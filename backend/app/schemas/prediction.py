"""Prediction response contracts."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.schemas.customer import CustomerInput, ValidationWarning


MODEL_VERSION = "random-forest-bundle-v1"
THRESHOLD_POLICY_VERSION = "fpr-cap-0.31-v1"
DEFAULT_THRESHOLD = 0.5268190582639384


class PredictionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Z0-9_-]+$")
    risk_score: float = Field(ge=0, le=1)
    recommended_for_review: bool
    model_version: Literal[MODEL_VERSION] = MODEL_VERSION
    threshold: float = DEFAULT_THRESHOLD
    threshold_policy_version: Literal[THRESHOLD_POLICY_VERSION] = THRESHOLD_POLICY_VERSION
    scored_at: datetime
    warnings: list[ValidationWarning] = Field(default_factory=list)


class CustomerRecordResponse(BaseModel):
    """Persisted customer and current immutable prediction."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    customer: CustomerInput
    is_active: bool
    version: int
    created_at: datetime
    updated_at: datetime
    source: str
    current_prediction: PredictionResponse | None = None


class CustomerDetailResponse(CustomerRecordResponse):
    """Full record payload used by the detail and audit screens."""

    predictions: list[PredictionResponse] = Field(default_factory=list)
    audit_events: list["AuditEventResponse"] = Field(default_factory=list)


class CustomerWriteResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer: CustomerRecordResponse
    prediction: PredictionResponse


class CustomerPreviewResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    normalized_customer: CustomerInput
    prediction: PredictionResponse
    warnings: list[ValidationWarning] = Field(default_factory=list)


class PredictionHistoryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: str
    predictions: list[PredictionResponse]


class AuditEventResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str
    action: str
    actor: str
    source: str
    created_at: datetime
    before: dict | None = None
    after: dict | None = None
    correlation_id: str | None = None


class CustomerMetadataResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["customer-input-v1"] = "customer-input-v1"
    model_version: str
    threshold: float
    threshold_policy_version: str
    fields: dict[str, dict]


CustomerDetailResponse.model_rebuild()
