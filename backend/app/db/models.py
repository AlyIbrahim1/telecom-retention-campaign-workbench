"""Small, explicit SQLAlchemy models for the  customer core."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    Uuid,
    event,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (
        CheckConstraint("length(customer_id) BETWEEN 1 AND 64", name="ck_customer_id_length"),
        CheckConstraint("tenure >= 0", name="ck_customer_tenure_nonnegative"),
        CheckConstraint("monthly_charges >= 0", name="ck_customer_monthly_nonnegative"),
        CheckConstraint("total_charges >= 0", name="ck_customer_total_nonnegative"),
        CheckConstraint("gender IN ('Female', 'Male')", name="ck_customer_gender"),
        CheckConstraint("senior_citizen IN ('Yes', 'No')", name="ck_customer_senior_citizen"),
        CheckConstraint("partner IN ('Yes', 'No')", name="ck_customer_partner"),
        CheckConstraint("dependents IN ('Yes', 'No')", name="ck_customer_dependents"),
        CheckConstraint("phone_service IN ('Yes', 'No')", name="ck_customer_phone_service"),
        CheckConstraint("multiple_lines IN ('Yes', 'No', 'No phone service')", name="ck_customer_multiple_lines"),
        CheckConstraint("internet_service IN ('DSL', 'Fiber optic', 'No')", name="ck_customer_internet_service"),
        CheckConstraint("online_security IN ('Yes', 'No', 'No internet service')", name="ck_customer_online_security"),
        CheckConstraint("online_backup IN ('Yes', 'No', 'No internet service')", name="ck_customer_online_backup"),
        CheckConstraint("device_protection IN ('Yes', 'No', 'No internet service')", name="ck_customer_device_protection"),
        CheckConstraint("tech_support IN ('Yes', 'No', 'No internet service')", name="ck_customer_tech_support"),
        CheckConstraint("streaming_tv IN ('Yes', 'No', 'No internet service')", name="ck_customer_streaming_tv"),
        CheckConstraint("streaming_movies IN ('Yes', 'No', 'No internet service')", name="ck_customer_streaming_movies"),
        CheckConstraint("contract IN ('Month-to-month', 'One year', 'Two year')", name="ck_customer_contract"),
        CheckConstraint("paperless_billing IN ('Yes', 'No')", name="ck_customer_paperless_billing"),
        CheckConstraint("payment_method IN ('Bank transfer (automatic)', 'Credit card (automatic)', 'Electronic check', 'Mailed check')", name="ck_customer_payment_method"),
        CheckConstraint("(phone_service = 'No' AND multiple_lines = 'No phone service') OR (phone_service = 'Yes' AND multiple_lines <> 'No phone service')", name="ck_customer_phone_dependency"),
        CheckConstraint("(internet_service = 'No' AND online_security = 'No internet service' AND online_backup = 'No internet service' AND device_protection = 'No internet service' AND tech_support = 'No internet service' AND streaming_tv = 'No internet service' AND streaming_movies = 'No internet service') OR (internet_service <> 'No' AND online_security <> 'No internet service' AND online_backup <> 'No internet service' AND device_protection <> 'No internet service' AND tech_support <> 'No internet service' AND streaming_tv <> 'No internet service' AND streaming_movies <> 'No internet service')", name="ck_customer_internet_dependency"),
        CheckConstraint("tenure = 0 OR total_charges > 0", name="ck_customer_positive_total_after_tenure"),
        Index("ix_customers_active_customer_id", "is_active", "customer_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    gender: Mapped[str] = mapped_column(String(16), nullable=False)
    senior_citizen: Mapped[str] = mapped_column(String(3), nullable=False)
    partner: Mapped[str] = mapped_column(String(3), nullable=False)
    dependents: Mapped[str] = mapped_column(String(3), nullable=False)
    tenure: Mapped[int] = mapped_column(Integer, nullable=False)
    phone_service: Mapped[str] = mapped_column(String(3), nullable=False)
    multiple_lines: Mapped[str] = mapped_column(String(20), nullable=False)
    internet_service: Mapped[str] = mapped_column(String(16), nullable=False)
    online_security: Mapped[str] = mapped_column(String(20), nullable=False)
    online_backup: Mapped[str] = mapped_column(String(20), nullable=False)
    device_protection: Mapped[str] = mapped_column(String(20), nullable=False)
    tech_support: Mapped[str] = mapped_column(String(20), nullable=False)
    streaming_tv: Mapped[str] = mapped_column(String(20), nullable=False)
    streaming_movies: Mapped[str] = mapped_column(String(20), nullable=False)
    contract: Mapped[str] = mapped_column(String(20), nullable=False)
    paperless_billing: Mapped[str] = mapped_column(String(3), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(32), nullable=False)
    monthly_charges: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False)
    total_charges: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="form", server_default="form")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    predictions: Mapped[list["Prediction"]] = relationship(
        back_populates="customer", cascade="all, delete-orphan", order_by="Prediction.scored_at"
    )

    def as_input_dict(self) -> dict[str, Any]:
        return {
            "customer_id": self.customer_id,
            "gender": self.gender,
            "senior_citizen": self.senior_citizen,
            "partner": self.partner,
            "dependents": self.dependents,
            "tenure": self.tenure,
            "phone_service": self.phone_service,
            "multiple_lines": self.multiple_lines,
            "internet_service": self.internet_service,
            "online_security": self.online_security,
            "online_backup": self.online_backup,
            "device_protection": self.device_protection,
            "tech_support": self.tech_support,
            "streaming_tv": self.streaming_tv,
            "streaming_movies": self.streaming_movies,
            "contract": self.contract,
            "paperless_billing": self.paperless_billing,
            "payment_method": self.payment_method,
            "monthly_charges": self.monthly_charges,
            "total_charges": self.total_charges,
        }


class Prediction(Base):
    """Append-only score snapshot; no update or delete is allowed."""

    __tablename__ = "predictions"
    __table_args__ = (
        CheckConstraint("risk_score >= 0 AND risk_score <= 1", name="ck_prediction_score_range"),
        CheckConstraint("threshold >= 0 AND threshold <= 1", name="ck_prediction_threshold_range"),
        Index("ix_predictions_customer_scored_at", "customer_id", "scored_at"),
        Index("ix_predictions_recommended_scored_at", "recommended_for_review", "scored_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_uuid: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"), nullable=False
    )
    customer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    risk_score: Mapped[float] = mapped_column(Numeric(18, 16), nullable=False)
    recommended_for_review: Mapped[bool] = mapped_column(Boolean, nullable=False)
    model_version: Mapped[str] = mapped_column(String(80), nullable=False)
    model_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    threshold: Mapped[float] = mapped_column(Numeric(18, 16), nullable=False)
    threshold_policy_version: Mapped[str] = mapped_column(String(80), nullable=False)
    scored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    warnings: Mapped[list[dict[str, str]]] = mapped_column(JSON, nullable=False, default=list)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)

    customer: Mapped[Customer] = relationship(back_populates="predictions")


@event.listens_for(Prediction, "before_update")
def prevent_prediction_update(_mapper: Any, _connection: Any, _target: Prediction) -> None:
    raise ValueError("Prediction records are immutable")


@event.listens_for(Prediction, "before_delete")
def prevent_prediction_delete(_mapper: Any, _connection: Any, _target: Prediction) -> None:
    raise ValueError("Prediction records are immutable")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_customer_created_at", "customer_uuid", "created_at"),
        Index("ix_audit_events_action_created_at", "action", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_uuid: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("customers.id", ondelete="SET NULL"), nullable=True
    )
    customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    before_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    after_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class IdempotencyRecord(Base):
    """Stored mutation response, scoped to prevent replaying another action."""

    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("scope", "key", name="uq_idempotency_scope_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scope: Mapped[str] = mapped_column(String(120), nullable=False)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    response_body: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
