"""Live OpenRouter smoke test: explicit opt-in ONLY. Never runs by default.

    RUN_LIVE_OPENROUTER_TESTS=1 pytest tests/test_openrouter_live.py

Skipped unless every configured model (primary + fallbacks) is a free
variant (OpenRouter ':free' suffix convention). Never prints the API key.
"""

import os

import pytest

from app.config import get_settings

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE_OPENROUTER_TESTS") != "1",
    reason="live OpenRouter test requires explicit opt-in",
)


def _configured_models_free(models: list[str]) -> bool:
    """Confirm every configured model is zero-priced via the public catalog.

    No hardcoded model IDs: the check reads OpenRouter's own pricing metadata.
    Any failure (network, unknown model, non-zero price) means 'not confirmed'.
    """
    import httpx

    if not models:
        return False
    if all(m.endswith(":free") for m in models):
        return True
    try:
        response = httpx.get("https://openrouter.ai/api/v1/models", timeout=15.0)
        catalog = {m["id"]: m for m in response.json().get("data", [])}
    except Exception:
        return False
    for model in models:
        entry = catalog.get(model)
        if not entry or entry.get("pricing", {}).get("prompt") != "0":
            return False
    return True


def test_live_free_model_routing():
    import asyncio

    from app.llm.openrouter import OpenRouterProvider

    settings = get_settings()
    models = [settings.openrouter_model, *settings.fallback_model_list]
    assert _configured_models_free(models), (
        "live test runs only when ALL configured models are confirmed free"
    )
    assert settings.openrouter_api_key, "OPENROUTER_API_KEY must be configured"

    async def go():
        provider = OpenRouterProvider(
            api_key=settings.openrouter_api_key,
            model=settings.openrouter_model,
            fallback_models=settings.fallback_model_list,
        )
        completion = await provider.complete_json(
            "Respond with a single valid JSON object only.",
            'Return {"diagnosis_status": "insufficient_evidence"} verbatim as JSON.',
        )
        return completion

    completion = asyncio.run(go())
    assert completion.parsed["diagnosis_status"] == "insufficient_evidence"
    assert completion.actual_model
    assert completion.latency_ms >= 0
