"""Add immutable campaign optimization snapshots and human decisions.

Revision ID: 0004_phase5
Revises: 0003_phase4
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0004_phase5"
down_revision: str | None = "0003_phase4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "campaigns",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), server_default="draft", nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("latest_optimization_run_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 120", name="ck_campaign_name_length"),
        sa.CheckConstraint("capacity > 0", name="ck_campaign_capacity_positive"),
        sa.CheckConstraint("status IN ('draft', 'optimized', 'confirmed', 'archived')", name="ck_campaign_status"),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("name"),
    )
    op.create_index("ix_campaigns_status_created_at", "campaigns", ["status", "created_at"])
    op.create_table(
        "optimization_runs",
        sa.Column("id", sa.Uuid(), nullable=False), sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("formula_version", sa.String(40), nullable=False), sa.Column("monthly_weight", sa.Numeric(8, 6), nullable=False),
        sa.Column("historical_weight", sa.Numeric(8, 6), nullable=False), sa.Column("reference_population_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("eligible_count", sa.Integer(), nullable=False), sa.Column("recommended_count", sa.Integer(), nullable=False), sa.Column("unused_capacity", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("model_versions", sa.JSON(), nullable=False),
        sa.CheckConstraint("monthly_weight >= 0 AND historical_weight >= 0", name="ck_optimization_weights_nonnegative"),
        sa.CheckConstraint("monthly_weight + historical_weight = 1", name="ck_optimization_weights_sum"),
        sa.CheckConstraint("eligible_count >= 0 AND recommended_count >= 0 AND unused_capacity >= 0", name="ck_optimization_counts_nonnegative"),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_optimization_runs_campaign_created_at", "optimization_runs", ["campaign_id", "created_at"])
    op.create_table(
        "campaign_recommendations",
        sa.Column("id", sa.Uuid(), nullable=False), sa.Column("optimization_run_id", sa.Uuid(), nullable=False), sa.Column("customer_uuid", sa.Uuid(), nullable=False), sa.Column("customer_id", sa.String(64), nullable=False), sa.Column("prediction_id", sa.Uuid(), nullable=False),
        sa.Column("monthly_charges", sa.Numeric(12, 4), nullable=False), sa.Column("total_charges", sa.Numeric(14, 4), nullable=False), sa.Column("monthly_spend_percentile", sa.Numeric(8, 6), nullable=False), sa.Column("historical_spend_percentile", sa.Numeric(8, 6), nullable=False), sa.Column("value_index", sa.Numeric(8, 6), nullable=False), sa.Column("priority_score", sa.Numeric(12, 8), nullable=False), sa.Column("risk_score", sa.Numeric(18, 16), nullable=False), sa.Column("recommended_for_review", sa.Boolean(), nullable=False), sa.Column("recommended", sa.Boolean(), nullable=False), sa.Column("rank", sa.Integer(), nullable=False), sa.Column("model_version", sa.String(80), nullable=False), sa.Column("scored_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("monthly_spend_percentile BETWEEN 0 AND 1", name="ck_recommendation_monthly_percentile"),
        sa.CheckConstraint("historical_spend_percentile BETWEEN 0 AND 1", name="ck_recommendation_historical_percentile"),
        sa.CheckConstraint("value_index BETWEEN 0 AND 1", name="ck_recommendation_value_index"),
        sa.CheckConstraint("priority_score BETWEEN 0 AND 100", name="ck_recommendation_priority_score"),
        sa.CheckConstraint("risk_score BETWEEN 0 AND 1", name="ck_recommendation_risk_score"),
        sa.CheckConstraint("rank > 0", name="ck_recommendation_rank_positive"),
        sa.ForeignKeyConstraint(["optimization_run_id"], ["optimization_runs.id"], ondelete="CASCADE"), sa.ForeignKeyConstraint(["customer_uuid"], ["customers.id"], ondelete="RESTRICT"), sa.ForeignKeyConstraint(["prediction_id"], ["predictions.id"], ondelete="RESTRICT"), sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("optimization_run_id", "customer_id", name="uq_recommendation_run_customer"),
    )
    op.create_index("ix_recommendations_run_rank", "campaign_recommendations", ["optimization_run_id", "rank"])
    op.create_table(
        "campaign_selections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("recommendation_id", sa.Uuid(), nullable=False),
        sa.Column("customer_uuid", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.String(64), nullable=False),
        sa.Column("prediction_id", sa.Uuid(), nullable=False),
        sa.Column("formula_version", sa.String(40), nullable=False),
        sa.Column("monthly_spend_percentile", sa.Numeric(8, 6), nullable=False),
        sa.Column("historical_spend_percentile", sa.Numeric(8, 6), nullable=False),
        sa.Column("value_index", sa.Numeric(8, 6), nullable=False),
        sa.Column("priority_score", sa.Numeric(12, 8), nullable=False),
        sa.Column("risk_score", sa.Numeric(18, 16), nullable=False),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("actor", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("monthly_spend_percentile BETWEEN 0 AND 1", name="ck_selection_monthly_percentile"),
        sa.CheckConstraint("historical_spend_percentile BETWEEN 0 AND 1", name="ck_selection_historical_percentile"),
        sa.CheckConstraint("value_index BETWEEN 0 AND 1", name="ck_selection_value_index"),
        sa.CheckConstraint("priority_score BETWEEN 0 AND 100", name="ck_selection_priority_score"),
        sa.CheckConstraint("risk_score BETWEEN 0 AND 1", name="ck_selection_risk_score"),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recommendation_id"], ["campaign_recommendations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["customer_uuid"], ["customers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["prediction_id"], ["predictions.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("campaign_id", "customer_id", name="uq_campaign_selection_customer"),
    )
    op.create_index("ix_campaign_selections_campaign_created_at", "campaign_selections", ["campaign_id", "created_at"])
    op.create_table(
        "campaign_overrides",
        sa.Column("id", sa.Uuid(), nullable=False), sa.Column("campaign_id", sa.Uuid(), nullable=False), sa.Column("customer_id", sa.String(64), nullable=False), sa.Column("action", sa.String(8), nullable=False), sa.Column("reason", sa.String(500), nullable=False), sa.Column("replacement_customer_id", sa.String(64), nullable=True), sa.Column("actor", sa.String(80), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("action IN ('include', 'exclude')", name="ck_campaign_override_action"), sa.CheckConstraint("length(reason) BETWEEN 5 AND 500", name="ck_campaign_override_reason"), sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_campaign_overrides_campaign_created_at", "campaign_overrides", ["campaign_id", "created_at"])
    op.create_table(
        "outreach_decisions",
        sa.Column("id", sa.Uuid(), nullable=False), sa.Column("campaign_id", sa.Uuid(), nullable=False), sa.Column("recommendation_id", sa.Uuid(), nullable=True), sa.Column("customer_id", sa.String(64), nullable=False), sa.Column("decision", sa.String(24), nullable=False), sa.Column("reason", sa.String(500), nullable=True), sa.Column("actor", sa.String(80), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"), sa.ForeignKeyConstraint(["recommendation_id"], ["campaign_recommendations.id"], ondelete="RESTRICT"), sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_outreach_decisions_campaign_customer", "outreach_decisions", ["campaign_id", "customer_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_outreach_decisions_campaign_customer", table_name="outreach_decisions"); op.drop_table("outreach_decisions")
    op.drop_index("ix_campaign_overrides_campaign_created_at", table_name="campaign_overrides"); op.drop_table("campaign_overrides")
    op.drop_index("ix_campaign_selections_campaign_created_at", table_name="campaign_selections"); op.drop_table("campaign_selections")
    op.drop_index("ix_recommendations_run_rank", table_name="campaign_recommendations"); op.drop_table("campaign_recommendations")
    op.drop_index("ix_optimization_runs_campaign_created_at", table_name="optimization_runs"); op.drop_table("optimization_runs")
    op.drop_index("ix_campaigns_status_created_at", table_name="campaigns"); op.drop_table("campaigns")
