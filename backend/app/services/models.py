"""Free-model catalog for the console engine picker (OpenRouter, cached).

Verified catalogue: a model is selectable only when OpenRouter's own
metadata proves it — zero prompt AND completion pricing plus text input
AND text output. The ":free" suffix alone is not proof. Unknown,
paid, embeddings-only, or metadata-less models fail closed.
"""

import time

import httpx

from app.config import get_settings
from app.core.logging import get_logger
from app.llm.base import is_free_model

log = get_logger(__name__)

# Fallback when the catalog fetch fails: the documented free router only.
STATIC_FALLBACK = [{"id": "openrouter/free", "name": "OpenRouter Free Router"}]

_CACHE_TTL_SECONDS = 600.0
_cache: dict = {"at": 0.0, "items": [], "verified": []}


def clear_catalog_cache() -> None:
    _cache["at"] = 0.0
    _cache["items"] = []
    _cache["verified"] = []


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
        if not isinstance(entry, dict):
            continue
        model_id = str(entry.get("id", ""))
        name = str(entry.get("name", "") or model_id)
        pricing = entry.get("pricing") or {}
        architecture = entry.get("architecture") or {}
        items.append(
            {
                "id": model_id,
                "name": name,
                "pricing": pricing if isinstance(pricing, dict) else {},
                "architecture": architecture if isinstance(architecture, dict) else {},
            }
        )
    return items


def _is_zero(value) -> bool:
    """Zero pricing in whatever numeric shape the catalog uses."""
    try:
        return float(str(value)) == 0.0
    except (TypeError, ValueError):
        return False


def _is_verified_free(entry: dict) -> bool:
    """Catalog-proof free text-to-text model (suffix alone is not proof)."""
    if not is_free_model(str(entry.get("id", ""))):
        return False
    pricing = entry.get("pricing")
    if not isinstance(pricing, dict):
        return False
    if not _is_zero(pricing.get("prompt")) or not _is_zero(pricing.get("completion")):
        return False
    architecture = entry.get("architecture")
    if not isinstance(architecture, dict):
        return False
    inputs = architecture.get("input_modalities") or []
    outputs = architecture.get("output_modalities") or []
    if "text" not in list(inputs) or "text" not in list(outputs):
        return False
    return True


def _only_free(entries: list[dict]) -> list[dict]:
    """Keep verified free models only, sorted by id."""
    kept = [e for e in entries if _is_verified_free(e)]
    kept.sort(key=lambda e: str(e.get("id", "")))
    return kept


async def list_free_models() -> list[dict]:
    """Cached verified free-model catalog; static fallback keeps the UI usable offline."""
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
    _cache["items"] = [{"id": e["id"], "name": e["name"]} for e in items]
    _cache["verified"] = [str(e["id"]) for e in items]
    configured = settings.openrouter_model.strip()
    if configured and configured in _cache["verified"]:
        if all(e["id"] != configured for e in items):
            _cache["items"] = [{"id": configured, "name": configured + " (configured)"}] + _cache[
                "items"
            ]
    return [dict(e) for e in _cache["items"]]


async def ensure_verified_free_model(model_id: str) -> str:
    """Single shared gate: the id must be catalogue-verified free.

    Accepts exactly "openrouter/free" (documented free router) or an id
    present in the verified catalogue. Anything else — paid, unknown,
    embeddings-only, metadata-less — raises ValueError (HTTP 422).
    The frontend dropdown is not a security boundary; this check is.
    """
    cleaned = (model_id or "").strip()
    if cleaned == "openrouter/free":
        return cleaned
    await list_free_models()  # refresh verified set when stale/empty
    if cleaned and cleaned in _cache["verified"]:
        return cleaned
    raise ValueError(f"model is not a verified free model: {model_id!r}")


CHECK_SYSTEM = 'Reply with exactly this JSON object and nothing else: {"ok": true}'
CHECK_USER = "ping"


async def check_model(model_id: str) -> dict:
    """Ping one verified free model with a tiny structured request.

    Strict per-model check: no fallbacks, so the verdict reflects exactly
    the model the user picked. Raises ValueError for unverified ids (422)
    and LLMError for provider failures (502).
    """
    from app.llm.openrouter import OpenRouterProvider

    cleaned = await ensure_verified_free_model(model_id)
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
