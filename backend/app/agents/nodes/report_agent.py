"""Report Agent: Pydantic gate + dynamic citation validation (no LLM)."""

from pydantic import ValidationError

from app.agents.state import InvestigationState
from app.schemas.investigation import DiagnosisStatus, RCAReport


def _insufficient(reason: str) -> dict:
    return {
        "rca": RCAReport(
            diagnosis_status=DiagnosisStatus.INSUFFICIENT_EVIDENCE,
            root_cause=None,
            explanation="Available evidence is insufficient to establish a root cause.",
            confidence_estimate=None,
            limitations=reason,
        ),
        "report_error": "",
    }


def _failed(reason: str) -> dict:
    return {"rca": None, "report_error": reason}


def report_agent(state: InvestigationState) -> dict:
    """Validate the model output; reject invented evidence/runbook references.

    Provider failures stay failures (failed/validation_failed) — they are
    never disguised as completed insufficient_evidence investigations.
    """
    error_code = state.get("error_code", "")
    if error_code and error_code != "insufficient_evidence":
        return _failed(error_code)
    if error_code == "insufficient_evidence":
        return _insufficient(state.get("error_message", "no usable evidence"))
    raw = state.get("rca_json")
    if not isinstance(raw, dict):
        return _failed("invalid_schema")
    try:
        report = RCAReport.model_validate(raw)
    except ValidationError as exc:
        return _failed(f"invalid_schema: {exc.errors()[0]['msg'][:120]}")
    if report.diagnosis_status == DiagnosisStatus.INSUFFICIENT_EVIDENCE:
        return {"rca": report, "report_error": ""}

    valid_evidence = {item.get("id", "") for item in state.get("evidence", [])}
    valid_runbooks = {rb.get("runbook_id", "") for rb in state.get("runbooks", [])}
    for finding in report.findings:
        unknown_ev = [e for e in finding.evidence_ids if e not in valid_evidence]
        if unknown_ev:
            return _failed(f"invalid_citation: unknown evidence IDs {unknown_ev}")
        unknown_rb = [r for r in finding.runbook_ids if r not in valid_runbooks]
        if unknown_rb:
            return _failed(f"invalid_citation: unretrieved runbook IDs {unknown_rb}")
    return {"rca": report, "report_error": ""}
