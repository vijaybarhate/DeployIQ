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


class _FakeContainer:
    def __init__(self, name, status="running", health="", project="", logs_text=""):
        self.name = name
        self.short_id = "abc123"
        self.status = status
        self._logs = logs_text
        self.attrs = {
            "State": {"Health": {"Status": health}} if health else {},
            "Config": {"Labels": {"com.docker.compose.project": project} if project else {}},
        }

    def logs(self, tail=200, timestamps=False):
        return self._logs.encode("utf-8")


class _FakeContainers:
    def __init__(self, items):
        self._items = {c.name: c for c in items}

    def list(self, all=True):
        return list(self._items.values())

    def get(self, name):
        try:
            return self._items[name]
        except KeyError:
            raise Exception(f"No such container: {name}") from None


class _FakeClient:
    def __init__(self, items):
        self.containers = _FakeContainers(items)


@pytest.fixture
def _scope(monkeypatch):
    """Pin the allowlist without touching the cached global settings."""
    monkeypatch.setattr(docker_ops, "_allowlist", lambda: ["my-proj"])


@pytest.fixture
def _client(monkeypatch):
    monkeypatch.setattr(
        docker_ops,
        "get_client",
        lambda: _FakeClient(
            [
                _FakeContainer(
                    "ok-1", status="running", health="healthy", project="my-proj", logs_text="ok\n"
                ),
                _FakeContainer(
                    "other-1", status="running", project="other-proj", logs_text="nope\n"
                ),
                _FakeContainer("nolabel-1", status="running", logs_text="plain\n"),
                _FakeContainer(
                    "leaky-1",
                    status="running",
                    health="healthy",
                    project="my-proj",
                    logs_text="starting\napi_key=sk-or-SECRET1234567890\ntoken abcdef\ndone\n",
                ),
            ]
        ),
    )


def test_docker_list_only_monitored(_scope, _client):
    r = client.get("/api/v1/docker/containers")
    assert r.status_code == 200, r.text
    names = [c["name"] for c in r.json()]
    assert names == ["leaky-1", "ok-1"]  # sorted; other-proj + unlabeled hidden
    assert all(c["project"] == "my-proj" for c in r.json())


def test_docker_unavailable_is_503(monkeypatch):
    def _boom():
        raise docker_watcher.DockerUnavailableError("daemon down")

    monkeypatch.setattr(docker_ops, "list_containers", _boom)
    r = client.get("/api/v1/docker/containers")
    assert r.status_code == 503


def test_container_logs_validation():
    r = client.get("/api/v1/docker/containers/bad!name/logs")
    assert r.status_code == 422


def test_container_logs_not_found(_scope, _client):
    r = client.get("/api/v1/docker/containers/nope/logs")
    assert r.status_code == 404


def test_container_logs_success(_scope, _client):
    r = client.get("/api/v1/docker/containers/ok-1/logs?tail=50")
    assert r.status_code == 200, r.text
    assert r.json()["lines"] == ["ok"]


def test_docker_logs_rejects_unlisted_project(_scope, _client):
    r = client.get("/api/v1/docker/containers/other-1/logs")
    assert r.status_code == 403, r.text


def test_docker_logs_rejects_missing_project_label(_scope, _client):
    r = client.get("/api/v1/docker/containers/nolabel-1/logs")
    assert r.status_code == 403, r.text


def test_docker_logs_redacts_secrets(_scope, _client):
    r = client.get("/api/v1/docker/containers/leaky-1/logs")
    assert r.status_code == 200, r.text
    text = "\n".join(r.json()["lines"])
    assert "SECRET1234567890" not in text
    assert "[REDACTED]" in text


def test_models_fallback_without_key(monkeypatch):
    import asyncio

    model_service.clear_catalog_cache()
    monkeypatch.setattr(model_service, "fetch_catalog", _raise_unavailable)
    items = asyncio.run(model_service.list_free_models())
    assert items == [{"id": "openrouter/free", "name": "OpenRouter Free Router"}]


