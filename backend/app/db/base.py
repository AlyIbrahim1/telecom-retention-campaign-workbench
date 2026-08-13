"""Declarative base shared by future SQLAlchemy models."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for application tables introduced in later stages."""


# Register model classes for Alembic/metadata consumers that import Base only.
# ``models`` imports Base above, so this executes safely after the class exists.
from backend.app.db import models as _models  # noqa: E402,F401
