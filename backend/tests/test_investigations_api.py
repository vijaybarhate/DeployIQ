"""Tests: investigation service + API with stubbed LLM/RAG (no network)."""

import os
import uuid

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_investigations.db")
os.environ.setdefault("MONITORED_PROJECTS", "demo")

from datetime import UTC, datetime  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.agents.graph import build_graph  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.models import incident as _incident  # noqa: F401,E402 (register model)
from app.db.models import investigation as _investigation  # noqa: F401,E402 (register model)
from app.db.models.incident import Incident  # noqa: E402
from app.db.models.investigation import Investigation  # noqa: E402
from app.db.session import get_session  # noqa: E402
from app.llm.base import LLMCompletion, LLMProvider, TokenUsage  # noqa: E402
from app.main import app  # noqa: E402
from app.rag.schemas import RetrievalResult  # noqa: E402
from app.services import investigation as investigation_service  # noqa: E402

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
        return [
            RetrievalResult(
                runbook_id="RB-007",
                title="HTTP 500",
                relevance_score=9.0,
                matched_sections=["Symptoms"],
                source_urls=["https://docs.docker.com/x"],
            )
        ]

    def get(self, runbook_id):
        raise KeyError(runbook_id)


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

investigation_service.get_retriever = lambda: StubRetriever()

import app.services.investigation as _svc  # noqa: E402

_orig_build_graph = build_graph


def _stubbed_build_graph(provider, retriever, max_input_chars):
    return _orig_build_graph(StubProvider(), StubRetriever(), max_input_chars)


_svc.build_graph = _stubbed_build_graph


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

    r = client.get(f"/api/v1/incidents/{incident_id}/investigations")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_unknown_incident_404():
    r = client.post(f"/api/v1/incidents/{uuid.uuid4()}/investigations")
    assert r.status_code == 404


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
