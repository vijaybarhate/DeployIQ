"""Watcher CLI (Milestone 2): Docker events + log tailing -> ingestion -> SQLite.

Run from backend/ with the venv:  python -m app.collector.watch

Scope is fail-closed: only containers whose Compose project is in
MONITORED_PROJECTS are processed. Planned shutdowns (exit 0, no error
evidence) never create incidents. This process performs no LLM calls.
"""

import argparse
import hashlib
import queue
import re
import signal
import threading
import time as _time

from app.collector.docker_watcher import (
    DockerUnavailableError,
    connection_status,
    get_client,
    iter_events,
    normalize_signal,
)
from app.collector.log_stream import collect_recent, collect_since
from app.config import get_settings
from app.core.logging import get_logger, setup_logging
from app.db.session import SessionLocal, engine
from app.evidence.extractor import count_matching_lines, extract_evidence
from app.schemas.incident import EvidenceItem, IncidentSource
from app.services.ingestion import OutOfScopeError, ingest_event

log = get_logger(__name__)
_stop = False

# Recent per-container signals (kill SIGTERM, oom) used to classify a later
# die event: planned stop vs genuine abrupt kill. TTL covers the daemon's
# stop grace period plus event delivery lag.
SIGNAL_TTL_SECONDS = 180.0
_recent_signals: dict[str, list[tuple[str, float]]] = {}


def _record_signal(container_id: str, signal: str) -> None:
    if not container_id or not signal:
        return
    bucket = _recent_signals.setdefault(container_id, [])
    bucket.append((normalize_signal(signal), _time.time()))
    if len(bucket) > 10:
        del bucket[:-10]


def _recent_signal(container_id: str, signal: str) -> bool:
    now = _time.time()
    bucket = _recent_signals.get(container_id, [])
    fresh = [(s, ts) for s, ts in bucket if now - ts < SIGNAL_TTL_SECONDS]
    if fresh:
        _recent_signals[container_id] = fresh
    return any(s == signal.upper() for s, _ in fresh)


def _recent_stop_or_kill(container_id: str) -> bool:
    """True when an explicit stop/kill was requested for this container recently."""
    return (
        _recent_signal(container_id, "SIGTERM")
        or _recent_signal(container_id, "SIGINT")
        or _recent_signal(container_id, "SIGHUP")
        or _recent_signal(container_id, "STOP")
    )


def _handle_sig(*_args):  # type: ignore[no-untyped-def]
    global _stop
    _stop = True


def _ingest(session, project, category, detail, logs, action, matched_lines=0):  # type: ignore[no-untyped-def]
    ev = extract_evidence(logs)
    evidence = [
        EvidenceItem(
            kind=category,
            summary=detail,
            detail=f"action={action} exc={ev['exception_type']} frame={ev['last_frame']}",
        )
    ]
    try:
        incident, created = ingest_event(
            session,
            source=IncidentSource.DOCKER,
            project_id=project,
            category=category,
            detail=detail,
            raw_logs=logs,
            evidence=evidence,
            allowlist=get_settings().monitored_project_list,
            matched_lines=matched_lines,
        )
        log.info(
            "%s incident %s (observations=%d, matched_lines=%d): %s",
            "created" if created else "updated",
            incident.id,
            incident.observation_count,
            incident.matched_line_count,
            incident.title,
        )
    except OutOfScopeError:
        pass  # out-of-scope projects are silently ignored by design


