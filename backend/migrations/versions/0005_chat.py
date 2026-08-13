"""Add bounded grounded-chat sessions and one-time staged customer actions.

Revision ID: 0005_phase6
Revises: 0004_phase5
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0005_phase6"
down_revision: str | None = "0004_phase5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(12), server_default="active", nullable=False),
        sa.Column("context_customer_id", sa.String(64), nullable=True),
        sa.Column("context_campaign_id", sa.Uuid(), nullable=True),
        sa.Column("context", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('active', 'closed')", name="ck_chat_session_status"),
        sa.ForeignKeyConstraint(["context_campaign_id"], ["campaigns.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_sessions_updated_at", "chat_sessions", ["updated_at"])

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(12), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(32), server_default="message", nullable=False),
        sa.Column("provider_response_id", sa.String(128), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('user', 'assistant', 'tool', 'system')", name="ck_chat_message_role"),
        sa.CheckConstraint("length(content) BETWEEN 1 AND 20000", name="ck_chat_message_content_length"),
        sa.ForeignKeyConstraint(["session_id"], ["chat_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_session_created_at", "chat_messages", ["session_id", "created_at"])

    op.create_table(
        "chat_tool_audits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=True),
        sa.Column("tool_name", sa.String(64), nullable=False),
        sa.Column("arguments", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("success", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["session_id"], ["chat_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_tool_audits_session_created_at", "chat_tool_audits", ["session_id", "created_at"])

    op.create_table(
        "chat_staged_actions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("action_type", sa.String(8), nullable=False),
        sa.Column("customer_id", sa.String(64), nullable=False),
        sa.Column("customer_snapshot", sa.JSON(), nullable=False),
        sa.Column("preview", sa.JSON(), nullable=False),
        sa.Column("action_hash", sa.String(64), nullable=False),
        sa.Column("confirmation_token_hash", sa.String(64), nullable=False),
        sa.Column("expected_version", sa.Integer(), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("status", sa.String(12), server_default="pending", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("action_type IN ('create', 'update')", name="ck_chat_action_type"),
        sa.CheckConstraint("status IN ('pending', 'consumed', 'cancelled', 'expired')", name="ck_chat_action_status"),
        sa.ForeignKeyConstraint(["session_id"], ["chat_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_staged_actions_session_created_at", "chat_staged_actions", ["session_id", "created_at"])
    op.create_index("ix_chat_staged_actions_expires_at", "chat_staged_actions", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_chat_staged_actions_expires_at", table_name="chat_staged_actions")
    op.drop_index("ix_chat_staged_actions_session_created_at", table_name="chat_staged_actions")
    op.drop_table("chat_staged_actions")
    op.drop_index("ix_chat_tool_audits_session_created_at", table_name="chat_tool_audits")
    op.drop_table("chat_tool_audits")
    op.drop_index("ix_chat_messages_session_created_at", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index("ix_chat_sessions_updated_at", table_name="chat_sessions")
    op.drop_table("chat_sessions")
