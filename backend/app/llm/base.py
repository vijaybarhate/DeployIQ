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


@dataclass(frozen=True)
class TokenUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


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
