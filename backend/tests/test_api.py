"""Tests: incident API + health/collector status (no real Docker needed)."""

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_api.db")
os.environ.setdefault("MONITORED_PROJECTS", "demo")

import uuid  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.collector import docker_watcher  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.models import incident as _incident  # noqa: F401,E402 (register model)
from app.db.session import get_session  # noqa: E402
from app.main import app  # noqa: E402

engine = create_engine(
    "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
Base.metadata.create_all(bind=engine)
TestingSession = sessionmaker(bind=engine)


def _override_session():
    s = TestingSession()
    try:
        yield s
    finally:
        s.close()


app.dependency_overrides[get_session] = _override_session
client = TestClient(app, raise_server_exceptions=False)

PAYLOAD = {
    "source": "docker",
    "project_id": "demo",
    "title": "ZeroDivisionError: division by zero",
    "error_signature": "sig-ignored-server-side",
    "raw_logs": "Traceback ... ZeroDivisionError",
    "evidence": [{"kind": "exception", "summary": "ZeroDivisionError"}],
}


def test_create_and_fetch_incident():
    r = client.post("/api/v1/incidents", json=PAYLOAD)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["occurrence_count"] == 1
    assert body["source"] == "docker"

    r = client.post("/api/v1/incidents", json=PAYLOAD)
    assert r.status_code == 201
    assert r.json()["occurrence_count"] == 2
    assert r.json()["id"] == body["id"]

    r = client.get("/api/v1/incidents")
    assert r.status_code == 200
    assert len(r.json()) == 1

    r = client.get(f"/api/v1/incidents/{body['id']}")
    assert r.status_code == 200


def test_invalid_payload_returns_422():
    r = client.post("/api/v1/incidents", json={"source": "docker"})
    assert r.status_code == 422


def test_out_of_scope_returns_403():
    bad = dict(PAYLOAD, project_id="not-monitored")
    r = client.post("/api/v1/incidents", json=bad)
    assert r.status_code == 403


def test_unknown_incident_returns_404():
    r = client.get(f"/api/v1/incidents/{uuid.uuid4()}")
    assert r.status_code == 404


def test_health_reports_docker_status():
    r = client.get("/api/v1/healthz")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert "docker" in r.json()


def test_collector_reports_disconnected(monkeypatch):
    def _boom():
        raise docker_watcher.DockerUnavailableError("engine down")

    monkeypatch.setattr(docker_watcher, "get_client", _boom)
    r = client.get("/api/v1/collector/status")
    assert r.status_code == 200
    assert r.json()["docker"]["connected"] is False
