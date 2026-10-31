"""Security helpers: secret redaction and Docker scope enforcement."""

import re

_SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?([^'\"\s]+)"),
    re.compile(r"(?i)bearer\s+([A-Za-z0-9\-._~+/=]+)"),
    re.compile(r"sk-(or-)?[A-Za-z0-9]{8,}"),
]

REDACTED = "[REDACTED]"


def redact_secrets(text: str) -> str:
    """Redact likely secrets before persisting evidence or sending text to an LLM."""
    if not text:
        return text
    redacted = text
    for pattern in _SECRET_PATTERNS:
        redacted = pattern.sub(REDACTED, redacted)
    return redacted


def is_project_monitored(project: str | None, allowlist: list[str]) -> bool:
    """Fail closed: unconfigured or unlisted projects are never monitored."""
    if not project:
        return False
    return project in allowlist
