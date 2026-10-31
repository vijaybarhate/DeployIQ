"""RAG Agent: retrieve runbooks via the shared Retriever interface (no LLM)."""

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


def rag_agent(state: InvestigationState, retriever: Retriever, top_k: int = 3) -> dict:
    """Retrieve up to top_k runbooks. Empty results are honest, not errors."""
    results = retriever.retrieve(build_query(state), top_k=top_k)
    return {"runbooks": [r.model_dump() for r in results]}
