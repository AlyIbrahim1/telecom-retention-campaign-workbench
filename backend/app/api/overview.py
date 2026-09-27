"""Small aggregated overview for the local operator."""

from fastapi import APIRouter, Request
from sqlalchemy import func, select

from backend.app.core.errors import problem_response
from backend.app.db.models import Campaign, CampaignSelection, OutreachEvent, Prediction

router = APIRouter(prefix="/api/v1", tags=["overview"])


@router.get("/overview")
async def overview(request: Request):
    factory = request.app.state.session_factory
    if factory is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    with factory() as session:
        scored = session.scalar(select(func.count(func.distinct(Prediction.customer_uuid))).where(Prediction.success.is_(True))) or 0
        awaiting = session.scalar(select(func.count()).select_from(Campaign).where(Campaign.status == "optimized")) or 0
        selected = session.scalar(select(func.count()).select_from(CampaignSelection)) or 0
        events = session.scalars(select(OutreachEvent).order_by(OutreachEvent.created_at, OutreachEvent.id))
        latest = {}
        for event in events:
            latest[event.selection_id] = event.status
        return {
            "customers_scored": scored,
            "campaigns_awaiting_review": awaiting,
            "confirmed_selections": selected,
            "contacts_recorded": len(latest),
            "accepted_offers": sum(status == "offer_accepted" for status in latest.values()),
        }
