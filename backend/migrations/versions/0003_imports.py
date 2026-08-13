"""Add bounded CSV import job and row outcome tables.

Revision ID: 0003_phase4
Revises: 0002_phase2
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0003_phase4"
down_revision: str | None = "0002_phase2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "import_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=True),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("raw_csv", sa.LargeBinary(), nullable=True),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("total_rows", sa.Integer(), nullable=False),
        sa.Column("valid_rows", sa.Integer(), nullable=False),
        sa.Column("invalid_rows", sa.Integer(), nullable=False),
        sa.Column("warning_rows", sa.Integer(), nullable=False),
        sa.Column("processed_rows", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("mode IN ('create', 'update')", name="ck_import_job_mode"),
        sa.CheckConstraint(
            "status IN ('uploaded', 'validating', 'ready', 'queued', 'running', 'completed', 'partially_completed', 'failed', 'cancelled')",
            name="ck_import_job_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_import_jobs_created_at", "import_jobs", ["created_at"])
    op.create_index("ix_import_jobs_status_created_at", "import_jobs", ["status", "created_at"])

    op.create_table(
        "import_row_outcomes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("import_job_id", sa.Uuid(), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("customer_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("normalized_snapshot", sa.JSON(), nullable=True),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("errors", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["import_job_id"], ["import_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("import_job_id", "row_number", name="uq_import_row_job_number"),
    )
    op.create_index(
        "ix_import_row_outcomes_job_status", "import_row_outcomes", ["import_job_id", "status"]
    )


def downgrade() -> None:
    op.drop_index("ix_import_row_outcomes_job_status", table_name="import_row_outcomes")
    op.drop_table("import_row_outcomes")
    op.drop_index("ix_import_jobs_status_created_at", table_name="import_jobs")
    op.drop_index("ix_import_jobs_created_at", table_name="import_jobs")
    op.drop_table("import_jobs")
