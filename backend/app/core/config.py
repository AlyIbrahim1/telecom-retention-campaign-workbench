"""Typed application settings loaded from environment variables."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_MODEL_SHA256 = "e96bc451db7fd313cd34e549816afbedded45ff34665a2aafd70c63bf767b180"
DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[3] / "models" / "random_forest_churn_bundle.joblib"


class Settings(BaseSettings):
    """Runtime settings with a deliberately local-only safety boundary."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: Literal["local", "test", "staging", "production"] = "local"
    auth_enabled: bool = False
    database_url: SecretStr
    database_connect_timeout_seconds: int = Field(default=3, ge=1, le=30)
    cors_origin: AnyHttpUrl = "http://127.0.0.1:5173"
    max_request_bytes: int = Field(default=11_000_000, ge=1)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    model_path: Path = DEFAULT_MODEL_PATH
    model_sha256: str = DEFAULT_MODEL_SHA256
    import_max_file_bytes: int = Field(default=10_000_000, ge=1)
    import_max_rows: int = Field(default=10_000, ge=1)
    import_max_columns: int = Field(default=30, ge=1)
    import_chunk_size: int = Field(default=500, ge=1)
    # Chat is optional in the local pilot.  An absent key keeps the core API
    # usable and makes chat return a safe ``ai_unavailable`` state.
    openai_api_key: SecretStr | None = None
    openai_model: str = "gpt-4.1-mini"
    chat_timeout_seconds: float = Field(default=20.0, gt=0, le=120)
    chat_max_output_tokens: int = Field(default=600, ge=64, le=4000)
    chat_context_messages: int = Field(default=20, ge=1, le=50)
    chat_confirmation_ttl_seconds: int = Field(default=600, ge=30, le=3600)

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().startswith("postgresql+psycopg://"):
            raise ValueError("DATABASE_URL must use PostgreSQL with the psycopg driver")
        return value

    @field_validator("cors_origin")
    @classmethod
    def validate_cors_origin(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        if value.host == "*" or str(value) == "*":
            raise ValueError("CORS origin must be one exact HTTP origin")
        if value.path not in (None, "/") or value.query or value.fragment:
            raise ValueError("CORS origin cannot contain a path, query, or fragment")
        return value

    @model_validator(mode="after")
    def enforce_pilot_boundary(self) -> "Settings":
        if self.auth_enabled:
            raise ValueError("Authentication is not implemented in the local pilot")
        if self.app_env not in {"local", "test"}:
            raise ValueError(
                "Unauthenticated startup is allowed only in local or test mode"
            )
        return self

    @property
    def allowed_origin(self) -> str:
        return str(self.cors_origin).rstrip("/")


@lru_cache
def get_settings() -> Settings:
    """Load and cache environment settings once per process."""

    return Settings()  # type: ignore[call-arg]
