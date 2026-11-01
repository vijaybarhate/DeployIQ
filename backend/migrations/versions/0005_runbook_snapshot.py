"""0005 runbook snapshot: retrieved runbook metadata per investigation."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0005_investigation_runbook_snapshot"
down_revision: str | Sequence[str] | None = "0004_investigation_evidence_snapshot"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("investigations") as batch:
        batch.add_column(sa.Column("runbook_snapshot", sa.Text(), nullable=False, server_default="[]"))


def downgrade() -> None:
    with op.batch_alter_table("investigations") as batch:
        batch.drop_column("runbook_snapshot")
