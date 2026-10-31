"""Tests: runbook validation + BM25 retrieval (M3.1 acceptance)."""

import json
from pathlib import Path

import pytest

from app.rag.retriever import BM25Retriever, load_runbooks

RUNBOOK_DIR = Path(__file__).resolve().parent.parent / "app" / "rag" / "runbooks"
EVAL_PATH = Path(__file__).resolve().parent / "data" / "retrieval_eval.json"


@pytest.fixture(scope="module")
def retriever():
    runbooks = load_runbooks(RUNBOOK_DIR)
    assert len(runbooks) == 9
    return BM25Retriever(runbooks)


def test_all_runbooks_parse_and_cite_official_docs(retriever):
    for rb_id in [f"RB-{i:03d}" for i in range(1, 10)]:
        rb = retriever.get(rb_id)
        assert rb.title and rb.symptoms and rb.causes
        assert rb.diagnostics and rb.remediation and rb.verification
        assert rb.sources, f"{rb_id} has no sources"
        assert all(s.startswith("https://docs.docker.com/") for s in rb.sources), rb.sources


def test_unknown_runbook_id_rejected(retriever):
    with pytest.raises(KeyError):
        retriever.get("RB-999")


def _top_id(retriever, query):
    results = retriever.retrieve(query, top_k=3)
    assert results, f"no results for: {query}"
    return results[0].runbook_id, results


def test_acceptance_oom(retriever):
    top, _ = _top_id(retriever, "container OOMKilled, Exited 137, kernel killed process")
    assert top == "RB-005"


def test_acceptance_missing_env(retriever):
    top, _ = _top_id(retriever, "KeyError: DATABASE_URL, missing environment variable on boot")
    assert top == "RB-002"


def test_acceptance_db_refused(retriever):
    top, _ = _top_id(
        retriever, "could not connect to server: connection refused, postgres unreachable"
    )
    assert top == "RB-004"


def test_acceptance_port_conflict(retriever):
    top, _ = _top_id(retriever, "Bind for 0.0.0.0:5432 failed: port is already allocated")
    assert top == "RB-003"


def test_acceptance_http500_traceback(retriever):
    top, results = _top_id(
        retriever, "Traceback ZeroDivisionError: division by zero, HTTP 500, container stays up"
    )
    assert top == "RB-007"
    assert results[0].matched_sections, "expected matched sections"
    assert results[0].source_urls, "expected source URLs"


def test_irrelevant_query_returns_nothing(retriever):
    assert retriever.retrieve("how to bake sourdough bread starter hydration", top_k=3) == []
    assert retriever.retrieve("", top_k=3) == []
    assert retriever.retrieve("the and or", top_k=3) == []


def test_repeated_query_is_deterministic(retriever):
    first = [r.runbook_id for r in retriever.retrieve("OOMKilled exit 137", top_k=3)]
    second = [r.runbook_id for r in retriever.retrieve("OOMKilled exit 137", top_k=3)]
    assert first == second and first[0] == "RB-005"


def test_eval_precision_recall_at_3(retriever):
    cases = json.loads(EVAL_PATH.read_text(encoding="utf-8"))
    assert len(cases) >= 20, "eval dataset must hold 20-30 labelled queries"
    hits_at_1 = 0
    hits_at_3 = 0
    for case in cases:
        ids = [r.runbook_id for r in retriever.retrieve(case["query"], top_k=3)]
        if ids[:1] == [case["expected"]]:
            hits_at_1 += 1
        if case["expected"] in ids:
            hits_at_3 += 1
    precision_at_3 = hits_at_3 / len(cases)  # single relevant doc => P@3 == R@3 here
    precision_at_1 = hits_at_1 / len(cases)
    print(f"\neval: {len(cases)} queries, P@1={precision_at_1:.2f}, P@3=R@3={precision_at_3:.2f}")
    assert precision_at_3 >= 0.80, f"P@3 {precision_at_3:.2f} below bar"
