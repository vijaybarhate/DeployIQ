"""Alembic migration-state gate shared by the API and the Docker watcher.

Table presence alone is not enough: a pre-Alembic database (or one built
with raw create_all) lacks version history and would diverge from the
migration chain. Neither process creates schema; both fail fast instead.
"""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.core.logging import get_logger

log = get_logger(__name__)


def migration_head() -> str:
    """Current Alembic head from the configured migration scripts (not hardcoded)."""
    backend_dir = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    heads = ScriptDirectory.from_config(cfg).get_heads()
    return heads[0] if len(heads) == 1 else ""


def require_migrated_db(engine: Engine) -> None:
    """Raise SystemExit(2) unless the database is at the Alembic head."""
    required = {"incidents", "investigations", "alembic_version"}
    try:
        with engine.connect() as connection:
            tables = set(inspect(connection).get_table_names())
            if not required <= tables:
                raise SystemExit(2)
            revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except SystemExit:
        log.error("database schema not initialized: run 'alembic upgrade head' from backend/ first")
        raise
    except Exception as exc:
        log.error("could not verify migration state: %s", exc)
        raise SystemExit(2) from exc
    head = migration_head()
    if not head or revision != head:
        log.error(
            "database is at revision %s, expected %s: run 'alembic upgrade head' from backend/",
            revision,
            head or "<unknown>",
        )
        raise SystemExit(2)
