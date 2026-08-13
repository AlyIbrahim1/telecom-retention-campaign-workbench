"""Grounded, allowlisted chat tools and staged customer writes."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from backend.app.db.models import (
    AuditEvent,
    Campaign,
    CampaignRecommendation,
    CampaignSelection,
    ChatSession,
    ChatStagedAction,
    Customer,
    OptimizationRun,
    Prediction,
)
from backend.app.core.validation import normalize_idempotency_key, validate_confirmation_token
from backend.app.ml.service import ModelService
from backend.app.schemas.chat import ChatStagedActionResponse
from backend.app.schemas.customer import CustomerInput, normalize_customer_payload
from backend.app.schemas.prediction import PredictionResponse


class ChatError(ValueError):
    def __init__(self, code: str, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


ALLOWLISTED_TOOLS = {
    "get_customer",
    "get_customer_prediction",
    "get_customer_campaigns",
    "get_campaign_summary",
    "preview_customer_create",
    "preview_customer_update",
}

# The provider sees only these function contracts.  Confirmation is deliberately
# an HTTP/UI action, not an provider tool.
TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "get_customer",
        "description": "Retrieve one customer by exact customer ID.",
        "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"], "additionalProperties": False},
    },
    {
        "type": "function",
        "name": "get_customer_prediction",
        "description": "Retrieve one customer's latest immutable model output.",
        "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"], "additionalProperties": False},
    },
    {
        "type": "function",
        "name": "get_customer_campaigns",
        "description": "Retrieve bounded campaign history for one exact customer ID.",
        "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"], "additionalProperties": False},
    },
    {
        "type": "function",
        "name": "get_campaign_summary",
        "description": "Retrieve one campaign's bounded summary and selected count.",
        "parameters": {"type": "object", "properties": {"campaign_id": {"type": "string", "format": "uuid"}}, "required": ["campaign_id"], "additionalProperties": False},
    },
    {
        "type": "function",
        "name": "preview_customer_create",
        "description": "Validate and score one complete customer before create confirmation.",
        "parameters": {"type": "object", "properties": {"customer": {"type": "object"}}, "required": ["customer"], "additionalProperties": False},
    },
    {
        "type": "function",
        "name": "preview_customer_update",
        "description": "Validate and score one complete existing customer before update confirmation.",
        "parameters": {"type": "object", "properties": {"customer": {"type": "object"}, "expected_version": {"type": "integer", "minimum": 1}}, "required": ["customer", "expected_version"], "additionalProperties": False},
    },
]


def request_hash(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest()


def _safe_snapshot(value: dict[str, Any] | None) -> dict[str, Any] | None:
    return json.loads(json.dumps(value, default=float)) if value is not None else None


def _prediction_response(row: Prediction) -> PredictionResponse:
    return PredictionResponse(
        customer_id=row.customer_id,
        risk_score=float(row.risk_score),
        recommended_for_review=row.recommended_for_review,
        model_version=row.model_version,
        threshold=float(row.threshold),
        threshold_policy_version=row.threshold_policy_version,
        scored_at=row.scored_at,
        warnings=row.warnings or [],
    )


def _add_prediction(session: Session, customer: Customer, normalized: CustomerInput, prediction: PredictionResponse, model_sha256: str) -> Prediction:
    snapshot = normalized.model_dump(mode="json")
    row = Prediction(
        customer_uuid=customer.id,
        customer_id=normalized.customer_id,
        input_snapshot=snapshot,
        input_hash=request_hash(snapshot),
        risk_score=prediction.risk_score,
        recommended_for_review=prediction.recommended_for_review,
        model_version=prediction.model_version,
        model_sha256=model_sha256,
        threshold=prediction.threshold,
        threshold_policy_version=prediction.threshold_policy_version,
        scored_at=prediction.scored_at,
        source="chat",
        warnings=[warning.as_dict() for warning in prediction.warnings],
        success=True,
    )
    session.add(row)
    return row


def _customer_result(customer: Customer, prediction: Prediction | None) -> dict[str, Any]:
    return {
        "customer": customer.as_input_dict(),
        "is_active": customer.is_active,
        "version": customer.version,
        "source": customer.source,
        "current_prediction": _prediction_response(prediction).model_dump(mode="json") if prediction else None,
    }


def _latest_prediction(session: Session, customer: Customer) -> Prediction | None:
    return session.scalar(
        select(Prediction)
        .where(Prediction.customer_uuid == customer.id, Prediction.success.is_(True))
        .order_by(desc(Prediction.scored_at), desc(Prediction.id))
    )


def _customer(session: Session, customer_id: object) -> Customer:
    from backend.app.schemas.customer import canonical_customer_id

    try:
        normalized_id = canonical_customer_id(customer_id)
    except ValueError as exc:
        raise ChatError("customer_not_found", "The requested customer does not exist.", 404) from exc
    row = session.scalar(select(Customer).where(Customer.customer_id == normalized_id))
    if row is None:
        raise ChatError("customer_not_found", "The requested customer does not exist.", 404)
    return row


def _campaign_uuid(value: object) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise ChatError("campaign_not_found", "The requested campaign does not exist.", 404) from exc


def execute_read_tool(session: Session, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Execute exactly one allowlisted, bounded read/preview operation."""

    if tool_name not in ALLOWLISTED_TOOLS:
        raise ChatError("chat_tool_not_allowed", "That chatbot capability is not available.", 403)
    if not isinstance(arguments, dict) or arguments.get("_malformed"):
        raise ChatError("staged_action_invalid", "The tool arguments need correction.", 409)
    expected_keys = {
        "get_customer": {"customer_id"},
        "get_customer_prediction": {"customer_id"},
        "get_customer_campaigns": {"customer_id"},
        "get_campaign_summary": {"campaign_id"},
    }.get(tool_name, set())
    if set(arguments) != expected_keys:
        raise ChatError("staged_action_invalid", "The tool arguments need correction.", 409)
    if tool_name in {"get_customer", "get_customer_prediction", "get_customer_campaigns"}:
        customer = _customer(session, arguments.get("customer_id"))
        if tool_name == "get_customer":
            return json.loads(json.dumps({"label": "Customer record", **_customer_result(customer, _latest_prediction(session, customer))}, default=float))
        if tool_name == "get_customer_prediction":
            prediction = _latest_prediction(session, customer)
            return {"label": "Model output", "customer_id": customer.customer_id, "prediction": _prediction_response(prediction).model_dump(mode="json") if prediction else None}
        rows = list(
            session.execute(
                select(Campaign.id, Campaign.name, Campaign.status, CampaignRecommendation.rank, CampaignRecommendation.recommended, CampaignSelection.id)
                .join(OptimizationRun, OptimizationRun.campaign_id == Campaign.id)
                .join(CampaignRecommendation, (CampaignRecommendation.optimization_run_id == OptimizationRun.id) & (CampaignRecommendation.customer_id == customer.customer_id))
                .outerjoin(CampaignSelection, (CampaignSelection.campaign_id == Campaign.id) & (CampaignSelection.customer_id == customer.customer_id))
                .order_by(desc(Campaign.created_at))
                .limit(20)
            ).mappings()
        )
        return json.loads(json.dumps({"label": "Campaign history", "customer_id": customer.customer_id, "campaigns": [dict(row) for row in rows]}, default=str))
    if tool_name == "get_campaign_summary":
        campaign = session.get(Campaign, _campaign_uuid(arguments.get("campaign_id")))
        if campaign is None:
            raise ChatError("campaign_not_found", "The requested campaign does not exist.", 404)
        selected_count = int(session.scalar(select(func.count(CampaignSelection.id)).where(CampaignSelection.campaign_id == campaign.id)) or 0)
        run = None
        recommendations: list[dict[str, Any]] = []
        if campaign.latest_optimization_run_id:
            run = session.get(OptimizationRun, campaign.latest_optimization_run_id)
        if run is not None:
            selected_ids = set(
                session.scalars(
                    select(CampaignSelection.customer_id).where(CampaignSelection.campaign_id == campaign.id)
                )
            )
            rows = session.scalars(
                select(CampaignRecommendation)
                .where(CampaignRecommendation.optimization_run_id == run.id)
                .order_by(CampaignRecommendation.rank)
                .limit(20)
            )
            recommendations = [
                {
                    "customer_id": row.customer_id,
                    "rank": row.rank,
                    "risk_score": float(row.risk_score),
                    "priority_score": float(row.priority_score),
                    "recommended": row.recommended,
                    "selected": row.customer_id in selected_ids,
                }
                for row in rows
            ]
        return {
            "label": "Calculated priority",
            "campaign_id": str(campaign.id),
            "name": campaign.name,
            "status": campaign.status,
            "capacity": campaign.capacity,
            "selected_count": selected_count,
            "optimization": {"eligible_count": run.eligible_count, "recommended_count": run.recommended_count, "unused_capacity": run.unused_capacity, "formula_version": run.formula_version} if run else None,
            "recommendations": recommendations,
        }
    raise ChatError("chat_tool_not_allowed", "That chatbot capability is not available.", 403)


