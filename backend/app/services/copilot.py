"""Stateless SRE Q&A: one grounded answer, no persistence, no auto-actions."""

import uuid

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.logging import get_logger
from app.db.models.incident import Incident
from app.llm.base import LLMError, LLMErrorCode
from app.llm.openrouter import OpenRouterProvider
from app.services.investigation import get_retriever

log = get_logger(__name__)

MAX_QUESTION_CHARS = 2000
MAX_CONTEXT_CHARS = 6000

COPILOT_SYSTEM = """You are DeployIQ SRE Copilot, a careful DevOps assistant.
Answer ONLY from the provided incident evidence and runbooks.
Respond with a JSON object with exactly these keys: answer, evidence_ids,
runbook_ids, and confidence (a number between 0 and 1).
Evidence IDs look like E-001 and runbook IDs look like RB-007: use ONLY ids
that appear in the context below, never invent any.
Keep the answer under 150 words. Never invent commands, IDs, or runbooks.
If the context is insufficient, say so in the answer and set confidence below 0.4."""


INSUFFICIENT_ANSWER = (
    "Not enough context to answer. Provide an incident ID or ask about "
    "something covered by the runbooks — I only answer from incident "
    "evidence and runbooks, never from general knowledge."
)


def _clamp_confidence(value) -> float | None:  # type: ignore[no-untyped-def]
    """Force model confidence into the promised 0–1 range."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return max(0.0, min(1.0, number))


async def _provider(model_override: str | None) -> OpenRouterProvider:
    from app.services.models import ensure_verified_free_model

    settings = get_settings()
    # Single shared catalogue gate (same as investigations + /models/check).
    model = (
        await ensure_verified_free_model(model_override)
        if model_override
        else settings.openrouter_model
    )
    return OpenRouterProvider(
        api_key=settings.openrouter_api_key,
        model=model,
        fallback_models=settings.fallback_model_list,
        base_url=settings.openrouter_base_url,
        timeout_seconds=settings.openrouter_timeout_seconds,
        max_output_tokens=800,
    )


async def ask(
    session: Session,
    question: str,
    incident_id: uuid.UUID | None = None,
    model_override: str | None = None,
) -> dict:
    """Answer one question grounded in incident + runbook context."""
    cleaned = (question or "").strip()
    if not cleaned:
        raise ValueError("question must not be empty")
    if len(cleaned) > MAX_QUESTION_CHARS:
        raise ValueError("question too long")
    context_parts: list[str] = []
    valid_evidence_ids: set[str] = set()
    if incident_id is not None:
        incident = session.get(Incident, incident_id)
        if incident is None:
            raise KeyError(f"incident not found: {incident_id}")
        import json as _json

        try:
            evidence = _json.loads(incident.evidence_json or "[]")
        except ValueError:
            evidence = []
        context_parts.append(f"INCIDENT {incident.title} [{incident.error_signature}]")
        labeled = []
        for i, entry in enumerate(evidence if isinstance(evidence, list) else []):
            label = f"E-{i + 1:03d}"
            valid_evidence_ids.add(label)
            if isinstance(entry, dict):
                labeled.append(
                    f"[{label}] {entry.get('kind', '')}: {entry.get('summary', '')}"
                )
            else:
                labeled.append(f"[{label}] {entry}")
        context_parts.append("EVIDENCE " + " | ".join(labeled)[:3000])
        context_parts.append(f"LOGS {(incident.raw_logs or '')[-3000:]}")
    retriever = get_retriever()
    runbooks = retriever.retrieve(cleaned, top_k=3)
    valid_runbook_ids = {r.runbook_id for r in runbooks}
    for r in runbooks:
        context_parts.append(f"RUNBOOK {r.runbook_id}: {r.title} :: {str(r.matched_sections)}")
    if not valid_evidence_ids and not valid_runbook_ids:
        # No verifiable grounding exists: answer explicitly without an LLM call.
        return {
            "answer": INSUFFICIENT_ANSWER,
            "evidence_ids": [],
            "runbook_ids": [],
            "confidence": 0.0,
            "actual_model": "",
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        }
    context = "\n".join(context_parts)[:MAX_CONTEXT_CHARS]
    provider = await _provider(model_override)
    try:
        completion = await provider.complete_json(
            COPILOT_SYSTEM, f"QUESTION: {cleaned}\n\nCONTEXT:\n{context}"
        )
    except LLMError:
        raise
    parsed = completion.parsed if isinstance(completion.parsed, dict) else {}
    answer = str(parsed.get("answer", "")).strip()
    if not answer:
        raise LLMError(LLMErrorCode.INVALID_RESPONSE, "empty copilot answer")
    return {
        "answer": answer,
        # Server-side grounding: only IDs that appeared in the context survive.
        "evidence_ids": [
            str(e) for e in parsed.get("evidence_ids", []) or [] if str(e) in valid_evidence_ids
        ],
        "runbook_ids": [
            str(e) for e in parsed.get("runbook_ids", []) or [] if str(e) in valid_runbook_ids
        ],
        "confidence": _clamp_confidence(parsed.get("confidence")),
        "actual_model": completion.actual_model,
        "prompt_tokens": completion.usage.prompt_tokens,
        "completion_tokens": completion.usage.completion_tokens,
        "total_tokens": completion.usage.total_tokens,
    }
