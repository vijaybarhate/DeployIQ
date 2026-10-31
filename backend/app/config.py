"""Centralized configuration. Secrets come from the environment / .env only."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py is backend/app/config.py -> parents[2] == repository root.
REPO_ROOT = Path(__file__).resolve().parents[2]


def resolve_env_file(root: Path, cwd: Path) -> Path:
    """Root .env wins; otherwise fall back to the current working directory."""
    candidate = root / ".env"
    return candidate if candidate.exists() else cwd / ".env"


ENV_FILE = resolve_env_file(REPO_ROOT, Path.cwd())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    app_name: str = "DeployIQ"
    log_level: str = "INFO"

    backend_host: str = "127.0.0.1"
    backend_port: int = 8000

    # SQLite for initial MVP; switch to PostgreSQL via this URL later.
    # Example: postgresql+psycopg://user:password@localhost/deployiq
    database_url: str = "sqlite:///./deployiq.db"

    # Explicit allowlist of Compose project names in scope for monitoring.
    # Empty = monitor nothing (fail closed).
    monitored_projects: str = ""

    # --- OpenRouter (M3.2) ---
    openrouter_api_key: str = ""
    openrouter_model: str = ""
    # Comma-separated free-model fallbacks, e.g. "vendor/model:free,...".
    # Paid models must never appear here; the live test enforces the :free rule.
    openrouter_fallback_models: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_timeout_seconds: float = 30.0
    openrouter_max_output_tokens: int = 2500
    # Hard cap on incident evidence characters sent to the model.
    openrouter_max_input_chars: int = 12000

    prompt_version: str = "rca-v1"

    @property
    def monitored_project_list(self) -> list[str]:
        return [p.strip() for p in self.monitored_projects.split(",") if p.strip()]

    @property
    def fallback_model_list(self) -> list[str]:
        return [m.strip() for m in self.openrouter_fallback_models.split(",") if m.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