# Short public name for callers that do not need to distinguish read tools from
# the preview tools exposed by the provider.
execute_tool = execute_read_tool


def redact_tool_data(tool_name: str, value: Any) -> dict[str, Any]:
    """Keep audit metadata useful without persisting full customer payloads."""

    if not isinstance(value, dict):
        return {"type": type(value).__name__}
    result: dict[str, Any] = {"keys": sorted(str(key) for key in value)[:40]}
    for key in ("customer_id", "campaign_id", "status", "action_id"):
        if key in value and isinstance(value[key], (str, int, bool)):
            result[key] = value[key]
    if "customer" in value and isinstance(value["customer"], dict):
        result["customer_id"] = value["customer"].get("customer_id")
        result["customer_field_count"] = len(value["customer"])
    result["tool"] = tool_name
    return result


def stage_customer_action(
    session: Session,
    chat_session: ChatSession,
    *,
    action_type: str,
    payload: dict[str, Any] | CustomerInput,
    expected_version: int | None,
    idempotency_key: str,
    model_service: ModelService,
    ttl_seconds: int,
) -> tuple[ChatStagedAction, str, CustomerInput, PredictionResponse]:
    try:
        idempotency_key = normalize_idempotency_key(idempotency_key)
    except ValueError as exc:
        raise ChatError(
            "idempotency_key_invalid",
            "Idempotency-Key must be visible ASCII text no longer than 128 characters.",
            400,
        ) from exc
    if idempotency_key is None:
        raise ChatError("idempotency_key_required", "Provide an Idempotency-Key for this staged action.", 400)
    if action_type not in {"create", "update"}:
        raise ChatError("chat_tool_not_allowed", "That chatbot capability is not available.", 403)
    if action_type == "update" and expected_version is None:
        raise ChatError("staged_action_invalid", "An expected customer version is required for updates.", 409)
    try:
        normalized = normalize_customer_payload(payload)
    except Exception as exc:
        raise ChatError("validation_failed", "One or more customer fields need correction.", 422) from exc
    customer = session.scalar(select(Customer).where(Customer.customer_id == normalized.customer.customer_id))
    if action_type == "create" and customer is not None:
        raise ChatError("duplicate_customer_id", "Create uses a new customer ID.", 409)
    if action_type == "update":
        if customer is None:
            raise ChatError("customer_not_found", "The requested customer does not exist.", 404)
        if customer.version != expected_version:
            raise ChatError("customer_version_conflict", "Reload the customer before applying this update.", 409)
    try:
        prediction = model_service.predict(normalized.customer, normalized.warnings)
    except Exception as exc:
        raise ChatError("prediction_failed", "The local model could not score this preview.", 503) from exc
    snapshot = normalized.customer.model_dump(mode="json")
    action_hash = request_hash({"action": action_type, "expected_version": expected_version, "customer": snapshot})
    token = secrets.token_urlsafe(32)
    row = ChatStagedAction(
        session_id=chat_session.id,
        action_type=action_type,
        customer_id=normalized.customer.customer_id,
        customer_snapshot=snapshot,
        preview={"normalized_customer": snapshot, "prediction": prediction.model_dump(mode="json"), "warnings": [item.model_dump() for item in normalized.warnings]},
        action_hash=action_hash,
        confirmation_token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expected_version=expected_version,
        idempotency_key=idempotency_key,
        status="pending",
        expires_at=datetime.now(UTC) + timedelta(seconds=ttl_seconds),
    )
    session.add(row)
    session.flush()
    return row, token, normalized.customer, prediction


