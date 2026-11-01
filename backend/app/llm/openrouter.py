"""OpenRouter provider: one structured request, free-model fallback routing."""

import json
import time

import httpx

from app.llm.base import LLMCompletion, LLMError, LLMErrorCode, TokenUsage

CHAT_COMPLETIONS_PATH = "/chat/completions"


class _EmptyContent(Exception):
    """Internal: provider returned 200 but no usable message content."""


class OpenRouterProvider:
    """Async OpenRouter client. Exactly one generation request per call, plus at
    most one retry when the provider explicitly rejects `response_format`."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        fallback_models: list[str] | None = None,
        base_url: str = "https://openrouter.ai/api/v1",
        timeout_seconds: float = 30.0,
        max_output_tokens: int = 1500,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not api_key:
            raise LLMError(LLMErrorCode.AUTH, "missing OpenRouter API key")
        if not model:
            raise LLMError(LLMErrorCode.INVALID_RESPONSE, "missing OpenRouter model")
        self._api_key = api_key
        self._model = model
        self._fallbacks = [m for m in (fallback_models or []) if m]
        self._enforce_free_only([self._model, *self._fallbacks])
        self._base_url = base_url.rstrip("/")
        self._timeout = httpx.Timeout(timeout_seconds)
        self._max_output_tokens = max_output_tokens
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _is_explicitly_free(model_id: str) -> bool:
        """Free-only routing guard (delegates to base.is_free_model)."""
        from app.llm.base import is_free_model

        return is_free_model(model_id)

    def _enforce_free_only(self, models: list[str]) -> None:
        bad = [m for m in models if not self._is_explicitly_free(m)]
        if bad:
            raise LLMError(
                LLMErrorCode.POLICY,
                f"non-free model in routing list (free-only policy): {bad}",
            )

    def _payload(self, system_prompt: str, user_prompt: str, use_json_mode: bool) -> dict:
        models = [self._model, *self._fallbacks]
        body: dict = {
            "models": models,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": self._max_output_tokens,
        }
        if use_json_mode:
            body["response_format"] = {"type": "json_object"}
        return body

    async def complete_json(self, system_prompt: str, user_prompt: str) -> LLMCompletion:
        start = time.perf_counter()
        try:
            return await self._attempt(system_prompt, user_prompt, use_json_mode=True, start=start)
        except LLMError as exc:
            if exc.code == LLMErrorCode.INVALID_RESPONSE and self._retryable(exc):
                # Provider accepted json_object but returned no usable content,
                # or explicitly rejected the parameter: the single permitted
                # compatibility retry uses plain JSON prompting instead.
                system_prompt = system_prompt + "\nRespond with a single valid JSON object only."
                try:
                    retry = await self._attempt(
                        system_prompt, user_prompt, use_json_mode=False, start=start
                    )
                except LLMError as retry_exc:
                    # The retry failed too: preserve the first attempt's usage.
                    first = exc.usage
                    second = retry_exc.usage or TokenUsage()
                    merged = TokenUsage(
                        prompt_tokens=first.prompt_tokens + second.prompt_tokens,
                        completion_tokens=first.completion_tokens + second.completion_tokens,
                        total_tokens=first.total_tokens + second.total_tokens,
                    )
                    raise LLMError(
                        retry_exc.code,
                        f"{retry_exc} (first attempt used {first.total_tokens} tokens)",
                        model=retry_exc.model or exc.model,
                        usage=merged,
                    ) from retry_exc
                # Aggregate usage across both attempts so recorded token
                # consumption stays accurate: one logical investigation.
                return LLMCompletion(
                    parsed=retry.parsed,
                    actual_model=retry.actual_model or exc.model,
                    usage=TokenUsage(
                        prompt_tokens=exc.usage.prompt_tokens + retry.usage.prompt_tokens,
                        completion_tokens=exc.usage.completion_tokens
                        + retry.usage.completion_tokens,
                        total_tokens=exc.usage.total_tokens + retry.usage.total_tokens,
                    ),
                    latency_ms=retry.latency_ms,
                )
            raise

    @staticmethod
    def _retryable(exc: LLMError) -> bool:
        message = str(exc).lower()
        return "response_format" in message or "empty content" in message

    async def _attempt(
        self, system_prompt: str, user_prompt: str, use_json_mode: bool, start: float
    ) -> LLMCompletion:
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url, timeout=self._timeout, transport=self._transport
            ) as client:
                response = await client.post(
                    CHAT_COMPLETIONS_PATH,
                    headers=self._headers(),
                    json=self._payload(system_prompt, user_prompt, use_json_mode),
                )
        except httpx.TimeoutException as exc:
            raise LLMError(LLMErrorCode.TIMEOUT, f"OpenRouter request timed out: {exc}") from exc
        except httpx.HTTPError as exc:
            raise LLMError(LLMErrorCode.NO_RESPONSE, f"OpenRouter transport error: {exc}") from exc
        latency_ms = int((time.perf_counter() - start) * 1000)

        if response.status_code == 401:
            raise LLMError(LLMErrorCode.AUTH, "OpenRouter authentication failed (401)")
        if response.status_code == 402:
            raise LLMError(LLMErrorCode.AUTH, "OpenRouter payment required (402): billing issue")
        if response.status_code == 429:
            raise LLMError(LLMErrorCode.RATE_LIMITED, "OpenRouter rate limited (429)")
        if response.status_code >= 500:
            raise LLMError(LLMErrorCode.SERVER, f"OpenRouter server error ({response.status_code})")
        if response.status_code == 400:
            raise LLMError(LLMErrorCode.INVALID_RESPONSE, self._error_detail(response))
        if response.status_code != 200:
            raise LLMError(
                LLMErrorCode.INVALID_RESPONSE,
                f"OpenRouter unexpected status {response.status_code}",
            )
        actual_model = ""
        usage = TokenUsage()
        try:
            body = response.json()
            usage_raw = body.get("usage", {}) or {}
            usage = TokenUsage(
                prompt_tokens=int(usage_raw.get("prompt_tokens", 0) or 0),
                completion_tokens=int(usage_raw.get("completion_tokens", 0) or 0),
                total_tokens=int(usage_raw.get("total_tokens", 0) or 0),
            )
            actual_model = str(body.get("model", "") or "")
            content = body["choices"][0]["message"]["content"]
            if content is None or (isinstance(content, str) and not content.strip()):
                # Reasoning-style free models sometimes put everything into
                # reasoning fields and leave content empty despite accepting
                # json_object mode. Retryable with plain JSON prompting.
                raise _EmptyContent()
            parsed = json.loads(content) if isinstance(content, str) else content
            if not isinstance(parsed, dict):
                raise ValueError("top-level JSON must be an object")
        except _EmptyContent as exc:
            raise LLMError(
                LLMErrorCode.INVALID_RESPONSE,
                f"malformed model output: empty content (model={actual_model or 'unknown'})",
                model=actual_model,
                usage=usage,
            ) from exc
        except (ValueError, KeyError, IndexError, AttributeError) as exc:
            raise LLMError(
                LLMErrorCode.INVALID_RESPONSE,
                f"malformed model output: {exc}",
                model=actual_model,
                usage=usage,
            ) from exc
        usage_raw = body.get("usage", {}) or {}
        usage = TokenUsage(
            prompt_tokens=int(usage_raw.get("prompt_tokens", 0) or 0),
            completion_tokens=int(usage_raw.get("completion_tokens", 0) or 0),
            total_tokens=int(usage_raw.get("total_tokens", 0) or 0),
        )
        return LLMCompletion(
            parsed=parsed,
            actual_model=str(body.get("model", self._model)),
            usage=usage,
            latency_ms=latency_ms,
        )

    @staticmethod
    def _error_detail(response: httpx.Response) -> str:
        try:
            detail = response.json().get("error", {}).get("message", "")
        except ValueError:
            detail = response.text[:200]
        return f"OpenRouter rejected the request (400): {detail[:200]}"
