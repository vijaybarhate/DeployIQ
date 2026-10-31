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
        )
    }


def report_agent(state: InvestigationState) -> dict:
    """Validate the model output; reject invented evidence/runbook references."""
    if state.get("error_code"):
        return _insufficient(state.get("error_message", "investigation failed before reporting"))
    raw = state.get("rca_json")
    if not isinstance(raw, dict):
        return _insufficient("model returned no structured output")
    try:
        report = RCAReport.model_validate(raw)
    except ValidationError as exc:
        return _insufficient(f"model output failed schema validation: {exc.errors()[0]['msg']}")

    valid_evidence = {item.get("id", "") for item in state.get("evidence", [])}
    valid_runbooks = {rb.get("runbook_id", "") for rb in state.get("runbooks", [])}
    for finding in report.findings:
        unknown_ev = [e for e in finding.evidence_ids if e not in valid_evidence]
        if unknown_ev:
            return _insufficient(f"report cites unknown evidence IDs: {unknown_ev}")
        unknown_rb = [r for r in finding.runbook_ids if r not in valid_runbooks]
        if unknown_rb:
            return _insufficient(f"report cites unretrieved runbook IDs: {unknown_rb}")
    return {"rca": report}
