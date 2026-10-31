"""Container log collection (stdout/stderr via the Docker SDK)."""

from app.core.logging import get_logger

log = get_logger(__name__)


def collect_recent(container, tail: int = 500) -> str:
    """Return the last `tail` lines of container logs as text (never raises)."""
    try:
        out = container.logs(tail=tail, stdout=True, stderr=True)
        if isinstance(out, bytes):
            return out.decode("utf-8", errors="replace")
        return str(out)
    except Exception as exc:
        log.warning("log collection failed: %s", exc)
        return ""


def stream_logs(container):  # type: ignore[no-untyped-def]
    """Yield log lines as they arrive (caller decides scope and stop conditions)."""
    try:
        for chunk in container.logs(stream=True, follow=True, stdout=True, stderr=True):
            if isinstance(chunk, bytes):
                yield chunk.decode("utf-8", errors="replace")
            else:
                yield str(chunk)
    except Exception as exc:
        log.warning("log stream ended: %s", exc)
