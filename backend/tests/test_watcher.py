"""Tests: watcher tail/event logic with fake Docker objects (no daemon needed)."""

import time
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.collector import docker_watcher, watch
from app.db.base import Base
from app.db.models import incident as _incident  # noqa: F401 (register model)
from app.db.models.incident import Incident
from app.schemas.incident import IncidentSource

TRACE_LINES = [
    "Traceback (most recent call last):",
    '  File "/code/app.py", line 42, in boom',
    "ZeroDivisionError: division by zero",
]


def _ts_line(ts: int, text: str) -> bytes:
    iso = datetime.fromtimestamp(ts, tz=UTC).isoformat().replace("+00:00", "Z")
    return f"{iso} {text}\n".encode()


class FakeContainer:
    """Fake docker container: logs(**kwargs) honors `since` and timestamps."""

    id = "cid-1"
    name = "crashme"
    labels = {"com.docker.compose.project": "demo"}

    def __init__(self, lines: list[tuple[int, str, str]] | None = None):
        # (epoch_seconds, stream, text)
        self._lines = list(lines or [])

    def logs(self, **kwargs):  # type: ignore[no-untyped-def]
        since = int(kwargs.get("since", 0) or 0)
        use_ts = kwargs.get("timestamps", False)
        want_out = kwargs.get("stdout", True)
        want_err = kwargs.get("stderr", True)
        out = b""
        for ts, stream, text in self._lines:
            if ts <= since:
                continue
            if stream == "stdout" and not want_out:
                continue
            if stream == "stderr" and not want_err:
                continue
            out += _ts_line(ts, text) if use_ts else f"{text}\n".encode()
        return out


def _client_with(containers):
    class C:
        def __init__(self, conts):
            self.containers = self
            self._conts = conts

        def list(self):
            return self._conts

    return C(containers)


def _session():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _settings_allowlist(monkeypatch, projects):  # type: ignore[no-untyped-def]
    settings = type("Settings", (), {"monitored_project_list": list(projects)})()
    monkeypatch.setattr(watch, "get_settings", lambda: settings)


@pytest.fixture(autouse=True)
def _clean_watcher_state():
    watch._recent_signals.clear()
    yield
    watch._recent_signals.clear()


def _tail(client, session, seen_ts, seen_ids):
    watch._tail_containers(client, session, "", seen_ts, seen_ids)


def test_tail_skips_history_and_ingests_once(monkeypatch):
    _settings_allowlist(monkeypatch, ["demo"])
    base = int(time.time())
    session = _session()
    container = FakeContainer([(base - 60, "stderr", "crashme listening")])
    client = _client_with([container])
    seen_ts: dict = {}
    seen_ids: set = set()
    _tail(client, session, seen_ts, seen_ids)  # first sight: skip history
    assert session.query(Incident).count() == 0

    container._lines.append((base + 1, "stderr", TRACE_LINES[0]))
    container._lines.append((base + 1, "stderr", TRACE_LINES[1]))
    container._lines.append((base + 1, "stderr", TRACE_LINES[2]))
    _tail(client, session, seen_ts, seen_ids)  # new traceback: ingest
    inc = session.query(Incident).one()
    assert inc.source == IncidentSource.DOCKER.value
    assert inc.observation_count == 1
    assert inc.matched_line_count == 2  # Traceback header + exception line

    _tail(client, session, seen_ts, seen_ids)  # nothing new: no-op
    assert session.query(Incident).one().observation_count == 1


def test_tail_ignores_out_of_scope_project(monkeypatch):
    _settings_allowlist(monkeypatch, ["other"])
    base = int(time.time())
    session = _session()
    container = FakeContainer([(base + 1, "stderr", TRACE_LINES[2])])
    client = _client_with([container])
    _tail(client, session, {}, set())
    _tail(client, session, {}, set())
    assert session.query(Incident).count() == 0


def test_identical_errors_seconds_apart_both_count(monkeypatch):
    """GPT M2.1-A: same error text at different timestamps = separate observations."""
    _settings_allowlist(monkeypatch, ["demo"])
    base = int(time.time())
    session = _session()
    container = FakeContainer()
    client = _client_with([container])
    seen_ts: dict = {}
    seen_ids: set = set()
    _tail(client, session, seen_ts, seen_ids)  # init
    assert session.query(Incident).count() == 0

    for ts in (base + 1, base + 2, base + 3):
        for line in TRACE_LINES:
            container._lines.append((ts, "stderr", line))
        _tail(client, session, seen_ts, seen_ids)

    inc = session.query(Incident).one()
    assert inc.observation_count == 3
    assert inc.matched_line_count == 6

    _tail(client, session, seen_ts, seen_ids)  # same lines re-fetched: no-op
    assert session.query(Incident).one().observation_count == 3


