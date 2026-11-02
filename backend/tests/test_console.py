"""Tests: ops-console surface — docker read-only routes, model catalog + override
policy, manual ingest, copilot validation, docx report (no real Docker/LLM)."""

import io
import os
import uuid
import zipfile

import pytest  # noqa: E402

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_api.db")
os.environ.setdefault("MONITORED_PROJECTS", "demo")
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.collector import docker_watcher  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.models import incident as _incident  # noqa: F401,E402 (register model)
from app.db.models import investigation as _investigation  # noqa: F401,E402
from app.db.models.investigation import Investigation  # noqa: E402
from app.db.session import get_session  # noqa: E402
from app.llm.base import is_free_model  # noqa: E402
from app.main import app  # noqa: E402
from app.services import docker_ops  # noqa: E402
from app.services import models as model_service  # noqa: E402

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


@pytest.fixture(autouse=True)
def _isolated_session_override():
    """Pin the session override to this module's engine for each test.

    Several test modules share the global FastAPI app and overwrite
    ``dependency_overrides`` at import time; without this fixture the
    winning override depends on collection order and direct-DB tests read
    from the wrong engine. Restored afterwards to stay polite.
    """
    previous = app.dependency_overrides.get(get_session)
    app.dependency_overrides[get_session] = _override_session
    try:
        yield
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_session, None)
        else:
            app.dependency_overrides[get_session] = previous


def test_is_free_model_policy():
    assert is_free_model("vendor/model:free")
    assert is_free_model("openrouter/free")
    assert not is_free_model("vendor/model")
    assert not is_free_model("openrouter/auto")
    assert not is_free_model("")


def test_docker_containers_success(monkeypatch):
    monkeypatch.setattr(
        docker_ops,
        "list_containers",
        lambda: [
            {
                "name": "crashme",
                "short_id": "abc",
                "status": "running",
                "health": "",
                "project": "demo",
            }
        ],
    )
    r = client.get("/api/v1/docker/containers")
    assert r.status_code == 200, r.text
    assert r.json()[0]["name"] == "crashme"


def test_docker_unavailable_is_503(monkeypatch):
    def _boom():
        raise docker_watcher.DockerUnavailableError("daemon down")

    monkeypatch.setattr(docker_ops, "list_containers", _boom)
    r = client.get("/api/v1/docker/containers")
    assert r.status_code == 503


def test_container_logs_validation():
    r = client.get("/api/v1/docker/containers/bad!name/logs")
    assert r.status_code == 422


def test_container_logs_not_found(monkeypatch):
    monkeypatch.setattr(
        docker_ops, "container_logs", lambda name, tail=200: (_ for _ in ()).throw(KeyError(name))
    )
    r = client.get("/api/v1/docker/containers/nope/logs")
    assert r.status_code == 404


def test_container_logs_success(monkeypatch):
    monkeypatch.setattr(
        docker_ops,
        "container_logs",
        lambda name, tail=200: {"name": name, "lines": ["boom"], "truncated": False},
    )
    r = client.get("/api/v1/docker/containers/crashme/logs?tail=50")
    assert r.status_code == 200, r.text
    assert r.json()["lines"] == ["boom"]


def test_models_fallback_without_key(monkeypatch):
    import asyncio

    model_service.clear_catalog_cache()
    monkeypatch.setattr(model_service, "fetch_catalog", _raise_unavailable)
    items = asyncio.run(model_service.list_free_models())
    assert items == [{"id": "openrouter/free", "name": "OpenRouter Free Router"}]


async def _raise_unavailable(*args, **kwargs):
    raise RuntimeError("offline")


def test_models_filters_non_free(monkeypatch):
    import asyncio

    model_service.clear_catalog_cache()

    async def _fake(*args, **kwargs):
        return [
            {"id": "b/model:free", "name": "B"},
            {"id": "a/paid", "name": "A"},
            {"id": "openrouter/auto", "name": "Auto"},
        ]

    monkeypatch.setattr(model_service, "fetch_catalog", _fake)
    # Bypass cache by clearing right before (fetch runs, filters, sorts).
    items = asyncio.run(model_service.list_free_models())
    ids = [e["id"] for e in items]
    assert "b/model:free" in ids
    assert all(e.endswith(":free") or e == "openrouter/free" for e in ids)
    model_service.clear_catalog_cache()


def test_models_route_uses_fallback(monkeypatch):
    model_service.clear_catalog_cache()
    monkeypatch.setattr(model_service, "fetch_catalog", _raise_unavailable)
    r = client.get("/api/v1/models")
    assert r.status_code == 200, r.text
    assert r.json()[0]["id"] == "openrouter/free"
    model_service.clear_catalog_cache()


