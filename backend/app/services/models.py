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
