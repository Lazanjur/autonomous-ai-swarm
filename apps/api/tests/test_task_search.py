from uuid import uuid4

from app.services.workflows.run_service import RunService


def test_build_search_highlight_centers_match():
    service = RunService()

    highlight = service._build_search_highlight(
        "The agent completed browser automation and then deployed the app to production successfully.",
        "deployed",
    )

    assert "deployed" in highlight.lower()
    assert len(highlight) <= 180


def test_register_search_hit_accumulates_score_and_sources():
    service = RunService()
    hit_map = {}
    thread_id = uuid4()

    service._register_search_hit(
        hit_map,
        thread_id=thread_id,
        source="thread_title",
        text="Deploy production system",
        score=8.0,
        query="deploy",
    )
    service._register_search_hit(
        hit_map,
        thread_id=thread_id,
        source="message_content",
        text="We should deploy after validation passes.",
        score=4.5,
        query="deploy",
    )

    thread_key = ("thread", thread_id)
    assert round(hit_map[thread_key]["score"], 1) == 12.5
    assert hit_map[thread_key]["matched_by"] == {"thread_title", "message_content"}
    assert "deploy" in hit_map[thread_key]["highlight"].lower()


def test_register_generic_search_hit_tracks_non_thread_results():
    service = RunService()
    hit_map = {}
    project_key = ("project", uuid4())

    service._register_generic_search_hit(
        hit_map,
        result_key=project_key,
        source="project_name",
        text="Website deployment",
        score=7.5,
        query="deploy",
    )
    service._register_generic_search_hit(
        hit_map,
        result_key=project_key,
        source="project_description",
        text="Launch checklist and deployment notes.",
        score=3.0,
        query="deploy",
    )

    assert round(hit_map[project_key]["score"], 1) == 10.5
    assert hit_map[project_key]["matched_by"] == {"project_name", "project_description"}
    assert "deploy" in hit_map[project_key]["highlight"].lower()


def test_metadata_matches_project_handles_direct_and_nested_ids():
    service = RunService()
    project_id = uuid4()

    assert service._metadata_matches_project({"project_id": str(project_id)}, project_id)
    assert service._metadata_matches_project({"project_ids": [str(project_id)]}, project_id)
    assert service._metadata_matches_project({"project": {"id": str(project_id)}}, project_id)
    assert not service._metadata_matches_project({"project_id": str(uuid4())}, project_id)


def test_count_search_keys_groups_result_kinds():
    service = RunService()
    counts = service._count_search_keys(
        [
            ("project", uuid4()),
            ("thread", uuid4()),
            ("thread", uuid4()),
            ("document", uuid4()),
            ("artifact", uuid4()),
        ]
    )

    assert counts == {
        "project": 1,
        "task": 2,
        "document": 1,
        "artifact": 1,
    }
