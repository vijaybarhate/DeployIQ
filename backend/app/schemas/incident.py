"""Common incident schema — identical for Docker and GitHub Actions sources."""

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class IncidentSource(StrEnum):
    DOCKER = "docker"
    GITHUB_ACTIONS = "github_actions"


class IncidentStatus(StrEnum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"


class EvidenceItem(BaseModel):
    kind: str = Field(description="e.g. traceback, exit_code, oom, health, log_excerpt")
    summary: str
    detail: str = ""


class IncidentCreate(BaseModel):
    source: IncidentSource
    project_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=512)
    error_signature: str = Field(min_length=1, max_length=512)
    raw_logs: str = ""
    evidence: list[EvidenceItem] = []


class IncidentRead(BaseModel):
    id: uuid.UUID
    source: IncidentSource
    project_id: str
    title: str
    status: IncidentStatus
    severity: str | None
    error_signature: str
    raw_logs: str
    evidence: list[EvidenceItem]
    first_seen: datetime
    last_seen: datetime
    occurrence_count: int
