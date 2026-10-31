"""RAG schemas: runbooks and retrieval results."""

from pydantic import BaseModel, Field


class Runbook(BaseModel):
    runbook_id: str = Field(pattern=r"^RB-\d{3}$")
    title: str = Field(min_length=1)
    technology: str = ""
    symptoms: str = ""
    causes: str = ""
    diagnostics: str = ""
    remediation: str = ""
    verification: str = ""
    risk: str = ""
    sources: list[str] = Field(default_factory=list)
    raw_text: str = ""


class RetrievalResult(BaseModel):
    runbook_id: str
    title: str
    relevance_score: float = Field(ge=0.0)
    matched_sections: list[str] = Field(default_factory=list)
    source_urls: list[str] = Field(default_factory=list)
