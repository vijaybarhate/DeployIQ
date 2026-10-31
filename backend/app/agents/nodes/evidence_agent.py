"""Evidence Agent: deterministic structuring of stored incident evidence (no LLM)."""

from app.agents.state import EvidenceRef, InvestigationState
from app.core.security import redact_secrets
from app.evidence.extractor import extract_evidence

MIN_USABLE_SIGNALS = (
    "exception_type",
    "exit_code",
    "health_status",
    "last_frame",
)


def evidence_agent(state: InvestigationState) -> dict:
    """Build E-001.. IDs from stored evidence + fresh deterministic extraction."""
    raw_items = state.get("evidence", [])
    refs: list[EvidenceRef] = []
    for i, item in enumerate(raw_items, start=1):
        refs.append(
            {
                # Redact again at the LLM boundary: stored payloads may carry
                # user-controlled text that was never sanitized for model use.
                "id": f"E-{i:03d}",
                "kind": str(item.get("kind", "unknown")),
                "summary": redact_secrets(str(item.get("summary", ""))),
                "detail": redact_secrets(str(item.get("detail", ""))),
            }
        )
    title = redact_secrets(state.get("title", ""))
    signature = state.get("error_signature", "")
    fresh = extract_evidence(signature + "\n" + title)
    usable = fresh["category"] != "unknown" or any(
        str(item.get("summary", "")) or str(item.get("detail", "")) for item in raw_items
    )
    return {"evidence": refs, "usable_evidence": bool(usable)}
