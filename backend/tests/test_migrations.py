"""Tests: Alembic migrations apply cleanly to a fresh SQLite database."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.config import get_settings

ALEMBIC_INI = str(Path(__file__).resolve().parents[1] / "alembic.ini")
ALEMBIC_DIR = str(Path(__file__).resolve().parents[1] / "migrations")


def _cfg(url: str, monkeypatch) -> Config:
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    cfg = Config(ALEMBIC_INI)
    cfg.set_main_option("script_location", ALEMBIC_DIR)
    return cfg


def test_migrations_upgrade_head(tmp_path, monkeypatch):
    db = tmp_path / "migrated.db"
    try:
        command.upgrade(_cfg(f"sqlite:///{db}", monkeypatch), "head")
    finally:
        get_settings.cache_clear()

    inspector = inspect(create_engine(f"sqlite:///{db}"))
    tables = set(inspector.get_table_names())
    assert {"incidents", "investigations"} <= tables
    indexes = {ix["name"] for ix in inspector.get_indexes("investigations")}
    assert "uq_investigation_active_per_incident" in indexes
    columns = {c["name"] for c in inspector.get_columns("investigations")}
    assert {"evidence_snapshot", "runbook_snapshot", "started_at", "error_message"} <= columns

    # Downgrade back down removes the investigation artefacts.
    try:
        command.downgrade(_cfg(f"sqlite:///{db}", monkeypatch), "base")
    finally:
        get_settings.cache_clear()
    inspector = inspect(create_engine(f"sqlite:///{db}"))
    assert "investigations" not in set(inspector.get_table_names())
