"""Investigation graph: START -> evidence -> rag -> root_cause -> report -> END.

Compiled once at import and reused; per-investigation state stays isolated
because each ainvoke() call receives a fresh state dict.
"""

from functools import partial

from langgraph.graph import END, START, StateGraph

from app.agents.nodes import evidence_agent, rag_agent, report_agent, root_cause_agent
from app.agents.state import InvestigationState
from app.llm.base import LLMProvider
from app.rag.retriever import Retriever


def build_graph(provider: LLMProvider, retriever: Retriever, max_input_chars: int):  # type: ignore[no-untyped-def]
    graph = StateGraph(InvestigationState)
    graph.add_node("evidence", evidence_agent.evidence_agent)
    graph.add_node("rag", partial(rag_agent.rag_agent, retriever=retriever))
    graph.add_node(
        "root_cause",
        partial(
            root_cause_agent.root_cause_agent, provider=provider, max_input_chars=max_input_chars
        ),
    )
    graph.add_node("report", report_agent.report_agent)
    graph.add_edge(START, "evidence")
    graph.add_edge("evidence", "rag")
    graph.add_edge("rag", "root_cause")
    graph.add_edge("root_cause", "report")
    graph.add_edge("report", END)
    return graph.compile()
