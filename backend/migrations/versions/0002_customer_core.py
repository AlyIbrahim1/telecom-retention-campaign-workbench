"""Create the customer, immutable prediction, audit, and idempotency tables.

Revision ID: 0002_phase2
Revises: 0001_phase1
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0002_phase2"
down_revision: str | None = "0001_phase1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "customers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.String(length=64), nullable=False),
        sa.Column("gender", sa.String(length=16), nullable=False),
        sa.Column("senior_citizen", sa.String(length=3), nullable=False),
        sa.Column("partner", sa.String(length=3), nullable=False),
        sa.Column("dependents", sa.String(length=3), nullable=False),
        sa.Column("tenure", sa.Integer(), nullable=False),
        sa.Column("phone_service", sa.String(length=3), nullable=False),
        sa.Column("multiple_lines", sa.String(length=20), nullable=False),
        sa.Column("internet_service", sa.String(length=16), nullable=False),
        sa.Column("online_security", sa.String(length=20), nullable=False),
        sa.Column("online_backup", sa.String(length=20), nullable=False),
        sa.Column("device_protection", sa.String(length=20), nullable=False),
        sa.Column("tech_support", sa.String(length=20), nullable=False),
        sa.Column("streaming_tv", sa.String(length=20), nullable=False),
        sa.Column("streaming_movies", sa.String(length=20), nullable=False),
        sa.Column("contract", sa.String(length=20), nullable=False),
        sa.Column("paperless_billing", sa.String(length=3), nullable=False),
        sa.Column("payment_method", sa.String(length=32), nullable=False),
        sa.Column("monthly_charges", sa.Numeric(12, 4), nullable=False),
        sa.Column("total_charges", sa.Numeric(14, 4), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("source", sa.String(length=16), server_default="form", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(customer_id) BETWEEN 1 AND 64", name="ck_customer_id_length"),
        sa.CheckConstraint("tenure >= 0", name="ck_customer_tenure_nonnegative"),
        sa.CheckConstraint("monthly_charges >= 0", name="ck_customer_monthly_nonnegative"),
        sa.CheckConstraint("total_charges >= 0", name="ck_customer_total_nonnegative"),
        sa.CheckConstraint("gender IN ('Female', 'Male')", name="ck_customer_gender"),
        sa.CheckConstraint("senior_citizen IN ('Yes', 'No')", name="ck_customer_senior_citizen"),
        sa.CheckConstraint("partner IN ('Yes', 'No')", name="ck_customer_partner"),
        sa.CheckConstraint("dependents IN ('Yes', 'No')", name="ck_customer_dependents"),
        sa.CheckConstraint("phone_service IN ('Yes', 'No')", name="ck_customer_phone_service"),
        sa.CheckConstraint("multiple_lines IN ('Yes', 'No', 'No phone service')", name="ck_customer_multiple_lines"),
        sa.CheckConstraint("internet_service IN ('DSL', 'Fiber optic', 'No')", name="ck_customer_internet_service"),
        sa.CheckConstraint("contract IN ('Month-to-month', 'One year', 'Two year')", name="ck_customer_contract"),
        sa.CheckConstraint("paperless_billing IN ('Yes', 'No')", name="ck_customer_paperless_billing"),
        sa.CheckConstraint("payment_method IN ('Bank transfer (automatic)', 'Credit card (automatic)', 'Electronic check', 'Mailed check')", name="ck_customer_payment_method"),
        sa.CheckConstraint("online_security IN ('Yes', 'No', 'No internet service')", name="ck_customer_online_security"),
        sa.CheckConstraint("online_backup IN ('Yes', 'No', 'No internet service')", name="ck_customer_online_backup"),
        sa.CheckConstraint("device_protection IN ('Yes', 'No', 'No internet service')", name="ck_customer_device_protection"),
        sa.CheckConstraint("tech_support IN ('Yes', 'No', 'No internet service')", name="ck_customer_tech_support"),
        sa.CheckConstraint("streaming_tv IN ('Yes', 'No', 'No internet service')", name="ck_customer_streaming_tv"),
        sa.CheckConstraint("streaming_movies IN ('Yes', 'No', 'No internet service')", name="ck_customer_streaming_movies"),
        sa.CheckConstraint("(phone_service = 'No' AND multiple_lines = 'No phone service') OR (phone_service = 'Yes' AND multiple_lines <> 'No phone service')", name="ck_customer_phone_dependency"),
        sa.CheckConstraint("(internet_service = 'No' AND online_security = 'No internet service' AND online_backup = 'No internet service' AND device_protection = 'No internet service' AND tech_support = 'No internet service' AND streaming_tv = 'No internet service' AND streaming_movies = 'No internet service') OR (internet_service <> 'No' AND online_security <> 'No internet service' AND online_backup <> 'No internet service' AND device_protection <> 'No internet service' AND tech_support <> 'No internet service' AND streaming_tv <> 'No internet service' AND streaming_movies <> 'No internet service')", name="ck_customer_internet_dependency"),
        sa.CheckConstraint("tenure = 0 OR total_charges > 0", name="ck_customer_positive_total_after_tenure"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("customer_id"),
    )
    op.create_index("ix_customers_active_customer_id", "customers", ["is_active", "customer_id"])

    op.create_table(
        "predictions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("customer_uuid", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.String(length=64), nullable=False),
        sa.Column("input_snapshot", sa.JSON(), nullable=False),
        sa.Column("input_hash", sa.String(length=64), nullable=False),
        sa.Column("risk_score", sa.Numeric(18, 16), nullable=False),
        sa.Column("recommended_for_review", sa.Boolean(), nullable=False),
        sa.Column("model_version", sa.String(length=80), nullable=False),
        sa.Column("model_sha256", sa.String(length=64), nullable=False),
        sa.Column("threshold", sa.Numeric(18, 16), nullable=False),
        sa.Column("threshold_policy_version", sa.String(length=80), nullable=False),
        sa.Column("scored_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("success", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.CheckConstraint("risk_score >= 0 AND risk_score <= 1", name="ck_prediction_score_range"),
        sa.CheckConstraint("threshold >= 0 AND threshold <= 1", name="ck_prediction_threshold_range"),
        sa.ForeignKeyConstraint(["customer_uuid"], ["customers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_predictions_customer_scored_at", "predictions", ["customer_id", "scored_at"])
    op.create_index("ix_predictions_recommended_scored_at", "predictions", ["recommended_for_review", "scored_at"])

    op.create_table(
        "audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("customer_uuid", sa.Uuid(), nullable=True),
        sa.Column("customer_id", sa.String(length=64), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("actor", sa.String(length=80), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("before_snapshot", sa.JSON(), nullable=True),
        sa.Column("after_snapshot", sa.JSON(), nullable=True),
        sa.Column("correlation_id", sa.String(length=64), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["customer_uuid"], ["customers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_events_customer_created_at", "audit_events", ["customer_uuid", "created_at"])
    op.create_index("ix_audit_events_action_created_at", "audit_events", ["action", "created_at"])

    op.create_table(
        "idempotency_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("scope", sa.String(length=120), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("response_body", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scope", "key", name="uq_idempotency_scope_key"),
    )


def downgrade() -> None:
    op.drop_table("idempotency_records")
    op.drop_index("ix_audit_events_action_created_at", table_name="audit_events")
    op.drop_index("ix_audit_events_customer_created_at", table_name="audit_events")
    op.drop_table("audit_events")
    op.drop_index("ix_predictions_recommended_scored_at", table_name="predictions")
    op.drop_index("ix_predictions_customer_scored_at", table_name="predictions")
    op.drop_table("predictions")
    op.drop_index("ix_customers_active_customer_id", table_name="customers")
    op.drop_table("customers")
