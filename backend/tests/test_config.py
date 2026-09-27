import pytest
from pydantic import ValidationError

from backend.app.core.config import Settings


BASE = {
    "_env_file": None,
    "database_url": "postgresql+psycopg://pilot:secret@localhost/pilot",
}


def test_local_no_auth_settings_are_valid():
    settings = Settings(**BASE, app_env="local", auth_enabled=False, cors_origin="http://127.0.0.1:5173")

    assert settings.app_env == "local"
    assert settings.auth_enabled is False
    assert settings.allowed_origin == "http://127.0.0.1:5173"
    assert "secret" not in str(settings)


@pytest.mark.parametrize("app_env", ["staging", "production"])
def test_non_local_unauthenticated_startup_is_rejected(app_env):
    with pytest.raises(ValidationError, match="local or test"):
        Settings(**BASE, app_env=app_env)


def test_claimed_authentication_is_rejected_until_implemented():
    with pytest.raises(ValidationError, match="not implemented"):
        Settings(**BASE, auth_enabled=True)


@pytest.mark.parametrize(
    "values",
    [
        {**BASE, "cors_origin": "*"},
        {**BASE, "cors_origin": "http://127.0.0.1:5173/path"},
        {**BASE, "database_url": "sqlite:///unsafe.db"},
    ],
)
def test_missing_or_unsafe_boundary_configuration_is_rejected(values):
    with pytest.raises(ValidationError):
        Settings(**values)


def test_missing_database_configuration_is_rejected(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)