def staged_response(row: ChatStagedAction, token: str | None = None) -> ChatStagedActionResponse:
    preview = row.preview
    return ChatStagedActionResponse(
        action_id=row.id,
        session_id=row.session_id,
        action=row.action_type,
        status=row.status,
        customer_id=row.customer_id,
        normalized_customer=CustomerInput.model_validate(preview["normalized_customer"]),
        prediction=PredictionResponse.model_validate(preview["prediction"]),
        expected_version=row.expected_version,
        confirmation_token=token,
        expires_at=row.expires_at,
        created_at=row.created_at,
    )


def confirm_staged_action(
    session: Session,
    action: ChatStagedAction,
    *,
    session_id: UUID | None,
    confirmation_token: str,
    model_sha256: str,
    correlation_id: str | None = None,
) -> tuple[Customer, Prediction, PredictionResponse]:
    try:
        confirmation_token = validate_confirmation_token(confirmation_token)
    except ValueError as exc:
        raise ChatError("staged_action_invalid", "The confirmation token is invalid.", 409) from exc
    if session_id is not None and action.session_id != session_id:
        raise ChatError("staged_action_invalid", "This staged action belongs to another chat session.", 409)
    if action.status != "pending":
        raise ChatError("staged_action_consumed", "This confirmation token was already used or cancelled.", 409)
    now = datetime.now(UTC)
    expires_at = action.expires_at
    if expires_at.tzinfo is None:
        # SQLite drops timezone metadata in the in-memory contract tests;
        # PostgreSQL returns an aware value.  Treat both as UTC.
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at <= now:
        action.status = "expired"
        session.flush()
        raise ChatError("staged_action_expired", "The confirmation window has expired.", 410)
    token_hash = hashlib.sha256(confirmation_token.encode()).hexdigest()
    if not hmac.compare_digest(token_hash, action.confirmation_token_hash):
        raise ChatError("staged_action_invalid", "The confirmation token is invalid.", 409)
    customer = session.scalar(select(Customer).where(Customer.customer_id == action.customer_id))
    if action.action_type == "create":
        if customer is not None:
            raise ChatError("duplicate_customer_id", "Create uses a new customer ID.", 409)
        customer = Customer(**action.customer_snapshot, source="chat")
        session.add(customer)
        session.flush()
    else:
        if customer is None:
            raise ChatError("customer_not_found", "The requested customer does not exist.", 404)
        if action.expected_version is None or customer.version != action.expected_version:
            raise ChatError("customer_version_conflict", "The customer changed after this preview.", 409)
        before = {**customer.as_input_dict(), "version": customer.version}
        values = dict(action.customer_snapshot)
        values.pop("customer_id", None)
        for key, value in values.items():
            setattr(customer, key, value)
        customer.version += 1
        customer.source = "chat"
        session.flush()
    normalized = CustomerInput.model_validate(action.customer_snapshot)
    prediction_response = PredictionResponse.model_validate(action.preview["prediction"])
    prediction = _add_prediction(session, customer, normalized, prediction_response, model_sha256)
    before_snapshot = None if action.action_type == "create" else before
    after_snapshot = {**normalized.model_dump(mode="json"), "version": customer.version}
    session.add(
        AuditEvent(
            customer_uuid=customer.id,
            customer_id=customer.customer_id,
            action="customer_created" if action.action_type == "create" else "customer_updated",
            actor="local-demo-user",
            source="chat",
            correlation_id=correlation_id,
            before_snapshot=_safe_snapshot(before_snapshot),
            after_snapshot=_safe_snapshot(after_snapshot),
            idempotency_key=action.idempotency_key,
        )
    )
    action.status = "consumed"
    action.consumed_at = now
    session.flush()
    return customer, prediction, prediction_response