async def _raise_unavailable(*args, **kwargs):
    raise RuntimeError("offline")


def _free_entry(model_id, name="M"):
    """Catalogue entry that passes every verification gate."""
    return {
        "id": model_id,
        "name": name,
        "pricing": {"prompt": "0", "completion": "0"},
        "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
    }


@pytest.fixture
def _verified_catalog(monkeypatch):
    """Fake catalogue: one verified free model plus every rejection case."""
    entries = [
        _free_entry("m:free"),
        {
            "id": "m:paid",
            "name": "P",
            "pricing": {"prompt": "0.001", "completion": "0.002"},
            "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
        },
        {"id": "m:mystery:free", "name": "X", "pricing": {}, "architecture": {}},
        {
            "id": "m:embed:free",
            "name": "E",
            "pricing": {"prompt": "0", "completion": "0"},
            "architecture": {"input_modalities": ["text"], "output_modalities": ["embeddings"]},
        },
    ]

    async def _fake(*args, **kwargs):
        return [dict(e) for e in entries]

    model_service.clear_catalog_cache()
    monkeypatch.setattr(model_service, "fetch_catalog", _fake)
    return entries


def test_models_filters_non_free(monkeypatch):
    import asyncio

    model_service.clear_catalog_cache()

    async def _fake(*args, **kwargs):
        return [
            _free_entry("b/model:free", "B"),
            {
                "id": "a/paid",
                "name": "A",
                "pricing": {"prompt": "0.001", "completion": "0"},
                "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
            },
            {
                "id": "openrouter/auto",
                "name": "Auto",
                "pricing": {"prompt": "0", "completion": "0"},
                "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
            },
        ]

    monkeypatch.setattr(model_service, "fetch_catalog", _fake)
    # Bypass cache by clearing right before (fetch runs, filters, sorts).
    items = asyncio.run(model_service.list_free_models())
    ids = [e["id"] for e in items]
    # The documented free router is always listed; paid/auto entries rejected.
    assert ids == ["openrouter/free", "b/model:free"]
    model_service.clear_catalog_cache()


def test_models_route_uses_fallback(monkeypatch):
    model_service.clear_catalog_cache()
    monkeypatch.setattr(model_service, "fetch_catalog", _raise_unavailable)
    r = client.get("/api/v1/models")
    assert r.status_code == 200, r.text
    assert r.json()[0]["id"] == "openrouter/free"
    model_service.clear_catalog_cache()


def test_models_check_ok_strict_no_fallbacks(monkeypatch, _verified_catalog):
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


def test_models_check_rejects_paid_model(_verified_catalog):
    r = client.post("/api/v1/models/check", json={"model": "m:paid"})
    assert r.status_code == 422, r.text


def test_models_rejects_unknown_free_suffix(_verified_catalog):
    import asyncio

    with pytest.raises(ValueError, match="not a verified free model"):
        asyncio.run(model_service.ensure_verified_free_model("ghost/model:free"))


def test_models_rejects_embeddings_and_missing_metadata(_verified_catalog):
    import asyncio

    with pytest.raises(ValueError, match="not a verified free model"):
        asyncio.run(model_service.ensure_verified_free_model("m:embed:free"))
    with pytest.raises(ValueError, match="not a verified free model"):
        asyncio.run(model_service.ensure_verified_free_model("m:mystery:free"))


def test_models_accepts_free_router_without_catalog():
    import asyncio

    model_service.clear_catalog_cache()
    assert (
        asyncio.run(model_service.ensure_verified_free_model("openrouter/free"))
        == "openrouter/free"
    )
    model_service.clear_catalog_cache()


def test_models_check_provider_failure_is_502(monkeypatch, _verified_catalog):
    from app.llm.base import LLMError, LLMErrorCode

    class _FailingProvider:
        def __init__(self, **kwargs):
            pass

        async def complete_json(self, system_prompt, user_prompt):
            raise LLMError(LLMErrorCode.TIMEOUT, "too slow")

    monkeypatch.setattr("app.llm.openrouter.OpenRouterProvider", _FailingProvider)
    r = client.post("/api/v1/models/check", json={"model": "m:free"})
    assert r.status_code == 502, r.text