def test_models_check_ok_strict_no_fallbacks(monkeypatch):
    import asyncio

    from app.llm.base import LLMCompletion, TokenUsage

    seen: dict = {}

    class _FakeProvider:
        def __init__(self, **kwargs):
            seen.update(kwargs)

        async def complete_json(self, system_prompt, user_prompt):
            assert "ping" in user_prompt
            return LLMCompletion(
                parsed={"ok": True},
                actual_model="m:free",
                usage=TokenUsage(),
                latency_ms=123,
            )

    monkeypatch.setattr("app.llm.openrouter.OpenRouterProvider", _FakeProvider)
    result = asyncio.run(model_service.check_model("m:free"))
    assert result == {"model": "m:free", "ok": True, "actual_model": "m:free", "latency_ms": 123}
    assert seen["fallback_models"] == []  # strict: verdict reflects the picked model only

    r = client.post("/api/v1/models/check", json={"model": "m:free"})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True


def test_models_check_rejects_paid_model():
    r = client.post("/api/v1/models/check", json={"model": "vendor/paid"})
    assert r.status_code == 422, r.text


def test_models_check_provider_failure_is_502(monkeypatch):
    from app.llm.base import LLMError, LLMErrorCode

    class _FailingProvider:
        def __init__(self, **kwargs):
            pass

        async def complete_json(self, system_prompt, user_prompt):
            raise LLMError(LLMErrorCode.TIMEOUT, "too slow")

    monkeypatch.setattr("app.llm.openrouter.OpenRouterProvider", _FailingProvider)
    r = client.post("/api/v1/models/check", json={"model": "m:free"})
    assert r.status_code == 502, r.text


def test_trigger_rejects_paid_model_override():
    incident_id = uuid.uuid4()
    r = client.post(
        f"/api/v1/incidents/{incident_id}/investigations", json={"model": "vendor/paid"}
    )
    assert r.status_code == 422, r.text


def test_manual_ingest_ok_and_dedup():
    logs = (
        "Traceback (most recent call last):\n"
        '  File "/code/app.py", line 1, in x\n'
        "ZeroDivisionError: division by zero\n"
    )
    payload = {"project_id": "demo", "raw_logs": logs, "container_name": "crashme"}
    r = client.post("/api/v1/incidents/manual", json=payload)
    assert r.status_code == 201, r.text
    first = r.json()["id"]
    r = client.post("/api/v1/incidents/manual", json=payload)
    assert r.status_code == 201
    assert r.json()["id"] == first  # dedup by signature


def test_manual_ingest_rejects_noise():
    r = client.post(
        "/api/v1/incidents/manual",
        json={"project_id": "demo", "raw_logs": "hello world, all fine here\n"},
    )
    assert r.status_code == 422, r.text


def test_manual_ingest_out_of_scope():
    logs = "Traceback (most recent call last):\nZeroDivisionError: x\n"
    r = client.post("/api/v1/incidents/manual", json={"project_id": "nope", "raw_logs": logs})
    assert r.status_code == 403, r.text


def test_copilot_validation():
    r = client.post("/api/v1/copilot/ask", json={"question": ""})
    assert r.status_code == 422
    r = client.post("/api/v1/copilot/ask", json={"question": "hi", "model": "vendor/paid"})
    assert r.status_code == 422, r.text
    r = client.post(
        "/api/v1/copilot/ask", json={"question": "hi", "incident_id": str(uuid.uuid4())}
    )
    assert r.status_code == 404, r.text


def test_report_download_and_404():
    session = TestingSession()
    try:
        incident_id = uuid.uuid4()
        record = Investigation(
            incident_id=incident_id,
            status="completed",
            requested_model="m:free",
            actual_model="m:free",
            prompt_version="rca-v1",
            result_json=(
                '{"root_cause": "boom", "explanation": "e", "findings": '
                '[{"description": "d", "evidence_ids": ["E-001"], "runbook_ids": []}], '
                '"recommendations": [], "verification_steps": ["v"], "limitations": ""}'
            ),
            evidence_snapshot='[{"id": "E-001", "kind": "exception", "summary": "boom"}]',
            runbook_snapshot="[]",
            total_tokens=10,
            duration_ms=100,
        )
        session.add(record)
        session.commit()
        inv_id = record.id
    finally:
        session.close()
    r = client.get(f"/api/v1/incidents/{incident_id}/investigations/{inv_id}/report")
    assert r.status_code == 200, r.text
    assert "officedocument.wordprocessingml" in r.headers["content-type"]
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    assert "boom" in xml and "E-001" in xml
    r = client.get(f"/api/v1/incidents/{incident_id}/investigations/{uuid.uuid4()}/report")
    assert r.status_code == 404
