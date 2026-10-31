"""Ingestion service: scope check -> normalize -> dedup -> persist -> trigger hook.

Synchronous for MVP. The investigation trigger is a hook (log-only) until the
LangGraph layer lands; Docker callbacks never run LLM work directly.
"""

import json
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.security import is_project_monitored, redact_secrets
from app.db.models.incident import Incident
from app.evidence.normalizer import build_signature, build_title, classify_severity
from app.schemas.incident import EvidenceItem, IncidentSource

log = get_logger(__name__)

MAX_STORED_LOG_CHARS = 20000


class OutOfScopeError(ValueError):
    pass


def request_investigation(incident_id: str) -> None:
    """Hook: queued investigation entry point (background mechanism in a later milestone)."""
    log.info("investigation requested for incident %s (hook only)", incident_id)


def ingest_event(
    session: Session,
    *,
    source: IncidentSource | str,
    project_id: str,
    category: str,
    detail: str,
    raw_logs: str = "",
    evidence: list[EvidenceItem] | None = None,
    allowlist: list[str] | None = None,
    matched_lines: int = 0,
) -> tuple[Incident, bool]:
    src = str(source.value if isinstance(source, IncidentSource) else source)
    if not is_project_monitored(project_id, allowlist or []):
        raise OutOfScopeError(f"project '{project_id}' is not in the monitored allowlist")

    signature = build_signature(src, project_id, category, detail)
    safe_logs = redact_secrets(raw_logs or "")[-MAX_STORED_LOG_CHARS:]
    evidence_payload = [e.model_dump() for e in (evidence or [])]

    existing = (
        session.query(Incident)
        .filter(
            Incident.source == src,
            Incident.project_id == project_id,
            Incident.error_signature == signature,
            Incident.status != "resolved",
        )
        .one_or_none()
    )
    now = datetime.now(UTC)
    if existing:
        existing.observation_count += 1
        existing.matched_line_count += max(matched_lines, 0)
        existing.last_seen = now
        existing.raw_logs = (existing.raw_logs + "\n" + safe_logs)[-MAX_STORED_LOG_CHARS:]
        existing.severity = classify_severity(category, existing.observation_count)
        session.commit()
        session.refresh(existing)
        return existing, False

    incident = Incident(
        source=src,
        project_id=project_id,
        title=build_title(src, project_id, category, detail),
        status="open",
        severity=classify_severity(category, 1),
        error_signature=signature,
        raw_logs=safe_logs,
        evidence_json=json.dumps(evidence_payload),
        first_seen=now,
        last_seen=now,
        observation_count=1,
        matched_line_count=max(matched_lines, 0),
    )
    session.add(incident)
    session.commit()
    session.refresh(incident)
    request_investigation(str(incident.id))
    return incident, True
