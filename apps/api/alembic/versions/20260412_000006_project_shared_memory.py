"""Add project metadata for shared memory.

Revision ID: 20260412_000006
Revises: 20260410_000005
Create Date: 2026-04-12 11:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260412_000006"
down_revision: str | Sequence[str] | None = "20260410_000005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "project",
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    op.execute("UPDATE project SET metadata = '{}'::json WHERE metadata IS NULL")
    op.alter_column("project", "metadata", server_default=None)


def downgrade() -> None:
    op.drop_column("project", "metadata")
