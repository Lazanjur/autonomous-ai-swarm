from datetime import datetime, timezone
from uuid import uuid4

from app.schemas.auth import WorkspaceAccessRead
from app.services.admin_search import AdminSearchService


def test_build_result_entry_for_task_uses_workspace_context():
    service = AdminSearchService()
    workspace = WorkspaceAccessRead(
        workspace_id=uuid4(),
        workspace_name="Strategy Lab",
        workspace_slug="strategy-lab",
        role="owner",
    )
    now = datetime.now(timezone.utc)

    result = service._build_result_entry(
        workspace=workspace,
        result={
            "kind": "task",
            "score": 8.5,
            "matched_by": ["thread_title"],
            "highlight": "Deploy website",
            "thread": {
                "id": uuid4(),
                "project_id": uuid4(),
                "title": "Deploy website",
                "last_message_preview": "Finalize deployment checklist.",
                "status": "active",
                "created_at": now,
                "updated_at": now,
                "last_activity_at": now,
            },
        },
    )

    assert result is not None
    assert result["workspace_name"] == "Strategy Lab"
    assert result["kind"] == "task"
    assert result["title"] == "Deploy website"
    assert result["subtitle"] == "Finalize deployment checklist."


def test_count_results_groups_by_kind():
    service = AdminSearchService()

    counts = service._count_results(
        [
            {"kind": "project"},
            {"kind": "task"},
            {"kind": "task"},
            {"kind": "document"},
        ]
    )

    assert counts == {
        "project": 1,
        "task": 2,
        "document": 1,
    }
