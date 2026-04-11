"""pgvector and text search indexes

Revision ID: 20260410_000004
Revises: 20260410_000003
Create Date: 2026-04-10
"""

from __future__ import annotations

from alembic import op

revision = "20260410_000004"
down_revision = "20260410_000003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_documentchunk_embedding_cosine
        ON documentchunk
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_documentchunk_content_tsv
        ON documentchunk
        USING gin (to_tsvector('simple', content))
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_documentchunk_content_tsv")
    op.execute("DROP INDEX IF EXISTS ix_documentchunk_embedding_cosine")
