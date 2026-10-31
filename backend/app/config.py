"""Centralized configuration. Secrets come from the environment / .env only."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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

    openrouter_api_key: str = ""
    openrouter_model: str = ""

    @property
    def monitored_project_list(self) -> list[str]:
        return [p.strip() for p in self.monitored_projects.split(",") if p.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