def _status_catalog(monkeypatch):
    entries = [
        _free_entry("m-fast:free", "Fast"),
        _free_entry("m-limited:free", "Limited"),
        _free_entry("m-slow:free", "Slow"),
        _free_entry("m-dead:free", "Dead"),
    ]

    async def _fake(*args, **kwargs):
        return [dict(e) for e in entries]

    model_service.clear_catalog_cache()
    monkeypatch.setattr(model_service, "fetch_catalog", _fake)
    return entries


def _pooled_settings(monkeypatch, keys):
    import types

    model_service.clear_catalog_cache()
    fake = types.SimpleNamespace(
        openrouter_api_key=keys[0] if keys else "",
        openrouter_api_keys=list(keys),
        openrouter_model="",
        openrouter_base_url="https://openrouter.ai/api/v1",
        openrouter_timeout_seconds=5.0,
    )
    monkeypatch.setattr(model_service, "get_settings", lambda: fake)
    return fake


def test_check_fails_over_to_next_key_on_rate_limit(monkeypatch, _verified_catalog):
    import asyncio

    from app.llm.base import LLMCompletion, LLMError, LLMErrorCode, TokenUsage

    _pooled_settings(monkeypatch, ["k1", "k2"])
    model_service._reset_key_rotation()
    seen: list[str] = []

    class _FakeProvider:
        def __init__(self, **kwargs):
            self._key = kwargs.get("api_key", "")

        async def complete_json(self, system_prompt, user_prompt):
            seen.append(self._key)
            if self._key == "k1":
                raise LLMError(LLMErrorCode.RATE_LIMITED, "limited")
            return LLMCompletion(
                parsed={"ok": True}, actual_model="m:free", usage=TokenUsage(), latency_ms=10
            )

    monkeypatch.setattr("app.llm.openrouter.OpenRouterProvider", _FakeProvider)
    out = asyncio.run(model_service.check_model("m:free"))
    assert out["ok"] is True
    assert seen[0] == "k1" and seen[-1] == "k2"  # exhausted key skipped, next key answered


def test_check_reports_all_keys_exhausted(monkeypatch, _verified_catalog):
    import asyncio

    import pytest as _pytest

    from app.llm.base import LLMError, LLMErrorCode

    _pooled_settings(monkeypatch, ["k1", "k2"])
    model_service._reset_key_rotation()

    class _FailingProvider:
        def __init__(self, **kwargs):
            pass

        async def complete_json(self, system_prompt, user_prompt):
            raise LLMError(LLMErrorCode.RATE_LIMITED, "limited")

    monkeypatch.setattr("app.llm.openrouter.OpenRouterProvider", _FailingProvider)
    with _pytest.raises(LLMError) as excinfo:
        asyncio.run(model_service.check_model("m:free"))
    assert excinfo.value.code == LLMErrorCode.RATE_LIMITED
    assert "all 2 keys" in str(excinfo.value)


def test_key_rotation_spreads_load(monkeypatch, _verified_catalog):
    import asyncio

    from app.llm.base import LLMCompletion, TokenUsage

    _pooled_settings(monkeypatch, ["k1", "k2", "k3"])
    model_service._reset_key_rotation()
    seen: list[str] = []

    class _FakeProvider:
        def __init__(self, **kwargs):
            self._key = kwargs.get("api_key", "")

        async def complete_json(self, system_prompt, user_prompt):
            seen.append(self._key)
            return LLMCompletion(
                parsed={"ok": True}, actual_model="m:free", usage=TokenUsage(), latency_ms=10
            )

    monkeypatch.setattr("app.llm.openrouter.OpenRouterProvider", _FakeProvider)
    asyncio.run(model_service.check_model("m:free"))
    asyncio.run(model_service.check_model("m:free"))
    asyncio.run(model_service.check_model("m:free"))
    assert seen == ["k1", "k2", "k3"]


