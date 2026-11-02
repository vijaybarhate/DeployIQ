"""Free-model catalog for the console engine picker (OpenRouter, cached).

Verified catalogue: a model is selectable only when OpenRouter's own
metadata proves it — zero prompt AND completion pricing plus text input
AND text output. The ":free" suffix alone is not proof. Unknown,
paid, embeddings-only, or metadata-less models fail closed.
"""

import asyncio
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

# Bulk live-status cache: re-pinging every model on each dropdown open
# would burn free-tier quota. Refresh on demand or when stale.
# TTL is deliberately longer than the UI poll interval so background polls
# mostly read cache instead of re-firing a full sweep.
_STATUS_TTL_SECONDS = 300.0
_status_cache: dict = {"at": 0.0, "items": []}


def clear_catalog_cache() -> None:
    _cache["at"] = 0.0
    _cache["items"] = []
    _cache["verified"] = []
    _key_status_cache["at"] = 0.0
    _key_status_cache["items"] = []
    _status_cache["at"] = 0.0
    _status_cache["items"] = []


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
        # Fail closed on refresh errors too: a stale verified set must not
        # keep authorizing ids the catalogue no longer vouches for.
        _cache["verified"] = []
        return [dict(e) for e in STATIC_FALLBACK]
    _cache["at"] = now
    _cache["items"] = [{"id": e["id"], "name": e["name"]} for e in items]
    _cache["verified"] = [str(e["id"]) for e in items]
    # The documented free router is explicitly supported by the gate, so it
    # must stay selectable even when the catalogue fetch succeeds.
    if all(e["id"] != "openrouter/free" for e in _cache["items"]):
        _cache["items"] = [{"id": "openrouter/free", "name": "OpenRouter Free Router"}] + _cache[
            "items"
        ]
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


async def resolve_verified_model(model_override: str | None) -> str:
    """One shared resolution for investigations, Copilot and health checks.

    Explicit override wins; otherwise the configured default is used —
    but the default goes through the same catalogue verification instead
    of being trusted on syntax alone. Raises ValueError (HTTP 422).
    """
    settings = get_settings()
    if model_override:
        return await ensure_verified_free_model(model_override)
    default = (settings.openrouter_model or "").strip()
    if not default:
        raise ValueError("no model configured and no override supplied")
    return await ensure_verified_free_model(default)


CHECK_SYSTEM = 'Reply with exactly this JSON object and nothing else: {"ok": true}'
CHECK_USER = "ping"


async def _ping_with_key(model_id: str, api_key: str, timeout_seconds: float):
    """One tiny structured ping bound to a single key (no failover).

    Shared by the per-model check (which fails over across keys) and the
    per-key status sweep. Raises LLMError on any provider failure.
    """
    from app.llm.base import LLMError, LLMErrorCode
    from app.llm.openrouter import OpenRouterProvider

    settings = get_settings()
    provider = OpenRouterProvider(
        api_key=api_key,
        model=model_id,
        fallback_models=[],
        base_url=settings.openrouter_base_url,
        timeout_seconds=timeout_seconds,
        # Generous ceiling: free reasoning models can spend tokens thinking
        # before answering; the reply itself is one tiny JSON object.
        max_output_tokens=300,
    )
    completion = await provider.complete_json(CHECK_SYSTEM, CHECK_USER)
    parsed = completion.parsed if isinstance(completion.parsed, dict) else {}
    if parsed.get("ok") is not True:
        raise LLMError(
            LLMErrorCode.INVALID_RESPONSE,
            "model health check returned unexpected content",
            model=completion.actual_model,
            usage=completion.usage,
        )
    return completion


async def check_model(model_id: str, timeout_seconds: float | None = None) -> dict:
    """Ping one verified free model with a tiny structured request.

    Strict per-model check: no model fallbacks, so the verdict reflects
    exactly the model the user picked. The provider fans out across the
    pooled keys (round-robin start, fail over on dead/throttled keys), so
    one exhausted key never hides a model another key can still reach.
    Raises ValueError for unverified ids (422) and LLMError for provider
    failures (502).
    """
    from app.llm.openrouter import OpenRouterProvider

    cleaned = await ensure_verified_free_model(model_id)
    settings = get_settings()
    keys = settings.openrouter_api_keys
    if not keys:
        from app.llm.base import LLMError, LLMErrorCode

        raise LLMError(LLMErrorCode.AUTH, "missing OpenRouter API key")
    provider = OpenRouterProvider(
        api_key=keys,
        model=cleaned,
        fallback_models=[],
        base_url=settings.openrouter_base_url,
        timeout_seconds=timeout_seconds or settings.openrouter_timeout_seconds,
        max_output_tokens=300,
    )
    completion = await provider.complete_json(CHECK_SYSTEM, CHECK_USER)
    return {
        "model": cleaned,
        "ok": True,
        "actual_model": completion.actual_model,
        "latency_ms": completion.latency_ms,
    }


