"""Investigation API: explicit trigger + history (no auto-LLM on ingestion)."""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.models.investigation import Investigation
from app.db.session import get_session
from app.llm.base import LLMError
from app.schemas.investigation_api import InvestigationRead
from app.services.investigation import DuplicateActiveInvestigation, run_investigation
from app.services.reports import build_report_docx

router = APIRouter(prefix="/incidents/{incident_id}/investigations", tags=["investigations"])


def _to_read(inv: Investigation) -> InvestigationRead:
    try:
        result = json.loads(inv.result_json or "{}") or None
    except ValueError:
        result = None
    try:
        evidence_snapshot = json.loads(inv.evidence_snapshot or "[]")
        if not isinstance(evidence_snapshot, list):
            evidence_snapshot = []
    except (ValueError, AttributeError):
        evidence_snapshot = []
    try:
        runbook_snapshot = json.loads(getattr(inv, "runbook_snapshot", None) or "[]")
        if not isinstance(runbook_snapshot, list):
            runbook_snapshot = []
    except (ValueError, AttributeError):
        runbook_snapshot = []
    return InvestigationRead(
        id=inv.id,
        incident_id=inv.incident_id,
        status=inv.status,
        requested_model=inv.requested_model,
        actual_model=inv.actual_model,
        prompt_version=inv.prompt_version,
        result=result,
        evidence_snapshot=evidence_snapshot,
        runbook_snapshot=runbook_snapshot,
        prompt_tokens=inv.prompt_tokens,
        completion_tokens=inv.completion_tokens,
        total_tokens=inv.total_tokens,
        duration_ms=inv.duration_ms,
        error_code=inv.error_code,
        error_message=inv.error_message,
        created_at=inv.created_at,
        started_at=inv.started_at,
        completed_at=inv.completed_at,
    )


class TriggerRequest(BaseModel):
    """Optional per-investigation model override (must be an explicit free model)."""

    model: str | None = Field(default=None, max_length=256)


@router.post("", response_model=InvestigationRead, status_code=201)
async def trigger_investigation(
    incident_id: uuid.UUID,
    session: Session = Depends(get_session),
    payload: TriggerRequest | None = None,
) -> InvestigationRead:
    try:
        record = await run_investigation(
            session, incident_id, model_override=payload.model if payload else None
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="incident not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except DuplicateActiveInvestigation as exc:
        raise HTTPException(
            status_code=409,
            detail=f"an investigation is already active: {exc.investigation_id}",
        ) from None
    except LLMError as exc:
        raise HTTPException(
            status_code=502, detail=f"investigation provider failed: {exc.code.value}"
        ) from None
    if record.status == "failed":
        raise HTTPException(status_code=502, detail=f"investigation failed: {record.error_code}")
    if record.status == "validation_failed":
        raise HTTPException(
            status_code=502, detail=f"investigation failed validation: {record.error_code}"
        )
    return _to_read(record)


@router.get("", response_model=list[InvestigationRead])
def investigation_history(
    incident_id: uuid.UUID, session: Session = Depends(get_session)
) -> list[InvestigationRead]:
    rows = (
        session.query(Investigation)
        .filter(Investigation.incident_id == incident_id)
        .order_by(Investigation.created_at.desc())
        .all()
    )
    return [_to_read(r) for r in rows]


@router.get("/{investigation_id}/report")
def investigation_report(
    incident_id: uuid.UUID,
    investigation_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> Response:
    record = session.get(Investigation, investigation_id)
    if record is None or record.incident_id != incident_id:
        raise HTTPException(status_code=404, detail="investigation not found")
    content, filename = build_report_docx(session, investigation_id)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