def test_api_keys_property_collects_numbered_keys(monkeypatch):
    from app.config import Settings

    # Real environ beats the repo .env file, so this is deterministic.
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("OPENROUTER_API_KEY1", "aaa")
    monkeypatch.setenv("OPENROUTER_API_KEY2", "aaa")  # duplicate collapses
    monkeypatch.setenv("OPENROUTER_API_KEY3", "bbb")
    for i in range(4, 10):
        monkeypatch.delenv(f"OPENROUTER_API_KEY{i}", raising=False)
    assert Settings().openrouter_api_keys == ["aaa", "bbb"]


def test_models_status_ranks_live_first(monkeypatch):
    from app.llm.base import LLMCompletion, LLMError, LLMErrorCode, TokenUsage

    _status_catalog(monkeypatch)
    calls: list[str] = []

    class _FakeProvider:
        def __init__(self, **kwargs):
            self._model = kwargs.get("model", "")

        async def complete_json(self, system_prompt, user_prompt):
            calls.append(self._model)
            if self._model == "m-fast:free":
                return LLMCompletion(
                    parsed={"ok": True},
                    actual_model="m-fast:free",
                    usage=TokenUsage(),
                    latency_ms=100,
                )
            if self._model == "m-limited:free":
                raise LLMError(LLMErrorCode.RATE_LIMITED, "limited")
            if self._model == "m-slow:free":
                raise LLMError(LLMErrorCode.TIMEOUT, "slow")
            raise LLMError(LLMErrorCode.SERVER, "down")

    monkeypatch.setattr("app.llm.openrouter.OpenRouterProvider", _FakeProvider)
    r = client.get("/api/v1/models/status?refresh=true")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [(e["id"], e["status"]) for e in body] == [
        ("m-fast:free", "live"),
        ("m-limited:free", "limited"),
        ("m-slow:free", "slow"),
        ("openrouter/free", "down"),
        ("m-dead:free", "down"),
    ]
    assert body[0]["latency_ms"] == 100
    # Cached: second call pings nothing.
    calls.clear()
    r = client.get("/api/v1/models/status")
    assert r.status_code == 200, r.text
    assert calls == []
    assert [(e["id"], e["status"]) for e in r.json()][0] == ("m-fast:free", "live")
    model_service.clear_catalog_cache()


def test_trigger_rejects_paid_model_override(_verified_catalog):
    incident_id = uuid.uuid4()
    r = client.post(
        f"/api/v1/incidents/{incident_id}/investigations", json={"model": "vendor/paid"}
    )
    assert r.status_code == 422, r.text


def _fake_settings(monkeypatch, model="", fallbacks=()):
    import types

    import app.services.investigation as _inv

    fake = types.SimpleNamespace(
        openrouter_model=model,
        openrouter_api_key="k",
        openrouter_base_url="http://x",
        openrouter_timeout_seconds=5.0,
        openrouter_max_output_tokens=10,
        openrouter_max_input_chars=100,
        fallback_model_list=list(fallbacks),
        prompt_version="rca-v1",
    )
    monkeypatch.setattr(model_service, "get_settings", lambda: fake)
    monkeypatch.setattr(_inv, "get_settings", lambda: fake)
    return fake


def test_trigger_rejects_unverified_configured_default(monkeypatch, _verified_catalog):
    _fake_settings(monkeypatch, model="vendor/paid")
    r = client.post(f"/api/v1/incidents/{uuid.uuid4()}/investigations", json={})
    assert r.status_code == 422, r.text


def test_trigger_rejects_unverified_fallback(monkeypatch, _verified_catalog):
    _fake_settings(monkeypatch, model="m:free", fallbacks=["shady:free"])
    r = client.post(f"/api/v1/incidents/{uuid.uuid4()}/investigations", json={})
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


def test_manual_ingest_records_matched_lines_and_container():
    logs = (
        "Traceback (most recent call last):\n"
        '  File "/code/worker.py", line 9, in run\n'
        "ValueError: bad payload\n"
    )
    payload = {"project_id": "demo", "raw_logs": logs, "container_name": "boom-99"}
    r = client.post("/api/v1/incidents/manual", json=payload)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["matched_line_count"] > 0
    assert any("container=boom-99" in (e.get("detail") or "") for e in body["evidence"])


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


