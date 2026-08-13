"""Campaign lifecycle and deterministic optimization API."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import desc, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.core.errors import problem_response
from backend.app.core.validation import normalize_idempotency_key
from backend.app.db.models import Campaign, CampaignOverride, CampaignRecommendation, CampaignSelection, IdempotencyRecord, OptimizationRun
from backend.app.domain.campaigns import CampaignError, apply_override, confirm_campaign, latest_run, optimize_campaign, request_hash
from backend.app.schemas.campaign import CampaignListResponse, CampaignOptimizeWrite, CampaignOverrideResponse, CampaignOverrideWrite, CampaignOptimizationResponse, CampaignRecommendationResponse, CampaignResponse, CampaignWrite


router = APIRouter(prefix="/api/v1/campaigns", tags=["campaigns"])


def _session(request: Request) -> Session | None:
    factory = getattr(request.app.state, "session_factory", None)
    return factory() if factory else None


def _error(request: Request, exc: CampaignError) -> JSONResponse:
    return problem_response(request, status=exc.status, code=exc.code, title="Campaign action could not be completed", detail=str(exc))


def _load(session: Session, campaign_id: UUID) -> Campaign | None:
    return session.get(Campaign, campaign_id)


def _version(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value.strip().strip('"'))
    except (TypeError, ValueError):
        return None


def _summary(campaign: Campaign, *, eligible_count: int = 0, recommended_count: int = 0, selected_count: int = 0, unused_capacity: int = 0) -> CampaignResponse:
    return CampaignResponse(
        campaign_id=campaign.id, name=campaign.name, capacity=campaign.capacity,
        status=campaign.status, version=campaign.version, created_at=campaign.created_at,
        updated_at=campaign.updated_at, confirmed_at=campaign.confirmed_at,
        latest_optimization_run_id=campaign.latest_optimization_run_id,
        eligible_count=eligible_count, recommended_count=recommended_count,
        selected_count=selected_count, unused_capacity=unused_capacity,
    )


def _response(session: Session, campaign: Campaign) -> CampaignResponse:
    run = latest_run(session, campaign)
    recommendations: list[CampaignRecommendationResponse] = []
    overrides = list(session.scalars(select(CampaignOverride).where(CampaignOverride.campaign_id == campaign.id).order_by(CampaignOverride.created_at)))
    override_map = {item.customer_id: item for item in overrides}
    selected_ids = {item.customer_id for item in session.scalars(select(CampaignSelection).where(CampaignSelection.campaign_id == campaign.id))}
    if run is not None:
        rows = list(session.scalars(select(CampaignRecommendation).where(CampaignRecommendation.optimization_run_id == run.id).order_by(CampaignRecommendation.rank)))
        replacement_ids = {
            item.replacement_customer_id
            for item in override_map.values()
            if item.action == "include" and item.replacement_customer_id
        }
        for row in rows:
            override = override_map.get(row.customer_id)
            selected = row.customer_id in selected_ids
            is_override = override is not None
            replaced = campaign.status in {"confirmed", "archived"} and row.customer_id in replacement_ids
            state = "selected" if selected else "not_selected" if replaced else "excluded" if override and override.action == "exclude" else "override" if is_override else "recommended" if row.recommended else "not_selected"
            recommendations.append(CampaignRecommendationResponse(
                recommendation_id=row.id, customer_id=row.customer_id, prediction_id=row.prediction_id,
                rank=row.rank, risk_score=float(row.risk_score), recommended_for_review=row.recommended_for_review,
                recommended=row.recommended, selected=selected, override=is_override, selection_state=state,
                monthly_charges=float(row.monthly_charges), total_charges=float(row.total_charges),
                monthly_spend_percentile=float(row.monthly_spend_percentile), historical_spend_percentile=float(row.historical_spend_percentile),
                value_index=float(row.value_index), priority_score=float(row.priority_score), model_version=row.model_version,
                scored_at=row.scored_at, override_reason=override.reason if override else None,
            ))
    optimization = None
    if run is not None:
        prediction_times = [item.scored_at for item in recommendations if item.scored_at]
        optimization = CampaignOptimizationResponse(
            run_id=run.id, formula_version=run.formula_version, monthly_weight=float(run.monthly_weight), historical_weight=float(run.historical_weight),
            reference_population_timestamp=run.reference_population_timestamp, created_at=run.created_at, eligible_count=run.eligible_count,
            recommended_count=run.recommended_count, unused_capacity=run.unused_capacity, model_versions=run.model_versions,
            prediction_scored_at=max(prediction_times) if prediction_times else None,
        )
    selected_count = len(selected_ids)
    return CampaignResponse(
        campaign_id=campaign.id, name=campaign.name, capacity=campaign.capacity, status=campaign.status, version=campaign.version,
        created_at=campaign.created_at, updated_at=campaign.updated_at, confirmed_at=campaign.confirmed_at,
        latest_optimization_run_id=campaign.latest_optimization_run_id, optimization=optimization,
        recommendations=recommendations, overrides=[CampaignOverrideResponse(override_id=item.id, customer_id=item.customer_id, action=item.action, reason=item.reason, replacement_customer_id=item.replacement_customer_id, created_at=item.created_at) for item in overrides],
        eligible_count=run.eligible_count if run else 0, recommended_count=run.recommended_count if run else 0, selected_count=selected_count,
        unused_capacity=max(0, campaign.capacity - selected_count),
    )


def _idempotency_replay(request: Request, session: Session, scope: str, key: str, payload_hash: str):
    record = session.scalar(select(IdempotencyRecord).where(IdempotencyRecord.scope == scope, IdempotencyRecord.key == key))
    if record is None:
        return None
    if record.request_hash != payload_hash:
        return problem_response(request, status=409, code="idempotency_conflict", title="Idempotency key conflict", detail="This key was already used for a different campaign action.")
    return JSONResponse(status_code=record.status_code, content=record.response_body)


def _idempotency_key(request: Request, *, detail: str) -> tuple[str | None, JSONResponse | None]:
    try:
        key = normalize_idempotency_key(request.headers.get("Idempotency-Key"))
    except ValueError:
        return None, problem_response(
            request,
            status=400,
            code="idempotency_key_invalid",
            title="Invalid idempotency key",
            detail="Idempotency-Key must be visible ASCII text no longer than 128 characters.",
        )
    if key is None:
        return None, problem_response(
            request,
            status=400,
            code="idempotency_key_required",
            title="Idempotency key required",
            detail=detail,
        )
    return key, None


def _validate_body(request: Request, model, body: dict):
    try:
        return model.model_validate(body)
    except ValidationError:
        return problem_response(request, status=422, code="validation_failed", title="Request validation failed", detail="One or more campaign fields need correction.")


@router.get("", response_model=CampaignListResponse)
async def list_campaigns(request: Request, page: int = Query(1, ge=1), page_size: Literal[25, 50, 100] = Query(25), include_archived: bool = False):
    session = _session(request)
    if session is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        query = select(Campaign)
        if not include_archived:
            query = query.where(Campaign.status != "archived")
        total = int(session.scalar(select(func.count()).select_from(query.subquery())) or 0)
        rows = list(session.scalars(query.order_by(desc(Campaign.created_at)).offset((page - 1) * page_size).limit(page_size)))
        run_counts: dict[UUID, tuple[int, int, int]] = {}
        campaign_ids = [row.id for row in rows]
        run_ids = [row.latest_optimization_run_id for row in rows if row.latest_optimization_run_id is not None]
        if run_ids:
            run_counts = {
                row.id: (row.eligible_count, row.recommended_count, row.unused_capacity)
                for row in session.execute(
                    select(OptimizationRun.id, OptimizationRun.eligible_count, OptimizationRun.recommended_count, OptimizationRun.unused_capacity)
                    .where(OptimizationRun.id.in_(run_ids))
                )
            }
        selected_counts: dict[UUID, int] = {}
        if campaign_ids:
            selected_counts = {
                campaign_id: count
                for campaign_id, count in session.execute(
                    select(CampaignSelection.campaign_id, func.count(CampaignSelection.id))
                    .where(CampaignSelection.campaign_id.in_(campaign_ids))
                    .group_by(CampaignSelection.campaign_id)
                )
            }
        summaries = []
        for row in rows:
            eligible_count, recommended_count, run_unused = run_counts.get(row.latest_optimization_run_id, (0, 0, 0))
            selected_count = selected_counts.get(row.id, 0)
            unused_capacity = max(0, row.capacity - selected_count) if row.status in {"confirmed", "archived"} else run_unused
            summaries.append(_summary(row, eligible_count=eligible_count, recommended_count=recommended_count, selected_count=selected_count, unused_capacity=unused_capacity))
        return {"items": summaries, "total": total, "page": page, "page_size": page_size}
    finally:
        session.close()


@router.post("", response_model=CampaignResponse, status_code=201)
async def create_campaign(request: Request, body: dict):
    key, key_error = _idempotency_key(request, detail="Provide an Idempotency-Key for campaign creation.")
    if key_error is not None:
        return key_error
    payload = _validate_body(request, CampaignWrite, body)
    if isinstance(payload, JSONResponse):
        return payload
    if not payload.name.strip():
        return problem_response(request, status=422, code="validation_failed", title="Request validation failed", detail="Campaign name cannot be blank.")
    session = _session(request)
    if session is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        payload.name = payload.name.strip()
        digest = request_hash(payload.model_dump())
        replay = _idempotency_replay(request, session, "campaign:create", key, digest)
        if replay is not None:
            return replay
        campaign = Campaign(name=payload.name, capacity=payload.capacity, status="draft", version=1)
        session.add(campaign); session.flush()
        result = _response(session, campaign).model_dump(mode="json")
        session.add(IdempotencyRecord(scope="campaign:create", key=key, request_hash=digest, status_code=201, response_body=result))
        session.commit()
        return result
    except IntegrityError:
        session.rollback()
        return problem_response(request, status=409, code="duplicate_campaign_name", title="Campaign name already exists", detail="Choose a different campaign name.")
    finally:
        session.close()


@router.get("/{campaign_id}", response_model=CampaignResponse)
async def get_campaign(request: Request, campaign_id: UUID):
    session = _session(request)
    if session is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        campaign = _load(session, campaign_id)
        if campaign is None:
            return problem_response(request, status=404, code="not_found", title="Campaign not found", detail="The requested campaign does not exist.")
        return _response(session, campaign)
    finally:
        session.close()


@router.patch("/{campaign_id}")
@router.put("/{campaign_id}", include_in_schema=False)
async def update_campaign(request: Request, campaign_id: UUID, body: dict, if_match: str | None = Header(default=None, alias="If-Match")):
    if if_match is None:
        return problem_response(request, status=400, code="invalid_request", title="Expected version required", detail="Provide If-Match with the current campaign version.")
    try:
        expected = _version(if_match)
        if expected is None:
            raise ValueError
    except ValueError:
        return problem_response(request, status=400, code="invalid_request", title="Expected version required", detail="If-Match must contain the integer campaign version.")
    payload = _validate_body(request, CampaignWrite, body)
    if isinstance(payload, JSONResponse):
        return payload
    payload.name = payload.name.strip()
    if not payload.name:
        return problem_response(request, status=422, code="validation_failed", title="Request validation failed", detail="Campaign name cannot be blank.")
    session = _session(request)
    if session is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        campaign = _load(session, campaign_id)
        if campaign is None:
            return problem_response(request, status=404, code="not_found", title="Campaign not found", detail="The requested campaign does not exist.")
        if campaign.status != "draft":
            return problem_response(request, status=409, code="campaign_state_conflict", title="Campaign cannot be edited", detail="Only draft campaigns can be edited.")
        if campaign.version != expected:
            return problem_response(request, status=409, code="campaign_version_conflict", title="Campaign changed", detail="Reload the campaign and apply the edit again.")
        campaign.name = payload.name; campaign.capacity = payload.capacity; campaign.version += 1; session.commit()
        return _response(session, campaign)
    except IntegrityError:
        session.rollback(); return problem_response(request, status=409, code="duplicate_campaign_name", title="Campaign name already exists", detail="Choose a different campaign name.")
    finally:
        session.close()


@router.post("/{campaign_id}/optimize", response_model=CampaignResponse)
async def optimize(request: Request, campaign_id: UUID, body: dict | None = None, if_match: str | None = Header(default=None, alias="If-Match")):
    payload = _validate_body(request, CampaignOptimizeWrite, body or {})
    if isinstance(payload, JSONResponse):
        return payload
    session = _session(request)
    if session is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        campaign = _load(session, campaign_id)
        if campaign is None:
            return problem_response(request, status=404, code="not_found", title="Campaign not found", detail="The requested campaign does not exist.")
        expected_version = _version(if_match)
        if expected_version is None:
            return problem_response(request, status=400, code="invalid_request", title="Expected version required", detail="If-Match must contain the integer campaign version.")
        if if_match is not None and campaign.version != expected_version:
            return problem_response(request, status=409, code="campaign_version_conflict", title="Campaign changed", detail="Reload the campaign and optimize again.")
        if campaign.status == "optimized" and not payload.acknowledge_reoptimization:
            return problem_response(request, status=409, code="campaign_state_conflict", title="Re-optimization requires acknowledgement", detail="A new optimization creates an immutable replacement snapshot; acknowledge it explicitly.")
        if campaign.status == "optimized" and payload.acknowledge_reoptimization:
            for old_override in list(session.scalars(select(CampaignOverride).where(CampaignOverride.campaign_id == campaign.id))):
                session.delete(old_override)
            session.flush()
        run = optimize_campaign(session, campaign)
        session.commit()
        return _response(session, campaign)
    except CampaignError as exc:
        session.rollback(); return _error(request, exc)
    finally:
        session.close()


@router.post("/{campaign_id}/overrides", response_model=CampaignResponse)
async def add_override(request: Request, campaign_id: UUID, body: dict, if_match: str | None = Header(default=None, alias="If-Match")):
    payload = _validate_body(request, CampaignOverrideWrite, body)
    if isinstance(payload, JSONResponse): return payload
    session = _session(request)
    if session is None: return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        campaign = _load(session, campaign_id)
        if campaign is None: return problem_response(request, status=404, code="not_found", title="Campaign not found", detail="The requested campaign does not exist.")
        expected_version = _version(if_match)
        if expected_version is None: return problem_response(request, status=400, code="invalid_request", title="Expected version required", detail="If-Match must contain the integer campaign version.")
        if campaign.version != expected_version: return problem_response(request, status=409, code="campaign_version_conflict", title="Campaign changed", detail="Reload before applying the override.")
        apply_override(session, campaign, customer_id=payload.customer_id.strip().upper(), action=payload.action, reason=payload.reason, replacement_customer_id=payload.replacement_customer_id.strip().upper() if payload.replacement_customer_id else None)
        session.commit(); return _response(session, campaign)
    except CampaignError as exc:
        session.rollback(); return _error(request, exc)
    finally: session.close()


@router.delete("/{campaign_id}/overrides/{override_id}", response_model=CampaignResponse)
async def remove_override(request: Request, campaign_id: UUID, override_id: UUID, if_match: str | None = Header(default=None, alias="If-Match")):
    session = _session(request)
    if session is None: return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        campaign = _load(session, campaign_id)
        override = session.scalar(select(CampaignOverride).where(CampaignOverride.id == override_id, CampaignOverride.campaign_id == campaign_id))
        if campaign is None or override is None: return problem_response(request, status=404, code="not_found", title="Override not found", detail="The requested override does not exist.")
        expected_version = _version(if_match)
        if expected_version is None: return problem_response(request, status=400, code="invalid_request", title="Expected version required", detail="If-Match must contain the integer campaign version.")
        if campaign.version != expected_version: return problem_response(request, status=409, code="campaign_version_conflict", title="Campaign changed", detail="Reload before removing the override.")
        session.delete(override); campaign.version += 1; session.commit(); return _response(session, campaign)
    finally: session.close()


@router.post("/{campaign_id}/confirm", response_model=CampaignResponse)
async def confirm(request: Request, campaign_id: UUID, if_match: str | None = Header(default=None, alias="If-Match")):
    key, key_error = _idempotency_key(request, detail="Provide an Idempotency-Key for confirmation.")
    if key_error is not None:
        return key_error
    session = _session(request)
    if session is None: return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        # Lock before checking the idempotency record so concurrent retries for
        # the same key wait for the first confirmation and then replay it.
        campaign = session.scalar(select(Campaign).where(Campaign.id == campaign_id).with_for_update())
        if campaign is None: return problem_response(request, status=404, code="not_found", title="Campaign not found", detail="The requested campaign does not exist.")
        digest = request_hash({"campaign_id": str(campaign_id), "version": _version(if_match)})
        replay = _idempotency_replay(request, session, f"campaign:confirm:{campaign_id}", key, digest)
        if replay is not None: return replay
        expected_version = _version(if_match)
        if expected_version is None: return problem_response(request, status=400, code="invalid_request", title="Expected version required", detail="If-Match must contain the integer campaign version.")
        if campaign.version != expected_version: return problem_response(request, status=409, code="campaign_version_conflict", title="Campaign changed", detail="Reload before confirming.")
        confirm_campaign(session, campaign)
        result = _response(session, campaign).model_dump(mode="json")
        session.add(IdempotencyRecord(scope=f"campaign:confirm:{campaign_id}", key=key, request_hash=digest, status_code=200, response_body=result)); session.commit(); return result
    except CampaignError as exc:
        session.rollback(); return _error(request, exc)
    finally: session.close()


@router.post("/{campaign_id}/archive", response_model=CampaignResponse)
async def archive(request: Request, campaign_id: UUID, if_match: str | None = Header(default=None, alias="If-Match")):
    session = _session(request)
    if session is None: return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    try:
        campaign = _load(session, campaign_id)
        if campaign is None: return problem_response(request, status=404, code="not_found", title="Campaign not found", detail="The requested campaign does not exist.")
        expected_version = _version(if_match)
        if expected_version is None: return problem_response(request, status=400, code="invalid_request", title="Expected version required", detail="If-Match must contain the integer campaign version.")
        if campaign.version != expected_version: return problem_response(request, status=409, code="campaign_version_conflict", title="Campaign changed", detail="Reload before archiving.")
        if campaign.status != "confirmed": return problem_response(request, status=409, code="campaign_state_conflict", title="Campaign cannot be archived", detail="Only confirmed campaigns can be archived.")
        campaign.status = "archived"; campaign.version += 1; session.commit(); return _response(session, campaign)
    finally: session.close()
