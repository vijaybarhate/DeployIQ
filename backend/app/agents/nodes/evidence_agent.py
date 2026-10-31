"""Evidence Agent: deterministic structuring of stored evidence + raw logs (no LLM)."""

from app.agents.state import EvidenceRef, InvestigationState
from app.core.security import redact_secrets
from app.evidence.extractor import extract_evidence

# Minimum usable-evidence categories. A structured reference counts as usable
# only when its kind is in this allowlist AND it carries non-empty content:
# arbitrary non-empty evidence must never trigger an LLM call.
MIN_USABLE_CATEGORIES = ("exception", "exit_code", "oom", "health")

MAX_LOG_CHARS = 8000


def _ref_is_usable(ref: dict) -> bool:
    return ref.get("kind") in MIN_USABLE_CATEGORIES and bool(
        str(ref.get("summary", "")) or str(ref.get("detail", ""))
    )


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
    if fresh["category"] in MIN_USABLE_CATEGORIES:
        detail_parts = [
            fresh["exception_type"],
            fresh["exception_message"],
            fresh["last_frame"],
            f"exit {fresh['exit_code']}" if fresh["exit_code"] else "",
        ]
        detail = " ".join(p for p in detail_parts if p)[:300]
        merged = False
        for ref in refs:
            if ref["kind"] == fresh["category"]:
                # Merge, don't discard: the stored ref may lack the message
                # or frame the fresh extraction just found.
                for key, value in (
                    ("summary", detail),
                    ("detail", f"health={fresh['health_status']} oom={fresh['oom']}"),
                ):
                    if value and value not in ref[key]:
                        ref[key] = f"{ref[key]} {value}".strip()[:500]
                merged = True
        if not merged:
            refs.append(
                {
                    "id": f"E-{len(refs) + 1:03d}",
                    "kind": fresh["category"],
                    "summary": detail,
                    "detail": f"health={fresh['health_status']} oom={fresh['oom']}",
                }
            )
    usable = fresh["category"] in MIN_USABLE_CATEGORIES or any(map(_ref_is_usable, refs))
    return {"evidence": refs, "usable_evidence": bool(usable)}
