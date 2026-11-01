"""Investigation orchestration: explicit trigger -> LangGraph -> persist result.

Exactly one logical LLM call per investigation (plus at most one
compatibility retry inside the provider). Duplicate simultaneous
investigations are rejected by the database-level unique partial index;
the pre-check below only produces a nicer 409.
"""

import hashlib
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
from app.core.security import redact_secrets
from app.db.models.incident import Incident
from app.db.models.investigation import ACTIVE_STATUSES, Investigation
from app.llm.base import LLMError
from app.llm.openrouter import OpenRouterProvider
from app.rag.retriever import BM25Retriever, load_runbooks
from app.schemas.investigation import RCAReport

log = get_logger(__name__)

RUNBOOK_DIR = "app/rag/runbooks"
MAX_ERROR_MESSAGE_CHARS = 500


class DuplicateActiveInvestigation(RuntimeError):
    def __init__(self, investigation_id: uuid.UUID) -> None:
        super().__init__(f"an investigation is already active: {investigation_id}")
        self.investigation_id = investigation_id


@lru_cache(maxsize=1)
def get_retriever() -> BM25Retriever:
    return BM25Retriever(load_runbooks(RUNBOOK_DIR))


def _pipeline_key() -> tuple:
    settings = get_settings()
    key_hash = hashlib.sha256(settings.openrouter_api_key.encode("utf-8")).hexdigest()[:16]
    return (
        settings.openrouter_model,
        tuple(settings.fallback_model_list),
        settings.openrouter_max_output_tokens,
        settings.openrouter_base_url,
        settings.openrouter_timeout_seconds,
        key_hash,
    )


@lru_cache(maxsize=4)
def _get_pipeline(key: tuple):
    """Compile once and reuse per settings fingerprint (graph reuse, isolated state)."""
    model, fallbacks, max_tokens, base_url, timeout_s, _ = key
    settings = get_settings()
    provider = OpenRouterProvider(
        api_key=settings.openrouter_api_key,
        model=model,
        fallback_models=list(fallbacks),
        base_url=base_url,
        timeout_seconds=timeout_s,
        max_output_tokens=max_tokens,
    )
    graph = build_graph(provider, get_retriever(), settings.openrouter_max_input_chars)
    return provider, graph


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
        "raw_logs": incident.raw_logs or "",
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
                Investigation.status.in_(ACTIVE_STATUSES),
            )
            .order_by(Investigation.created_at.desc())
            .first()
        )
        raise DuplicateActiveInvestigation(active.id if active else incident_id) from None
    session.refresh(record)

    record.status = "running"
    record.started_at = datetime.now(UTC)
    session.commit()
    started = time.perf_counter()
    try:
        _, graph = _get_pipeline(_pipeline_key())
        final_state = await graph.ainvoke(_initial_state(incident))
    except LLMError as exc:
        # Setup or provider failure (missing key, non-free model, timeout,
        # auth, rate limit, server error): terminal failed record, no retry.
        _fail(session, record, exc.code.value, str(exc), started, model=exc.model, usage=exc.usage)
        session.refresh(record)
        raise
    except Exception:
        log.exception("investigation graph failed for incident %s", incident_id)
        _fail(session, record, "graph_error", "investigation pipeline failed", started)
        session.refresh(record)
        raise
    _persist_result(session, record, final_state, started)
    return record


def _fail(
    session: Session,
    record: Investigation,
    code: str,
    message: str,
    started: float,
    model: str = "",
    usage=None,
) -> None:
    record.status = "failed"
    record.error_code = code[:32]
    record.error_message = redact_secrets(message)[:MAX_ERROR_MESSAGE_CHARS]
    record.actual_model = model[:256]
    if usage is not None:
        record.prompt_tokens = int(usage.prompt_tokens or 0)
        record.completion_tokens = int(usage.completion_tokens or 0)
        record.total_tokens = int(usage.total_tokens or 0)
    record.duration_ms = int((time.perf_counter() - started) * 1000)
    record.completed_at = datetime.now(UTC)
    session.commit()
    session.refresh(record)


def _persist_result(
    session: Session, record: Investigation, final_state: dict, started: float
) -> None:
    record.duration_ms = int((time.perf_counter() - started) * 1000)
    record.completed_at = datetime.now(UTC)
    record.actual_model = str(final_state.get("actual_model", "") or "")[:256]
    record.prompt_tokens = int(final_state.get("prompt_tokens", 0) or 0)
    record.completion_tokens = int(final_state.get("completion_tokens", 0) or 0)
    record.total_tokens = int(final_state.get("total_tokens", 0) or 0)
    record.evidence_snapshot = json.dumps(final_state.get("evidence", []) or [])
    record.runbook_snapshot = json.dumps(final_state.get("runbooks", []) or [])
    rca = final_state.get("rca")
    if isinstance(rca, RCAReport):
        from app.schemas.investigation import DiagnosisStatus

        if rca.diagnosis_status == DiagnosisStatus.INSUFFICIENT_EVIDENCE:
            record.status = "insufficient_evidence"
        else:
            record.status = "completed"
        record.result_json = rca.model_dump_json()
        session.commit()
        session.refresh(record)
        return
    report_error = str(final_state.get("report_error", "") or "")
    error_code = str(final_state.get("error_code", "") or "")
    if report_error.startswith("invalid_") or error_code.startswith("invalid_"):
        record.status = "validation_failed"
        record.error_code = (report_error or error_code)[:32]
        record.error_message = redact_secrets(
            final_state.get("error_message", "report validation failed")
        )[:MAX_ERROR_MESSAGE_CHARS]
    else:
        record.status = "failed"
        record.error_code = (error_code or "provider_error")[:32]
        record.error_message = redact_secrets(final_state.get("error_message", "provider error"))[
            :MAX_ERROR_MESSAGE_CHARS
        ]
    record.result_json = "{}"
    session.commit()
    session.refresh(record)


def request_investigation(incident_id: str) -> None:
    """Hook: queued investigation entry point (explicit API trigger in M3.2)."""
    log.info("investigation requested for incident %s (hook only)", incident_id)
