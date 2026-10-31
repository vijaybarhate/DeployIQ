"""SQLAlchemy declarative base. No SQLite-specific logic here."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