def _process_event(session, client, event):  # type: ignore[no-untyped-def]
    project = event["project"]
    action = event["action"]
    exit_code = event["exit_code"]
    try:
        container = client.containers.get(event["container_id"])
        logs = collect_recent(container, tail=300)
    except Exception as exc:
        log.warning("could not read logs: %s", exc)
        logs = ""
    ev = extract_evidence(logs)

    if action == "restart":
        log.info("ignoring restart of %s (no failure evidence on its own)", event["container_name"])
        return
    if action in ("kill", "stop"):
        # Record-only: establishes that a planned shutdown was requested.
        # `stop` carries no signal attribute; treat it as an operator stop.
        _record_signal(event["container_id"], event.get("signal", "") or "STOP")
        return
    if action == "oom":
        _record_signal(event["container_id"], "OOM")
        _ingest(session, project, "oom", "OOMKilled", logs, action)
        return
    if ev["oom"] or _recent_signal(event["container_id"], "OOM"):
        # OOM evidence in logs, or a recent oom event whose die arrives
        # after the container is already gone (logs unreadable).
        _ingest(session, project, "oom", "OOMKilled", logs, action)
        return
    if action == "health_status" and "unhealth" in (event["health"] or "").lower():
        _ingest(session, project, "health", f"{event['service']} unhealthy", logs, action)
        return
    if action == "die":
        if exit_code == "0":
            # Exit status 0 is success by definition: never an incident,
            # even if old log history contains past errors.
            log.info("ignoring clean exit of %s", event["container_name"])
            return
        if exit_code in ("143", "130") and _recent_stop_or_kill(event["container_id"]):
            # SIGTERM/SIGINT after an explicit stop/kill request: planned.
            log.info(
                "ignoring planned shutdown of %s (exit %s)", event["container_name"], exit_code
            )
            return
        if exit_code in ("143", "130"):
            # Signal exit with NO preceding stop/kill request: suspicious
            # (stray signal, OOM-adjacent kill). Keep as an incident.
            _ingest(
                session,
                project,
                ev["category"] if ev["category"] != "unknown" else "exit_code",
                ev["exception_type"] or f"exit code {exit_code}",
                logs,
                action,
                matched_lines=count_matching_lines(logs),
            )
            return
        if exit_code == "137" and _recent_signal(event["container_id"], "SIGTERM"):
            # Planned stop where SIGTERM was not honored in time and the
            # daemon SIGKILLed after the grace period (compose stop/down).
            log.info(
                "ignoring planned shutdown of %s (SIGKILL after SIGTERM)",
                event["container_name"],
            )
            return
        if ev["category"] == "unknown":
            # Abrupt end (kill -9, kernel kill) with no log evidence.
            _ingest(session, project, "exit_code", f"exit code {exit_code}", logs, action)
            return
    if ev["category"] == "unknown":
        log.info("ignoring event %s for %s (no error evidence)", action, event["container_name"])
        return

    category = ev["category"]
    detail = ev["exception_type"] or f"exit code {exit_code}" or action
    _ingest(session, project, category, detail, logs, action)


def _event_pump(client, project: str, outbox: queue.Queue) -> None:
    """Blocking event stream runs here so log tailing never stalls."""
    try:
        for event in iter_events(client):
            if _stop:
                break
            if not project or event["project"] == project:
                outbox.put(event)
    except Exception as exc:
        log.error("event stream ended: %s", exc)


_LINE_WS_RE = re.compile(r"\s+")


def _normalize_line(msg: str) -> str:
    """Line-identity normalizer: fold case/whitespace only, keep ALL numbers.

    Distinct from the incident-signature normalizer (which collapses ports
    and long numbers for dedup): two different log lines must never share
    a tail identity, or one of them would be silently dropped.
    """
    return _LINE_WS_RE.sub(" ", msg.strip().lower())


def _line_identity(container_id: str, line: tuple[int, str, str]) -> str:
    """Stable per-line identity: container + nanosecond timestamp + stream + content hash."""
    ts_ns, stream, msg = line
    fingerprint = hashlib.sha256(_normalize_line(msg).encode("utf-8")).hexdigest()[:16]
    return f"{container_id}|{ts_ns}|{stream}|{fingerprint}"


# Bounded identity cache: TTL eviction first, oldest-first trim as a backstop.
# Clearing the whole cache at once would re-ingest recently seen lines.
SEEN_ID_TTL_SECONDS = 3600.0
SEEN_ID_MAX = 30000


