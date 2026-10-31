"""Tests: log-tailing ingests each error once and never re-ingests history."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.collector import docker_watcher, watch
from app.db.base import Base
from app.db.models import incident as _incident  # noqa: F401 (register model)
from app.db.models.incident import Incident
from app.schemas.incident import IncidentSource

TRACEBACK = b"""Traceback (most recent call last):
  File "/code/app.py", line 42, in boom
    1 / 0
ZeroDivisionError: division by zero
"""


class FakeContainer:
    id = "cid-1"
    name = "crashme"
    labels = {"com.docker.compose.project": "demo"}

    def __init__(self):
        self.calls = 0

    def logs(self, **kwargs):  # type: ignore[no-untyped-def]
        self.calls += 1
        if self.calls == 1:
            return b"crashme listening\n"  # history present at watcher start -> skipped
        if self.calls == 2:
            return TRACEBACK  # genuinely new lines -> one ingest
        return b""


def _client_with(containers):
    class C:
        def __init__(self):
            self.containers = self

        def list(self):
            return containers

    return C()


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
    watch._recent_sightings.clear()
    watch._recent_signals.clear()
    yield
    watch._recent_sightings.clear()
    watch._recent_signals.clear()


def test_tail_skips_history_and_ingests_once(monkeypatch):
    _settings_allowlist(monkeypatch, ["demo"])
    session = _session()
    container = FakeContainer()
    client = _client_with([container])
    seen: dict = {}

    watch._tail_containers(client, session, "", seen)  # first sight: skip history
    assert session.query(Incident).count() == 0

    watch._tail_containers(client, session, "", seen)  # old history lines: no ingest
    assert session.query(Incident).count() == 0

    watch._tail_containers(client, session, "", seen)  # new traceback: ingest
    assert session.query(Incident).count() == 1
    inc = session.query(Incident).one()
    assert inc.source == IncidentSource.DOCKER.value
    assert inc.occurrence_count == 1

    watch._tail_containers(client, session, "", seen)  # nothing new: no-op
    assert session.query(Incident).one().occurrence_count == 1


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
    ]
    assert got[0]["health"] == "unhealthy"
    assert got[1]["exit_code"] == "1"


def test_tail_ignores_out_of_scope_project(monkeypatch):
    _settings_allowlist(monkeypatch, ["other"])
    session = _session()
    container = FakeContainer()
    client = _client_with([container])
    seen: dict = {}
    watch._tail_containers(client, session, "", seen)
    watch._tail_containers(client, session, "", seen)
    assert session.query(Incident).count() == 0


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
        client = _event_client(_LogsContainer(TRACEBACK))
        watch._process_event(session, client, _die_event(code))
        assert session.query(Incident).count() == 0, f"exit {code} created an incident"


def test_die_crash_exit_creates_incident_without_log_evidence(monkeypatch):
    _settings_allowlist(monkeypatch, ["demo"])
    watch._recent_sightings.clear()
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


def test_kill_signal_normalization():
    assert docker_watcher.normalize_signal("15") == "SIGTERM"
    assert docker_watcher.normalize_signal("9") == "SIGKILL"
    assert docker_watcher.normalize_signal("SIGTERM") == "SIGTERM"
    assert docker_watcher.normalize_signal("") == ""


def test_die_137_after_sigterm_is_planned_shutdown(monkeypatch):
    """compose stop/down: kill SIGTERM, then SIGKILL after grace -> no incident."""
    _settings_allowlist(monkeypatch, ["demo"])
    session = _session()
    client = _event_client(_LogsContainer(b""))  # logs already gone (container removed)
    watch._process_event(session, client, _kill_event("15"))  # daemon sends numeric
    watch._process_event(session, client, _die_event("137"))
    assert session.query(Incident).count() == 0


def test_die_137_without_kill_signal_is_an_incident(monkeypatch):
    """Abrupt SIGKILL with no preceding stop request stays an incident."""
    _settings_allowlist(monkeypatch, ["demo"])
    watch._recent_sightings.clear()
    session = _session()
    client = _event_client(_LogsContainer(b""))
    watch._process_event(session, client, _die_event("137"))
    inc = session.query(Incident).one()
    assert "exit code 137" in inc.title


def test_die_after_oom_event_merges_into_oom_incident(monkeypatch):
    """OOM die with unreadable logs merges via recent-oom correlation."""
    _settings_allowlist(monkeypatch, ["demo"])
    watch._recent_sightings.clear()
    session = _session()
    client = _event_client(_LogsContainer(b""))  # 404: container already gone
    oom = _die_event("")
    oom["action"] = "oom"
    watch._process_event(session, client, oom)
    watch._process_event(session, client, _die_event("137"))
    incidents = session.query(Incident).all()
    assert len(incidents) == 1
    assert incidents[0].occurrence_count == 2
    assert "OOMKilled" in incidents[0].title


def test_tail_suppresses_same_second_resighting(monkeypatch):
    """Docker `since` repeats same-second lines: must not double-count."""
    _settings_allowlist(monkeypatch, ["demo"])
    watch._recent_sightings.clear()
    session = _session()

    class RepeatContainer:
        id = "cid-2"
        name = "crashme"
        labels = {"com.docker.compose.project": "demo"}

        def logs(self, **kwargs):  # type: ignore[no-untyped-def]
            return TRACEBACK  # every poll returns the same traceback (worst case)

    container = RepeatContainer()
    client = _client_with([container])
    seen: dict = {}
    watch._tail_containers(client, session, "", seen)  # init
    watch._tail_containers(client, session, "", seen)  # ingest -> count 1
    assert session.query(Incident).one().occurrence_count == 1
    watch._tail_containers(client, session, "", seen)  # resighting suppressed
    watch._tail_containers(client, session, "", seen)  # resighting suppressed
    assert session.query(Incident).one().occurrence_count == 1
    assert session.query(Incident).count() == 1
