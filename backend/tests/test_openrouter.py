"""Tests: OpenRouter provider with mocked HTTPX transport (no network, no credits)."""

import asyncio
import json as jsonlib

import httpx
import pytest

from app.llm.base import LLMError, LLMErrorCode
from app.llm.openrouter import OpenRouterProvider

PAYLOAD = {
    "diagnosis_status": "diagnosed",
    "root_cause": "x",
    "explanation": "y",
    "severity_assessment": "high",
    "confidence_estimate": 0.9,
    "confidence_rationale": "z",
    "findings": [],
    "recommendations": [],
    "verification_steps": [],
    "limitations": "",
}


def _await(coro):
    return asyncio.run(coro)


def _ok_response(request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "model": "vendor/model:free",
            "choices": [{"message": {"content": PAYLOAD | {"root_cause": "db down"}}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        },
    )


def _provider(transport, model="vendor/model:free", fallbacks=None):
    return OpenRouterProvider(
        api_key="test-key",
        model=model,
        fallback_models=fallbacks,
        transport=transport,
    )


def test_success_records_model_usage_latency():
    completion = _await(
        _provider(httpx.MockTransport(_ok_response)).complete_json("system", "user")
    )
    assert completion.parsed["root_cause"] == "db down"
    assert completion.actual_model == "vendor/model:free"
    assert completion.usage.total_tokens == 15
    assert completion.latency_ms >= 0


def test_missing_key_rejected_without_request():
    with pytest.raises(LLMError) as exc:
        OpenRouterProvider(api_key="", model="m")
    assert exc.value.code == LLMErrorCode.AUTH


@pytest.mark.parametrize(
    ("status", "code"),
    [(401, LLMErrorCode.AUTH), (402, LLMErrorCode.AUTH), (429, LLMErrorCode.RATE_LIMITED)],
)
def test_auth_rate_statuses(status, code):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={})

    with pytest.raises(LLMError) as exc:
        _await(_provider(httpx.MockTransport(handler)).complete_json("s", "u"))
    assert exc.value.code == code


def test_server_error_no_retry():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(500, json={})

    with pytest.raises(LLMError) as exc:
        _await(_provider(httpx.MockTransport(handler)).complete_json("s", "u"))
    assert exc.value.code == LLMErrorCode.SERVER
    assert len(calls) == 1  # exactly one request, no silent retries


def test_timeout_maps_to_timeout_code():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow", request=request)

    with pytest.raises(LLMError) as exc:
        _await(_provider(httpx.MockTransport(handler)).complete_json("s", "u"))
    assert exc.value.code == LLMErrorCode.TIMEOUT


def test_malformed_json_rejected():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": "not json{"}}]})

    with pytest.raises(LLMError) as exc:
        _await(_provider(httpx.MockTransport(handler)).complete_json("s", "u"))
    assert exc.value.code == LLMErrorCode.INVALID_RESPONSE


def test_json_mode_rejection_retries_once_with_prompting():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = jsonlib.loads(request.content.decode())
        calls.append(body)
        if body.get("response_format"):
            return httpx.Response(400, json={"error": {"message": "response_format unsupported"}})
        return _ok_response(request)

    completion = _await(_provider(httpx.MockTransport(handler)).complete_json("s", "u"))
    assert len(calls) == 2  # initial + single compatibility retry
    assert "response_format" not in calls[1]
    assert completion.parsed["root_cause"] == "db down"


def test_empty_content_retries_once_without_json_mode():
    """Reasoning-style free models may accept json_object yet return null content."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = jsonlib.loads(request.content.decode())
        calls.append(body)
        if body.get("response_format"):
            return httpx.Response(
                200, json={"model": "m:free", "choices": [{"message": {"content": None}}]}
            )
        return _ok_response(request)

    completion = _await(_provider(httpx.MockTransport(handler)).complete_json("s", "u"))
    assert len(calls) == 2
    assert "response_format" not in calls[1]
    assert completion.parsed["root_cause"] == "db down"


def test_garbled_json_does_not_retry():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "{oops"}}]})

    with pytest.raises(LLMError) as exc:
        _await(_provider(httpx.MockTransport(handler)).complete_json("s", "u"))
    assert exc.value.code == LLMErrorCode.INVALID_RESPONSE
    assert len(calls) == 1  # genuinely malformed output: no retry, fail fast


def test_error_carries_model_and_usage():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "model": "m:free",
                "usage": {"prompt_tokens": 3, "completion_tokens": 0, "total_tokens": 3},
                "choices": [{"message": {"content": None}}],
            },
        )

    with pytest.raises(LLMError) as exc:
        _await(_provider(httpx.MockTransport(handler)).complete_json("s", "u"))
    assert exc.value.model == "m:free"
    assert exc.value.usage.total_tokens == 3


def test_fallback_models_sent_in_order():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(jsonlib.loads(request.content.decode())["models"])
        return _ok_response(request)

    _await(
        _provider(httpx.MockTransport(handler), model="a:free", fallbacks=["b:free"]).complete_json(
            "s", "u"
        )
    )
    assert seen[0] == ["a:free", "b:free"]
