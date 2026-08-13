"""CSV template, preflight, confirmation, progress, and safe result routes."""

from __future__ import annotations

import hashlib
import threading

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import desc, func, select

from backend.app.core.errors import problem_response
from backend.app.core.validation import normalize_idempotency_key
from backend.app.domain.imports import ImportValidationError, job_export, preflight_bytes, process_job, safe_upload_filename, template_csv
from backend.app.db.models import ImportJob, ImportRowOutcome
from backend.app.schemas.imports import ImportJobResponse, ImportListResponse, ImportPreflightResponse, ImportRowReport


router = APIRouter(prefix="/api/v1/imports", tags=["imports"])


def _start_job(request: Request, job_id: UUID) -> None:
    threading.Thread(
        target=process_job,
        kwargs={
            "session_factory": request.app.state.session_factory,
            "job_id": job_id,
            "model_service": getattr(request.app.state, "model_service", None),
            "settings": request.app.state.settings,
        },
        name=f"import-{job_id}",
        daemon=True,
    ).start()


def _session(request: Request):
    factory = getattr(request.app.state, "session_factory", None)
    return factory() if factory else None


def _job_response(job: ImportJob, *, rows: bool = False) -> ImportJobResponse:
    outcomes = list(job.row_outcomes or []) if rows else []
    succeeded = sum(item.status == "succeeded" for item in (job.row_outcomes or []))
    failed = sum(item.status == "failed" for item in (job.row_outcomes or []))
    total = job.total_rows or 0
    return ImportJobResponse(
        job_id=job.id, filename=job.filename, mode=job.mode, status=job.status,
        file_hash=job.file_sha256, created_at=job.created_at, updated_at=job.updated_at,
        total_rows=total, valid_rows=job.valid_rows, invalid_rows=job.invalid_rows,
        warning_rows=job.warning_rows,
        warning_count=job.warning_rows, processed_rows=job.processed_rows,
        succeeded_rows=succeeded, failed_rows=failed,
        progress_percent=(job.processed_rows / total * 100) if total else 0,
        idempotency_key=job.idempotency_key,
        confirmed_at=job.confirmed_at, cancelled_at=job.cancelled_at,
        rows=[ImportRowReport(
            row_number=item.row_number,
            customer_id=item.customer_id,
            status=item.status,
            warnings=item.warnings or [],
            errors=[{"field": issue.get("field") or "row", "code": issue.get("code") or "invalid_value", "message": issue.get("message") or "The row needs correction."} for issue in (item.errors or [])],
            result=item.result,
        ) for item in outcomes],
    )


async def _file_form(request: Request) -> tuple[bytes, str]:
    try:
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise ImportValidationError("import_file_invalid", "Provide one CSV file in the file field.")
        content_type = str(getattr(upload, "content_type", "") or "").lower()
        filename = safe_upload_filename(str(getattr(upload, "filename", "import.csv") or "import.csv"))
        if content_type not in {"", "text/csv", "application/csv", "text/plain", "application/octet-stream"}:
            raise ImportValidationError("import_file_invalid", "Upload a comma-separated UTF-8 CSV file.")
        content = await upload.read()
        return content, filename
    except ImportValidationError:
        raise
    except Exception as exc:
        raise ImportValidationError("import_file_invalid", "The uploaded file could not be read.") from exc


def _error(request: Request, exc: ImportValidationError) -> JSONResponse:
    status = 413 if exc.code == "import_limit_exceeded" else 409 if exc.code in {
        "import_mode_conflict",
        "import_not_ready",
        "import_already_active",
        "idempotency_conflict",
    } else 422
    return problem_response(request, status=status, code=exc.code, title="Import could not be processed", detail=str(exc))


def _idempotency_key(request: Request) -> tuple[str | None, JSONResponse | None]:
    try:
        key = normalize_idempotency_key(request.headers.get("Idempotency-Key"))
    except ValueError:
        return None, problem_response(
            request,
            status=400,
            code="idempotency_key_invalid",
            title="Invalid idempotency key",
            detail="Idempotency-Key must be visible ASCII text no longer than 128 characters.",
        )
    if key is None:
        return None, problem_response(
            request,
            status=400,
            code="idempotency_key_required",
            title="Idempotency key required",
            detail="Provide an Idempotency-Key for this import.",
        )
    return key, None


