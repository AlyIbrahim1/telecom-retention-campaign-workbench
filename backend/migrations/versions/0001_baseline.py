"""Create the migration baseline.

Revision ID: 0001_phase1
Revises: None
Create Date: 2026-08-13
"""

from typing import Sequence


revision: str = "0001_phase1"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Reserve the baseline before domain tables are introduced."""


def downgrade() -> None:
    """Remove no domain objects because this baseline is intentionally empty."""
