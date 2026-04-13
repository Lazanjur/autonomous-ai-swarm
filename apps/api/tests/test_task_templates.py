from uuid import uuid4

from app.schemas.chat import ChatRunRequest
from app.services.task_templates import get_task_template, list_task_templates
from app.services.workflows.run_service import RunService


def test_task_template_catalog_covers_browser_and_computer_workflows():
    templates = list_task_templates()

    assert any(template["category"] == "browser" for template in templates)
    assert any(template["category"] == "computer" for template in templates)
    assert all(template["automation_defaults"]["schedule_hint"] for template in templates)


def test_get_task_template_returns_deep_copy():
    template = get_task_template("site_qa_sweep")
    assert template is not None

    template["name"] = "Changed locally"
    fresh_copy = get_task_template("site_qa_sweep")

    assert fresh_copy is not None
    assert fresh_copy["name"] == "Website QA sweep"


def test_thread_title_prefers_template_title_when_available():
    service = RunService()
    payload = ChatRunRequest(
        workspace_id=uuid4(),
        message="Investigate why the deploy is broken.",
        template_key="repo_debug_and_fix",
    )

    assert service._thread_title_for_payload(payload) == "Repo debug and fix"


def test_thread_title_falls_back_to_message_without_template():
    service = RunService()
    payload = ChatRunRequest(
        workspace_id=uuid4(),
        message="Investigate why the deploy is broken.",
    )

    assert service._thread_title_for_payload(payload) == payload.message[:70]