_STATUS_ORDER = {"live": 0, "limited": 1, "slow": 2, "down": 3}


async def list_model_statuses(
    refresh: bool = False,
    timeout_seconds: float = 20.0,
    max_concurrency: int = 3,
) -> list[dict]:
    """Live availability for every verified model, cheapest-first.

    Each entry: {id, name, status, latency_ms, reason} where status is
    live | limited (rate-limited, retry later) | slow (timed out) | down.
    Results are cached briefly so opening the picker does not burn
    free-tier quota; pass refresh=True to re-ping on demand.
    """
    now = time.monotonic()
    if _status_cache["items"] and not refresh and now - _status_cache["at"] < _STATUS_TTL_SECONDS:
        return [dict(e) for e in _status_cache["items"]]
    entries = await list_free_models()
    from app.llm.base import LLMError

    semaphore = asyncio.Semaphore(max_concurrency)

    async def _ping(entry: dict) -> dict:
        async with semaphore:
            try:
                result = await check_model(entry["id"], timeout_seconds=timeout_seconds)
                return {
                    "id": entry["id"],
                    "name": entry["name"],
                    "status": "live",
                    "latency_ms": result["latency_ms"],
                    "reason": "",
                }
            except ValueError as exc:
                return {
                    "id": entry["id"],
                    "name": entry["name"],
                    "status": "down",
                    "latency_ms": None,
                    "reason": str(exc),
                }
            except LLMError as exc:
                code = exc.code.value
                status = (
                    "limited" if code == "rate_limited" else "slow" if code == "timeout" else "down"
                )
                return {
                    "id": entry["id"],
                    "name": entry["name"],
                    "status": status,
                    "latency_ms": None,
                    "reason": code,
                }

    results = await asyncio.gather(*[_ping(e) for e in entries])
    results.sort(
        key=lambda r: (
            _STATUS_ORDER[r["status"]],
            r["latency_ms"] if r["latency_ms"] is not None else 10**9,
        )
    )
    _status_cache["at"] = now
    _status_cache["items"] = results
    return [dict(e) for e in results]


_key_status_cache: dict = {"at": 0.0, "items": []}


async def list_key_statuses(refresh: bool = False, timeout_seconds: float = 20.0) -> list[dict]:
    """Per-key health: which pooled keys are answering right now.

    Only key INDEXES are ever reported — key material never leaves the
    backend. Each entry: {index (1-based), status, latency_ms, reason} with
    status in live | limited | slow | down. Cached briefly; refresh re-pings.
    The probe is one tiny request against the documented free router.
    """
    now = time.monotonic()
    if (
        _key_status_cache["items"]
        and not refresh
        and now - _key_status_cache["at"] < _STATUS_TTL_SECONDS
    ):
        return [dict(e) for e in _key_status_cache["items"]]
    from app.llm.base import LLMError

    settings = get_settings()
    keys = settings.openrouter_api_keys

    async def _one(index: int, key: str) -> dict:
        try:
            completion = await _ping_with_key(
                "openrouter/free", key, timeout_seconds=timeout_seconds
            )
            return {
                "index": index,
                "status": "live",
                "latency_ms": completion.latency_ms,
                "reason": "",
            }
        except LLMError as exc:
            code = exc.code.value
            status = (
                "limited" if code == "rate_limited" else "slow" if code == "timeout" else "down"
            )
            return {"index": index, "status": status, "latency_ms": None, "reason": code}

    results = await asyncio.gather(*[_one(i + 1, k) for i, k in enumerate(keys)])
    results.sort(key=lambda r: (_STATUS_ORDER[r["status"]], r["index"]))
    _key_status_cache["at"] = now
    _key_status_cache["items"] = results
    return [dict(e) for e in results]
