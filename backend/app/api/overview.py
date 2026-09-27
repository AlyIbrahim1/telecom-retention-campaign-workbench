"""Small aggregated overview for the local operator."""

from fastapi import APIRouter, Request
from sqlalchemy import func, select

import math
from collections import Counter

from backend.app.api.customers import _latest_prediction_subquery
from backend.app.core.errors import problem_response
from backend.app.db.models import Campaign, CampaignSelection, Customer, OutreachEvent, Prediction

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


CONTRACT_ORDER = ("Month-to-month", "One year", "Two year")
INTERNET_ORDER = ("Fiber optic", "DSL", "No")
PAYMENT_ORDER = ("Electronic check", "Mailed check", "Bank transfer (automatic)", "Credit card (automatic)")
ADD_ONS = (
    ("online_security", "Online security"),
    ("online_backup", "Online backup"),
    ("device_protection", "Device protection"),
    ("tech_support", "Tech support"),
    ("streaming_tv", "Streaming TV"),
    ("streaming_movies", "Streaming movies"),
)
PROFILE = (
    ("senior_citizen", "Senior citizen"),
    ("partner", "Has partner"),
    ("dependents", "Has dependents"),
    ("phone_service", "Phone service"),
    ("multiple_lines", "Multiple lines"),
    ("paperless_billing", "Paperless billing"),
)
TENURE_BIN_MONTHS = 6
CHARGE_BIN = 10


def _mix(values: list[str], order: tuple[str, ...]) -> list[dict]:
    counts = Counter(values)
    labels = list(order) + sorted(label for label in counts if label not in order)
    return [{"label": label, "customers": counts.get(label, 0)} for label in labels]


def _histogram(values: list[float], width: float, top: float) -> list[dict]:
    """Fixed-width bins from 0 to ``top``; the last bin also holds larger values."""

    bins = [{"lower": index * width, "upper": (index + 1) * width, "customers": 0} for index in range(int(top // width))]
    for value in values:
        index = min(len(bins) - 1, max(0, int(value // width)))
        bins[index]["customers"] += 1
    return bins


def _ceil_to(value: float, width: int, floor: int) -> int:
    """Round ``value`` up to a whole number of bins, never below ``floor``."""

    return max(floor, int(math.ceil(value / width)) * width)


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


@router.get("/overview/customers")
async def customer_overview(request: Request):
    """Descriptive statistics for the active customer records.

    Everything here is computed from stored account facts only; no model
    output is involved.
    """

    factory = request.app.state.session_factory
    if factory is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    with factory() as session:
        customers = session.scalars(select(Customer).where(Customer.is_active.is_(True))).all()
        inactive = session.scalar(select(func.count()).select_from(Customer).where(Customer.is_active.is_(False))) or 0
        rows = [
            {
                "contract": customer.contract,
                "internet_service": customer.internet_service,
                "payment_method": customer.payment_method,
                "tenure": int(customer.tenure),
                "monthly_charges": float(customer.monthly_charges),
                "total_charges": float(customer.total_charges),
                **{field: getattr(customer, field) for field, _ in ADD_ONS + PROFILE},
            }
            for customer in customers
        ]

    count = len(rows)
    tenures = [row["tenure"] for row in rows]
    monthly = [row["monthly_charges"] for row in rows]
    lifetime = [row["total_charges"] for row in rows]
    internet_rows = [row for row in rows if row["internet_service"] != "No"]
    phone_rows = [row for row in rows if row["phone_service"] == "Yes"]

    def share(field: str, label: str) -> dict:
        base = phone_rows if field == "multiple_lines" else rows
        return {
            "key": field,
            "label": label,
            "customers": sum(1 for row in base if row[field] == "Yes"),
            "base": len(base),
        }

    return {
        "active_customers": count,
        "inactive_customers": inactive,
        "monthly_charges_total": round(sum(monthly), 2),
        "monthly_charges_average": round(sum(monthly) / count, 2) if count else None,
        "monthly_charges_median": _median(monthly),
        "total_charges_average": round(sum(lifetime) / count, 2) if count else None,
        "tenure_average": round(sum(tenures) / count, 1) if count else None,
        "tenure_median": _median([float(value) for value in tenures]),
        "internet_customers": len(internet_rows),
        "by_contract": _mix([row["contract"] for row in rows], CONTRACT_ORDER),
        "by_internet_service": _mix([row["internet_service"] for row in rows], INTERNET_ORDER),
        "by_payment_method": _mix([row["payment_method"] for row in rows], PAYMENT_ORDER),
        "tenure_distribution": _histogram([float(value) for value in tenures], TENURE_BIN_MONTHS, _ceil_to(max(tenures, default=0), TENURE_BIN_MONTHS, 72)),
        "monthly_charges_distribution": _histogram(monthly, CHARGE_BIN, _ceil_to(max(monthly, default=0), CHARGE_BIN, 120)),
        "add_on_adoption": [
            {"key": field, "label": label, "customers": sum(1 for row in internet_rows if row[field] == "Yes"), "base": len(internet_rows)}
            for field, label in ADD_ONS
        ],
        "account_profile": [share(field, label) for field, label in PROFILE],
    }


@router.get("/overview/predictions")
async def prediction_overview(request: Request):
    """Split of active customers by their latest model prediction.

    A customer counts as predicted to churn when the latest score is at or
    above that prediction's review threshold. These are model predictions,
    not observed outcomes.
    """

    factory = request.app.state.session_factory
    if factory is None:
        return problem_response(request, status=503, code="service_unavailable", title="Service unavailable", detail="The database is not ready.")
    latest = _latest_prediction_subquery()
    statement = (
        select(latest.c.prediction_recommended, latest.c.prediction_threshold, latest.c.prediction_model_version)
        .select_from(Customer)
        .outerjoin(latest, (latest.c.prediction_customer_uuid == Customer.id) & (latest.c.prediction_rank == 1))
        .where(Customer.is_active.is_(True))
    )
    with factory() as session:
        rows = session.execute(statement).all()
    scored = [row for row in rows if row[0] is not None]
    thresholds = Counter(round(float(row[1]), 4) for row in scored if row[1] is not None)
    versions = Counter(row[2] for row in scored if row[2])
    predicted_churn = sum(1 for row in scored if row[0])
    return {
        "active_customers": len(rows),
        "scored_customers": len(scored),
        "unscored_customers": len(rows) - len(scored),
        "predicted_churn": predicted_churn,
        "predicted_no_churn": len(scored) - predicted_churn,
        "threshold": thresholds.most_common(1)[0][0] if thresholds else None,
        "model_version": versions.most_common(1)[0][0] if versions else None,
    }
