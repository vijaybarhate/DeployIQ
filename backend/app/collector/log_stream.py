"""Container log collection (stdout/stderr via the Docker SDK)."""

import re
from datetime import datetime

from app.core.logging import get_logger

log = get_logger(__name__)

# Docker `timestamps=True` prefixes every line: "2026-11-01T03:04:39.123456789Z ..."
_TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z\s?(.*)$", re.DOTALL)


def parse_log_timestamp_ns(line: str) -> tuple[int, str]:
    """Split a timestamped log line into (epoch_nanoseconds, message).

    The fractional part is parsed as integer nanoseconds directly — never
    through float timestamps — so digits 7-9 are preserved exactly.
    """
    m = _TS_RE.match(line)
    if not m:
        return 0, line
    try:
        dt = datetime.fromisoformat(f"{m.group(1)}+00:00")
        frac = (m.group(2) or "").ljust(9, "0")[:9]
        ns = int(dt.timestamp()) * 1_000_000_000 + int(frac or 0)
        return ns, m.group(3)
    except (ValueError, OverflowError):
        return 0, line


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


def collect_since(container, since_ts: int) -> list[tuple[int, str, str]]:
    """Fetch lines newer than `since_ts` (epoch seconds) as (ts_ns, stream, line).

    stdout and stderr are fetched separately so the stream is part of each
    line's identity. Never raises: failures return [].
    """
    out: list[tuple[int, str, str]] = []
    try:
        for stream in ("stdout", "stderr"):
            kwargs = {"since": since_ts, "timestamps": True, "tail": "all"}
            kwargs["stdout"] = stream == "stdout"
            kwargs["stderr"] = stream == "stderr"
            raw = container.logs(**kwargs)
            text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
            for line in text.splitlines():
                if not line.strip():
                    continue
                ts_ns, msg = parse_log_timestamp_ns(line)
                out.append((ts_ns, stream, msg))
    except Exception as exc:
        log.warning("tail failed for %s: %s", getattr(container, "name", "?"), exc)
        return []
    return out
