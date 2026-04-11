"""auth sessions and workspace membership

Revision ID: 20260410_000002
Revises: 20260410_000001
Create Date: 2026-04-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260410_000002"
down_revision = "20260410_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("user")}

    if "password_hash" not in user_columns:
        op.add_column("user", sa.Column("password_hash", sa.String(length=512), nullable=True))
    if "is_active" not in user_columns:
        op.add_column("user", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    if "last_login_at" not in user_columns:
        op.add_column("user", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))

    tables = set(inspector.get_table_names())

    if "workspacemembership" not in tables:
        op.create_table(
            "workspacemembership",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("workspace_id", sa.UUID(), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=False),
            sa.Column("role", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=64), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    workspace_indexes = {index["name"] for index in inspector.get_indexes("workspacemembership")} if "workspacemembership" in set(sa.inspect(bind).get_table_names()) else set()
    if op.f("ix_workspacemembership_id") not in workspace_indexes:
        op.create_index(op.f("ix_workspacemembership_id"), "workspacemembership", ["id"], unique=False)
    if op.f("ix_workspacemembership_user_id") not in workspace_indexes:
        op.create_index(
            op.f("ix_workspacemembership_user_id"), "workspacemembership", ["user_id"], unique=False
        )
    if op.f("ix_workspacemembership_workspace_id") not in workspace_indexes:
        op.create_index(
            op.f("ix_workspacemembership_workspace_id"),
            "workspacemembership",
            ["workspace_id"],
            unique=False,
        )

    if "usersession" not in tables:
        op.create_table(
            "usersession",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=False),
            sa.Column("token_hash", sa.String(length=128), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("user_agent", sa.String(length=512), nullable=True),
            sa.Column("ip_address", sa.String(length=128), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    session_indexes = {index["name"] for index in inspector.get_indexes("usersession")} if "usersession" in set(sa.inspect(bind).get_table_names()) else set()
    if op.f("ix_usersession_id") not in session_indexes:
        op.create_index(op.f("ix_usersession_id"), "usersession", ["id"], unique=False)
    if op.f("ix_usersession_user_id") not in session_indexes:
        op.create_index(op.f("ix_usersession_user_id"), "usersession", ["user_id"], unique=False)
    if op.f("ix_usersession_expires_at") not in session_indexes:
        op.create_index(op.f("ix_usersession_expires_at"), "usersession", ["expires_at"], unique=False)
    if op.f("ix_usersession_token_hash") not in session_indexes:
        op.create_index(op.f("ix_usersession_token_hash"), "usersession", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_usersession_token_hash"), table_name="usersession")
    op.drop_index(op.f("ix_usersession_expires_at"), table_name="usersession")
    op.drop_index(op.f("ix_usersession_user_id"), table_name="usersession")
    op.drop_index(op.f("ix_usersession_id"), table_name="usersession")
    op.drop_table("usersession")

    op.drop_index(op.f("ix_workspacemembership_workspace_id"), table_name="workspacemembership")
    op.drop_index(op.f("ix_workspacemembership_user_id"), table_name="workspacemembership")
    op.drop_index(op.f("ix_workspacemembership_id"), table_name="workspacemembership")
    op.drop_table("workspacemembership")

    op.drop_column("user", "last_login_at")
    op.drop_column("user", "is_active")
    op.drop_column("user", "password_hash")
