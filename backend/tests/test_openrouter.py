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


def _keyed_provider(keys, handler):
    OpenRouterProvider.reset_key_rotation()
    return OpenRouterProvider(
        api_key=keys, model="vendor/model:free", transport=httpx.MockTransport(handler)
    )


def _key_of(request: httpx.Request) -> str:
    auth = request.headers.get("Authorization", "")
    return auth[7:] if auth.startswith("Bearer ") else ""


def test_key_failover_on_rate_limit():
    """A 429 on the first key fails over to the next; verdict still succeeds."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        key = _key_of(request)
        seen.append(key)
        if key == "k1":
            return httpx.Response(429, json={})
        return _ok_response(request)

    completion = _await(_keyed_provider(["k1", "k2"], handler).complete_json("s", "u"))
    assert completion.parsed["root_cause"] == "db down"
    assert seen == ["k1", "k2"]


def test_dead_key_skipped_with_401():
    """An invalid key (401) is skipped, not fatal."""

    def handler(request: httpx.Request) -> httpx.Response:
        if _key_of(request) == "k1":
            return httpx.Response(401, json={})
        return _ok_response(request)

    completion = _await(_keyed_provider(["k1", "k2"], handler).complete_json("s", "u"))
    assert completion.parsed["root_cause"] == "db down"


def test_all_keys_exhausted_reports_count():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={})

    with pytest.raises(LLMError) as exc:
        _await(_keyed_provider(["k1", "k2"], handler).complete_json("s", "u"))
    assert exc.value.code == LLMErrorCode.RATE_LIMITED
    assert "all 2 keys" in str(exc.value)


def test_no_failover_on_billing_or_timeout():
    """402 and timeouts fail fast instead of burning every key."""

    def billing(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={})

    with pytest.raises(LLMError) as exc:
        _await(_keyed_provider(["k1", "k2"], billing).complete_json("s", "u"))
    assert exc.value.code == LLMErrorCode.AUTH

    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow", request=request)

    with pytest.raises(LLMError) as exc:
        _await(_keyed_provider(["k1", "k2"], slow).complete_json("s", "u"))
    assert exc.value.code == LLMErrorCode.TIMEOUT


def test_round_robin_spreads_load_across_keys():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(_key_of(request))
        return _ok_response(request)

    OpenRouterProvider.reset_key_rotation()
    for _ in range(3):
        provider = OpenRouterProvider(
            api_key=["k1", "k2", "k3"],
            model="vendor/model:free",
            transport=httpx.MockTransport(handler),
        )
        _await(provider.complete_json("s", "u"))
    assert seen == ["k1", "k2", "k3"]


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
    assert exc.value.usage.total_tokens == 6  # 3 + 3 across both attempts
    assert "first attempt used 3 tokens" in str(exc.value)


def test_non_free_model_rejected_before_request():
    """Free-only policy: paid-looking IDs never reach the network."""
    from app.llm.base import LLMError, LLMErrorCode
    from app.llm.openrouter import OpenRouterProvider

    for bad in ["anthropic/claude-sonnet-4", "openrouter/auto", "vendor/model"]:
        with pytest.raises(LLMError) as exc:
            OpenRouterProvider(api_key="k", model=bad)
        assert exc.value.code == LLMErrorCode.POLICY
    # Documented free routes pass validation (no request made here).
    OpenRouterProvider(api_key="k", model="openrouter/free")
    OpenRouterProvider(api_key="k", model="x/y:free", fallback_models=["z/w:free"])


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
