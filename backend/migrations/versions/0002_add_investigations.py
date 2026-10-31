"""0002 investigations table with per-incident active-investigation guard."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0002_add_investigations"
down_revision: str | Sequence[str] | None = "0001_baseline_incidents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "investigations",
        sa.Column("id", sa.CHAR(36), nullable=False),
        sa.Column("incident_id", sa.CHAR(36), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("requested_model", sa.String(length=256), nullable=False),
        sa.Column("actual_model", sa.String(length=256), nullable=False),
        sa.Column("prompt_version", sa.String(length=32), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False),
        sa.Column("completion_tokens", sa.Integer(), nullable=False),
        sa.Column("total_tokens", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_investigations_incident_id", "investigations", ["incident_id"])
    # Race-proof guard: one active (pending/running) investigation per incident.
    dialect = op.get_bind().dialect.name
    where = sa.text("status IN ('pending', 'running')")
    op.create_index(
        "uq_investigation_active_per_incident",
        "investigations",
        ["incident_id"],
        unique=True,
        sqlite_where=where if dialect == "sqlite" else None,
        postgresql_where=where if dialect == "postgresql" else None,
    )


def downgrade() -> None:
    op.drop_index("uq_investigation_active_per_incident", table_name="investigations")
    op.drop_index("ix_investigations_incident_id", table_name="investigations")
    op.drop_table("investigations")
