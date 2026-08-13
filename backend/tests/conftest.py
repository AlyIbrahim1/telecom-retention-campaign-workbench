import asyncio
from collections.abc import Callable

import httpx
import pytest
from fastapi import Request

from backend.app.core.config import Settings
from backend.app.main import create_app


class SyncASGIClient:
    """Small synchronous facade over httpx's async ASGI transport.

    The installed Starlette TestClient cannot start its AnyIO portal in this
    environment. Keeping this adapter in tests preserves the existing test
    call sites while exercising the same FastAPI app and lifespan.
    """

    def __init__(self, app):
        self.app = app

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def request(self, method: str, path: str, **kwargs):
        content = kwargs.get("content")
        if content is not None and not isinstance(content, (bytes, bytearray, str)):
            kwargs["content"] = b"".join(content)

        async def send():
            async with self.app.router.lifespan_context(self.app):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=self.app), base_url="http://test"
                ) as client:
                    return await client.request(method, path, **kwargs)

        return asyncio.run(send())

    def get(self, path: str, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs):
        return self.request("POST", path, **kwargs)

    def options(self, path: str, **kwargs):
        return self.request("OPTIONS", path, **kwargs)


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
    def build(database_check: Callable[[], bool] = lambda: True) -> SyncASGIClient:
        app = create_app(settings=settings, database_check=database_check)

        @app.post("/test/body")
        async def body(request: Request) -> dict[str, int]:
            return {"size": len(await request.body())}

        @app.get("/test/error")
        async def error() -> None:
            raise RuntimeError("SENTINEL-SECRET database password")

        return SyncASGIClient(app)

    return build
