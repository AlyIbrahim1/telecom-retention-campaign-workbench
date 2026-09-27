"""Campaign API contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


CampaignStatus = Literal["draft", "optimized", "confirmed", "archived"]


class CampaignWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: str = Field(min_length=1, max_length=120)
    capacity: int = Field(gt=0)
    value_horizon_months: int = Field(default=3, ge=1, le=24)
    contact_cost_per_customer: float = Field(default=5, ge=0, le=1_000_000)


class CampaignOverrideWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    customer_id: str = Field(min_length=1, max_length=64)
    action: Literal["include", "exclude"]
    reason: str = Field(min_length=5, max_length=500)
    replacement_customer_id: str | None = Field(default=None, min_length=1, max_length=64)


class CampaignOptimizeWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    acknowledge_reoptimization: bool = False


class CampaignOptimizationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: UUID
    formula_version: str
    monthly_weight: float
    historical_weight: float
    reference_population_timestamp: datetime
    created_at: datetime
    eligible_count: int
    recommended_count: int
    unused_capacity: int
    model_versions: list[str]
    prediction_scored_at: datetime | None = None


class CampaignRecommendationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recommendation_id: UUID
    customer_id: str
    prediction_id: UUID | None
    rank: int
    risk_score: float
    recommended_for_review: bool
    recommended: bool
    selected: bool = False
    override: bool = False
    selection_state: Literal["recommended", "selected", "excluded", "override", "not_selected"]
    monthly_charges: float
    total_charges: float
    monthly_spend_percentile: float
    historical_spend_percentile: float
    value_index: float
    priority_score: float
    model_version: str | None
    scored_at: datetime | None
    override_reason: str | None = None


class CampaignOverrideResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    override_id: UUID
    customer_id: str
    action: Literal["include", "exclude"]
    reason: str
    replacement_customer_id: str | None = None
    created_at: datetime


class CampaignResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    campaign_id: UUID
    name: str
    capacity: int
    value_horizon_months: int = 3
    contact_cost_per_customer: float = 5
    status: CampaignStatus
    version: int
    created_at: datetime
    updated_at: datetime
    confirmed_at: datetime | None = None
    latest_optimization_run_id: UUID | None = None
    optimization: CampaignOptimizationResponse | None = None
    recommendations: list[CampaignRecommendationResponse] = Field(default_factory=list)
    overrides: list[CampaignOverrideResponse] = Field(default_factory=list)
    eligible_count: int = 0
    recommended_count: int = 0
    selected_count: int = 0
    unused_capacity: int = 0


class CampaignListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[CampaignResponse]
    total: int
    page: int
    page_size: int
