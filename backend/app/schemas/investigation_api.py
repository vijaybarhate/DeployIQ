"""Investigation API schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class InvestigationRead(BaseModel):
    id: uuid.UUID
    incident_id: uuid.UUID
    status: str
    requested_model: str
    actual_model: str
    prompt_version: str
    result: dict | None = None
    evidence_snapshot: list[dict] = Field(default_factory=list)
    runbook_snapshot: list[dict] = Field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    duration_ms: int = 0
    error_code: str = ""
    error_message: str = ""
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
