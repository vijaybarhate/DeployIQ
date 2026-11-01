"""Tests: full graph with a stub LLM (no network)."""

import asyncio

from app.agents.graph import build_graph
from app.llm.base import LLMCompletion, LLMProvider, TokenUsage
from app.rag.schemas import RetrievalResult


class StubProvider(LLMProvider):
    def __init__(self, parsed):
        self._parsed = parsed
        self.calls = 0

    async def complete_json(self, system_prompt, user_prompt):
        self.calls += 1
        assert "untrusted" in system_prompt.lower()
        return LLMCompletion(
            parsed=self._parsed,
            actual_model="stub/model:free",
            usage=TokenUsage(10, 5, 15),
            latency_ms=3,
        )


class StubRetriever:
    def __init__(self):
        self.calls = 0

    def retrieve(self, query, top_k=3):
        self.calls += 1
        assert query  # query built from incident fields
        return [
            RetrievalResult(
                runbook_id="RB-007",
                title="HTTP 500",
                relevance_score=9.0,
                matched_sections=["Symptoms"],
                source_urls=["https://docs.docker.com/x"],
            )
        ]

    def get(self, runbook_id):
        from app.rag.schemas import Runbook

        assert runbook_id == "RB-007"
        return Runbook(
            runbook_id="RB-007",
            title="HTTP 500",
            technology="app",
            symptoms="500 errors",
            causes="bug",
            diagnostics="read logs",
            remediation="fix code",
            verification="rerun",
            risk="low",
            sources=["https://docs.docker.com/x"],
            raw_text="HTTP 500",
        )


def _initial():
    return {
        "incident_id": "i1",
        "project_id": "demo",
        "source": "docker",
        "title": "ZeroDivisionError: division by zero",
        "error_signature": "docker|demo|exception|zerodivisionerror",
        "evidence": [
            {"id": "E-001", "kind": "exception", "summary": "ZeroDivisionError", "detail": ""}
        ],
    }


def test_graph_diagnoses_with_single_llm_call():
    parsed = {
        "diagnosis_status": "diagnosed",
        "root_cause": "division by zero",
        "explanation": "e",
        "severity_assessment": "medium",
        "confidence_estimate": 0.85,
        "confidence_rationale": "r",
        "findings": [{"description": "d", "evidence_ids": ["E-001"], "runbook_ids": ["RB-007"]}],
        "recommendations": [
            {"title": "t", "steps": ["s"], "risk_level": "low", "requires_approval": True}
        ],
        "verification_steps": ["v"],
        "limitations": "",
    }
    provider = StubProvider(parsed)
    retriever = StubRetriever()
    graph = build_graph(provider, retriever, max_input_chars=5000)
    final = asyncio.run(graph.ainvoke(_initial()))
    assert provider.calls == 1  # exactly one LLM call
    assert retriever.calls == 1
    assert final["rca"].root_cause == "division by zero"
    assert final["actual_model"] == "stub/model:free"
    assert final["total_tokens"] == 15


def test_graph_abstains_without_usable_evidence():
    provider = StubProvider({})
    retriever = StubRetriever()
    graph = build_graph(provider, retriever, max_input_chars=5000)
    state = _initial()
    state["evidence"] = []
    state["title"] = "nothing"
    state["error_signature"] = ""
    final = asyncio.run(graph.ainvoke(state))
    assert provider.calls == 0  # LLM skipped, credits protected
    assert final["rca"].diagnosis_status.value == "insufficient_evidence"
    assert final["error_code"] == "insufficient_evidence"


def test_graph_rejects_fabricated_ids():
    parsed = {
        "diagnosis_status": "diagnosed",
        "root_cause": "x",
        "explanation": "e",
        "severity_assessment": "high",
        "confidence_estimate": 0.9,
        "confidence_rationale": "r",
        "findings": [{"description": "d", "evidence_ids": ["E-007"], "runbook_ids": ["RB-007"]}],
        "recommendations": [],
        "verification_steps": [],
        "limitations": "",
    }
    provider = StubProvider(parsed)
    graph = build_graph(provider, StubRetriever(), max_input_chars=5000)
    final = asyncio.run(graph.ainvoke(_initial()))
    assert final["rca"] is None
    assert final["report_error"].startswith("invalid_citation")
