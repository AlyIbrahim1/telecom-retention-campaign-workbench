"""Manual campaign contact outcomes and illustrative value reporting."""

from __future__ import annotations

import csv
import io
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from backend.app.core.errors import problem_response
from backend.app.core.validation import normalize_idempotency_key
from backend.app.db.models import Campaign, CampaignRecommendation, CampaignSelection, OutreachEvent
from backend.app.domain.imports import safe_export_cell

router = APIRouter(prefix="/api/v1/campaigns", tags=["outreach"])
Status = Literal["attempted", "no_answer", "reached", "offer_accepted", "offer_declined"]
Filter = Literal["not_started", "attempted", "no_answer", "reached", "offer_accepted", "offer_declined"]


class EventWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    status: Status
    note: str | None = Field(default=None, max_length=500)


def _rows(session, campaign_id: UUID):
    return list(session.execute(
        select(CampaignSelection, CampaignRecommendation)
        .join(CampaignRecommendation, CampaignSelection.recommendation_id == CampaignRecommendation.id)
        .where(CampaignSelection.campaign_id == campaign_id)
        .order_by(CampaignRecommendation.rank)
    ))


def _events(session, campaign_id: UUID):
    events = session.scalars(
        select(OutreachEvent).where(OutreachEvent.campaign_id == campaign_id)
        .order_by(OutreachEvent.created_at, OutreachEvent.id)
    )
    history = {}
    for event in events:
        history.setdefault(event.selection_id, []).append(event)
    return history


def _event_data(event: OutreachEvent) -> dict:
    return {
        "event_id": event.id, "status": event.status, "note": event.note,
        "actor": event.actor, "created_at": event.created_at,
    }


def _summary(campaign: Campaign, rows, history) -> dict:
    latest = {selection_id: events[-1] for selection_id, events in history.items() if events}
    contacted = len(latest)
    reached = sum(item.status in {"reached", "offer_accepted", "offer_declined"} for item in latest.values())
    accepted = sum(item.status == "offer_accepted" for item in latest.values())
    horizon = campaign.value_horizon_months
    cost = Decimal(str(campaign.contact_cost_per_customer))
    associated = sum(
        (Decimal(str(recommendation.monthly_charges)) * horizon for selection, recommendation in rows
         if latest.get(selection.id) and latest[selection.id].status == "offer_accepted"),
        Decimal("0"),
    )
    contact_cost = cost * contacted
    return {
        "selected": len(rows), "contacted": contacted, "reached": reached, "accepted": accepted,
        "value_horizon_months": horizon, "contact_cost_per_customer": float(cost),
        "associated_value": float(associated), "estimated_contact_cost": float(contact_cost),
        "illustrative_net_value": float(associated - contact_cost),
    }


def _load(request, session, campaign_id):
    campaign = session.get(Campaign, campaign_id)
    if campaign is None:
        return problem_response(request, status=404, code="not_found", title="Campaign not found", detail="The requested campaign does not exist.")
    if campaign.status not in {"confirmed", "archived"}:
        return problem_response(request, status=409, code="campaign_not_confirmed", title="Campaign not confirmed", detail="Confirm a selection before recording contact outcomes.")
    return campaign


@router.get("/{campaign_id}/outreach")
async def list_outreach(request: Request, campaign_id: UUID, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), status: Filter | None = None):
    factory = request.app.state.session_factory
    if factory is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    with factory() as session:
        campaign = _load(request, session, campaign_id)
        if not isinstance(campaign, Campaign):
            return campaign
        rows = _rows(session, campaign_id)
        history = _events(session, campaign_id)
        summary = _summary(campaign, rows, history)
        if status:
            rows = [(selection, recommendation) for selection, recommendation in rows
                    if (history[selection.id][-1].status if history.get(selection.id) else "not_started") == status]
        total = len(rows)
        items = []
        for selection, recommendation in rows[(page - 1) * page_size:page * page_size]:
            events = history.get(selection.id, [])
            items.append({
                "selection_id": selection.id, "customer_id": selection.customer_id,
                "risk_score": float(selection.risk_score), "priority_score": float(selection.priority_score),
                "monthly_charges": float(recommendation.monthly_charges),
                "status": events[-1].status if events else "not_started",
                "events": [_event_data(event) for event in reversed(events)],
            })
        return {"items": items, "total": total, "page": page, "page_size": page_size, "summary": summary}


@router.post("/{campaign_id}/outreach/{selection_id}/events", status_code=201)
async def record_outreach(request: Request, campaign_id: UUID, selection_id: UUID, body: dict,
                    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    try:
        key = normalize_idempotency_key(idempotency_key)
    except ValueError:
        return problem_response(request, status=400, code="idempotency_key_invalid", title="Invalid idempotency key", detail="Provide visible ASCII text no longer than 128 characters.")
    if key is None:
        return problem_response(request, status=400, code="idempotency_key_required", title="Idempotency key required", detail="Provide an Idempotency-Key for each recorded outcome.")
    try:
        payload = EventWrite.model_validate(body)
    except ValidationError:
        return problem_response(request, status=422, code="validation_failed", title="Invalid contact outcome", detail="Provide a valid status and a note of at most 500 characters.")
    normalized_note = payload.note.strip() if payload.note else None
    factory = request.app.state.session_factory
    if factory is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    with factory() as session:
        prior = session.scalar(select(OutreachEvent).where(OutreachEvent.campaign_id == campaign_id, OutreachEvent.idempotency_key == key))
        if prior is not None:
            if prior.selection_id != selection_id or prior.status != payload.status or prior.note != normalized_note:
                return problem_response(request, status=409, code="idempotency_conflict", title="Idempotency key conflict", detail="This key was used for a different contact outcome.")
            return _event_data(prior)
        campaign = _load(request, session, campaign_id)
        if not isinstance(campaign, Campaign):
            return campaign
        if campaign.status == "archived":
            return problem_response(request, status=409, code="campaign_archived", title="Campaign archived", detail="Archived campaign outcomes are read-only.")
        selection = session.get(CampaignSelection, selection_id)
        if selection is None or selection.campaign_id != campaign_id:
            return problem_response(request, status=404, code="selection_not_found", title="Selection not found", detail="The customer is not in this confirmed selection.")
        event = OutreachEvent(campaign_id=campaign_id, selection_id=selection_id, idempotency_key=key,
                              status=payload.status, note=normalized_note, actor="local-demo-user")
        session.add(event)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            return problem_response(request, status=409, code="idempotency_conflict", title="Idempotency key conflict", detail="Reload the outcome and retry with a new key if needed.")
        return _event_data(event)


@router.get("/{campaign_id}/outreach.csv")
async def export_outreach(request: Request, campaign_id: UUID):
    factory = request.app.state.session_factory
    if factory is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    with factory() as session:
        campaign = _load(request, session, campaign_id)
        if not isinstance(campaign, Campaign):
            return campaign
        rows = _rows(session, campaign_id)
        history = _events(session, campaign_id)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["customer_id", "risk_score", "priority_score", "monthly_charges", "status", "latest_at", "latest_note"])
        for selection, recommendation in rows:
            events = history.get(selection.id, [])
            latest = events[-1] if events else None
            writer.writerow([safe_export_cell(selection.customer_id), selection.risk_score,
                             selection.priority_score, recommendation.monthly_charges,
                             latest.status if latest else "not_started",
                             latest.created_at.isoformat() if latest else "",
                             safe_export_cell(latest.note) if latest else ""])
        return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{campaign_id}-outreach.csv"'})
