"""Tests: investigation service + API with stubbed LLM/RAG (no network)."""

import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_investigations.db")
os.environ.setdefault("MONITORED_PROJECTS", "demo")

from datetime import UTC, datetime  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.models import incident as _incident  # noqa: F401,E402 (register model)
from app.db.models import investigation as _investigation  # noqa: F401,E402 (register model)
from app.db.models.incident import Incident  # noqa: E402
from app.db.models.investigation import Investigation  # noqa: E402
from app.db.session import get_session  # noqa: E402
from app.llm.base import LLMCompletion, LLMProvider, TokenUsage  # noqa: E402
from app.main import app  # noqa: E402

RCA = {
    "diagnosis_status": "diagnosed",
    "root_cause": "division by zero in handler",
    "explanation": "e",
    "severity_assessment": "medium",
    "confidence_estimate": 0.85,
    "confidence_rationale": "traceback points at one frame",
    "findings": [{"description": "d", "evidence_ids": ["E-001"], "runbook_ids": ["RB-007"]}],
    "recommendations": [
        {"title": "fix", "steps": ["patch"], "risk_level": "low", "requires_approval": True}
    ],
    "verification_steps": ["rerun"],
    "limitations": "",
}


class StubProvider(LLMProvider):
    async def complete_json(self, system_prompt, user_prompt):
        return LLMCompletion(
            parsed=dict(RCA),
            actual_model="stub/model:free",
            usage=TokenUsage(10, 5, 15),
            latency_ms=3,
        )


class StubRetriever:
    def retrieve(self, query, top_k=3):
        from app.rag.schemas import RetrievalResult as RR

        return [
            RR(
                runbook_id="RB-007",
                title="HTTP 500",
                relevance_score=9.0,
                matched_sections=["Symptoms"],
                source_urls=["https://docs.docker.com/x"],
            )
        ]

    def get(self, runbook_id):
        from app.rag.schemas import Runbook

        assert runbook_id == "RB-007"
        return Runbook(
            runbook_id="RB-007",
            title="HTTP 500",
            technology="app",
            symptoms="500 errors",
            causes="bug",
            diagnostics="read logs",
            remediation="fix code",
            verification="rerun",
            risk="low",
            sources=["https://docs.docker.com/x"],
            raw_text="HTTP 500",
        )


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

import app.services.investigation as _svc  # noqa: E402


def _stub_pipeline(key):
    from app.agents.graph import build_graph as _build

    return StubProvider(), _build(StubProvider(), StubRetriever(), 5000)


_svc._get_pipeline = _stub_pipeline  # type: ignore[method-assign]


def _seed_incident() -> uuid.UUID:
    session = TestingSession()
    inc = Incident(
        source="docker",
        project_id="demo",
        title="ZeroDivisionError: division by zero",
        status="open",
        severity="medium",
        error_signature="docker|demo|exception|zerodivisionerror",
        raw_logs="Traceback ... ZeroDivisionError",
        evidence_json='[{"kind": "exception", "summary": "ZeroDivisionError", "detail": ""}]',
        first_seen=datetime.now(UTC),
        last_seen=datetime.now(UTC),
        observation_count=1,
        matched_line_count=2,
    )
    session.add(inc)
    session.commit()
    incident_id = inc.id
    session.close()
    return incident_id


def test_trigger_and_history():
    incident_id = _seed_incident()
    r = client.post(f"/api/v1/incidents/{incident_id}/investigations")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "completed"
    assert body["result"]["root_cause"] == "division by zero in handler"
    assert body["actual_model"] == "stub/model:free"
    assert body["total_tokens"] == 15
    assert body["prompt_version"] == "rca-v1"
    snapshot = body["evidence_snapshot"]
    assert isinstance(snapshot, list) and len(snapshot) == 1
    assert snapshot[0]["id"] == "E-001"
    assert snapshot[0]["kind"] == "exception"
    assert "ZeroDivisionError" in snapshot[0]["summary"]
    runbooks = body["runbook_snapshot"]
    assert isinstance(runbooks, list) and len(runbooks) == 1
    assert runbooks[0]["runbook_id"] == "RB-007"
    assert runbooks[0]["title"] == "HTTP 500"
    assert runbooks[0]["source_urls"] == ["https://docs.docker.com/x"]

    r = client.get(f"/api/v1/incidents/{incident_id}/investigations")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_unknown_incident_404():
    r = client.post(f"/api/v1/incidents/{uuid.uuid4()}/investigations")
    assert r.status_code == 404


def test_old_records_default_to_empty_snapshots():
    """Pre-snapshot rows (NULL-free via server defaults) serialize as []."""
    incident_id = _seed_incident()
    session = TestingSession()
    legacy = Investigation(
        incident_id=incident_id,
        status="completed",
        requested_model="m",
        prompt_version="rca-v1",
        result_json="{}",
    )
    session.add(legacy)
    session.commit()
    legacy_id = str(legacy.id)
    session.close()
    r = client.get(f"/api/v1/incidents/{incident_id}/investigations")
    assert r.status_code == 200
    bodies = [b for b in r.json() if b["id"] == legacy_id]
    assert len(bodies) == 1
    assert bodies[0]["evidence_snapshot"] == []
    assert bodies[0]["runbook_snapshot"] == []


def test_simultaneous_duplicate_rejected_with_409():
    """An active (running) row makes the DB unique index reject a second POST."""
    incident_id = _seed_incident()
    session = TestingSession()
    active = Investigation(
        incident_id=incident_id,
        status="running",
        requested_model="m",
        prompt_version="rca-v1",
    )
    session.add(active)
    session.commit()
    session.close()

    r = client.post(f"/api/v1/incidents/{incident_id}/investigations")
    assert r.status_code == 409, r.text
    assert "already active" in r.json()["detail"]


