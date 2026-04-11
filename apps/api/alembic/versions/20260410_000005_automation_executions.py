"""automation executions

Revision ID: 20260410_000005
Revises: 20260410_000004
Create Date: 2026-04-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260410_000005"
down_revision = "20260410_000004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "automationexecution",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("automation_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("thread_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("trigger", sa.String(length=64), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("result_summary", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["automation_id"], ["automation.id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["run.id"]),
        sa.ForeignKeyConstraint(["thread_id"], ["chatthread.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_automationexecution_id", "automationexecution", ["id"], unique=False)
    op.create_index("ix_automationexecution_created_at", "automationexecution", ["created_at"], unique=False)
    op.create_index("ix_automationexecution_automation_id", "automationexecution", ["automation_id"], unique=False)
    op.create_index("ix_automationexecution_workspace_id", "automationexecution", ["workspace_id"], unique=False)
    op.create_index("ix_automationexecution_run_id", "automationexecution", ["run_id"], unique=False)
    op.create_index("ix_automationexecution_thread_id", "automationexecution", ["thread_id"], unique=False)
    op.create_index("ix_automationexecution_status", "automationexecution", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_automationexecution_status", table_name="automationexecution")
    op.drop_index("ix_automationexecution_thread_id", table_name="automationexecution")
    op.drop_index("ix_automationexecution_run_id", table_name="automationexecution")
    op.drop_index("ix_automationexecution_workspace_id", table_name="automationexecution")
    op.drop_index("ix_automationexecution_automation_id", table_name="automationexecution")
    op.drop_index("ix_automationexecution_created_at", table_name="automationexecution")
    op.drop_index("ix_automationexecution_id", table_name="automationexecution")
    op.drop_table("automationexecution")
