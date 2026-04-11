"""initial schema

Revision ID: 20260410_000001
Revises:
Create Date: 2026-04-10
"""

from __future__ import annotations

from alembic import op

from app.models.entities import SQLModel

revision = "20260410_000001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    bind = op.get_bind()
    SQLModel.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    SQLModel.metadata.drop_all(bind=bind)
