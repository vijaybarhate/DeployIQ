"""LLM provider abstraction (async-only; no sync wrappers, no ad-hoc event loops)."""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol


class LLMErrorCode(StrEnum):
    TIMEOUT = "timeout"
    AUTH = "auth"
    RATE_LIMITED = "rate_limited"
    SERVER = "server"
    INVALID_RESPONSE = "invalid_response"
    NO_RESPONSE = "no_response"
    POLICY = "policy"


@dataclass(frozen=True)
class TokenUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


def is_free_model(model_id: str) -> bool:
    """Free-only routing guard (single source of truth).

    Allowed (per OpenRouter docs):
    - IDs ending ":free" (free catalog variants, zero pricing).
    - Exactly "openrouter/free" (Free Models Router: documented to fall
      back only to other free models, pricing zero).
    Rejected: everything else, including "openrouter/auto" (spend-based
    routing across paid models) and bare paid model IDs.
    """
    return model_id.endswith(":free") or model_id == "openrouter/free"


class LLMError(RuntimeError):
    def __init__(
        self,
        code: LLMErrorCode,
        message: str,
        model: str = "",
        usage: TokenUsage | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.model = model
        self.usage = usage or TokenUsage()


@dataclass(frozen=True)
class LLMCompletion:
    parsed: dict[str, Any]
    actual_model: str
    usage: TokenUsage = field(default_factory=TokenUsage)
    latency_ms: int = 0


class LLMProvider(Protocol):
    async def complete_json(self, system_prompt: str, user_prompt: str) -> LLMCompletion:
        """One structured-JSON completion. Raises LLMError on any failure."""
        ...
