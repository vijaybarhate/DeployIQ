"""BM25 runbook retrieval behind a replaceable interface.

The `Retriever` protocol is the seam: a future pgvector/embedding retriever
implements the same method and nothing upstream changes. Scores are BM25
relevance weights — never presented as probabilities.
"""

import re
from pathlib import Path
from typing import Protocol

from rank_bm25 import BM25Okapi

from app.rag.schemas import RetrievalResult, Runbook
from app.rag.tokenizer import tokenize

_SECTION_RE = re.compile(r"^##\s+(.+)$", re.MULTILINE)
_FIELD_RE = re.compile(r"^-\s+\*\*(.+?):\*\*\s*(.*)$", re.MULTILINE)

REQUIRED_SECTIONS = ("Symptoms", "Possible causes", "Diagnostic steps", "Verified remediation")


class Retriever(Protocol):
    def retrieve(self, query: str, top_k: int = 3) -> list[RetrievalResult]:
        """Return up to top_k runbooks ranked by relevance (empty if none pass)."""
        ...

    def get(self, runbook_id: str) -> Runbook:
        """Return one runbook by ID or raise KeyError."""
        ...


def parse_runbook(path: Path) -> Runbook:
    """Parse our fixed runbook markdown structure (strict: missing parts raise)."""
    text = path.read_text(encoding="utf-8")
    fields = dict(_FIELD_RE.findall(text))
    sections = dict((m.group(1).strip(), "") for m in _SECTION_RE.finditer(text))
    # Fill section bodies: split on ## headers, keep content per header.
    parts = _SECTION_RE.split(text)
    for i in range(1, len(parts) - 1, 2):
        sections[parts[i].strip()] = parts[i + 1].strip()
    missing = [s for s in REQUIRED_SECTIONS if not sections.get(s)]
    if missing:
        raise ValueError(f"{path.name}: missing sections: {missing}")
    sources: list[str] = []
    for name, body in sections.items():
        if name.lower().startswith("source references"):
            for url in re.findall(r"https?://\S+", body):
                sources.append(url.rstrip(").,"))
    if not sources:
        raise ValueError(f"{path.name}: no source URLs")
    return Runbook(
        runbook_id=fields.get("Runbook ID", "").strip(),
        title=fields.get("Title", "").strip(),
        technology=fields.get("Affected technology", "").strip(),
        symptoms=sections.get("Symptoms", ""),
        causes=sections.get("Possible causes", ""),
        diagnostics=sections.get("Diagnostic steps", ""),
        remediation=sections.get("Verified remediation", ""),
        verification=sections.get("Verification steps", ""),
        risk=fields.get("Risk level", "").strip(),
        sources=sources,
        raw_text=text,
    )


def load_runbooks(directory: str | Path) -> list[Runbook]:
    paths = sorted(Path(directory).glob("RB-*.md"))
    if not paths:
        raise FileNotFoundError(f"no runbooks in {directory}")
    return [parse_runbook(p) for p in paths]


class BM25Retriever:
    """Ranked keyword retrieval. Deterministic for a fixed corpus and query."""

    def __init__(
        self,
        runbooks: list[Runbook],
        min_score: float = 0.5,
        title_weight: int = 3,
        symptoms_weight: int = 2,
    ) -> None:
        if not runbooks:
            raise ValueError("BM25Retriever needs at least one runbook")
        self._runbooks = {rb.runbook_id: rb for rb in runbooks}
        self._min_score = min_score
        corpus = [self._doc_tokens(rb, title_weight, symptoms_weight) for rb in runbooks]
        self._ids = [rb.runbook_id for rb in runbooks]
        self._bm25 = BM25Okapi(corpus)

    @staticmethod
    def _doc_tokens(rb: Runbook, title_weight: int, symptoms_weight: int) -> list[str]:
        tokens = tokenize(rb.raw_text)
        tokens += tokenize(rb.title) * title_weight
        tokens += tokenize(rb.symptoms) * symptoms_weight
        return tokens

    def get(self, runbook_id: str) -> Runbook:
        try:
            return self._runbooks[runbook_id]
        except KeyError:
            raise KeyError(f"unknown runbook: {runbook_id}") from None

    def retrieve(self, query: str, top_k: int = 3) -> list[RetrievalResult]:
        query_tokens = tokenize(query)
        if not query_tokens:
            return []
        scores = self._bm25.get_scores(query_tokens)
        ranked = sorted(zip(self._ids, scores, strict=True), key=lambda pair: pair[1], reverse=True)
        results: list[RetrievalResult] = []
        for runbook_id, score in ranked[: max(top_k, 0)]:
            if score < self._min_score:
                continue
            rb = self._runbooks[runbook_id]
            results.append(
                RetrievalResult(
                    runbook_id=runbook_id,
                    title=rb.title,
                    relevance_score=round(float(score), 4),
                    matched_sections=self._matched_sections(rb, set(query_tokens)),
                    source_urls=rb.sources,
                )
            )
        return results

    @staticmethod
    def _matched_sections(rb: Runbook, query_terms: set[str]) -> list[str]:
        matched = []
        for name, body in (
            ("Symptoms", rb.symptoms),
            ("Possible causes", rb.causes),
            ("Diagnostic steps", rb.diagnostics),
            ("Verified remediation", rb.remediation),
        ):
            if query_terms & set(tokenize(body)):
                matched.append(name)
        return matched
