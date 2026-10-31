"""LangGraph shared investigation state."""

from typing import TypedDict

from app.schemas.investigation import RCAReport


class EvidenceRef(TypedDict):
    id: str
    kind: str
    summary: str
    detail: str


class InvestigationState(TypedDict, total=False):
    incident_id: str
    project_id: str
    source: str
    title: str
    error_signature: str
    evidence: list[EvidenceRef]
    usable_evidence: bool
    runbooks: list[dict]
    rca_json: dict
    rca: RCAReport
    error_code: str
    error_message: str
    actual_model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    llm_latency_ms: int