def test_completed_allows_new_investigation():
    incident_id = _seed_incident()
    session = TestingSession()
    done = Investigation(
        incident_id=incident_id,
        status="completed",
        requested_model="m",
        prompt_version="rca-v1",
        result_json="{}",
    )
    session.add(done)
    session.commit()
    session.close()
    r = client.post(f"/api/v1/incidents/{incident_id}/investigations")
    assert r.status_code == 201, r.text
    r = client.get(f"/api/v1/incidents/{incident_id}/investigations")
    assert len(r.json()) == 2


def test_startup_recovery_completes_audit_record(monkeypatch):
    """Interrupted pending/running rows become failed with timestamp + message."""
    import app.main as main_module

    session = TestingSession()
    pending = Investigation(incident_id=_seed_incident(), status="pending", prompt_version="rca-v1")
    running = Investigation(incident_id=_seed_incident(), status="running", prompt_version="rca-v1")
    session.add(pending)
    session.add(running)
    session.commit()
    target_ids = {pending.id, running.id}
    session.close()

    monkeypatch.setattr(main_module, "SessionLocal", TestingSession)
    main_module._recover_interrupted()

    rows = TestingSession().query(Investigation).filter(Investigation.id.in_(target_ids)).all()
    assert len(rows) == 2
    for row in rows:
        assert row.status == "failed"
        assert row.error_code == "interrupted"
        assert row.error_message
        assert row.completed_at is not None


def test_lifespan_enforces_migrations(monkeypatch):
    """The API lifespan uses the same migration gate as the watcher."""
    import asyncio

    import app.db.migrations as migrations
    import app.main as main_module

    calls = []
    monkeypatch.setattr(main_module, "SessionLocal", TestingSession)
    monkeypatch.setattr(migrations, "require_migrated_db", lambda engine: calls.append(engine))
    asyncio.run(_enter_lifespan(main_module))
    assert len(calls) == 1


async def _enter_lifespan(main_module):
    async with main_module.lifespan(main_module.app):
        pass


def test_lifespan_rejects_unmigrated_db(monkeypatch):
    import asyncio

    import app.db.migrations as migrations
    import app.main as main_module

    def _boom(engine):  # noqa: ANN001
        raise SystemExit(2)

    monkeypatch.setattr(main_module, "SessionLocal", TestingSession)
    monkeypatch.setattr(migrations, "require_migrated_db", _boom)
    with pytest.raises(SystemExit):
        asyncio.run(_enter_lifespan(main_module))


def test_integrity_error_maps_to_duplicate():
    """The DB unique index is the race-proof guard: concurrent inserts collide."""

    from sqlalchemy.exc import IntegrityError

    incident_id = _seed_incident()
    session = TestingSession()
    first = Investigation(incident_id=incident_id, status="pending")
    session.add(first)
    session.commit()
    clash = Investigation(incident_id=incident_id, status="pending")
    session.add(clash)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()
    session.close()


def test_concurrent_duplicate_returns_409():
    """Two near-simultaneous triggers: exactly one wins; the other gets 409."""
    import asyncio
    from unittest.mock import patch

    from sqlalchemy.exc import IntegrityError

    from app.services import investigation as svc

    incident_id = _seed_incident()
    calls = {"n": 0}
    session = TestingSession()

    orig_commit = session.commit

    def flaky_commit():
        calls["n"] += 1
        if calls["n"] == 1:
            # Simulate the lost race: the INSERT hits the unique index.
            raise IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed"))
        return orig_commit()

    with patch.object(session, "commit", side_effect=flaky_commit):
        with pytest.raises(Exception) as exc:
            asyncio.run(svc.run_investigation(session, incident_id))
    assert isinstance(exc.value, svc.DuplicateActiveInvestigation) or "already active" in str(
        exc.value
    )
    session.close()


class _FailingProvider:
    async def complete_json(self, system_prompt, user_prompt):
        from app.llm.base import LLMError, LLMErrorCode

        raise LLMError(LLMErrorCode.TIMEOUT, "upstream timed out")


def _failing_pipeline(key):
    from app.agents.graph import build_graph as _build

    return _FailingProvider(), _build(_FailingProvider(), StubRetriever(), 5000)


def test_provider_failure_yields_failed_record():
    """A failing provider produces a failed record (never a fake completed RCA)."""
    import asyncio

    from app.services import investigation as svc

    incident_id = _seed_incident()
    session = TestingSession()
    with pytest.MonkeyPatch().context() as mp:
        mp.setattr(svc, "_get_pipeline", _failing_pipeline)
        record = asyncio.run(svc.run_investigation(session, incident_id))
    assert record.status == "failed"
    assert record.error_code == "timeout"
    assert record.error_message
    assert record.started_at is not None
    assert record.actual_model == ""
    import json as _json

    snapshot = _json.loads(record.evidence_snapshot or "[]")
    assert isinstance(snapshot, list) and len(snapshot) == 1
    assert snapshot[0]["id"] == "E-001"  # evidence preserved despite LLM failure
    session.close()

    r = client.post(f"/api/v1/incidents/{incident_id}/investigations")
    assert r.status_code == 201, r.text  # terminal failure does not block a retry
    session.close()


def test_failed_investigation_returns_502():
    """Provider failure surfaced through the API is a 502, not a fake 201."""
    from app.services import investigation as svc

    incident_id = _seed_incident()
    with pytest.MonkeyPatch().context() as mp:
        mp.setattr(svc, "_get_pipeline", _failing_pipeline)
        r = client.post(f"/api/v1/incidents/{incident_id}/investigations")
    assert r.status_code == 502, r.text
    assert "timeout" in r.json()["detail"]