def test_event_action_parsing_handles_status_suffix():
    """Real daemon format: 'health_status: unhealthy' (suffix, not exact)."""
    raws = [
        {
            "Action": "health_status: unhealthy",
            "Actor": {
                "ID": "c1",
                "Attributes": {
                    "name": "crashme",
                    "com.docker.compose.project": "demo",
                    "com.docker.compose.service": "crashme",
                },
            },
        },
        {
            "Action": "die",
            "Actor": {
                "ID": "c1",
                "Attributes": {
                    "name": "crashme",
                    "com.docker.compose.project": "demo",
                    "com.docker.compose.service": "crashme",
                    "exitCode": "1",
                },
            },
        },
        {"Action": "exec_die", "Actor": {"ID": "c1", "Attributes": {}}},
        {"Action": "stop", "Actor": {"ID": "c1", "Attributes": {}}},
    ]

    class FakeEventsClient:
        def events(self, filters=None, decode=True):  # type: ignore[no-untyped-def]
            return iter(raws)

    got = list(docker_watcher.iter_events(FakeEventsClient()))
    assert [(e["action"], e["status"]) for e in got] == [
        ("health_status", "unhealthy"),
        ("die", ""),
        ("stop", ""),
    ]
    assert got[0]["health"] == "unhealthy"
    assert got[1]["exit_code"] == "1"


def test_kill_signal_normalization():
    assert docker_watcher.normalize_signal("15") == "SIGTERM"
    assert docker_watcher.normalize_signal("9") == "SIGKILL"
    assert docker_watcher.normalize_signal("SIGTERM") == "SIGTERM"
    assert docker_watcher.normalize_signal("") == ""


def _die_event(exit_code: str) -> dict:
    return {
        "action": "die",
        "status": "",
        "container_id": "c1",
        "container_name": "crashme",
        "project": "demo",
        "service": "crashme",
        "exit_code": exit_code,
        "health": "",
    }


class _LogsContainer:
    def __init__(self, text: bytes):
        self._text = text

    def logs(self, **kwargs):  # type: ignore[no-untyped-def]
        return self._text


def _event_client(container):
    class C:
        def __init__(self, cont):
            self._cont = cont

        def get(self, _cid):
            return self._cont

    class Client:
        def __init__(self, cont):
            self.containers = C(cont)

    return Client(container)


def test_die_planned_shutdown_codes_never_create_incidents(monkeypatch):
    """exit 0/143/130 with stale traceback in logs: still no incident."""
    _settings_allowlist(monkeypatch, ["demo"])
    for code in ("0", "143", "130"):
        session = _session()
        client = _event_client(_LogsContainer(b"Traceback ... ZeroDivisionError"))
        event = _die_event(code)
        if code != "0":
            event["signal"] = ""  # kill path tested separately
            watch._process_event(session, client, _kill_event_for(code))
        watch._process_event(session, client, event)
        assert session.query(Incident).count() == 0, f"exit {code} created an incident"


def _kill_event_for(code: str) -> dict:
    event = _die_event("")
    event["action"] = "kill" if code != "0" else "stop"
    event["signal"] = {"143": "15", "130": "2"}.get(code, "")
    return event


def test_die_crash_exit_creates_incident_without_log_evidence(monkeypatch):
    _settings_allowlist(monkeypatch, ["demo"])
    session = _session()
    client = _event_client(_LogsContainer(b"crashme listening\n"))
    watch._process_event(session, client, _die_event("1"))
    inc = session.query(Incident).one()
    assert "exit code 1" in inc.title


def _kill_event(signal: str) -> dict:
    event = _die_event("")
    event["action"] = "kill"
    event["signal"] = docker_watcher.normalize_signal(signal)
    return event


def test_die_137_after_sigterm_is_planned_shutdown(monkeypatch):
    """compose stop/down: kill 15, then SIGKILL after grace -> no incident."""
    _settings_allowlist(monkeypatch, ["demo"])
    session = _session()
    client = _event_client(_LogsContainer(b""))  # logs already gone (container removed)
    watch._process_event(session, client, _kill_event("15"))  # daemon sends numeric
    watch._process_event(session, client, _die_event("137"))
    assert session.query(Incident).count() == 0


def test_die_137_without_kill_signal_is_an_incident(monkeypatch):
    """Abrupt SIGKILL with no preceding stop request stays an incident."""
    _settings_allowlist(monkeypatch, ["demo"])
    session = _session()
    client = _event_client(_LogsContainer(b""))
    watch._process_event(session, client, _die_event("137"))
    inc = session.query(Incident).one()
    assert "exit code 137" in inc.title


def test_die_143_without_stop_request_is_an_incident(monkeypatch):
    """GPT M2.1-B: 143/130 need a preceding stop/kill to count as planned."""
    _settings_allowlist(monkeypatch, ["demo"])
    session = _session()
    client = _event_client(_LogsContainer(b""))
    watch._process_event(session, client, _die_event("143"))
    assert session.query(Incident).count() == 1


def test_die_after_oom_event_merges_into_oom_incident(monkeypatch):
    """OOM die with unreadable logs merges via recent-oom correlation."""
    _settings_allowlist(monkeypatch, ["demo"])
    session = _session()
    client = _event_client(_LogsContainer(b""))  # 404: container already gone
    oom = _die_event("")
    oom["action"] = "oom"
    watch._process_event(session, client, oom)
    watch._process_event(session, client, _die_event("137"))
    incidents = session.query(Incident).all()
    assert len(incidents) == 1
    assert incidents[0].observation_count == 2
    assert "OOMKilled" in incidents[0].title
