"""Investigation orchestration: explicit trigger -> LangGraph -> persist result.

Exactly one LLM call per investigation (inside the Root Cause node).
Duplicate simultaneous investigations are rejected by the database-level
partial unique index; the pre-check below only produces a nicer 409.
"""

import json
import time
import uuid
from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.agents.graph import build_graph
from app.config import get_settings
from app.core.logging import get_logger
from app.db.models.incident import Incident
from app.db.models.investigation import Investigation
from app.llm.openrouter import OpenRouterProvider
from app.rag.retriever import BM25Retriever, load_runbooks
from app.schemas.investigation import RCAReport

log = get_logger(__name__)

RUNBOOK_DIR = "app/rag/runbooks"


class DuplicateActiveInvestigation(RuntimeError):
    def __init__(self, investigation_id: uuid.UUID) -> None:
        super().__init__(f"an investigation is already active: {investigation_id}")
        self.investigation_id = investigation_id


@lru_cache(maxsize=1)
def get_retriever() -> BM25Retriever:
    return BM25Retriever(load_runbooks(RUNBOOK_DIR))


def _initial_state(incident: Incident) -> dict:
    try:
        evidence = json.loads(incident.evidence_json or "[]")
    except ValueError:
        evidence = []
    return {
        "incident_id": str(incident.id),
        "project_id": incident.project_id,
        "source": incident.source,
        "title": incident.title,
        "error_signature": incident.error_signature,
        "evidence": evidence if isinstance(evidence, list) else [],
    }


async def run_investigation(session: Session, incident_id: uuid.UUID) -> Investigation:
    settings = get_settings()
    incident = session.get(Incident, incident_id)
    if incident is None:
        raise KeyError(f"incident not found: {incident_id}")

    record = Investigation(
        incident_id=incident.id,
        status="pending",
        requested_model=settings.openrouter_model,
        prompt_version=settings.prompt_version,
    )
    session.add(record)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        active = (
            session.query(Investigation)
            .filter(
                Investigation.incident_id == incident.id,
                Investigation.status.in_(["pending", "running"]),
            )
            .order_by(Investigation.created_at.desc())
            .first()
        )
        raise DuplicateActiveInvestigation(active.id if active else incident_id) from None
    session.refresh(record)

    record.status = "running"
    session.commit()
    started = time.perf_counter()

    provider = OpenRouterProvider(
        api_key=settings.openrouter_api_key,
        model=settings.openrouter_model,
        fallback_models=settings.fallback_model_list,
        base_url=settings.openrouter_base_url,
        timeout_seconds=settings.openrouter_timeout_seconds,
        max_output_tokens=settings.openrouter_max_output_tokens,
    )
    graph = build_graph(
        provider, get_retriever(), max_input_chars=settings.openrouter_max_input_chars
    )
    try:
        final_state = await graph.ainvoke(_initial_state(incident))
    except Exception:  # defensive: graph bugs must fail the record, not hang
        log.exception("investigation graph failed for incident %s", incident_id)
        record.status = "failed"
        record.error_code = "graph_error"
        record.duration_ms = int((time.perf_counter() - started) * 1000)
        record.completed_at = datetime.now(UTC)
        session.commit()
        session.refresh(record)
        raise
    _persist_result(session, record, final_state, started)
    return record


def _persist_result(
    session: Session, record: Investigation, final_state: dict, started: float
) -> None:
    record.duration_ms = int((time.perf_counter() - started) * 1000)
    record.completed_at = datetime.now(UTC)
    rca = final_state.get("rca")
    if isinstance(rca, RCAReport):
        record.status = "completed"
        record.result_json = rca.model_dump_json()
    else:
        record.status = "failed"
        record.error_code = str(
            final_state.get("error_code", "invalid_report") or "invalid_report"
        )[:32]
        record.result_json = "{}"
    record.actual_model = str(final_state.get("actual_model", "") or "")[:256]
    record.prompt_tokens = int(final_state.get("prompt_tokens", 0) or 0)
    record.completion_tokens = int(final_state.get("completion_tokens", 0) or 0)
    record.total_tokens = int(final_state.get("total_tokens", 0) or 0)
    session.commit()
    session.refresh(record)


def request_investigation(incident_id: str) -> None:
    """Hook: queued investigation entry point (explicit API trigger in M3.2)."""
    log.info("investigation requested for incident %s (hook only)", incident_id)
