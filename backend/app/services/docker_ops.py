"""Read-only Docker operations for the ops console (list + log tails).

Fail-closed scope: both listing and log tails only ever touch containers
whose Compose project is in MONITORED_PROJECTS. Anything else — including
containers with no project label at all — is hidden or rejected, never
defaulted into scope.
"""

import re

from app.collector.docker_watcher import DockerUnavailableError, get_client
from app.config import get_settings
from app.core.logging import get_logger
from app.core.security import is_project_monitored, redact_secrets
from app.services.ingestion import OutOfScopeError

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


def _allowlist() -> list[str]:
    return get_settings().monitored_project_list


def _project_of(container) -> str:  # type: ignore[no-untyped-def]
    """Compose project label; empty when the container has none."""
    try:
        attrs = container.attrs or {}
    except Exception:
        return ""
    if not isinstance(attrs, dict):
        return ""
    config = attrs.get("Config") or {}
    labels = config.get("Labels") or {} if isinstance(config, dict) else {}
    if not isinstance(labels, dict):
        return ""
    return str(labels.get("com.docker.compose.project", ""))


def list_containers() -> list[dict]:
    """List monitored containers with status/health/project (read-only).

    Only containers whose Compose project is allowlisted are returned —
    anything else is hidden, never defaulted into scope.
    """
    allowlist = _allowlist()
    try:
        client = get_client()
    except DockerUnavailableError:
        raise
    try:
        rows = []
        for c in client.containers.list(all=True):
            name = (c.name or "").lstrip("/") if hasattr(c, "name") else ""
            project = _project_of(c)
            if not is_project_monitored(project, allowlist):
                continue
            attrs = c.attrs or {}
            state = (attrs.get("State") or {}) if isinstance(attrs, dict) else {}
            health = ""
            if isinstance(state.get("Health"), dict):
                health = str(state["Health"].get("Status", ""))
            rows.append(
                {
                    "name": name,
                    "short_id": (c.short_id or "") if hasattr(c, "short_id") else "",
                    "status": str(c.status or "") if hasattr(c, "status") else "",
                    "health": health,
                    "project": project,
                }
            )
    except DockerUnavailableError:
        raise
    except Exception as exc:
        raise DockerUnavailableError(f"docker list failed: {exc}") from exc
    rows.sort(key=lambda r: (r["name"] or "").lower())
    return rows


def container_logs(name: str, tail: int = 200) -> dict:
    """Fetch the last `tail` log lines for one monitored container (read-only).

    The container's Compose project is re-validated here — filtering the
    listing alone is not sufficient. Secrets are redacted before returning.
    """
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
    if not is_project_monitored(_project_of(container), _allowlist()):
        raise OutOfScopeError(
            f"container '{cleaned}' is outside the monitored scope"
        )
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
    lines = redact_secrets(text).splitlines()
    return {"name": cleaned, "lines": lines, "truncated": truncated or len(lines) >= tail}