def test_copilot_validation(_verified_catalog):
    r = client.post("/api/v1/copilot/ask", json={"question": ""})
    assert r.status_code == 422
    # Paid model rejected once validation is reached: seed an incident so the
    # request gets past the insufficient-context short-circuit.
    logs = "Traceback (most recent call last):\nZeroDivisionError: x\n"
    inc = client.post("/api/v1/incidents/manual", json={"project_id": "demo", "raw_logs": logs})
    assert inc.status_code == 201, inc.text
    incident_id = inc.json()["id"]
    r = client.post(
        "/api/v1/copilot/ask",
        json={"question": "hi", "incident_id": incident_id, "model": "vendor/paid"},
    )
    assert r.status_code == 422, r.text
    r = client.post(
        "/api/v1/copilot/ask", json={"question": "hi", "incident_id": str(uuid.uuid4())}
    )
    assert r.status_code == 404, r.text


def test_copilot_paid_override_rejected_without_context(_verified_catalog):
    # Policy runs before grounding: no incident, no runbooks — still 422.
    r = client.post("/api/v1/copilot/ask", json={"question": "hi", "model": "vendor/paid"})
    assert r.status_code == 422, r.text


@pytest.fixture
def _accept_all_models(monkeypatch):
    """Grounding tests assume policy passes; policy itself is tested elsewhere."""

    async def _ok(model_id=None):
        cleaned = (model_id or "").strip()
        if not cleaned:
            raise ValueError("empty")
        return cleaned

    monkeypatch.setattr(model_service, "ensure_verified_free_model", _ok)


def test_copilot_insufficient_context_without_llm(monkeypatch, _accept_all_models):
    async def _boom(*args, **kwargs):
        raise AssertionError("LLM must not be called without grounding")

    monkeypatch.setattr("app.services.copilot.OpenRouterProvider", _boom)
    r = client.post("/api/v1/copilot/ask", json={"question": "zzz-no-such-runbook-topic-qqq"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["evidence_ids"] == [] and body["runbook_ids"] == []
    assert body["confidence"] == 0.0
    assert "Not enough context" in body["answer"]


def test_copilot_grounds_ids_and_clamps_confidence(monkeypatch, _accept_all_models):
    from app.llm.base import LLMCompletion, TokenUsage
    from app.rag.schemas import RetrievalResult
    from app.services import copilot as copilot_service

    logs = "Traceback (most recent call last):\nZeroDivisionError: x\n"
    inc = client.post("/api/v1/incidents/manual", json={"project_id": "demo", "raw_logs": logs})
    incident_id = inc.json()["id"]

    def _fake_retrieve(question, top_k=3):
        return [
            RetrievalResult(
                runbook_id="RB-001",
                title="T",
                relevance_score=1.0,
                matched_sections=[],
                source_urls=[],
            )
        ]

    class _FakeRetriever:
        retrieve = staticmethod(_fake_retrieve)

    class _FakeProvider:
        def __init__(self, **kwargs):
            pass

        async def complete_json(self, system_prompt, user_prompt):
            return LLMCompletion(
                parsed={
                    "answer": "boom",
                    "evidence_ids": ["E-001", "E-999"],
                    "runbook_ids": ["RB-001", "RB-999"],
                    "confidence": 42,
                },
                actual_model="m",
                usage=TokenUsage(),
                latency_ms=1,
            )

    monkeypatch.setattr("app.services.copilot.OpenRouterProvider", _FakeProvider)
    monkeypatch.setattr(copilot_service, "get_retriever", lambda: _FakeRetriever())
    r = client.post("/api/v1/copilot/ask", json={"question": "why", "incident_id": incident_id})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["evidence_ids"] == ["E-001"]
    assert body["runbook_ids"] == ["RB-001"]
    assert body["confidence"] == 1.0


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
