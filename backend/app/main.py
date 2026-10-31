"""FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC

from fastapi import FastAPI

from app.api.routes import health, incidents, investigations
from app.config import get_settings
from app.core.logging import setup_logging
from app.db.models.investigation import Investigation
from app.db.session import SessionLocal


def _recover_interrupted() -> None:
    """Mark investigations left active by a restart as failed with full audit fields."""
    from datetime import datetime

    from app.core.security import redact_secrets

    session = SessionLocal()
    try:
        rows = (
            session.query(Investigation)
            .filter(Investigation.status.in_(["pending", "running"]))
            .all()
        )
        for row in rows:
            row.status = "failed"
            row.error_code = "interrupted"
            row.error_message = redact_secrets("Investigation interrupted by application restart.")
            row.completed_at = datetime.now(UTC)
        session.commit()
    finally:
        session.close()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Schema comes from Alembic migrations (run `alembic upgrade head` first).
    # Only crash recovery runs here; never create_all (see M3.2 notes).
    _recover_interrupted()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_level)
    app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    app.include_router(health.router, prefix="/api/v1")
    app.include_router(incidents.router, prefix="/api/v1")
    app.include_router(investigations.router, prefix="/api/v1")
    return app


app = create_app()
