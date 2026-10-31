"""Deterministic tokenizer for BM25 retrieval (no ML, no downloads)."""

import re

_TOKEN_RE = re.compile(r"[a-z0-9]+")

# Small stopword list. Domain terms (error, failed, killed, unhealthy,
# refused, timeout) are deliberately KEPT — they carry retrieval signal.
STOPWORDS = frozenset(
    {
        "the",
        "a",
        "an",
        "and",
        "or",
        "of",
        "to",
        "in",
        "on",
        "for",
        "with",
        "is",
        "are",
        "was",
        "be",
        "by",
        "as",
        "at",
        "from",
        "that",
        "this",
        "it",
        "its",
        "you",
        "your",
        "we",
        "our",
        "can",
        "will",
        "may",
        "not",
        "no",
        "if",
        "then",
        "than",
        "so",
        "such",
        "into",
        "out",
        "up",
        "do",
        "does",
        "did",
        "how",
        "what",
        "why",
        "when",
        "which",
        "see",
        "also",
        "only",
        "both",
        "each",
        "using",
        "used",
        "use",
        "via",
    }
)


def tokenize(text: str) -> list[str]:
    """Lowercase alphanumeric tokens, length >= 2, minus stopwords."""
    return [t for t in _TOKEN_RE.findall(text.lower()) if len(t) >= 2 and t not in STOPWORDS]
