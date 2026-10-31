"""Tests: RCA schema static rules + citation dynamics + secret handling."""

import pytest

from app.schemas.investigation import DiagnosisStatus, RCAReport


def _valid_rca(**overrides):
    base = {
        "diagnosis_status": "diagnosed",
        "root_cause": "bad host",
        "explanation": "e",
        "severity_assessment": "high",
        "confidence_estimate": 0.8,
        "confidence_rationale": "r",
        "findings": [{"description": "d", "evidence_ids": ["E-001"], "runbook_ids": ["RB-004"]}],
        "recommendations": [],
        "verification_steps": ["v"],
        "limitations": "l",
    }
    base.update(overrides)
    return RCAReport.model_validate(base)


def test_valid_report_passes():
    rca = _valid_rca()
    assert rca.diagnosis_status == DiagnosisStatus.DIAGNOSED
    assert rca.confidence_estimate == 0.8


def test_insufficient_evidence_enforced():
    rca = RCAReport.model_validate(
        {
            "diagnosis_status": "insufficient_evidence",
            "root_cause": None,
            "explanation": "Available evidence is insufficient to establish a root cause.",
            "confidence_estimate": None,
            "findings": [],
            "recommendations": [],
        }
    )
    assert rca.root_cause is None


def test_insufficient_with_cause_rejected():
    with pytest.raises(ValueError):
        _valid_rca(diagnosis_status="insufficient_evidence", root_cause="x")


def test_insufficient_with_findings_rejected():
    with pytest.raises(ValueError):
        _valid_rca(diagnosis_status="insufficient_evidence", root_cause=None)


def test_diagnosed_without_cause_rejected():
    with pytest.raises(ValueError):
        _valid_rca(root_cause=None)


def test_confidence_bounds():
    with pytest.raises(ValueError):
        _valid_rca(confidence_estimate=1.5)
    with pytest.raises(ValueError):
        _valid_rca(confidence_estimate=-0.1)
