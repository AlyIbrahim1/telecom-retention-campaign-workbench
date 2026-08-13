from collections.abc import Callable

import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.main import create_app


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        app_env="test",
        database_url="postgresql+psycopg://test:test@localhost/test",
        cors_origin="http://127.0.0.1:5173",
        max_request_bytes=16,
    )


@pytest.fixture
def client_factory(settings: Settings):
    def build(database_check: Callable[[], bool] = lambda: True) -> TestClient:
        app = create_app(settings=settings, database_check=database_check)

        @app.post("/test/body")
        async def body(request: Request) -> dict[str, int]:
            return {"size": len(await request.body())}

        @app.get("/test/error")
        async def error() -> None:
            raise RuntimeError("SENTINEL-SECRET database password")

        return TestClient(app, raise_server_exceptions=False)

    return build
