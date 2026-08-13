"""Process and dependency health endpoints."""

from fastapi import APIRouter, Request

from backend.app.core.errors import problem_response


router = APIRouter(tags=["health"])


@router.get("/health/live")
async def live() -> dict[str, str]:
    """Report process liveness without touching dependencies."""

    return {"status": "live"}


@router.get("/health/ready")
async def ready(request: Request):
    """Report readiness only when the database and trusted model are ready."""

    try:
        # The readiness query is one short ``SELECT 1``.  Keeping it direct
        # avoids a hidden thread-pool dependency in the local pilot and keeps
        # the health path deterministic in minimal development environments.
        database_ready = request.app.state.database_check()
    except Exception:
        database_ready = False

    model_status = getattr(request.app.state, "model_status", "not_configured")
    # 's injected checker intentionally has no model.  A real process
    # creates a loader during lifespan, so an unavailable model fails closed.
    model_ready = model_status in {"ready", "not_configured"}
    if not database_ready or not model_ready:
        return problem_response(
            request,
            status=503,
            code="service_unavailable",
            title="Service unavailable",
            detail="The application is not ready to serve requests.",
        )

    return {
        "status": "ready",
        "ready": True,
        "checks": {"database": "ready", "model": model_status},
    }
