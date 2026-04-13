from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from uuid import uuid4

from app.services.workflows.run_service import RunService


def test_build_project_summaries_counts_threads_and_activity():
    service = RunService()
    workspace_id = uuid4()
    project_a_id = uuid4()
    project_b_id = uuid4()
    now = datetime.now(timezone.utc)

    projects = [
      SimpleNamespace(
          id=project_a_id,
          workspace_id=workspace_id,
          name="Alpha",
          description="First project",
          status="active",
          created_at=now - timedelta(days=2),
          updated_at=now - timedelta(days=2),
      ),
      SimpleNamespace(
          id=project_b_id,
          workspace_id=workspace_id,
          name="Beta",
          description="Second project",
          status="active",
          created_at=now - timedelta(days=1),
          updated_at=now - timedelta(days=1),
      ),
    ]

    thread_summaries = [
        {
            "id": uuid4(),
            "workspace_id": workspace_id,
            "project_id": project_a_id,
            "title": "Alpha task",
            "last_activity_at": now,
        },
        {
            "id": uuid4(),
            "workspace_id": workspace_id,
            "project_id": project_a_id,
            "title": "Alpha follow-up",
            "last_activity_at": now - timedelta(hours=1),
        },
        {
            "id": uuid4(),
            "workspace_id": workspace_id,
            "project_id": project_b_id,
            "title": "Beta task",
            "last_activity_at": now - timedelta(hours=2),
        },
        {
            "id": uuid4(),
            "workspace_id": workspace_id,
            "project_id": None,
            "title": "General task",
            "last_activity_at": now - timedelta(hours=3),
        },
    ]

    summaries = service._build_project_summaries(projects, thread_summaries)

    assert summaries[0]["id"] == project_a_id
    assert summaries[0]["thread_count"] == 2
    assert summaries[0]["last_activity_at"] == now
    assert summaries[1]["id"] == project_b_id
    assert summaries[1]["thread_count"] == 1
