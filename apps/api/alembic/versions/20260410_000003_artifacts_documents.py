"""artifact document linkage and nullable run

Revision ID: 20260410_000003
Revises: 20260410_000002
Create Date: 2026-04-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260410_000003"
down_revision = "20260410_000002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    artifact_columns = {column["name"] for column in inspector.get_columns("artifact")}
    if "document_id" not in artifact_columns:
        op.add_column("artifact", sa.Column("document_id", sa.UUID(), nullable=True))

    run_column = next(column for column in inspector.get_columns("artifact") if column["name"] == "run_id")
    if not run_column.get("nullable", False):
        op.alter_column("artifact", "run_id", existing_type=sa.UUID(), nullable=True)

    foreign_keys = {foreign_key["name"] for foreign_key in inspector.get_foreign_keys("artifact")}
    if "fk_artifact_document_id_document" not in foreign_keys:
        op.create_foreign_key(
            "fk_artifact_document_id_document",
            "artifact",
            "document",
            ["document_id"],
            ["id"],
        )

    indexes = {index["name"] for index in inspector.get_indexes("artifact")}
    if op.f("ix_artifact_document_id") not in indexes:
        op.create_index(op.f("ix_artifact_document_id"), "artifact", ["document_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_artifact_document_id"), table_name="artifact")
    op.drop_constraint("fk_artifact_document_id_document", "artifact", type_="foreignkey")
    op.drop_column("artifact", "document_id")
    op.alter_column("artifact", "run_id", existing_type=sa.UUID(), nullable=False)
