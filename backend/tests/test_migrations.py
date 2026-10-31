"""Tests: Alembic migrations apply cleanly to a fresh SQLite database."""

from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command
from app.config import get_settings


def test_migrations_upgrade_head(tmp_path, monkeypatch):
    db = tmp_path / "migrated.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db}")
    get_settings.cache_clear()
    try:
        cfg = Config("alembic.ini")
        command.upgrade(cfg, "head")
    finally:
        get_settings.cache_clear()

    inspector = inspect(create_engine(f"sqlite:///{db}"))
    tables = set(inspector.get_table_names())
    assert {"incidents", "investigations"} <= tables
    indexes = {ix["name"] for ix in inspector.get_indexes("investigations")}
    assert "uq_investigation_active_per_incident" in indexes

    # Downgrade back down removes the investigation artefacts.
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db}")
    get_settings.cache_clear()
    try:
        command.downgrade(cfg, "base")
    finally:
        get_settings.cache_clear()
    inspector = inspect(create_engine(f"sqlite:///{db}"))
    assert "investigations" not in set(inspector.get_table_names())
