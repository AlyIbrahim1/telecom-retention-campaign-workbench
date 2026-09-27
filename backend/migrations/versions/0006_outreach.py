"""Add campaign economics and append-only outreach outcomes.

Revision ID: 0006_outreach
Revises: 0005_chat
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_outreach"
down_revision: str | None = "0005_phase6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("campaigns", sa.Column("value_horizon_months", sa.Integer(), server_default="3", nullable=False))
    op.add_column("campaigns", sa.Column("contact_cost_per_customer", sa.Numeric(12, 2), server_default="5", nullable=False))
    op.create_check_constraint("ck_campaign_value_horizon", "campaigns", "value_horizon_months BETWEEN 1 AND 24")
    op.create_check_constraint("ck_campaign_contact_cost", "campaigns", "contact_cost_per_customer >= 0")
    op.create_table(
        "outreach_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("campaign_id", sa.Uuid(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("selection_id", sa.Uuid(), sa.ForeignKey("campaign_selections.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("note", sa.String(500)),
        sa.Column("actor", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('attempted', 'no_answer', 'reached', 'offer_accepted', 'offer_declined')", name="ck_outreach_event_status"),
        sa.UniqueConstraint("campaign_id", "idempotency_key", name="uq_outreach_event_idempotency"),
    )
    op.create_index("ix_outreach_events_selection_created", "outreach_events", ["selection_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_outreach_events_selection_created", table_name="outreach_events")
    op.drop_table("outreach_events")
    op.drop_constraint("ck_campaign_contact_cost", "campaigns", type_="check")
    op.drop_constraint("ck_campaign_value_horizon", "campaigns", type_="check")
    op.drop_column("campaigns", "contact_cost_per_customer")
    op.drop_column("campaigns", "value_horizon_months")
