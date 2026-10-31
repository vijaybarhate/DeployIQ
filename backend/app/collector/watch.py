"""Watcher CLI (Milestone 2): Docker events + log tailing -> ingestion -> SQLite.

Run from backend/ with the venv:  python -m app.collector.watch

Scope is fail-closed: only containers whose Compose project is in
MONITORED_PROJECTS are processed. Planned shutdowns (exit 0, no error
evidence) never create incidents. This process performs no LLM calls.
"""

import argparse
import queue
import signal
import threading
import time as _time

from app.collector.docker_watcher import (
    DockerUnavailableError,
    connection_status,
    get_client,
    iter_events,
)
from app.collector.log_stream import collect_recent
from app.config import get_settings
from app.core.logging import get_logger, setup_logging
from app.db.session import SessionLocal, init_db
from app.evidence.extractor import extract_evidence
from app.evidence.normalizer import build_signature
from app.schemas.incident import EvidenceItem, IncidentSource
from app.services.ingestion import OutOfScopeError, ingest_event

log = get_logger(__name__)
_stop = False

# Suppress tail re-sightings of the same error: Docker `since` has
# second granularity, so lines from second N can reappear in the poll for
# second N+1. Window = 2x the default poll interval.
RESIGHT_WINDOW_SECONDS = 4.0
_recent_sightings: dict[str, float] = {}

# Recent per-container signals (kill SIGTERM, oom) used to classify a later
# die event: planned stop vs genuine abrupt kill. TTL covers the daemon's
# stop grace period plus event delivery lag.
SIGNAL_TTL_SECONDS = 180.0
_recent_signals: dict[str, list[tuple[str, float]]] = {}


def _record_signal(container_id: str, signal: str) -> None:
    if not container_id or not signal:
        return
    bucket = _recent_signals.setdefault(container_id, [])
    bucket.append((signal.upper(), _time.time()))
    if len(bucket) > 10:
        del bucket[:-10]


def _recent_signal(container_id: str, signal: str) -> bool:
    now = _time.time()
    bucket = _recent_signals.get(container_id, [])
    fresh = [(s, ts) for s, ts in bucket if now - ts < SIGNAL_TTL_SECONDS]
    if fresh:
        _recent_signals[container_id] = fresh
    return any(s == signal.upper() for s, _ in fresh)


def _handle_sig(*_args):  # type: ignore[no-untyped-def]
    global _stop
    _stop = True


def _ingest(session, project, category, detail, logs, action):  # type: ignore[no-untyped-def]
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
        )
        log.info(
            "%s incident %s (count=%d): %s",
            "created" if created else "updated",
            incident.id,
            incident.occurrence_count,
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
    if action == "kill":
        _record_signal(event["container_id"], event.get("signal", ""))
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
        if exit_code in ("0", "143", "130"):
            # 0 = clean exit, 143 = SIGTERM, 130 = SIGINT: orchestrator or
            # operator stop. Never an incident, even if old log history
            # contains past errors.
            log.info(
                "ignoring planned shutdown of %s (exit %s)", event["container_name"], exit_code
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


def _tail_containers(client, session, project: str, seen_ts: dict) -> None:  # type: ignore[no-untyped-def]
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
        try:
            out = container.logs(since=seen_ts[container.id], stdout=True, stderr=True)
        except Exception as exc:
            log.warning("tail failed for %s: %s", container.name, exc)
            continue
        seen_ts[container.id] = now
        new_text = out.decode("utf-8", errors="replace") if isinstance(out, bytes) else str(out)
        if not new_text.strip():
            continue
        ev = extract_evidence(new_text)
        if ev["category"] != "unknown":
            detail = ev["exception_type"] or ev["category"]
            sig = build_signature("docker", proj, ev["category"], detail)
            now_t = _time.time()
            last = _recent_sightings.get(sig, 0.0)
            if now_t - last < RESIGHT_WINDOW_SECONDS:
                continue  # same-second re-sighting of an just-ingested error
            _recent_sightings[sig] = now_t
            if len(_recent_sightings) > 1000:
                _recent_sightings.clear()
            _ingest(session, proj, ev["category"], detail, new_text, "log-tail")


def run(project: str, poll_seconds: float = 2.0) -> None:
    settings = get_settings()
    log.info("monitored projects: %s", settings.monitored_project_list)
    try:
        client = get_client()
    except DockerUnavailableError as exc:
        log.error("collector disconnected: %s", exc)
        raise SystemExit(2) from exc
    init_db()
    session = SessionLocal()
    seen_ts: dict[str, int] = {}
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
            _tail_containers(client, session, project, seen_ts)
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
