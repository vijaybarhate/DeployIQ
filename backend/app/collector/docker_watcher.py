"""Docker connection + event watcher (Docker SDK; no shell parsing)."""

from collections.abc import Iterator
from typing import Any

from app.core.logging import get_logger

log = get_logger(__name__)

WATCHED_ACTIONS = {"die", "oom", "restart", "health_status", "kill"}

# The daemon reports kill signals numerically ("15", "9"); normalize to names
# so rules and logs stay readable.
SIGNAL_NAMES = {"1": "SIGHUP", "2": "SIGINT", "9": "SIGKILL", "15": "SIGTERM"}


def normalize_signal(raw: str) -> str:
    raw = (raw or "").strip()
    if raw.isdigit():
        return SIGNAL_NAMES.get(raw, f"SIG{raw}")
    return raw.upper()


class DockerUnavailableError(RuntimeError):
    pass


def get_client():  # type: ignore[no-untyped-def]
    """Return a docker client, or raise DockerUnavailableError with a clear status."""
    try:
        import docker
    except ImportError as exc:
        raise DockerUnavailableError("docker SDK not installed") from exc
    try:
        client = docker.from_env()
        client.ping()
        return client
    except Exception as exc:
        raise DockerUnavailableError(f"docker engine unreachable: {exc}") from exc


def connection_status() -> dict:
    try:
        client = get_client()
        version = client.version().get("Version", "unknown")
        return {"connected": True, "version": version}
    except DockerUnavailableError as exc:
        return {"connected": False, "error": str(exc)}


def iter_events(client, filters: dict | None = None) -> Iterator[dict[str, Any]]:
    """Yield normalized event dicts for watched container actions only.

    Docker appends a status suffix to some actions (e.g. "health_status:
    unhealthy"); the base action and suffix are split so matching is exact
    on the base and the status is preserved for rules.
    """
    for raw in client.events(filters=filters or {"type": "container"}, decode=True):
        raw_action = str(raw.get("Action", ""))
        base, _, suffix = raw_action.partition(": ")
        if base not in WATCHED_ACTIONS:
            continue
        actor = raw.get("Actor", {}) or {}
        attrs = actor.get("Attributes", {}) or {}
        yield {
            "action": base,
            "status": suffix.strip(),
            "container_id": actor.get("ID", ""),
            "container_name": attrs.get("name", ""),
            "project": attrs.get("com.docker.compose.project", ""),
            "service": attrs.get("com.docker.compose.service", ""),
            "exit_code": attrs.get("exitCode", ""),
            "signal": normalize_signal(attrs.get("signal", "")),
            "health": suffix.strip()
            or attrs.get("healthStatus", "")
            or attrs.get("health_status", ""),
            "raw": raw,
        }
