"""RCA report schemas: Pydantic static rules; IDs validated dynamically in Report Agent."""

from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


class DiagnosisStatus(StrEnum):
    DIAGNOSED = "diagnosed"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


class Severity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"
    UNKNOWN = "unknown"


class RiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Finding(BaseModel):
    description: str = Field(min_length=1)
    evidence_ids: list[str] = Field(min_length=1)
    runbook_ids: list[str] = Field(default_factory=list)


class Recommendation(BaseModel):
    title: str = Field(min_length=1)
    steps: list[str] = Field(default_factory=list)
    risk_level: RiskLevel = RiskLevel.LOW
    requires_approval: bool = True


class RCAReport(BaseModel):
    diagnosis_status: DiagnosisStatus
    root_cause: str | None = None
    explanation: str = ""
    severity_assessment: Severity = Severity.UNKNOWN
    confidence_estimate: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence_rationale: str = ""
    findings: list[Finding] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)
    verification_steps: list[str] = Field(default_factory=list)
    limitations: str = ""

    @model_validator(mode="after")
    def _cross_field_rules(self):  # type: ignore[no-untyped-def]
        if self.diagnosis_status == DiagnosisStatus.INSUFFICIENT_EVIDENCE:
            if self.root_cause is not None:
                raise ValueError("root_cause must be null when evidence is insufficient")
            if self.confidence_estimate is not None:
                raise ValueError("confidence_estimate must be null when evidence is insufficient")
            if self.findings:
                raise ValueError("findings must be empty when evidence is insufficient")
            if self.recommendations:
                raise ValueError("recommendations must be empty when evidence is insufficient")
            return self
        if not self.root_cause:
            raise ValueError("root_cause is required when diagnosed")
        return self
