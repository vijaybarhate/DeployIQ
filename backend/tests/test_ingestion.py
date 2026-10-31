"""Tests: ingestion service — dedup, scope enforcement, severity."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.models import incident as _incident  # noqa: F401 (register model)
from app.db.models.incident import Incident
from app.schemas.incident import EvidenceItem, IncidentSource
from app.services.ingestion import OutOfScopeError, ingest_event

ALLOW = ["demo"]


@pytest.fixture
def session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    try:
        yield s
    finally:
        s.close()


def _ingest(session, project="demo", detail="ZeroDivisionError: division by zero"):
    return ingest_event(
        session,
        source=IncidentSource.DOCKER,
        project_id=project,
        category="exception",
        detail=detail,
        raw_logs="Traceback ... ZeroDivisionError: division by zero",
        evidence=[EvidenceItem(kind="traceback", summary="ZeroDivisionError")],
        allowlist=ALLOW,
    )


def test_ingest_creates_incident(session):
    inc, created = _ingest(session)
    assert created is True
    assert inc.observation_count == 1
    assert inc.status == "open"
    assert inc.severity == "medium"


def test_repeat_events_deduplicate(session):
    for _ in range(5):
        inc, created = _ingest(session)
    assert created is False
    assert inc.observation_count == 5
    assert session.query(Incident).count() == 1
    # Escalation: repeated exceptions become high severity.
    assert inc.severity == "high"


def test_different_errors_are_separate_incidents(session):
    _ingest(session, detail="ZeroDivisionError: division by zero")
    _ingest(session, detail="KeyError: 'user_id'")
    assert session.query(Incident).count() == 2


def test_out_of_scope_project_rejected(session):
    with pytest.raises(OutOfScopeError):
        _ingest(session, project="evil-project")


def test_empty_allowlist_rejects_everything(session):
    with pytest.raises(OutOfScopeError):
        ingest_event(
            session,
            source=IncidentSource.DOCKER,
            project_id="demo",
            category="exception",
            detail="boom",
            allowlist=[],
        )
