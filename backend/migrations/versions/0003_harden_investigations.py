"""0003 investigations hardening: FK, longer status, started_at, error_message."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0003_harden_investigations"
down_revision: str | Sequence[str] | None = "0002_add_investigations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("investigations") as batch:
        batch.create_foreign_key("fk_investigation_incident", "incidents", ["incident_id"], ["id"])
        batch.alter_column("status", existing_type=sa.String(length=16), type_=sa.String(24))
        batch.add_column(sa.Column("started_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("error_message", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("investigations") as batch:
        batch.drop_constraint("fk_investigation_incident", type_="foreignkey")
        batch.drop_column("error_message")
        batch.drop_column("started_at")
        batch.alter_column("status", existing_type=sa.String(length=24), type_=sa.String(16))
