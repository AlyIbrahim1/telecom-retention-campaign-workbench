"""Small, explicit SQLAlchemy models for the  customer core."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    LargeBinary,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
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


class ImportJob(Base):
    """Metadata and lifecycle for one bounded CSV preflight/process run."""

    __tablename__ = "import_jobs"
    __table_args__ = (
        CheckConstraint("mode IN ('create', 'update')", name="ck_import_job_mode"),
        CheckConstraint(
            "status IN ('uploaded', 'validating', 'ready', 'queued', 'running', 'completed', 'partially_completed', 'failed', 'cancelled')",
            name="ck_import_job_status",
        ),
        Index("ix_import_jobs_created_at", "created_at"),
        Index("ix_import_jobs_status_created_at", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_csv: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    mode: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="ready")
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    valid_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    invalid_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    warning_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    row_outcomes: Mapped[list["ImportRowOutcome"]] = relationship(
        back_populates="job", cascade="all, delete-orphan", order_by="ImportRowOutcome.row_number"
    )


class ImportRowOutcome(Base):
    """One deterministic source row result; no raw upload is retained."""

    __tablename__ = "import_row_outcomes"
    __table_args__ = (
        UniqueConstraint("import_job_id", "row_number", name="uq_import_row_job_number"),
        Index("ix_import_row_outcomes_job_status", "import_job_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    import_job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("import_jobs.id", ondelete="CASCADE"), nullable=False
    )
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    normalized_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    warnings: Mapped[list[dict[str, str]]] = mapped_column(JSON, nullable=False, default=list)
    errors: Mapped[list[dict[str, str]]] = mapped_column(JSON, nullable=False, default=list)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    job: Mapped[ImportJob] = relationship(back_populates="row_outcomes")


class Campaign(Base):
    """Mutable campaign definition with immutable optimization snapshots."""

    __tablename__ = "campaigns"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 120", name="ck_campaign_name_length"),
        CheckConstraint("capacity > 0", name="ck_campaign_capacity_positive"),
        CheckConstraint("status IN ('draft', 'optimized', 'confirmed', 'archived')", name="ck_campaign_status"),
        Index("ix_campaigns_status_created_at", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latest_optimization_run_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)

    optimization_runs: Mapped[list["OptimizationRun"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan", order_by="OptimizationRun.created_at"
    )
    overrides: Mapped[list["CampaignOverride"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan", order_by="CampaignOverride.created_at"
    )
    decisions: Mapped[list["OutreachDecision"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan", order_by="OutreachDecision.created_at"
    )
    selections: Mapped[list["CampaignSelection"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan", order_by="CampaignSelection.created_at"
    )


class OptimizationRun(Base):
    """Immutable calculation context for one ranking pass."""

    __tablename__ = "optimization_runs"
    __table_args__ = (
        CheckConstraint("monthly_weight >= 0 AND historical_weight >= 0", name="ck_optimization_weights_nonnegative"),
        CheckConstraint("monthly_weight + historical_weight = 1", name="ck_optimization_weights_sum"),
        CheckConstraint("eligible_count >= 0 AND recommended_count >= 0 AND unused_capacity >= 0", name="ck_optimization_counts_nonnegative"),
        Index("ix_optimization_runs_campaign_created_at", "campaign_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    formula_version: Mapped[str] = mapped_column(String(40), nullable=False)
    monthly_weight: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    historical_weight: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    reference_population_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    eligible_count: Mapped[int] = mapped_column(Integer, nullable=False)
    recommended_count: Mapped[int] = mapped_column(Integer, nullable=False)
    unused_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    model_versions: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    campaign: Mapped[Campaign] = relationship(back_populates="optimization_runs")
    recommendations: Mapped[list["CampaignRecommendation"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="CampaignRecommendation.rank"
    )


@event.listens_for(OptimizationRun, "before_update")
def prevent_optimization_update(_mapper: Any, _connection: Any, _target: OptimizationRun) -> None:
    raise ValueError("Optimization snapshots are immutable")


@event.listens_for(OptimizationRun, "before_delete")
def prevent_optimization_delete(_mapper: Any, _connection: Any, _target: OptimizationRun) -> None:
    raise ValueError("Optimization snapshots are immutable")


class CampaignRecommendation(Base):
    """Immutable recommendation row tied to a prediction snapshot."""

    __tablename__ = "campaign_recommendations"
    __table_args__ = (
        UniqueConstraint("optimization_run_id", "customer_id", name="uq_recommendation_run_customer"),
        CheckConstraint("monthly_spend_percentile BETWEEN 0 AND 1", name="ck_recommendation_monthly_percentile"),
        CheckConstraint("historical_spend_percentile BETWEEN 0 AND 1", name="ck_recommendation_historical_percentile"),
        CheckConstraint("value_index BETWEEN 0 AND 1", name="ck_recommendation_value_index"),
        CheckConstraint("priority_score BETWEEN 0 AND 100", name="ck_recommendation_priority_score"),
        CheckConstraint("risk_score BETWEEN 0 AND 1", name="ck_recommendation_risk_score"),
        CheckConstraint("rank > 0", name="ck_recommendation_rank_positive"),
        Index("ix_recommendations_run_rank", "optimization_run_id", "rank"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    optimization_run_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("optimization_runs.id", ondelete="CASCADE"), nullable=False)
    customer_uuid: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False)
    customer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    prediction_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("predictions.id", ondelete="RESTRICT"), nullable=False)
    monthly_charges: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False)
    total_charges: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)
    monthly_spend_percentile: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    historical_spend_percentile: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    value_index: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    priority_score: Mapped[float] = mapped_column(Numeric(12, 8), nullable=False)
    risk_score: Mapped[float] = mapped_column(Numeric(18, 16), nullable=False)
    recommended_for_review: Mapped[bool] = mapped_column(Boolean, nullable=False)
    recommended: Mapped[bool] = mapped_column(Boolean, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    model_version: Mapped[str] = mapped_column(String(80), nullable=False)
    scored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    run: Mapped[OptimizationRun] = relationship(back_populates="recommendations")


@event.listens_for(CampaignRecommendation, "before_update")
def prevent_recommendation_update(_mapper: Any, _connection: Any, _target: CampaignRecommendation) -> None:
    raise ValueError("Campaign recommendations are immutable")


@event.listens_for(CampaignRecommendation, "before_delete")
def prevent_recommendation_delete(_mapper: Any, _connection: Any, _target: CampaignRecommendation) -> None:
    raise ValueError("Campaign recommendations are immutable")


class CampaignOverride(Base):
    __tablename__ = "campaign_overrides"
    __table_args__ = (
        CheckConstraint("action IN ('include', 'exclude')", name="ck_campaign_override_action"),
        CheckConstraint("length(reason) BETWEEN 5 AND 500", name="ck_campaign_override_reason"),
        Index("ix_campaign_overrides_campaign_created_at", "campaign_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    customer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(8), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    replacement_customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor: Mapped[str] = mapped_column(String(80), nullable=False, default="local-demo-user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    campaign: Mapped[Campaign] = relationship(back_populates="overrides")


class CampaignSelection(Base):
    """Immutable final-selection snapshot created when a campaign is confirmed."""

    __tablename__ = "campaign_selections"
    __table_args__ = (
        UniqueConstraint("campaign_id", "customer_id", name="uq_campaign_selection_customer"),
        CheckConstraint("monthly_spend_percentile BETWEEN 0 AND 1", name="ck_selection_monthly_percentile"),
        CheckConstraint("historical_spend_percentile BETWEEN 0 AND 1", name="ck_selection_historical_percentile"),
        CheckConstraint("value_index BETWEEN 0 AND 1", name="ck_selection_value_index"),
        CheckConstraint("priority_score BETWEEN 0 AND 100", name="ck_selection_priority_score"),
        CheckConstraint("risk_score BETWEEN 0 AND 1", name="ck_selection_risk_score"),
        Index("ix_campaign_selections_campaign_created_at", "campaign_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False
    )
    recommendation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("campaign_recommendations.id", ondelete="RESTRICT"), nullable=False
    )
    customer_uuid: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False
    )
    customer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    prediction_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("predictions.id", ondelete="RESTRICT"), nullable=False
    )
    formula_version: Mapped[str] = mapped_column(String(40), nullable=False)
    monthly_spend_percentile: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    historical_spend_percentile: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    value_index: Mapped[float] = mapped_column(Numeric(8, 6), nullable=False)
    priority_score: Mapped[float] = mapped_column(Numeric(12, 8), nullable=False)
    risk_score: Mapped[float] = mapped_column(Numeric(18, 16), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    campaign: Mapped[Campaign] = relationship(back_populates="selections")


@event.listens_for(CampaignSelection, "before_update")
def prevent_selection_update(_mapper: Any, _connection: Any, _target: CampaignSelection) -> None:
    raise ValueError("Campaign selections are immutable")


@event.listens_for(CampaignSelection, "before_delete")
def prevent_selection_delete(_mapper: Any, _connection: Any, _target: CampaignSelection) -> None:
    raise ValueError("Campaign selections are immutable")


class OutreachDecision(Base):
    """Append-only human decision event; no external outreach is performed."""

    __tablename__ = "outreach_decisions"
    __table_args__ = (Index("ix_outreach_decisions_campaign_customer", "campaign_id", "customer_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    recommendation_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("campaign_recommendations.id", ondelete="RESTRICT"), nullable=True)
    customer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    decision: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    campaign: Mapped[Campaign] = relationship(back_populates="decisions")


@event.listens_for(OutreachDecision, "before_update")
def prevent_outreach_decision_update(_mapper: Any, _connection: Any, _target: OutreachDecision) -> None:
    raise ValueError("Outreach decisions are immutable")


@event.listens_for(OutreachDecision, "before_delete")
def prevent_outreach_decision_delete(_mapper: Any, _connection: Any, _target: OutreachDecision) -> None:
    raise ValueError("Outreach decisions are immutable")


class ChatSession(Base):
    """Bounded conversation metadata and optional customer/campaign context."""

    __tablename__ = "chat_sessions"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'closed')", name="ck_chat_session_status"),
        Index("ix_chat_sessions_updated_at", "updated_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="active", server_default="active")
    context_customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    context_campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("campaigns.id", ondelete="SET NULL"), nullable=True
    )
    context: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at"
    )
    staged_actions: Mapped[list["ChatStagedAction"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="ChatStagedAction.created_at"
    )
    tool_audits: Mapped[list["ChatToolAudit"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="ChatToolAudit.created_at"
    )


class ChatMessage(Base):
    """One user/assistant/tool event retained for bounded conversation history."""

    __tablename__ = "chat_messages"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant', 'tool', 'system')", name="ck_chat_message_role"),
        CheckConstraint("length(content) BETWEEN 1 AND 20000", name="ck_chat_message_content_length"),
        Index("ix_chat_messages_session_created_at", "session_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(12), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="message", server_default="message")
    provider_response_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    session: Mapped[ChatSession] = relationship(back_populates="messages")


class ChatToolAudit(Base):
    """Append-only redacted metadata for each allowlisted tool invocation."""

    __tablename__ = "chat_tool_audits"
    __table_args__ = (Index("ix_chat_tool_audits_session_created_at", "session_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True
    )
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    arguments: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    session: Mapped[ChatSession] = relationship(back_populates="tool_audits")


class ChatStagedAction(Base):
    """One short-lived, one-time customer mutation awaiting human confirmation."""

    __tablename__ = "chat_staged_actions"
    __table_args__ = (
        CheckConstraint("action_type IN ('create', 'update')", name="ck_chat_action_type"),
        CheckConstraint("status IN ('pending', 'consumed', 'cancelled', 'expired')", name="ck_chat_action_status"),
        Index("ix_chat_staged_actions_session_created_at", "session_id", "created_at"),
        Index("ix_chat_staged_actions_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False
    )
    action_type: Mapped[str] = mapped_column(String(8), nullable=False)
    customer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    customer_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    preview: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    action_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    confirmation_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expected_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending", server_default="pending")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    session: Mapped[ChatSession] = relationship(back_populates="staged_actions")


@event.listens_for(ChatToolAudit, "before_update")
def prevent_chat_tool_audit_update(_mapper: Any, _connection: Any, _target: ChatToolAudit) -> None:
    raise ValueError("Chat tool audit records are immutable")


@event.listens_for(ChatToolAudit, "before_delete")
def prevent_chat_tool_audit_delete(_mapper: Any, _connection: Any, _target: ChatToolAudit) -> None:
    raise ValueError("Chat tool audit records are immutable")
