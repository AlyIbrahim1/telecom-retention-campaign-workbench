"""Customer and prediction routes for the core service.

The route module intentionally keeps the orchestration explicit: normalize,
score, then persist the customer and immutable prediction in one transaction.
CSV and chat callers can reuse the same ``normalize_customer_payload`` and
domain/model service functions without going through HTTP.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any, Literal

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import desc, func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.core.errors import problem_response
from backend.app.core.validation import normalize_idempotency_key
from backend.app.db.models import AuditEvent, Customer, IdempotencyRecord, Prediction
from backend.app.ml.service import ModelLoadError
from backend.app.schemas.customer import (
    CustomerInput,
    ValidationWarning,
    canonical_customer_id,
    normalize_customer_payload,
)
from backend.app.schemas.prediction import (
    AuditEventResponse,
    CustomerDetailResponse,
    CustomerListItemResponse,
    CustomerListResponse,
    CustomerMetadataResponse,
    CustomerPreviewResponse,
    CustomerRecordResponse,
    CustomerWriteResponse,
    PredictionHistoryResponse,
    PredictionResponse,
)


router = APIRouter(prefix="/api/v1", tags=["customers"])


def _validation_errors(exception: ValidationError) -> list[dict[str, str]]:
    """Convert Pydantic errors into safe, stable field-level problems."""

    errors: list[dict[str, str]] = []
    for item in exception.errors(include_url=False, include_context=False):
        location = item.get("loc", ())
        field = ".".join(str(part) for part in location) or "customer"
        error_type = str(item.get("type", "value_error"))
        if error_type == "missing":
            code = "missing_field"
        elif error_type == "extra_forbidden":
            code = "extra_field"
        elif error_type in {"int_type", "decimal_type", "float_type", "bool_type"}:
            code = "invalid_type"
        elif error_type in {"greater_than", "greater_equal", "less_than", "less_equal"}:
            code = "out_of_range"
        elif field == "customer":
            code = "cross_field_conflict"
        else:
            code = "invalid_value"
        errors.append({"field": field, "code": code, "message": "The value needs correction."})
    return errors or [{"field": "customer", "code": "invalid_value", "message": "The value needs correction."}]


def _validation_problem(request: Request, exception: ValidationError) -> JSONResponse:
    return problem_response(
        request,
        status=422,
        code="validation_failed",
        title="Request validation failed",
        detail="One or more fields need correction.",
        errors=_validation_errors(exception),
    )


def _missing_idempotency(request: Request) -> JSONResponse:
    return problem_response(
        request,
        status=400,
        code="idempotency_key_required",
        title="Idempotency key required",
        detail="Provide an Idempotency-Key for this write.",
    )


def _idempotency_key(request: Request, value: str | None) -> tuple[str | None, JSONResponse | None]:
    try:
        key = normalize_idempotency_key(value)
    except ValueError:
        return None, problem_response(
            request,
            status=400,
            code="idempotency_key_invalid",
            title="Invalid idempotency key",
            detail="Idempotency-Key must be visible ASCII text no longer than 128 characters.",
        )
    if key is None:
        return None, _missing_idempotency(request)
    return key, None


def _service_unavailable(request: Request, *, code: str = "service_unavailable") -> JSONResponse:
    return problem_response(
        request,
        status=503,
        code=code,
        title="Service unavailable",
        detail="The required local service is not ready.",
    )


def _model_service(request: Request):
    service = getattr(request.app.state, "model_service", None)
    return service


def _session(request: Request) -> Session | None:
    factory = getattr(request.app.state, "session_factory", None)
    return factory() if factory is not None else None


def _request_hash(customer: CustomerInput, *, mode: str, expected_version: int | None = None) -> str:
    payload = {
        "mode": mode,
        "expected_version": expected_version,
        "customer": customer.model_dump(mode="json"),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _problem_for_existing_key(
    request: Request,
    record: IdempotencyRecord,
    request_hash: str,
) -> JSONResponse | None:
    if record.request_hash != request_hash:
        return problem_response(
            request,
            status=409,
            code="idempotency_conflict",
            title="Idempotency key conflict",
            detail="This key was already used for a different customer write.",
        )
    return JSONResponse(status_code=record.status_code, content=record.response_body)


def _prediction_response(row: Prediction) -> PredictionResponse:
    warnings = [ValidationWarning(**warning) for warning in (row.warnings or [])]
    return PredictionResponse(
        customer_id=row.customer_id,
        risk_score=float(row.risk_score),
        recommended_for_review=row.recommended_for_review,
        model_version=row.model_version,
        threshold=float(row.threshold),
        threshold_policy_version=row.threshold_policy_version,
        scored_at=row.scored_at,
        warnings=warnings,
    )


def _customer_input(customer: Customer) -> CustomerInput:
    return CustomerInput.model_validate(customer.as_input_dict())


def _customer_record(
    customer: Customer,
    prediction: Prediction | None,
) -> CustomerRecordResponse:
    return CustomerRecordResponse(
        customer=_customer_input(customer),
        is_active=customer.is_active,
        version=customer.version,
        created_at=customer.created_at,
        updated_at=customer.updated_at,
        source=customer.source,
        current_prediction=_prediction_response(prediction) if prediction else None,
    )


def _latest_prediction_subquery():
    """Return one latest prediction row per customer for bounded list reads."""

    return (
        select(
            Prediction.id.label("prediction_id"),
            Prediction.customer_uuid.label("prediction_customer_uuid"),
            Prediction.customer_id.label("prediction_customer_id"),
            Prediction.risk_score.label("prediction_risk_score"),
            Prediction.recommended_for_review.label("prediction_recommended"),
            Prediction.model_version.label("prediction_model_version"),
            Prediction.threshold.label("prediction_threshold"),
            Prediction.threshold_policy_version.label("prediction_threshold_policy_version"),
            Prediction.scored_at.label("prediction_scored_at"),
            Prediction.warnings.label("prediction_warnings"),
            func.row_number()
            .over(
                partition_by=Prediction.customer_uuid,
                order_by=(Prediction.scored_at.desc(), Prediction.id.desc()),
            )
            .label("prediction_rank"),
        )
        .subquery("latest_prediction")
    )


def _list_prediction(row: Mapping[str, Any]) -> PredictionResponse | None:
    if row["prediction_id"] is None:
        return None
    warnings = [ValidationWarning(**warning) for warning in (row["prediction_warnings"] or [])]
    return PredictionResponse(
        customer_id=row["prediction_customer_id"],
        risk_score=float(row["prediction_risk_score"]),
        recommended_for_review=bool(row["prediction_recommended"]),
        model_version=row["prediction_model_version"],
        threshold=float(row["prediction_threshold"]),
        threshold_policy_version=row["prediction_threshold_policy_version"],
        scored_at=row["prediction_scored_at"],
        warnings=warnings,
    )


def _add_prediction(
    session: Session,
    customer: Customer,
    normalized: CustomerInput,
    prediction: PredictionResponse,
    request: Request,
    source: str,
    model_sha256: str,
) -> Prediction:
    snapshot = normalized.model_dump(mode="json")
    input_hash = hashlib.sha256(
        json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    row = Prediction(
        customer_uuid=customer.id,
        customer_id=normalized.customer_id,
        input_snapshot=snapshot,
        input_hash=input_hash,
        risk_score=prediction.risk_score,
        recommended_for_review=prediction.recommended_for_review,
        model_version=prediction.model_version,
        model_sha256=model_sha256,
        threshold=prediction.threshold,
        threshold_policy_version=prediction.threshold_policy_version,
        scored_at=prediction.scored_at,
        source=source,
        warnings=[warning.as_dict() for warning in prediction.warnings],
        success=True,
    )
    session.add(row)
    return row


def _audit(
    session: Session,
    customer: Customer,
    request: Request,
    *,
    action: str,
    source: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    idempotency_key: str | None = None,
) -> None:
    def json_snapshot(value: dict[str, Any] | None):
        return json.loads(json.dumps(value, default=float)) if value is not None else None

    session.add(
        AuditEvent(
            customer_uuid=customer.id,
            customer_id=customer.customer_id,
            action=action,
            actor="local-demo-user",
            source=source,
            before_snapshot=json_snapshot(before),
            after_snapshot=json_snapshot(after),
            correlation_id=getattr(request.state, "correlation_id", None),
            idempotency_key=idempotency_key,
        )
    )


def _load_customer(session: Session, customer_id: str) -> Customer | None:
    return session.scalar(select(Customer).where(Customer.customer_id == customer_id))


def _normalise(body: Mapping[str, Any], request: Request):
    try:
        return normalize_customer_payload(body)
    except ValidationError as exception:
        return _validation_problem(request, exception)
    except (TypeError, ValueError) as exception:
        return problem_response(
            request,
            status=422,
            code="validation_failed",
            title="Request validation failed",
            detail="One or more fields need correction.",
            errors=[
                {
                    "field": "customer",
                    "code": "invalid_value",
                    "message": "The value needs correction.",
                }
            ],
        )


@router.get("/meta/model")
async def model_metadata(request: Request):
    service = _model_service(request)
    if service is None:
        return _service_unavailable(request, code="model_unavailable")
    metadata = service.metadata
    return {
        "model_version": metadata.model_version,
        "model_sha256": metadata.model_sha256,
        "threshold": metadata.threshold,
        "threshold_policy_version": metadata.threshold_policy_version,
        "feature_columns": list(metadata.feature_columns),
        "positive_class": metadata.positive_class,
        "sklearn_version": metadata.sklearn_version,
    }


@router.get("/meta/customer-schema")
async def customer_schema():
    return {
        "schema_version": "customer-input-v1",
        "schema": CustomerInput.model_json_schema(),
    }


@router.get("/customers/metadata", response_model=CustomerMetadataResponse)
async def customer_metadata(request: Request):
    service = _model_service(request)
    if service is None:
        return _service_unavailable(request, code="model_unavailable")
    return CustomerMetadataResponse(
        model_version=service.metadata.model_version,
        threshold=service.metadata.threshold,
        threshold_policy_version=service.metadata.threshold_policy_version,
        fields=CustomerInput.model_json_schema().get("properties", {}),
    )


@router.get("/customers", response_model=CustomerListResponse)
async def list_customers(
    request: Request,
    q: str | None = Query(default=None, description="Partial or exact customer ID search."),
    page: int = Query(default=1, ge=1, le=10_000),
    page_size: int = Query(default=25, ge=25, le=100),
    recommended: bool | None = Query(default=None),
    score_freshness: Literal["fresh", "missing"] | None = Query(default=None),
    outreach_status: Literal["not_recorded", "none"] | None = Query(default=None),
    contract: Literal["Month-to-month", "One year", "Two year"] | None = Query(default=None),
    internet_service: Literal["DSL", "Fiber optic", "No"] | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    sort: Literal["customer_id", "risk_score", "monthly_charges", "total_charges", "last_scored_at"] = Query(
        default="last_scored_at"
    ),
    order: Literal["asc", "desc"] = Query(default="desc"),
):
    """Return a paginated, bounded customer table projection.

    Campaign/outreach tables are not present. An outreach
    filter of ``not_recorded``/``none`` means the nullable pilot field is
    empty for every customer.
    """

    if page_size not in {25, 50, 100}:
        return problem_response(
            request,
            status=422,
            code="validation_failed",
            title="Request validation failed",
            detail="page_size must be 25, 50, or 100.",
            errors=[
                {
                    "field": "page_size",
                    "code": "invalid_page_size",
                    "message": "Choose 25, 50, or 100 rows per page.",
                }
            ],
        )

    session = _session(request)
    if session is None:
        return _service_unavailable(request)

    latest = _latest_prediction_subquery()
    latest_join = (latest.c.prediction_customer_uuid == Customer.id) & (
        latest.c.prediction_rank == 1
    )
    filters = []
    if q and q.strip():
        # IDs are canonical uppercase; escaping keeps user-entered '%'/'_' as
        # literal search text rather than turning them into wildcards.
        search = q.strip().upper().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        filters.append(Customer.customer_id.ilike(f"%{search}%", escape="\\"))
    if recommended is not None:
        filters.append(latest.c.prediction_recommended == recommended)
    if score_freshness == "fresh":
        filters.append(latest.c.prediction_id.is_not(None))
    elif score_freshness == "missing":
        filters.append(latest.c.prediction_id.is_(None))
    if contract is not None:
        filters.append(Customer.contract == contract)
    if internet_service is not None:
        filters.append(Customer.internet_service == internet_service)
    if is_active is not None:
        filters.append(Customer.is_active == is_active)
    # No campaign/outreach table exists here. Both documented values
    # therefore select the currently unrecorded (NULL) state.
    # ``outreach_status`` is accepted for forward-compatible list links; the
    # current pilot has no outreach rows, so every customer is unrecorded.

    base = select(Customer.id).outerjoin(latest, latest_join)
    if filters:
        base = base.where(*filters)
    try:
        total = int(session.scalar(select(func.count()).select_from(base.subquery())) or 0)

        selected_columns = (
            Customer.customer_id,
            Customer.contract,
            Customer.internet_service,
            Customer.tenure,
            Customer.monthly_charges,
            Customer.total_charges,
            Customer.is_active,
            Customer.version,
            latest.c.prediction_id,
            latest.c.prediction_customer_id,
            latest.c.prediction_risk_score,
            latest.c.prediction_recommended,
            latest.c.prediction_model_version,
            latest.c.prediction_threshold,
            latest.c.prediction_threshold_policy_version,
            latest.c.prediction_scored_at,
            latest.c.prediction_warnings,
        )
        query = select(*selected_columns).outerjoin(latest, latest_join)
        if filters:
            query = query.where(*filters)
        sort_columns = {
            "customer_id": Customer.customer_id,
            "risk_score": latest.c.prediction_risk_score,
            "monthly_charges": Customer.monthly_charges,
            "total_charges": Customer.total_charges,
            "last_scored_at": latest.c.prediction_scored_at,
        }
        sort_column = sort_columns[sort]
        sort_expression = sort_column.desc().nullslast() if order == "desc" else sort_column.asc().nullsfirst()
        rows = session.execute(
            query.order_by(sort_expression, Customer.customer_id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).mappings()
        items = []
        for row in rows:
            prediction = _list_prediction(row)
            items.append(
                CustomerListItemResponse(
                    customer_id=row["customer_id"],
                    contract=row["contract"],
                    internet_service=row["internet_service"],
                    tenure=row["tenure"],
                    monthly_charges=float(row["monthly_charges"]),
                    total_charges=float(row["total_charges"]),
                    risk_score=float(row["prediction_risk_score"])
                    if row["prediction_risk_score"] is not None
                    else None,
                    recommended_for_review=row["prediction_recommended"],
                    last_scored_at=row["prediction_scored_at"],
                    current_prediction=prediction,
                    outreach_status=None,
                    is_active=row["is_active"],
                    version=row["version"],
                )
            )
        return CustomerListResponse(items=items, total=total, page=page, page_size=page_size)
    except SQLAlchemyError:
        return _service_unavailable(request)
    finally:
        session.close()


@router.post("/customers/preview", response_model=CustomerPreviewResponse)
async def preview_customer(request: Request, body: dict[str, Any] = Body(...)):
    normalized = _normalise(body, request)
    if isinstance(normalized, JSONResponse):
        return normalized
    service = _model_service(request)
    if service is None:
        return _service_unavailable(request, code="model_unavailable")
    try:
        prediction = service.predict(normalized.customer, normalized.warnings)
    except ModelLoadError:
        return _service_unavailable(request, code="prediction_failed")
    return CustomerPreviewResponse(
        normalized_customer=normalized.customer,
        prediction=prediction,
        warnings=normalized.warnings,
    )


@router.post("/customers", response_model=CustomerWriteResponse, status_code=201)
async def create_customer(
    request: Request,
    body: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    idempotency_key, key_error = _idempotency_key(request, idempotency_key)
    if key_error is not None:
        return key_error
    normalized = _normalise(body, request)
    if isinstance(normalized, JSONResponse):
        return normalized
    service = _model_service(request)
    if service is None:
        return _service_unavailable(request, code="model_unavailable")
    try:
        prediction = service.predict(normalized.customer, normalized.warnings)
    except ModelLoadError:
        return _service_unavailable(request, code="prediction_failed")
    session = _session(request)
    if session is None:
        return _service_unavailable(request)
    request_hash = _request_hash(normalized.customer, mode="create")
    try:
        with session.begin():
            existing_key = session.scalar(
                select(IdempotencyRecord).where(
                    IdempotencyRecord.scope == "customer:create",
                    IdempotencyRecord.key == idempotency_key,
                )
            )
            if existing_key is not None:
                replay = _problem_for_existing_key(request, existing_key, request_hash)
                if replay is not None:
                    return replay
            existing = _load_customer(session, normalized.customer.customer_id)
            if existing is not None:
                return problem_response(
                    request,
                    status=409,
                    code="duplicate_customer_id",
                    title="Customer already exists",
                    detail="Create uses a new customer ID; choose the explicit update action for an existing record.",
                )
            customer = Customer(**normalized.customer.model_dump(mode="python"), source="form")
            session.add(customer)
            session.flush()
            prediction_row = _add_prediction(
                session,
                customer,
                normalized.customer,
                prediction,
                request,
                "form",
                service.metadata.model_sha256,
            )
            _audit(
                session,
                customer,
                request,
                action="customer_created",
                source="form",
                before=None,
                after=normalized.customer.model_dump(mode="json"),
                idempotency_key=idempotency_key,
            )
            session.flush()
            response = CustomerWriteResponse(
                customer=_customer_record(customer, prediction_row),
                prediction=prediction,
            )
            session.add(
                IdempotencyRecord(
                    scope="customer:create",
                    key=idempotency_key,
                    request_hash=request_hash,
                    status_code=201,
                    response_body=response.model_dump(mode="json"),
                )
            )
            return response
    except IntegrityError:
        session.rollback()
        return problem_response(
            request,
            status=409,
            code="duplicate_customer_id",
            title="Customer already exists",
            detail="Create uses a new customer ID; choose the explicit update action for an existing record.",
        )
    except SQLAlchemyError:
        session.rollback()
        return _service_unavailable(request)
    finally:
        session.close()


@router.get("/customers/{customer_id}", response_model=CustomerDetailResponse)
async def get_customer(request: Request, customer_id: str):
    try:
        normalized_id = canonical_customer_id(customer_id)
    except ValueError:
        return problem_response(
            request,
            status=404,
            code="customer_not_found",
            title="Customer not found",
            detail="The requested customer does not exist.",
        )
    session = _session(request)
    if session is None:
        return _service_unavailable(request)
    try:
        customer = _load_customer(session, normalized_id)
        if customer is None:
            return problem_response(
                request,
                status=404,
                code="customer_not_found",
                title="Customer not found",
                detail="The requested customer does not exist.",
            )
        prediction_rows = list(
            session.scalars(
                select(Prediction)
                .where(Prediction.customer_uuid == customer.id)
                .order_by(desc(Prediction.scored_at))
            )
        )
        audit_rows = list(
            session.scalars(
                select(AuditEvent)
                .where(AuditEvent.customer_uuid == customer.id)
                .order_by(desc(AuditEvent.created_at))
            )
        )
        current = prediction_rows[0] if prediction_rows else None
        return CustomerDetailResponse(
            **_customer_record(customer, current).model_dump(),
            predictions=[_prediction_response(row) for row in prediction_rows],
            audit_events=[
                AuditEventResponse(
                    event_id=str(row.id),
                    action=row.action,
                    actor=row.actor,
                    source=row.source,
                    created_at=row.created_at,
                    before=row.before_snapshot,
                    after=row.after_snapshot,
                    correlation_id=row.correlation_id,
                )
                for row in audit_rows
            ],
        )
    except SQLAlchemyError:
        return _service_unavailable(request)
    finally:
        session.close()


@router.post("/customers/{customer_id}/preview-update", response_model=CustomerPreviewResponse)
async def preview_update_customer(request: Request, customer_id: str, body: dict[str, Any] = Body(...)):
    try:
        normalized_id = canonical_customer_id(customer_id)
    except ValueError:
        return problem_response(request, status=404, code="customer_not_found", title="Customer not found", detail="The requested customer does not exist.")
    normalized = _normalise(body, request)
    if isinstance(normalized, JSONResponse):
        return normalized
    if normalized.customer.customer_id != normalized_id:
        return problem_response(
            request,
            status=422,
            code="validation_failed",
            title="Request validation failed",
            detail="The customer ID in the path and body must match.",
            errors=[{"field": "customer_id", "code": "invalid_customer_id", "message": "The value needs correction."}],
        )
    service = _model_service(request)
    if service is None:
        return _service_unavailable(request, code="model_unavailable")
    session = _session(request)
    if session is None:
        return _service_unavailable(request)
    try:
        if _load_customer(session, normalized_id) is None:
            return problem_response(request, status=404, code="customer_not_found", title="Customer not found", detail="The requested customer does not exist.")
    finally:
        session.close()
    try:
        prediction = service.predict(normalized.customer, normalized.warnings)
    except ModelLoadError:
        return _service_unavailable(request, code="prediction_failed")
    return CustomerPreviewResponse(normalized_customer=normalized.customer, prediction=prediction, warnings=normalized.warnings)


@router.put("/customers/{customer_id}", response_model=CustomerWriteResponse)
async def update_customer(
    request: Request,
    customer_id: str,
    body: dict[str, Any] = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    if_match: str | None = Header(default=None, alias="If-Match"),
):
    idempotency_key, key_error = _idempotency_key(request, idempotency_key)
    if key_error is not None:
        return key_error
    if not if_match:
        return problem_response(request, status=400, code="invalid_request", title="Expected version required", detail="Provide If-Match with the current customer version.")
    try:
        normalized_id = canonical_customer_id(customer_id)
        expected_version = int(if_match.strip().strip('"'))
    except (ValueError, TypeError):
        return problem_response(request, status=400, code="invalid_request", title="Expected version required", detail="If-Match must contain the integer customer version.")
    normalized = _normalise(body, request)
    if isinstance(normalized, JSONResponse):
        return normalized
    if normalized.customer.customer_id != normalized_id:
        return problem_response(request, status=422, code="validation_failed", title="Request validation failed", detail="The customer ID in the path and body must match.", errors=[{"field": "customer_id", "code": "invalid_customer_id", "message": "The value needs correction."}])
    service = _model_service(request)
    if service is None:
        return _service_unavailable(request, code="model_unavailable")
    try:
        prediction = service.predict(normalized.customer, normalized.warnings)
    except ModelLoadError:
        return _service_unavailable(request, code="prediction_failed")
    session = _session(request)
    if session is None:
        return _service_unavailable(request)
    request_hash = _request_hash(normalized.customer, mode="update", expected_version=expected_version)
    try:
        with session.begin():
            existing_key = session.scalar(select(IdempotencyRecord).where(IdempotencyRecord.scope == "customer:update", IdempotencyRecord.key == idempotency_key))
            if existing_key is not None:
                replay = _problem_for_existing_key(request, existing_key, request_hash)
                if replay is not None:
                    return replay
            customer = _load_customer(session, normalized_id)
            if customer is None:
                return problem_response(request, status=404, code="customer_not_found", title="Customer not found", detail="The requested customer does not exist.")
            if customer.version != expected_version:
                return problem_response(request, status=409, code="customer_version_conflict", title="Customer changed", detail="Reload the customer, review the latest values, and apply the update again.")
            before = {**customer.as_input_dict(), "version": customer.version}
            values = normalized.customer.model_dump(mode="python")
            values.pop("customer_id")
            for field, value in values.items():
                setattr(customer, field, value)
            customer.version += 1
            customer.source = "form"
            session.flush()
            prediction_row = _add_prediction(session, customer, normalized.customer, prediction, request, "form", service.metadata.model_sha256)
            _audit(session, customer, request, action="customer_updated", source="form", before=before, after={**normalized.customer.model_dump(mode="json"), "version": customer.version}, idempotency_key=idempotency_key)
            session.flush()
            response = CustomerWriteResponse(customer=_customer_record(customer, prediction_row), prediction=prediction)
            session.add(IdempotencyRecord(scope="customer:update", key=idempotency_key, request_hash=request_hash, status_code=200, response_body=response.model_dump(mode="json")))
            return response
    except IntegrityError:
        session.rollback()
        return _service_unavailable(request)
    except SQLAlchemyError:
        session.rollback()
        return _service_unavailable(request)
    finally:
        session.close()


@router.get("/customers/{customer_id}/predictions", response_model=PredictionHistoryResponse)
async def prediction_history(request: Request, customer_id: str):
    try:
        normalized_id = canonical_customer_id(customer_id)
    except ValueError:
        normalized_id = ""
    session = _session(request)
    if session is None:
        return _service_unavailable(request)
    try:
        customer = _load_customer(session, normalized_id)
        if customer is None:
            return problem_response(request, status=404, code="customer_not_found", title="Customer not found", detail="The requested customer does not exist.")
        rows = list(session.scalars(select(Prediction).where(Prediction.customer_uuid == customer.id).order_by(desc(Prediction.scored_at))))
        return PredictionHistoryResponse(customer_id=customer.customer_id, predictions=[_prediction_response(row) for row in rows])
    finally:
        session.close()


@router.get("/customers/{customer_id}/audit-events", response_model=list[AuditEventResponse])
@router.get("/customers/{customer_id}/audit", response_model=list[AuditEventResponse], include_in_schema=False)
async def audit_history(request: Request, customer_id: str):
    try:
        normalized_id = canonical_customer_id(customer_id)
    except ValueError:
        normalized_id = ""
    session = _session(request)
    if session is None:
        return _service_unavailable(request)
    try:
        customer = _load_customer(session, normalized_id)
        if customer is None:
            return problem_response(request, status=404, code="customer_not_found", title="Customer not found", detail="The requested customer does not exist.")
        rows = list(session.scalars(select(AuditEvent).where(AuditEvent.customer_uuid == customer.id).order_by(desc(AuditEvent.created_at))))
        return [
            AuditEventResponse(event_id=str(row.id), action=row.action, actor=row.actor, source=row.source, created_at=row.created_at, before=row.before_snapshot, after=row.after_snapshot, correlation_id=row.correlation_id)
            for row in rows
        ]
    finally:
        session.close()
