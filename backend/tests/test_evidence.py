"""Tests: deterministic evidence extraction + normalization."""

from app.evidence.extractor import extract_evidence
from app.evidence.normalizer import build_signature, classify_severity, normalize_signature

TRACEBACK_LOG = """Traceback (most recent call last):
  File "/code/app.py", line 42, in boom
    1 / 0
  File "/code/app.py", line 17, in handler
    boom()
ZeroDivisionError: division by zero
"""

OOM_LOG = "Memory cgroup out of memory: Killed process 1234 (python) score 999"


def test_extract_traceback():
    ev = extract_evidence(TRACEBACK_LOG)
    assert ev["category"] == "exception"
    assert ev["has_traceback"] is True
    assert ev["exception_type"] == "ZeroDivisionError"
    assert "division by zero" in ev["exception_message"]
    assert "app.py" in ev["last_frame"]
    assert ev["last_frame"].endswith("in handler")


def test_extract_oom():
    ev = extract_evidence(OOM_LOG)
    assert ev["oom"] is True
    assert ev["category"] == "oom"


def test_extract_unknown():
    ev = extract_evidence("server started on port 8000\nlistening…")
    assert ev["category"] == "unknown"


def test_signature_normalization_collapses_volatile_tokens():
    a = normalize_signature("ZeroDivisionError at 0x7f8a1c from 172.18.0.4:8000 pid 1234")
    b = normalize_signature("ZeroDivisionError at 0x9b11de from 172.18.0.9:8001 pid 5678")
    assert a == b


def test_signature_preserves_short_numbers():
    # HTTP 404 vs 500 are different failures and must not dedup together.
    assert normalize_signature("HTTP error 404") != normalize_signature("HTTP error 500")


def test_build_signature_scoped():
    a = build_signature("docker", "demo", "exception", "ZeroDivisionError")
    b = build_signature("docker", "other", "exception", "ZeroDivisionError")
    assert a != b


def test_severity_rules():
    assert classify_severity("oom") == "high"
    assert classify_severity("exception", 1) == "medium"
    assert classify_severity("exception", 5) == "high"
    assert classify_severity("unknown") == "low"
