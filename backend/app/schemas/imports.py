"""HTTP DTOs for bounded CSV preflight and import jobs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


ImportMode = Literal["create", "update"]
ImportStatus = Literal[
    "uploaded",
    "validating",
    "ready",
    "queued",
    "running",
    "completed",
    "partially_completed",
    "failed",
    "cancelled",
]


class ImportFieldError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    code: str
    message: str


class ImportRowReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_number: int = Field(ge=2)
    customer_id: str | None = None
    status: str
    warnings: list[dict[str, str]] = Field(default_factory=list)
    errors: list[ImportFieldError] = Field(default_factory=list)
    result: dict | None = None


class ImportPreflightResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: UUID
    filename: str
    mode: ImportMode
    file_hash: str | None = None
    detected_columns: list[str]
    mappings: dict[str, str]
    missing_columns: list[str] = Field(default_factory=list)
    extra_columns: list[str] = Field(default_factory=list)
    duplicate_columns: list[str] = Field(default_factory=list)
    ambiguous_columns: list[str] = Field(default_factory=list)
    total_rows: int = Field(ge=0)
    valid_rows: int = Field(ge=0)
    invalid_rows: int = Field(ge=0)
    warning_rows: int = Field(ge=0)
    warning_count: int = Field(default=0, ge=0)
    warnings: list[dict] = Field(default_factory=list)
    errors: list[dict] = Field(default_factory=list)
    sample_rows: list[dict] = Field(default_factory=list)
    database_missing: list[str] = Field(default_factory=list)
    duplicate_customer_ids: list[str] = Field(default_factory=list)
    database_conflicts: list[str] = Field(default_factory=list)
    proposed_idempotency_key: str
    status: ImportStatus
    rows: list[ImportRowReport] = Field(default_factory=list)


class ImportJobResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: UUID
    filename: str
    mode: ImportMode
    status: ImportStatus
    file_hash: str
    file_sha256: str | None = None
    total_rows: int = Field(ge=0)
    valid_rows: int = Field(ge=0)
    invalid_rows: int = Field(ge=0)
    warning_rows: int = Field(ge=0)
    processed_rows: int = Field(ge=0)
    warning_count: int = Field(default=0, ge=0)
    succeeded_rows: int = Field(default=0, ge=0)
    failed_rows: int = Field(default=0, ge=0)
    progress_percent: float = Field(default=0, ge=0, le=100)
    message: str | None = None
    idempotency_key: str | None = None
    created_at: datetime
    updated_at: datetime
    confirmed_at: datetime | None = None
    cancelled_at: datetime | None = None
    rows: list[ImportRowReport] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class ImportListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ImportJobResponse]
    total: int = Field(ge=0)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1)
