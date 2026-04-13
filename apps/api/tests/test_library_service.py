from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.models.entities import Artifact, Document
from app.services.library import LibraryService


def test_build_dashboard_aggregates_collections_and_curated_counts():
    service = LibraryService()
    workspace_id = uuid4()
    now = datetime.now(timezone.utc)

    documents = [
        Document(
            id=uuid4(),
            workspace_id=workspace_id,
            title="Board Memo",
            source_type="upload",
            mime_type="application/pdf",
            status="processed",
            content_text="Quarterly board memo and planning notes.",
            metadata={
                "tags": ["Finance", "Planning"],
                "library": {
                    "pinned": True,
                    "reusable": True,
                    "collections": ["board room", "q2 pack"],
                    "note": "Use this as the canonical board source.",
                },
            },
            created_at=now - timedelta(days=2),
            updated_at=now - timedelta(days=1),
        ),
    ]
    artifacts = [
        Artifact(
            id=uuid4(),
            workspace_id=workspace_id,
            document_id=documents[0].id,
            kind="presentation_export",
            title="board-deck.pptx",
            storage_key="exports/board/board-deck.pptx",
            metadata={
                "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "tags": ["Finance"],
                "library": {
                    "collections": ["q2 pack"],
                    "pinned": False,
                    "reusable": True,
                },
            },
            created_at=now,
            updated_at=now,
        ),
    ]

    dashboard = service.build_dashboard(
        workspace_id=workspace_id,
        documents=documents,
        artifacts=artifacts,
    )

    assert dashboard["stats"]["total_items"] == 2
    assert dashboard["stats"]["pinned_items"] == 1
    assert dashboard["stats"]["reusable_items"] == 2
    assert dashboard["stats"]["collection_count"] == 2
    assert dashboard["collections"][0]["name"] == "q2 pack"
    assert dashboard["collections"][0]["item_count"] == 2
    assert dashboard["top_tags"][0]["tag"] == "finance"


def test_apply_update_normalizes_tags_collections_and_clears_note():
    service = LibraryService()

    metadata = {
        "tags": ["Finance"],
        "library": {
            "pinned": False,
            "reusable": False,
            "collections": ["archive"],
            "note": "Old note",
        },
    }

    updated = service.apply_update(
        metadata,
        {
            "pinned": True,
            "reusable": True,
            "note": "   ",
            "tags": ["Finance", "board memo", "Board Memo"],
            "collections": ["Board Room", "board room", "Q2 Pack"],
        },
        preserve_tags=True,
    )

    assert updated["library"]["pinned"] is True
    assert updated["library"]["reusable"] is True
    assert updated["library"]["note"] is None
    assert updated["tags"] == ["board-memo", "finance"]
    assert updated["library"]["collections"] == ["board room", "q2 pack"]
