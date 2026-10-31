"""RAG Agent: retrieve runbooks AND their full diagnostic content (no LLM)."""

from app.agents.state import InvestigationState
from app.rag.retriever import Retriever


def build_query(state: InvestigationState) -> str:
    parts = [
        state.get("title", ""),
        state.get("error_signature", ""),
    ]
    for item in state.get("evidence", []):
        summary = str(item.get("summary", ""))
        if summary and summary not in parts:
            parts.append(summary)
    return " ".join(p for p in parts if p)[:1000]


def _sections_for(rb, matched: list[str]) -> dict:
    body = {
        "Symptoms": rb.symptoms,
        "Possible causes": rb.causes,
        "Diagnostic steps": rb.diagnostics,
        "Verified remediation": rb.remediation,
        "Verification steps": rb.verification,
    }
    wanted = [s for s in matched if s in body] or ["Symptoms", "Possible causes"]
    return {name: body[name][:1500] for name in wanted if body.get(name)}


def rag_agent(state: InvestigationState, retriever: Retriever, top_k: int = 3) -> dict:
    """Retrieve top runbooks plus the full diagnostic sections the model needs.

    BM25 retrieve() returns only metadata, so each hit is expanded with
    .get(runbook_id). Anything unresolvable is dropped, never fabricated.
    """
    results = retriever.retrieve(build_query(state), top_k=top_k)
    runbooks = []
    sections = {}
    for result in results:
        try:
            full = retriever.get(result.runbook_id)
        except KeyError:
            continue
        runbooks.append(result.model_dump())
        sections[result.runbook_id] = {
            "title": full.title,
            "sections": _sections_for(full, list(result.matched_sections)),
            "source_urls": list(full.sources),
        }
    return {"runbooks": runbooks, "runbook_sections": sections}
