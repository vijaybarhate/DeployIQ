"""Incident ingestion + query API."""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models.incident import Incident
from app.db.session import get_session
from app.schemas.incident import IncidentCreate, IncidentRead
from app.services.ingestion import OutOfScopeError, ingest_event

router = APIRouter(prefix="/incidents", tags=["incidents"])


def _to_read(inc: Incident) -> IncidentRead:
    return IncidentRead(
        id=inc.id,
        source=inc.source,  # type: ignore[arg-type]
        project_id=inc.project_id,
        title=inc.title,
        status=inc.status,  # type: ignore[arg-type]
        severity=inc.severity,
        error_signature=inc.error_signature,
        raw_logs=inc.raw_logs,
        evidence=json.loads(inc.evidence_json or "[]"),
        first_seen=inc.first_seen,
        last_seen=inc.last_seen,
        observation_count=inc.observation_count,
        matched_line_count=inc.matched_line_count,
    )


@router.post("", response_model=IncidentRead, status_code=201)
def create_incident(
    payload: IncidentCreate, session: Session = Depends(get_session)
) -> IncidentRead:
    settings = get_settings()
    try:
        incident, _ = ingest_event(
            session,
            source=payload.source,
            project_id=payload.project_id,
            category=payload.evidence[0].kind if payload.evidence else "unknown",
            detail=payload.title,
            raw_logs=payload.raw_logs,
            evidence=payload.evidence,
            allowlist=settings.monitored_project_list,
        )
    except OutOfScopeError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return _to_read(incident)


@router.get("", response_model=list[IncidentRead])
def list_incidents(session: Session = Depends(get_session)) -> list[IncidentRead]:
    rows = session.query(Incident).order_by(Incident.last_seen.desc()).limit(100).all()
    return [_to_read(r) for r in rows]


@router.get("/{incident_id}", response_model=IncidentRead)
def get_incident(incident_id: uuid.UUID, session: Session = Depends(get_session)) -> IncidentRead:
    row = session.get(Incident, incident_id)
    if row is None:
        raise HTTPException(status_code=404, detail="incident not found")
    return _to_read(row)
