"""FastAPI application factory for the local pilot."""

from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.app.api.health import router as health_router
from backend.app.api.customers import router as customer_router
from backend.app.api.imports import router as imports_router
from backend.app.api.campaigns import router as campaigns_router
from backend.app.api.chat import router as chat_router
from backend.app.api.outreach import router as outreach_router
from backend.app.api.overview import router as overview_router
from backend.app.chat.provider import OpenAIResponsesProvider
from backend.app.core.config import Settings, get_settings
from backend.app.core.errors import (
    database_exception_handler,
    http_exception_handler,
    unexpected_exception_handler,
    validation_exception_handler,
)
from backend.app.core.logging import configure_logging
from backend.app.core.middleware import HttpBoundaryMiddleware
from backend.app.db.session import create_database_engine, database_is_ready
from backend.app.db.session import create_session_factory
from backend.app.ml.service import ModelService, TrustedModelLoader


def create_app(
    settings: Settings | None = None,
    database_check: Callable[[], bool] | None = None,
    model_loader: TrustedModelLoader | None = None,
    session_factory: Any | None = None,
    chat_provider: Any | None = None,
) -> FastAPI:
    """Create the API with injectable settings and readiness for small tests."""

    settings = settings or get_settings()
    logger = configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = None
        app.state.model_ready = False
        app.state.model_status = "not_configured"
        app.state.model_error = None
        app.state.chat_provider = chat_provider or OpenAIResponsesProvider(
            settings.openai_api_key,
            settings.openai_base_url,
            settings.openai_model,
            settings.chat_timeout_seconds,
            settings.chat_max_output_tokens,
        )
        if database_check is None:
            engine = create_database_engine(
                settings.database_url.get_secret_value(),
                connect_timeout_seconds=settings.database_connect_timeout_seconds,
            )
            app.state.database_check = lambda: database_is_ready(engine)
            app.state.session_factory = session_factory or create_session_factory(engine)
        else:
            app.state.database_check = database_check
            app.state.session_factory = session_factory

        # The injected database checker is used by boundary tests. A
        # real application process always gets a loader here; tests that need
        # model behavior pass a small loader explicitly.
        active_loader = model_loader
        if active_loader is None and database_check is None:
            active_loader = TrustedModelLoader(settings.model_path, settings.model_sha256)
        if active_loader is not None:
            try:
                active_loader.load_once()
                app.state.model_service = ModelService(active_loader)
                app.state.model_ready = True
                app.state.model_status = "ready"
            except Exception:
                app.state.model_service = None
                app.state.model_status = "unavailable"
                app.state.model_error = "model startup validation failed"
        else:
            app.state.model_service = None
        yield
        if engine is not None:
            engine.dispose()

    app = FastAPI(
        title="Retention Campaign Workbench API",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.logger = logger
    app.state.model_service = None
    app.state.session_factory = session_factory
    app.state.chat_provider = chat_provider
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(SQLAlchemyError, database_exception_handler)
    app.add_exception_handler(Exception, unexpected_exception_handler)
    app.include_router(health_router)
    app.include_router(customer_router)
    app.include_router(imports_router)
    app.include_router(campaigns_router)
    app.include_router(chat_router)
    app.include_router(outreach_router)
    app.include_router(overview_router)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.allowed_origin],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Accept",
            "Content-Type",
            "If-Match",
            "Idempotency-Key",
            "X-Confirmation-Token",
            "X-Correlation-ID",
        ],
    )
    app.add_middleware(
        HttpBoundaryMiddleware,
        max_request_bytes=settings.max_request_bytes,
        logger=logger,
    )
    return app