@router.get("/template")
async def download_template() -> Response:
    return Response(template_csv(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="customer-template.csv"'})


@router.post("/preflight", response_model=ImportPreflightResponse)
async def preflight(request: Request, mode: Literal["create", "update"] = Query(...)):
    try:
        content, filename = await _file_form(request)
        session = _session(request)
        if session is None:
            return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
        try:
            job, parsed, outcomes, conflicts, missing = preflight_bytes(session, content, filename=filename, mode=mode, settings=request.app.state.settings)
            session.commit()
        finally:
            session.close()
        errors = [issue for row in outcomes for issue in row.errors]
        warnings = [{"row_number": row.row_number, "customer_id": row.customer_id, **warning} for row in outcomes for warning in row.warnings]
        return ImportPreflightResponse(job_id=job.id, filename=job.filename, mode=job.mode, file_hash=job.file_sha256, detected_columns=parsed.columns, mappings=parsed.mappings, missing_columns=parsed.missing_columns, extra_columns=parsed.extra_columns, duplicate_columns=parsed.duplicate_columns, ambiguous_columns=parsed.ambiguous_columns, duplicate_customer_ids=sorted({row.customer_id for row in outcomes if row.customer_id and any(issue.get("code") == "duplicate_file_customer_id" for issue in row.errors)}), database_conflicts=conflicts, database_missing=missing, total_rows=job.total_rows, valid_rows=job.valid_rows, invalid_rows=job.invalid_rows, warning_rows=job.warning_rows, warning_count=job.warning_rows, warnings=warnings, errors=errors, sample_rows=parsed.sample_rows, proposed_idempotency_key=hashlib.sha256(content).hexdigest(), status=job.status)
    except ImportValidationError as exc:
        return _error(request, exc)


@router.post("", response_model=ImportJobResponse, status_code=202)
async def upload_import(
    request: Request,
    mode: Literal["create", "update"] = Query(...),
):
    """Upload and process in one bounded request for API clients without a UI."""

    key, key_error = _idempotency_key(request)
    if key_error is not None:
        return key_error
    try:
        content, filename = await _file_form(request)
        session = _session(request)
        if session is None:
            return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
        try:
            digest = hashlib.sha256(content).hexdigest()
            existing = session.scalar(
                select(ImportJob).where(ImportJob.idempotency_key == key).order_by(ImportJob.created_at.desc())
            )
            if existing is not None:
                if existing.file_sha256 != digest or existing.mode != mode:
                    return problem_response(
                        request,
                        status=409,
                        code="idempotency_conflict",
                        title="Idempotency key conflict",
                        detail="This key was already used for a different import.",
                    )
                return _job_response(existing, rows=True)
            job, _parsed, _outcomes, _conflicts, _missing = preflight_bytes(session, content, filename=filename, mode=mode, settings=request.app.state.settings)
            job.idempotency_key = key
            job.status = "queued"
            job.confirmed_at = datetime.now(UTC)
            session.commit()
            response = _job_response(job, rows=True)
        finally:
            session.close()
        _start_job(request, job.id)
        return response
    except ImportValidationError as exc:
        return _error(request, exc)


@router.get("", response_model=ImportListResponse)
async def list_imports(request: Request, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)):
    if page_size not in {25, 50, 100}:
        return problem_response(
            request,
            status=422,
            code="validation_failed",
            title="Request validation failed",
            detail="Page size must be 25, 50, or 100.",
        )
    session = _session(request)
    if session is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        total = int(session.scalar(select(func.count()).select_from(ImportJob)) or 0)
        jobs = list(session.scalars(select(ImportJob).order_by(desc(ImportJob.created_at)).offset((page - 1) * page_size).limit(page_size)))
        return {"items": [_job_response(job) for job in jobs], "total": total, "page": page, "page_size": page_size}
    finally:
        session.close()


@router.get("/{job_id}", response_model=ImportJobResponse)
async def get_import(request: Request, job_id: UUID):
    session = _session(request)
    if session is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        job = session.get(ImportJob, job_id)
        if job is None:
            return problem_response(request, status=404, code="not_found", title="Import not found", detail="The requested import job does not exist.")
        return _job_response(job, rows=True)
    finally:
        session.close()


@router.post("/{job_id}/confirm", response_model=ImportJobResponse)
async def confirm_import(request: Request, job_id: UUID):
    key, key_error = _idempotency_key(request)
    if key_error is not None:
        return key_error
    session = _session(request)
    if session is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        job = session.get(ImportJob, job_id)
        if job is None:
            return problem_response(request, status=404, code="not_found", title="Import not found", detail="The requested import job does not exist.")
        if job.status != "ready":
            if job.idempotency_key == key:
                return _job_response(job, rows=True)
            return problem_response(request, status=409, code="import_not_ready", title="Import is not ready", detail="Only a ready preflight can be confirmed.")
        job.status = "queued"
        job.idempotency_key = key
        job.confirmed_at = datetime.now(UTC)
        session.commit()
        response = _job_response(job, rows=True)
    finally:
        session.close()
    _start_job(request, job_id)
    return response


@router.post("/{job_id}/cancel", response_model=ImportJobResponse)
async def cancel_import(request: Request, job_id: UUID):
    session = _session(request)
    if session is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        job = session.get(ImportJob, job_id)
        if job is None:
            return problem_response(request, status=404, code="not_found", title="Import not found", detail="The requested import job does not exist.")
        if job.status in {"completed", "partially_completed", "failed", "cancelled"}:
            return _job_response(job, rows=True)
        job.status = "cancelled"; job.cancelled_at = __import__("datetime").datetime.now(__import__("datetime").UTC); job.raw_csv = None
        session.commit()
        return _job_response(job, rows=True)
    finally:
        session.close()


@router.get("/{job_id}/results.csv")
async def results_csv(request: Request, job_id: UUID):
    return await _export(request, job_id, errors=False)


@router.get("/{job_id}/results")
async def results(request: Request, job_id: UUID):
    return await _export(request, job_id, errors=False)


@router.get("/{job_id}/errors.csv")
async def errors_csv(request: Request, job_id: UUID):
    return await _export(request, job_id, errors=True)


@router.get("/{job_id}/errors")
async def errors(request: Request, job_id: UUID):
    return await _export(request, job_id, errors=True)


async def _export(request: Request, job_id: UUID, *, errors: bool) -> Response:
    session = _session(request)
    if session is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        job = session.get(ImportJob, job_id)
        if job is None:
            return problem_response(request, status=404, code="not_found", title="Import not found", detail="The requested import job does not exist.")
        if job.status not in {"completed", "partially_completed", "failed", "cancelled"}:
            return problem_response(request, status=409, code="import_not_ready", title="Import is not ready", detail="Results are available after processing.")
        return Response(job_export(job, errors=errors), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{job.id}-{"errors" if errors else "results"}.csv"'})
    finally:
        session.close()
