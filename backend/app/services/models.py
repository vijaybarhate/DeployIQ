"""Free-model catalog for the console engine picker (OpenRouter, cached)."""

import time

import httpx

from app.config import get_settings
from app.core.logging import get_logger
from app.llm.base import is_free_model

log = get_logger(__name__)

# Fallback when the catalog fetch fails: the documented free router only.
STATIC_FALLBACK = [{"id": "openrouter/free", "name": "OpenRouter Free Router"}]

_CACHE_TTL_SECONDS = 600.0
_cache: dict = {"at": 0.0, "items": []}


def clear_catalog_cache() -> None:
    _cache["at"] = 0.0
    _cache["items"] = []


async def fetch_catalog(base_url: str, api_key: str) -> list[dict]:
    """Fetch the raw OpenRouter model catalog (raises on transport/auth errors)."""
    url = base_url.rstrip("/") + "/models"
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
        response = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
        response.raise_for_status()
        body = response.json()
    raw = body.get("data", []) if isinstance(body, dict) else []
    items = []
    for entry in raw:
        model_id = str(entry.get("id", ""))
        name = str(entry.get("name", "") or model_id)
        items.append({"id": model_id, "name": name})
    return items


def _only_free(entries: list[dict]) -> list[dict]:
    """Keep explicit free models only, sorted by id."""
    kept = [e for e in entries if is_free_model(str(e.get("id", "")))]
    kept.sort(key=lambda e: str(e.get("id", "")))
    return kept


async def list_free_models() -> list[dict]:
    """Cached free-model catalog; static fallback keeps the UI usable offline."""
    now = time.monotonic()
    if _cache["items"] and now - _cache["at"] < _CACHE_TTL_SECONDS:
        return [dict(e) for e in _cache["items"]]
    settings = get_settings()
    try:
        if not settings.openrouter_api_key:
            raise RuntimeError("missing OpenRouter API key")
        items = _only_free(
            await fetch_catalog(settings.openrouter_base_url, settings.openrouter_api_key)
        )
        if not items:
            raise RuntimeError("empty free catalog")
    except Exception as exc:
        log.warning("free-model catalog unavailable, using fallback: %s", exc)
        return [dict(e) for e in STATIC_FALLBACK]
    _cache["at"] = now
    _cache["items"] = items
    configured = settings.openrouter_model.strip()
    if configured and is_free_model(configured) and all(e["id"] != configured for e in items):
        items = [{"id": configured, "name": configured + " (configured)"}] + items
    return [dict(e) for e in items]


CHECK_SYSTEM = 'Reply with exactly this JSON object and nothing else: {"ok": true}'
CHECK_USER = "ping"


async def check_model(model_id: str) -> dict:
    """Ping one explicit free model with a tiny structured request.

    Strict per-model check: no fallbacks, so the verdict reflects exactly
    the model the user picked. Raises ValueError for non-free ids (422)
    and LLMError for provider failures (502).
    """
    from app.llm.openrouter import OpenRouterProvider

    cleaned = (model_id or "").strip()
    if not is_free_model(cleaned):
        raise ValueError(f"model must be an explicit free model id, got: {model_id!r}")
    settings = get_settings()
    provider = OpenRouterProvider(
        api_key=settings.openrouter_api_key,
        model=cleaned,
        fallback_models=[],
        base_url=settings.openrouter_base_url,
        timeout_seconds=settings.openrouter_timeout_seconds,
        # Generous ceiling: free reasoning models can spend tokens thinking
        # before answering; the reply itself is one tiny JSON object.
        max_output_tokens=300,
    )
    completion = await provider.complete_json(CHECK_SYSTEM, CHECK_USER)
    parsed = completion.parsed if isinstance(completion.parsed, dict) else {}
    if parsed.get("ok") is not True:
        from app.llm.base import LLMError, LLMErrorCode

        raise LLMError(
            LLMErrorCode.INVALID_RESPONSE,
            "model health check returned unexpected content",
            model=completion.actual_model,
            usage=completion.usage,
        )
    return {
        "model": cleaned,
        "ok": True,
        "actual_model": completion.actual_model,
        "latency_ms": completion.latency_ms,
    }
