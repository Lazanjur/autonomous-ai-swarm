"""Add workspace metadata for enterprise controls.

Revision ID: 20260412_000007
Revises: 20260412_000006
Create Date: 2026-04-12 18:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260412_000007"
down_revision: str | Sequence[str] | None = "20260412_000006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspace",
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    op.execute("UPDATE workspace SET metadata = '{}'::json WHERE metadata IS NULL")
    op.alter_column("workspace", "metadata", server_default=None)


def downgrade() -> None:
    op.drop_column("workspace", "metadata")
