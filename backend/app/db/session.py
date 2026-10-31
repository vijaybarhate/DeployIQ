"""Engine/session factory driven by DATABASE_URL (SQLite file now, Postgres later)."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.db.base import Base

_settings = get_settings()

connect_args = {"check_same_thread": False} if _settings.database_url.startswith("sqlite") else {}
engine = create_engine(_settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    from app.db.models import incident  # noqa: F401  (register models)

    Base.metadata.create_all(bind=engine)


def get_session():  # type: ignore[no-untyped-def]
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
