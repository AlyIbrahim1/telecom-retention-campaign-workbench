"""Deterministic risk/spend campaign optimization domain service."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Iterable
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.db.models import (
    Campaign,
    CampaignOverride,
    CampaignRecommendation,
    CampaignSelection,
    Customer,
    IdempotencyRecord,
    OptimizationRun,
    OutreachDecision,
    Prediction,
)
from backend.app.schemas.customer import CustomerInput


FORMULA_VERSION = "risk-spend-v1"
MONTHLY_WEIGHT = 0.60
HISTORICAL_WEIGHT = 0.40


class CampaignError(ValueError):
    def __init__(self, code: str, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class Candidate:
    customer: Customer
    prediction: Prediction
    monthly_percentile: float
    historical_percentile: float
    value_index: float
    priority_score: float


def percentile_rank(value: float, population: Iterable[float]) -> float:
    """Return the specified average-rank percentile in [0, 1]."""

    values = sorted(float(item) for item in population)
    count = len(values)
    if count == 0:
        return 0.0
    if count == 1:
        return 0.5
    lower = sum(item < value for item in values)
    equal = sum(item == value for item in values)
    average_rank = lower + (equal + 1) / 2
    return (average_rank - 1) / (count - 1)


def _percentile_rank_map(population: Iterable[float]) -> dict[float, float]:
    """Compute all average-rank percentiles in one sort."""

    values = sorted(float(item) for item in population)
    count = len(values)
    if count == 0:
        return {}
    if count == 1:
        return {values[0]: 0.5}
    ranks: dict[float, float] = {}
    index = 0
    while index < count:
        value = values[index]
        end = index + 1
        while end < count and values[end] == value:
            end += 1
        average_rank = index + (end - index + 1) / 2
        ranks[value] = (average_rank - 1) / (count - 1)
        index = end
    return ranks


def campaign_priority(risk_score: float, monthly_percentile: float, historical_percentile: float) -> tuple[float, float]:
    value_index = MONTHLY_WEIGHT * monthly_percentile + HISTORICAL_WEIGHT * historical_percentile
    priority = 100 * float(risk_score) * value_index
    return value_index, priority


def _latest_predictions(session: Session) -> dict[UUID, Prediction]:
    rows = session.scalars(select(Prediction).where(Prediction.success.is_(True)).order_by(desc(Prediction.scored_at), desc(Prediction.id)))
    latest: dict[UUID, Prediction] = {}
    for prediction in rows:
        latest.setdefault(prediction.customer_uuid, prediction)
    return latest


def _candidates(session: Session) -> list[Candidate]:
    customers = list(session.scalars(select(Customer).where(Customer.is_active.is_(True))))
    latest = _latest_predictions(session)
    monthly_population = [float(customer.monthly_charges) for customer in customers]
    historical_population = [float(customer.total_charges) for customer in customers]
    monthly_ranks = _percentile_rank_map(monthly_population)
    historical_ranks = _percentile_rank_map(historical_population)
    candidates: list[Candidate] = []
    for customer in customers:
        prediction = latest.get(customer.id)
        if prediction is None or not prediction.success:
            continue
        # An update after scoring makes the snapshot stale and ineligible.
        snapshot = CustomerInput.model_validate(customer.as_input_dict()).model_dump(mode="json")
        current_hash = hashlib.sha256(json.dumps(snapshot, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest()
        if prediction.input_hash != current_hash:
            continue
        monthly = monthly_ranks[float(customer.monthly_charges)]
        historical = historical_ranks[float(customer.total_charges)]
        value, priority = campaign_priority(float(prediction.risk_score), monthly, historical)
        candidates.append(Candidate(customer, prediction, monthly, historical, value, priority))
    return candidates


def _sort_candidates(candidates: Iterable[Candidate]) -> list[Candidate]:
    return sorted(candidates, key=lambda item: (-item.priority_score, -float(item.prediction.risk_score), -item.value_index, item.customer.customer_id))


def optimize_campaign(session: Session, campaign: Campaign) -> OptimizationRun:
    if campaign.status == "archived":
        raise CampaignError("campaign_state_conflict", "Archived campaigns cannot be optimized.")
    if campaign.status == "confirmed":
        raise CampaignError("campaign_state_conflict", "Confirmed campaigns cannot be re-optimized.")
    candidates = _sort_candidates(_candidates(session))
    eligible = [candidate for candidate in candidates if float(candidate.prediction.risk_score) >= float(candidate.prediction.threshold)]
    recommended_ids = {candidate.customer.customer_id for candidate in eligible[: campaign.capacity]}
    now = datetime.now(UTC)
    run = OptimizationRun(
        campaign=campaign,
        formula_version=FORMULA_VERSION,
        monthly_weight=MONTHLY_WEIGHT,
        historical_weight=HISTORICAL_WEIGHT,
        reference_population_timestamp=now,
        eligible_count=len(eligible),
        recommended_count=len(recommended_ids),
        unused_capacity=max(0, campaign.capacity - len(recommended_ids)),
        created_at=now,
        model_versions=sorted({candidate.prediction.model_version for candidate in candidates}),
    )
    session.add(run)
    session.flush()
    for rank, candidate in enumerate(candidates, start=1):
        session.add(
            CampaignRecommendation(
                optimization_run_id=run.id,
                customer_uuid=candidate.customer.id,
                customer_id=candidate.customer.customer_id,
                prediction_id=candidate.prediction.id,
                monthly_charges=candidate.customer.monthly_charges,
                total_charges=candidate.customer.total_charges,
                monthly_spend_percentile=candidate.monthly_percentile,
                historical_spend_percentile=candidate.historical_percentile,
                value_index=candidate.value_index,
                priority_score=candidate.priority_score,
                risk_score=candidate.prediction.risk_score,
                recommended_for_review=candidate.prediction.recommended_for_review,
                recommended=candidate.customer.customer_id in recommended_ids,
                rank=rank,
                model_version=candidate.prediction.model_version,
                scored_at=candidate.prediction.scored_at,
            )
        )
    campaign.status = "optimized"
    campaign.latest_optimization_run_id = run.id
    campaign.version += 1
    session.flush()
    return run


def request_hash(payload: object) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest()


def latest_run(session: Session, campaign: Campaign) -> OptimizationRun | None:
    if campaign.latest_optimization_run_id:
        return session.get(OptimizationRun, campaign.latest_optimization_run_id)
    return session.scalar(select(OptimizationRun).where(OptimizationRun.campaign_id == campaign.id).order_by(desc(OptimizationRun.created_at)))


def _effective_overrides(campaign: Campaign) -> dict[str, CampaignOverride]:
    """Return the latest override for each customer in creation order."""

    effective: dict[str, CampaignOverride] = {}
    for item in campaign.overrides:
        effective[item.customer_id] = item
    return effective


def apply_override(session: Session, campaign: Campaign, *, customer_id: str, action: str, reason: str, replacement_customer_id: str | None = None) -> CampaignOverride:
    if campaign.status != "optimized":
        raise CampaignError("campaign_state_conflict", "Overrides are available only after optimization.")
    reason = reason.strip()
    if len(reason) < 5 or len(reason) > 500:
        raise CampaignError("campaign_override_reason_required", "Provide an override reason between 5 and 500 characters.", 422)
    if action not in {"include", "exclude"}:
        raise CampaignError("campaign_override_action_invalid", "Override action must be include or exclude.", 422)
    if replacement_customer_id and action != "include":
        raise CampaignError("campaign_replacement_invalid", "A replacement customer is only valid for an include override.", 422)
    run = latest_run(session, campaign)
    if run is None:
        raise CampaignError("campaign_state_conflict", "Optimize the campaign before adding an override.")
    recommendation = session.scalar(select(CampaignRecommendation).where(CampaignRecommendation.optimization_run_id == run.id, CampaignRecommendation.customer_id == customer_id))
    if recommendation is None:
        raise CampaignError("customer_not_found", "The customer is not in this optimization snapshot.", 404)
    if action == "exclude" and not recommendation.recommended:
        raise CampaignError("campaign_override_invalid", "Only a recommended customer can be excluded.", 422)
    if action == "include" and recommendation.recommended:
        raise CampaignError("campaign_override_invalid", "Include overrides are for customers outside the recommendation set.", 422)
    replacement = None
    if replacement_customer_id:
        if replacement_customer_id == customer_id:
            raise CampaignError("campaign_replacement_invalid", "Replacement must be a different customer.", 422)
        replacement = session.scalar(select(CampaignRecommendation).where(CampaignRecommendation.optimization_run_id == run.id, CampaignRecommendation.customer_id == replacement_customer_id))
        if replacement is None:
            raise CampaignError("customer_not_found", "The replacement customer is not in this optimization snapshot.", 404)
        if not replacement.recommended:
            raise CampaignError("campaign_replacement_invalid", "Replacement must be a currently recommended customer.", 422)
    if action == "include":
        selected_ids = {row.customer_id for row in run.recommendations if row.recommended}
        for existing in _effective_overrides(campaign).values():
            if existing.action == "exclude":
                selected_ids.discard(existing.customer_id)
            elif existing.action == "include":
                selected_ids.add(existing.customer_id)
                if existing.replacement_customer_id:
                    selected_ids.discard(existing.replacement_customer_id)
        current = len(selected_ids)
        if current >= campaign.capacity and not replacement_customer_id:
            raise CampaignError("campaign_capacity_exceeded", "Exclude or replace a selected customer before including another.", 422)
    override = CampaignOverride(campaign=campaign, customer_id=customer_id, action=action, reason=reason, replacement_customer_id=replacement_customer_id, actor="local-demo-user")
    session.add(override)
    campaign.version += 1
    session.flush()
    return override


def confirm_campaign(session: Session, campaign: Campaign) -> None:
    # PostgreSQL serializes two confirmations for the same campaign. SQLite ignores
    # FOR UPDATE, but still exercises the same state/version checks in API tests.
    locked = session.scalar(select(Campaign).where(Campaign.id == campaign.id).with_for_update())
    if locked is None:
        raise CampaignError("not_found", "The campaign does not exist.", 404)
    campaign = locked
    if campaign.status != "optimized":
        raise CampaignError("campaign_state_conflict", "Only an optimized campaign can be confirmed.")
    run = latest_run(session, campaign)
    if run is None:
        raise CampaignError("campaign_state_conflict", "Optimize the campaign before confirming.")
    overrides = _effective_overrides(campaign)
    replacement_ids = {
        item.replacement_customer_id
        for item in overrides.values()
        if item.action == "include" and item.replacement_customer_id
    }
    selected: list[CampaignRecommendation] = []
    for recommendation in run.recommendations:
        override = overrides.get(recommendation.customer_id)
        decision = "selected" if recommendation.recommended else "not_selected"
        if recommendation.customer_id in replacement_ids:
            decision = "not_selected"
        elif override and override.action == "exclude":
            decision = "not_selected"
        elif override and override.action == "include":
            decision = "selected"
        if decision == "selected":
            selected.append(recommendation)
            session.add(CampaignSelection(
                campaign_id=campaign.id,
                recommendation_id=recommendation.id,
                customer_uuid=recommendation.customer_uuid,
                customer_id=recommendation.customer_id,
                prediction_id=recommendation.prediction_id,
                formula_version=run.formula_version,
                monthly_spend_percentile=recommendation.monthly_spend_percentile,
                historical_spend_percentile=recommendation.historical_spend_percentile,
                value_index=recommendation.value_index,
                priority_score=recommendation.priority_score,
                risk_score=recommendation.risk_score,
                reason=override.reason if override else None,
                actor="local-demo-user",
            ))
        session.add(OutreachDecision(campaign_id=campaign.id, recommendation_id=recommendation.id, customer_id=recommendation.customer_id, decision=decision, reason=override.reason if override else None, actor="local-demo-user"))
    if len(selected) > campaign.capacity:
        raise CampaignError("campaign_capacity_exceeded", "The confirmed selection exceeds campaign capacity.", 422)
    campaign.status = "confirmed"
    campaign.confirmed_at = datetime.now(UTC)
    campaign.version += 1
    session.flush()
