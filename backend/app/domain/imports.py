"""Bounded CSV validation, preflight, processing, and safe exports."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Iterable
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings
from backend.app.db.models import AuditEvent, Customer, ImportJob, ImportRowOutcome, Prediction
from backend.app.ml.service import ModelService
from backend.app.schemas.customer import CSV_TO_CANONICAL, CustomerInput, NormalizedCustomer, ValidationWarning, normalize_csv_row


TEMPLATE_COLUMNS = [
    "customerID", "gender", "SeniorCitizen", "Partner", "Dependents", "tenure",
    "PhoneService", "MultipleLines", "InternetService", "OnlineSecurity", "OnlineBackup",
    "DeviceProtection", "TechSupport", "StreamingTV", "StreamingMovies", "Contract",
    "PaperlessBilling", "PaymentMethod", "MonthlyCharges", "TotalCharges",
]
REQUIRED_COLUMNS = set(CSV_TO_CANONICAL.values())
STATUS_VALID = "valid"
STATUS_INVALID = "invalid"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"


class ImportValidationError(ValueError):
    def __init__(self, code: str, message: str, *, field: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.field = field


_UNSAFE_FILENAME_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")


def safe_upload_filename(value: Any) -> str:
    """Keep filename metadata safe without using it for filesystem paths."""

    if not isinstance(value, str):
        raise ImportValidationError("import_file_invalid", "Upload a comma-separated UTF-8 CSV file.")
    # Browsers may send a full Windows path.  Store only its final component;
    # the application never uses this value as a temporary filesystem name.
    filename = value.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not filename or _UNSAFE_FILENAME_CHARACTERS.search(filename):
        raise ImportValidationError("import_file_invalid", "The uploaded filename is invalid.")
    if len(filename) > 255:
        raise ImportValidationError("import_limit_exceeded", "The uploaded filename is too long.")
    if not filename.lower().endswith(".csv"):
        raise ImportValidationError("import_file_invalid", "Upload a comma-separated UTF-8 CSV file.")
    return filename


@dataclass
class ParsedImport:
    columns: list[str]
    mappings: dict[str, str]
    rows: list[dict[str, str]]
    sample_rows: list[dict[str, str]]
    missing_columns: list[str]
    extra_columns: list[str]
    duplicate_columns: list[str]
    ambiguous_columns: list[str]


def template_csv() -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(TEMPLATE_COLUMNS)
    return output.getvalue().encode("utf-8")


def _safe_text(value: str) -> str:
    text = str(value)
    if text.startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def safe_export_cell(value: Any) -> str:
    """Neutralize spreadsheet formulas in user-controlled exported cells."""

    return _safe_text("" if value is None else str(value))


def _parse_csv(content: bytes, settings: Settings) -> ParsedImport:
    if len(content) > settings.import_max_file_bytes:
        raise ImportValidationError("import_limit_exceeded", "The CSV exceeds the file-size limit.")
    if not content:
        raise ImportValidationError("import_file_invalid", "The CSV file is empty.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ImportValidationError("import_file_invalid", "The CSV must use UTF-8 encoding.") from exc
    if "\x00" in text:
        raise ImportValidationError("import_file_invalid", "The CSV contains unsupported binary content.")
    try:
        reader = csv.reader(io.StringIO(text), strict=True)
        columns = next(reader)
        rows = list(reader)
    except (csv.Error, StopIteration) as exc:
        raise ImportValidationError("import_file_invalid", "The CSV must contain a header and valid comma-separated rows.") from exc
    if not columns or not any(column.strip() for column in columns):
        raise ImportValidationError("import_file_invalid", "The CSV header is empty.")
    first_line = text.splitlines()[0] if text.splitlines() else ""
    if len(columns) == 1 and any(delimiter in first_line for delimiter in (";", "\t", "|")):
        raise ImportValidationError(
            "import_file_invalid",
            "The CSV must use a comma delimiter.",
        )
    if not rows:
        raise ImportValidationError("import_file_invalid", "The CSV must contain at least one data row.")
    if len(columns) > settings.import_max_columns:
        raise ImportValidationError("import_limit_exceeded", "The CSV exceeds the column limit.")
    if len(rows) > settings.import_max_rows:
        raise ImportValidationError("import_limit_exceeded", "The CSV exceeds the row limit.")
    normalized_columns = [column.strip() for column in columns]
    duplicate_columns = sorted({column for column in normalized_columns if normalized_columns.count(column) > 1})
    mappings: dict[str, str] = {}
    ambiguous: list[str] = []
    for column in normalized_columns:
        canonical = CSV_TO_CANONICAL.get(column)
        if canonical is None:
            continue
        if canonical in mappings.values():
            ambiguous.append(column)
        mappings[column] = canonical
    mapped_values = set(mappings.values())
    missing = sorted(REQUIRED_COLUMNS.difference(mapped_values))
    extra = sorted(set(normalized_columns).difference(CSV_TO_CANONICAL))
    # Accept either the original IBM headings or the explicit snake_case
    # equivalents, but never a mixture that maps two headings to one field.
    if not duplicate_columns and not ambiguous and not missing and not extra:
        pass
    if any(len(row) != len(normalized_columns) for row in rows):
        raise ImportValidationError("import_file_invalid", "Every CSV row must have the same number of columns as the header.")
    return ParsedImport(
        columns=normalized_columns,
        mappings=mappings,
        rows=[dict(zip(normalized_columns, row, strict=True)) for row in rows],
        sample_rows=[dict(zip(normalized_columns, row, strict=True)) for row in rows[:5]],
        missing_columns=missing,
        extra_columns=extra,
        duplicate_columns=duplicate_columns,
        ambiguous_columns=sorted(set(ambiguous)),
    )


def _issue(row_number: int, code: str, message: str, *, customer_id: str | None = None, field: str | None = None) -> dict[str, Any]:
    return {"row_number": row_number, "customer_id": customer_id, "field": field, "code": code, "message": message}


def _duplicate_ids(rows: Iterable[dict[str, str]]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for row in rows:
        value = row.get("customerID") or row.get("customer_id") or ""
        normalized = value.strip().upper()
        if normalized and normalized in seen:
            duplicates.add(normalized)
        if normalized:
            seen.add(normalized)
    return sorted(duplicates)


def _canonical_row(row: dict[str, str]) -> dict[str, Any]:
    return {CSV_TO_CANONICAL[key]: value for key, value in row.items() if key in CSV_TO_CANONICAL}


def preflight_bytes(session: Session, content: bytes, *, filename: str, mode: str, settings: Settings) -> tuple[ImportJob, ParsedImport, list[ImportRowOutcome], list[str], list[str]]:
    if mode not in {"create", "update"}:
        raise ImportValidationError("import_mode_conflict", "Import mode must be create or update.")
    active = session.scalar(
        select(ImportJob.id).where(ImportJob.status.in_(["uploaded", "validating", "ready", "queued", "running"]))
    )
    if active is not None:
        raise ImportValidationError("import_already_active", "Only one import job may be active in the local pilot.")
    filename = safe_upload_filename(filename)
    parsed = _parse_csv(content, settings)
    duplicate_ids = _duplicate_ids(parsed.rows)
    ids = sorted({(row.get("customerID") or row.get("customer_id") or "").strip().upper() for row in parsed.rows if (row.get("customerID") or row.get("customer_id"))})
    existing_ids = set(session.scalars(select(Customer.customer_id).where(Customer.customer_id.in_(ids)))) if ids else set()
    database_conflicts = sorted(existing_ids) if mode == "create" else []
    database_missing = sorted(set(ids).difference(existing_ids)) if mode == "update" else []
    outcomes: list[ImportRowOutcome] = []
    valid = invalid = warning_rows = 0
    for index, row in enumerate(parsed.rows, start=2):
        customer_id = (row.get("customerID") or row.get("customer_id") or "").strip().upper() or None
        errors: list[dict[str, str]] = []
        warnings: list[dict[str, str]] = []
        normalized: NormalizedCustomer | None = None
        try:
            if parsed.missing_columns or parsed.extra_columns or parsed.duplicate_columns or parsed.ambiguous_columns:
                raise ImportValidationError("import_schema_invalid", "CSV columns do not match the canonical template.")
            normalized = normalize_csv_row(row)
            customer_id = normalized.customer.customer_id
            warnings = [warning.as_dict() for warning in normalized.warnings]
            if customer_id in duplicate_ids:
                errors.append({"field": "customer_id", "code": "duplicate_file_customer_id", "message": "The customer ID occurs more than once in this file."})
            if mode == "create" and customer_id in existing_ids:
                errors.append({"field": "customer_id", "code": "customer_already_exists", "message": "The customer already exists for create mode."})
            if mode == "update" and customer_id not in existing_ids:
                errors.append({"field": "customer_id", "code": "customer_missing_for_update", "message": "The customer does not exist for update mode."})
        except ImportValidationError as exc:
            errors.append({"field": exc.field or "row", "code": exc.code, "message": str(exc)})
        except Exception:
            errors.append({"field": "row", "code": "invalid_value", "message": "The row needs correction."})
        if errors:
            invalid += 1
            status = STATUS_INVALID
        else:
            valid += 1
            warning_rows += bool(warnings)
            status = STATUS_VALID
        outcomes.append(ImportRowOutcome(row_number=index, customer_id=customer_id, status=status, normalized_snapshot=normalized.customer.model_dump(mode="json") if normalized else None, warnings=warnings, errors=errors))
    job = ImportJob(id=uuid4(), filename=filename[:255], content_type="text/csv", file_sha256=hashlib.sha256(content).hexdigest(), raw_csv=content, mode=mode, status="ready", total_rows=len(parsed.rows), valid_rows=valid, invalid_rows=invalid, warning_rows=warning_rows)
    session.add(job)
    session.flush()
    for outcome in outcomes:
        outcome.import_job_id = job.id
        session.add(outcome)
    session.flush()
    return job, parsed, outcomes, database_conflicts, database_missing


def process_job(session_factory: Any, job_id: UUID, *, model_service: ModelService | None, settings: Settings) -> ImportJob:
    session = session_factory()
    job: ImportJob | None = None
    try:
        job = session.get(ImportJob, job_id)
        if job is None:
            raise ImportValidationError("not_found", "Import job not found.")
        if job.status == "cancelled":
            return job
        if job.status not in {"ready", "queued"}:
            return job
        if model_service is None:
            job.status = "failed"
            job.raw_csv = None
            session.commit()
            return job
        job.status = "running"
        session.commit()
        outcomes = list(session.scalars(select(ImportRowOutcome).where(ImportRowOutcome.import_job_id == job.id).order_by(ImportRowOutcome.row_number)))
        for chunk_start in range(0, len(outcomes), settings.import_chunk_size):
            chunk = outcomes[chunk_start : chunk_start + settings.import_chunk_size]
            for outcome in chunk:
                session.expire(job)
                session.refresh(job)
                if job.status == "cancelled":
                    break
                if outcome.status != STATUS_VALID:
                    continue
                row_session = session_factory()
                try:
                    customer_data = CustomerInput.model_validate(outcome.normalized_snapshot or {})
                    prediction = model_service.predict(
                        customer_data,
                        [
                            # Warning dictionaries were retained during preflight;
                            # the prediction snapshot preserves them unchanged.
                            ValidationWarning(**warning)
                            for warning in (outcome.warnings or [])
                        ],
                    )
                    customer = row_session.scalar(select(Customer).where(Customer.customer_id == customer_data.customer_id))
                    if job.mode == "create":
                        if customer is not None:
                            raise ImportValidationError("customer_already_exists", "The customer already exists.")
                        customer = Customer(**customer_data.model_dump(mode="python"), source="csv")
                        row_session.add(customer)
                    elif customer is None:
                        raise ImportValidationError("customer_missing_for_update", "The customer does not exist.")
                    else:
                        values = customer_data.model_dump(mode="python")
                        values.pop("customer_id")
                        for field, value in values.items():
                            setattr(customer, field, value)
                        customer.version += 1
                        customer.source = "csv"
                    row_session.flush()
                    snapshot = customer_data.model_dump(mode="json")
                    row_session.add(
                        Prediction(
                            customer_uuid=customer.id,
                            customer_id=customer.customer_id,
                            input_snapshot=snapshot,
                            input_hash=hashlib.sha256(
                                json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()
                            ).hexdigest(),
                            risk_score=prediction.risk_score,
                            recommended_for_review=prediction.recommended_for_review,
                            model_version=prediction.model_version,
                            model_sha256=model_service.metadata.model_sha256,
                            threshold=prediction.threshold,
                            threshold_policy_version=prediction.threshold_policy_version,
                            scored_at=prediction.scored_at,
                            source="csv",
                            warnings=[warning.model_dump() for warning in prediction.warnings],
                            success=True,
                        )
                    )
                    row_session.add(
                        AuditEvent(
                            customer_uuid=customer.id,
                            customer_id=customer.customer_id,
                            action="customer_imported",
                            actor="local-demo-user",
                            source="csv",
                            after_snapshot=snapshot,
                        )
                    )
                    row_session.commit()
                    outcome.status = STATUS_SUCCEEDED
                    outcome.result = prediction.model_dump(mode="json")
                    job.processed_rows += 1
                    session.commit()
                except Exception:
                    row_session.rollback()
                    outcome.status = STATUS_FAILED
                    outcome.errors = [
                        {
                            "field": "row",
                            "code": "prediction_failed",
                            "message": "The row could not be scored or persisted.",
                        }
                    ]
                    job.processed_rows += 1
                    session.commit()
                finally:
                    row_session.close()
            session.expire(job)
            session.refresh(job)
            if job.status == "cancelled":
                break
        if job.status != "cancelled":
            job.status = "partially_completed" if any(
                item.status in {STATUS_FAILED, STATUS_INVALID} for item in outcomes
            ) else "completed"
        job.raw_csv = None
        session.commit()
        return job
    except Exception:
        session.rollback()
        if job is not None:
            job = session.get(ImportJob, job_id)
            if job is not None:
                job.status = "failed"
                job.raw_csv = None
                session.commit()
                return job
        raise
    finally:
        session.close()


def job_export(job: ImportJob, *, errors: bool) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    if errors:
        writer.writerow(["row_number", "customer_id", "field", "code", "message"])
        for row in job.row_outcomes:
            for issue in (row.errors or []):
                writer.writerow([row.row_number, safe_export_cell(row.customer_id), safe_export_cell(issue.get("field")), safe_export_cell(issue.get("code")), safe_export_cell(issue.get("message"))])
    else:
        writer.writerow(["row_number", "customer_id", "status", "risk_score", "recommended_for_review", "warnings"])
        for row in job.row_outcomes:
            result = row.result or {}
            writer.writerow([row.row_number, safe_export_cell(row.customer_id), row.status, safe_export_cell(result.get("risk_score")), safe_export_cell(result.get("recommended_for_review")), safe_export_cell(json.dumps(row.warnings or []))])
    return output.getvalue().encode("utf-8")