def _remember_seen(seen: dict[str, float], identity: str, now: float) -> None:
    seen[identity] = now
    if len(seen) <= SEEN_ID_MAX:
        return
    cutoff = now - SEEN_ID_TTL_SECONDS
    for key in [k for k, ts in seen.items() if ts < cutoff]:
        del seen[key]
    if len(seen) > SEEN_ID_MAX:
        drop = len(seen) - SEEN_ID_MAX + len(seen) // 4
        for key in list(seen.keys())[:drop]:
            del seen[key]


def _tail_containers(  # type: ignore[no-untyped-def]
    client, session, project: str, seen_ts: dict, seen_ids: dict[str, float]
):
    """Detect in-app errors (e.g. HTTP 500) that produce no Docker event.

    Uses Docker's `since` filter so each poll sees only genuinely new lines.
    The tail-window comparison approach re-ingested old tracebacks whenever
    the window slid, inflating occurrence counts — do not revert to it.
    """
    settings = get_settings()
    try:
        containers = client.containers.list()
    except Exception as exc:
        log.warning("tail pass failed: %s", exc)
        return
    now = int(_time.time())
    for container in containers:
        labels = container.labels or {}
        proj = labels.get("com.docker.compose.project", "")
        if project and proj != project:
            continue
        if proj not in settings.monitored_project_list:
            continue
        if container.id not in seen_ts:
            seen_ts[container.id] = now  # skip pre-existing history on first sight
            continue
        lines = collect_since(container, seen_ts[container.id])
        seen_ts[container.id] = now
        fresh = [ln for ln in lines if _line_identity(container.id, ln) not in seen_ids]
        for ln in lines:
            _remember_seen(seen_ids, _line_identity(container.id, ln), _time.time())
        if not fresh:
            continue
        new_text = "\n".join(msg for _, _, msg in fresh)
        ev = extract_evidence(new_text)
        if ev["category"] != "unknown":
            detail = ev["exception_type"] or ev["category"]
            _ingest(
                session,
                proj,
                ev["category"],
                detail,
                new_text,
                "log-tail",
                matched_lines=count_matching_lines(new_text),
            )


def _require_migrated_db() -> None:
    """Fail fast unless Alembic migrations have created the incident tables.

    The watcher must never create schema itself: an unmigrated database would
    diverge from Alembic history (e.g. missing investigations table).
    """
    from sqlalchemy import inspect

    if "incidents" not in inspect(engine).get_table_names():
        log.error("database schema not initialized: run 'alembic upgrade head' from backend/ first")
        raise SystemExit(2)


def run(project: str, poll_seconds: float = 2.0) -> None:
    settings = get_settings()
    log.info("monitored projects: %s", settings.monitored_project_list)
    try:
        client = get_client()
    except DockerUnavailableError as exc:
        log.error("collector disconnected: %s", exc)
        raise SystemExit(2) from exc
    _require_migrated_db()
    session = SessionLocal()
    seen_ts: dict[str, int] = {}
    seen_ids: dict[str, float] = {}
    outbox: queue.Queue = queue.Queue()
    pump = threading.Thread(target=_event_pump, args=(client, project, outbox), daemon=True)
    pump.start()
    try:
        while not _stop:
            while True:
                try:
                    event = outbox.get_nowait()
                except queue.Empty:
                    break
                _process_event(session, client, event)
            _tail_containers(client, session, project, seen_ts, seen_ids)
            _time.sleep(poll_seconds)
    finally:
        session.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="DeployIQ Docker watcher (Milestone 2)")
    parser.add_argument(
        "--project", default="", help="Compose project to watch (default: all allowlisted)"
    )
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    args = parser.parse_args()
    setup_logging(get_settings().log_level)
    signal.signal(signal.SIGINT, _handle_sig)
    signal.signal(signal.SIGTERM, _handle_sig)
    status = connection_status()
    if not status.get("connected"):
        log.error("collector disconnected: %s", status.get("error"))
        raise SystemExit(2)
    run(args.project, args.poll_seconds)


if __name__ == "__main__":
    main()
