"""Normalization: signatures, severities, titles — deterministic, no LLM."""

import re

_WS_RE = re.compile(r"\s+")
_HEX_RE = re.compile(r"\b0x[0-9a-fA-F]+\b")
_IP_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b")
# Collapse 4+ digit numbers (ports, PIDs, timestamps). Short numbers are kept:
# "error 404" vs "error 500" must NOT dedup together.
NUM_RE = re.compile(r"\b\d{4,}\b")


def normalize_signature(raw: str) -> str:
    """Collapse volatile tokens (addresses, IPs, ports, PIDs) so repeats dedup."""
    sig = (raw or "").strip().lower()
    sig = _HEX_RE.sub("0xN", sig)
    sig = _IP_RE.sub("IP", sig)
    sig = NUM_RE.sub("N", sig)
    sig = _WS_RE.sub(" ", sig)
    return sig[:300] or "unknown"


def build_signature(source: str, project_id: str, category: str, detail: str) -> str:
    return normalize_signature(f"{source}|{project_id}|{category}|{detail}")


def classify_severity(category: str, occurrence_count: int = 1) -> str:
    if category in ("oom", "health"):
        return "high"
    if category in ("exception", "exit_code"):
        return "medium" if occurrence_count < 5 else "high"
    return "low"


def build_title(source: str, project_id: str, category: str, detail: str) -> str:
    short = (detail or category)[:120]
    return f"[{source}] {project_id}: {category} - {short}"
