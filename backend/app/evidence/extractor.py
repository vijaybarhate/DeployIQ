"""Deterministic evidence extraction from container logs (no LLM calls)."""

import re

OOM_RE = re.compile(r"(?i)(out of memory|oomkilled|killed process|memoryerror)")
EXIT_CODE_RE = re.compile(r"exit(?:ed)?(?: with)? code[:\s]+(\d+)", re.IGNORECASE)
HEALTH_RE = re.compile(r"(?i)health[_ -]?status[:\s]+(\S+)")
PY_TRACEBACK_START = re.compile(r"^Traceback \(most recent call last\):", re.MULTILINE)
EXC_LINE_RE = re.compile(r"^([A-Za-z_][\w.]*Error[\w.]*|Exception[\w.]*)\s*:\s*(.*)$", re.MULTILINE)
FRAME_RE = re.compile(r'^\s*File "([^"]+)", line (\d+), in (\S+)', re.MULTILINE)


def extract_evidence(log_text: str, max_log_chars: int = 20000) -> dict:
    """Return deterministic evidence dict: category, exception, frames, excerpt."""
    trimmed = (log_text or "")[-max_log_chars:]

    evidence: dict = {
        "category": "unknown",
        "exception_type": "",
        "exception_message": "",
        "last_frame": "",
        "exit_code": "",
        "health_status": "",
        "oom": False,
        "has_traceback": False,
        "log_excerpt": trimmed[-2000:],
    }

    if OOM_RE.search(trimmed):
        evidence["oom"] = True
        evidence["category"] = "oom"

    m = EXIT_CODE_RE.search(trimmed)
    if m:
        evidence["exit_code"] = m.group(1)
        if evidence["category"] == "unknown":
            evidence["category"] = "exit_code"

    m = HEALTH_RE.search(trimmed)
    if m:
        evidence["health_status"] = m.group(1)
        if "unhealth" in m.group(1).lower() and evidence["category"] == "unknown":
            evidence["category"] = "health"

    if PY_TRACEBACK_START.search(trimmed):
        evidence["has_traceback"] = True
        evidence["category"] = "exception"
        excs = list(EXC_LINE_RE.finditer(trimmed))
        if excs:
            evidence["exception_type"] = excs[-1].group(1).strip()
            evidence["exception_message"] = excs[-1].group(2).strip()[:500]
        frames = list(FRAME_RE.finditer(trimmed))
        if frames:
            f = frames[-1]
            evidence["last_frame"] = f"{f.group(1)}:{f.group(2)} in {f.group(3)}"

    return evidence
