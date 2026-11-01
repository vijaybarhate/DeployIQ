"""Read-only Docker operations for the ops console (list + log tails)."""

import re

from app.collector.docker_watcher import DockerUnavailableError, get_client
from app.core.logging import get_logger

log = get_logger(__name__)

# Container names/IDs as accepted by the Docker SDK (no shell involved).
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,127}$")

MAX_TAIL_LINES = 2000
MAX_LOG_CHARS = 100000


def _check_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not NAME_RE.match(cleaned):
        raise ValueError(f"invalid container name or ID: {name!r}")
    return cleaned


def list_containers() -> list[dict]:
    """List all containers with status/health/project (read-only)."""
    try:
        client = get_client()
    except DockerUnavailableError:
        raise
    try:
        rows = []
        for c in client.containers.list(all=True):
            name = (c.name or "").lstrip("/") if hasattr(c, "name") else ""
            attrs = c.attrs or {}
            state = (attrs.get("State") or {}) if isinstance(attrs, dict) else {}
            health = ""
            if isinstance(state.get("Health"), dict):
                health = str(state["Health"].get("Status", ""))
            labels = attrs.get("Config", {}).get("Labels", {}) if isinstance(attrs, dict) else {}
            rows.append(
                {
                    "name": name,
                    "short_id": (c.short_id or "") if hasattr(c, "short_id") else "",
                    "status": str(c.status or "") if hasattr(c, "status") else "",
                    "health": health,
                    "project": str((labels or {}).get("com.docker.compose.project", "")),
                }
            )
    except DockerUnavailableError:
        raise
    except Exception as exc:
        raise DockerUnavailableError(f"docker list failed: {exc}") from exc
    rows.sort(key=lambda r: (r["name"] or "").lower())
    return rows


def container_logs(name: str, tail: int = 200) -> dict:
    """Fetch the last `tail` log lines for one container (read-only)."""
    cleaned = _check_name(name)
    tail = max(1, min(int(tail), MAX_TAIL_LINES))
    try:
        client = get_client()
    except DockerUnavailableError:
        raise
    try:
        container = client.containers.get(cleaned)
    except Exception as exc:
        raise KeyError(f"container not found: {cleaned}") from exc
    try:
        raw = container.logs(tail=tail, timestamps=False)
    except Exception as exc:
        raise DockerUnavailableError(f"docker logs failed: {exc}") from exc
    if isinstance(raw, bytes):
        text = raw.decode("utf-8", errors="replace")
    else:
        text = str(raw or "")
    truncated = len(text) > MAX_LOG_CHARS
    if truncated:
        text = text[-MAX_LOG_CHARS:]
    lines = text.splitlines()
    return {"name": cleaned, "lines": lines, "truncated": truncated or len(lines) >= tail}
