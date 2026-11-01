"""Investigation persistence: one row per investigation attempt (history preserved)."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.incident import GUID

# Terminal states need no recovery; only pending/running block duplicates.
ACTIVE_STATUSES = ("pending", "running")


class Investigation(Base):
    __tablename__ = "investigations"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("incidents.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    requested_model: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    actual_model: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    prompt_version: Mapped[str] = mapped_column(String(32), nullable=False, default="rca-v1")
    result_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    error_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    evidence_snapshot: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    runbook_snapshot: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


Index(
    "uq_investigation_active_per_incident",
    Investigation.__table__.c.incident_id,
    unique=True,
    sqlite_where=Investigation.__table__.c.status.in_(ACTIVE_STATUSES),
    postgresql_where=Investigation.__table__.c.status.in_(ACTIVE_STATUSES),
)
