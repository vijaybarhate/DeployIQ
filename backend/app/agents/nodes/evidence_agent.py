"""Evidence Agent: deterministic structuring of stored evidence + raw logs (no LLM)."""

from app.agents.state import EvidenceRef, InvestigationState
from app.core.security import redact_secrets
from app.evidence.extractor import extract_evidence

# Minimum usable-evidence criteria: at least one of these must hold,
# otherwise the Root Cause Agent is skipped to protect API credits.
MIN_USABLE_CATEGORIES = ("exception", "exit_code", "oom", "health")

MAX_LOG_CHARS = 8000


def evidence_agent(state: InvestigationState) -> dict:
    """Build E-001.. refs from stored evidence plus fresh extraction of raw logs."""
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
    logs = redact_secrets((state.get("raw_logs", "") or "")[-MAX_LOG_CHARS:])
    fresh = extract_evidence(logs)
    if fresh["category"] in MIN_USABLE_CATEGORIES and fresh["category"] not in {
        r["kind"] for r in refs
    }:
        refs.append(
            {
                "id": f"E-{len(refs) + 1:03d}",
                "kind": fresh["category"],
                "summary": " ".join(
                    x
                    for x in [
                        fresh["exception_type"],
                        fresh["exception_message"],
                        fresh["last_frame"],
                        f"exit {fresh['exit_code']}" if fresh["exit_code"] else "",
                    ]
                    if x
                )[:300],
                "detail": f"health={fresh['health_status']} oom={fresh['oom']}",
            }
        )
    usable = fresh["category"] in MIN_USABLE_CATEGORIES or any(
        str(item.get("summary", "")) or str(item.get("detail", "")) for item in raw_items
    )
    return {"evidence": refs, "usable_evidence": bool(usable)}
