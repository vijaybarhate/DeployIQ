"""0004 investigation evidence snapshot (what the AI actually cited)."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0004_investigation_evidence_snapshot"
down_revision: str | Sequence[str] | None = "0003_harden_investigations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("investigations") as batch:
        batch.add_column(sa.Column("evidence_snapshot", sa.Text(), nullable=False, server_default="[]"))


def downgrade() -> None:
    with op.batch_alter_table("investigations") as batch:
        batch.drop_column("evidence_snapshot")
