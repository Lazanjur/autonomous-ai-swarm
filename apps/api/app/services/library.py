from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Artifact, Document, utc_now
from app.services.rag.retrieval import normalize_tag


class LibraryService:
    def __init__(self) -> None:
        self.preview_limit = 280

    async def get_dashboard(self, session: AsyncSession, workspace_id: UUID) -> dict:
        documents = list(
            (
                await session.execute(
                    select(Document)
                    .where(Document.workspace_id == workspace_id)
                    .order_by(desc(Document.created_at))
                )
            )
            .scalars()
            .all()
        )
        artifacts = list(
            (
                await session.execute(
                    select(Artifact)
                    .where(Artifact.workspace_id == workspace_id)
                    .order_by(desc(Artifact.created_at))
                )
            )
            .scalars()
            .all()
        )
        return self.build_dashboard(workspace_id=workspace_id, documents=documents, artifacts=artifacts)

    async def update_item(
        self,
        session: AsyncSession,
        *,
        item_type: str,
        item_id: UUID,
        update: dict[str, Any],
    ) -> dict:
        if item_type == "document":
            item = await self._get_document(session, item_id)
            if item is None:
                raise ValueError("Document not found.")
            item.metadata_ = self.apply_update(item.metadata_, update, preserve_tags=True)
            item.updated_at = utc_now()
            await session.commit()
            await session.refresh(item)
            return self.build_document_item(item)

        if item_type == "artifact":
            item = await self._get_artifact(session, item_id)
            if item is None:
                raise ValueError("Artifact not found.")
            item.metadata_ = self.apply_update(item.metadata_, update, preserve_tags=False)
            item.updated_at = utc_now()
            await session.commit()
            await session.refresh(item)

            linked_document_title = None
            if item.document_id is not None:
                linked_document = await self._get_document(session, item.document_id)
                linked_document_title = linked_document.title if linked_document else None
            return self.build_artifact_item(item, linked_document_title=linked_document_title)

        raise ValueError("Unsupported library item type.")

    async def get_item_workspace_id(
        self,
        session: AsyncSession,
        *,
        item_type: str,
        item_id: UUID,
    ) -> UUID | None:
        if item_type == "document":
            item = await self._get_document(session, item_id)
            return item.workspace_id if item else None
        if item_type == "artifact":
            item = await self._get_artifact(session, item_id)
            return item.workspace_id if item else None
        return None

    def build_dashboard(
        self,
        *,
        workspace_id: UUID,
        documents: list[Document],
        artifacts: list[Artifact],
    ) -> dict:
        document_titles = {str(document.id): document.title for document in documents}
        items = [self.build_document_item(document) for document in documents]
        items.extend(
            self.build_artifact_item(
                artifact,
                linked_document_title=document_titles.get(str(artifact.document_id))
                if artifact.document_id is not None
                else None,
            )
            for artifact in artifacts
        )
        items.sort(
            key=lambda item: (
                item["pinned"],
                item["reusable"],
                item["updated_at"],
                item["created_at"],
            ),
            reverse=True,
        )

        tag_counts: Counter[str] = Counter()
        collection_items: defaultdict[str, list[dict]] = defaultdict(list)
        pinned_items = 0
        reusable_items = 0
        tagged_items = 0
        unfiled_items = 0

        for item in items:
            tags = item["tags"]
            collections = item["collections"]
            if tags:
                tag_counts.update(tags)
                tagged_items += 1
            if not collections:
                unfiled_items += 1
            for collection in collections:
                collection_items[collection].append(item)
            if item["pinned"]:
                pinned_items += 1
            if item["reusable"]:
                reusable_items += 1

        collections = []
        for name, members in sorted(
            collection_items.items(),
            key=lambda pair: (-len(pair[1]), pair[0]),
        ):
            collections.append(
                {
                    "name": name,
                    "item_count": len(members),
                    "document_count": sum(1 for member in members if member["item_type"] == "document"),
                    "artifact_count": sum(1 for member in members if member["item_type"] == "artifact"),
                    "pinned_count": sum(1 for member in members if member["pinned"]),
                    "reusable_count": sum(1 for member in members if member["reusable"]),
                    "recent_titles": [member["title"] for member in members[:4]],
                }
            )

        return {
            "workspace_id": workspace_id,
            "stats": {
                "total_items": len(items),
                "total_documents": len(documents),
                "total_artifacts": len(artifacts),
                "pinned_items": pinned_items,
                "reusable_items": reusable_items,
                "collection_count": len(collections),
                "tagged_items": tagged_items,
                "unfiled_items": unfiled_items,
            },
            "collections": collections,
            "top_tags": [
                {"tag": tag, "count": count}
                for tag, count in tag_counts.most_common(8)
            ],
            "items": items,
        }

    def build_document_item(self, document: Document) -> dict:
        library_state = self.library_state(document.metadata_)
        tags = self.normalize_tags(document.metadata_.get("tags", []))
        return {
            "id": document.id,
            "item_type": "document",
            "workspace_id": document.workspace_id,
            "title": document.title,
            "subtitle": f"{document.source_type} / {document.mime_type or 'unknown mime'}",
            "status": document.status,
            "kind": document.source_type,
            "mime_type": document.mime_type,
            "source_uri": document.source_uri,
            "storage_key": None,
            "document_id": document.id,
            "artifact_id": None,
            "linked_document_id": None,
            "linked_document_title": None,
            "tags": tags,
            "collections": library_state["collections"],
            "pinned": library_state["pinned"],
            "reusable": library_state["reusable"],
            "note": library_state["note"],
            "preview_text": self.truncate(document.content_text),
            "metadata": document.metadata_,
            "created_at": document.created_at,
            "updated_at": document.updated_at,
        }

    def build_artifact_item(self, artifact: Artifact, *, linked_document_title: str | None = None) -> dict:
        library_state = self.library_state(artifact.metadata_)
        tags = self.normalize_tags(artifact.metadata_.get("tags", []))
        format_label = artifact.metadata_.get("format")
        subtitle = str(format_label) if isinstance(format_label, str) else artifact.storage_key
        return {
            "id": artifact.id,
            "item_type": "artifact",
            "workspace_id": artifact.workspace_id,
            "title": artifact.title,
            "subtitle": subtitle,
            "status": "available",
            "kind": artifact.kind,
            "mime_type": artifact.metadata_.get("mime_type"),
            "source_uri": None,
            "storage_key": artifact.storage_key,
            "document_id": artifact.document_id,
            "artifact_id": artifact.id,
            "linked_document_id": artifact.document_id,
            "linked_document_title": linked_document_title,
            "tags": tags,
            "collections": library_state["collections"],
            "pinned": library_state["pinned"],
            "reusable": library_state["reusable"],
            "note": library_state["note"],
            "preview_text": self.truncate(
                linked_document_title
                and f"Linked to {linked_document_title}"
                or f"{artifact.kind} stored at {artifact.storage_key}"
            ),
            "metadata": artifact.metadata_,
            "created_at": artifact.created_at,
            "updated_at": artifact.updated_at,
        }

    def apply_update(
        self,
        metadata: dict[str, Any] | None,
        update: dict[str, Any],
        *,
        preserve_tags: bool,
    ) -> dict[str, Any]:
        next_metadata = dict(metadata or {})
        library = self.library_state(next_metadata)

        if update.get("pinned") is not None:
            library["pinned"] = bool(update["pinned"])
        if update.get("reusable") is not None:
            library["reusable"] = bool(update["reusable"])
        if "note" in update:
            raw_note = (update.get("note") or "").strip()
            library["note"] = raw_note or None
        if update.get("collections") is not None:
            library["collections"] = self.normalize_collections(update["collections"])
        next_metadata["library"] = library

        if update.get("tags") is not None:
            next_metadata["tags"] = self.normalize_tags(update["tags"])
        elif not preserve_tags and "tags" in next_metadata:
            next_metadata["tags"] = self.normalize_tags(next_metadata.get("tags", []))

        return next_metadata

    def library_state(self, metadata: dict[str, Any] | None) -> dict[str, Any]:
        raw = metadata.get("library", {}) if isinstance(metadata, dict) else {}
        if not isinstance(raw, dict):
            raw = {}
        return {
            "pinned": bool(raw.get("pinned", False)),
            "reusable": bool(raw.get("reusable", False)),
            "note": str(raw["note"]).strip() if raw.get("note") else None,
            "collections": self.normalize_collections(raw.get("collections", [])),
        }

    def normalize_tags(self, tags: Any) -> list[str]:
        if isinstance(tags, str):
            values = [tags]
        elif isinstance(tags, (list, tuple, set)):
            values = list(tags)
        else:
            values = []
        normalized = {
            normalize_tag(str(tag))
            for tag in values
            if str(tag).strip()
        }
        return sorted(normalized)

    def normalize_collections(self, values: Any) -> list[str]:
        if isinstance(values, str):
            iterable = [values]
        elif isinstance(values, (list, tuple, set)):
            iterable = list(values)
        else:
            iterable = []
        normalized: set[str] = set()
        for value in iterable:
            label = " ".join(str(value).strip().split()).lower()
            if label:
                normalized.add(label)
        return sorted(normalized)

    def truncate(self, value: str | None) -> str | None:
        if not value:
            return None
        collapsed = " ".join(value.split())
        return collapsed[: self.preview_limit] + ("..." if len(collapsed) > self.preview_limit else "")

    async def _get_document(self, session: AsyncSession, document_id: UUID) -> Document | None:
        return await session.get(Document, document_id)

    async def _get_artifact(self, session: AsyncSession, artifact_id: UUID) -> Artifact | None:
        return await session.get(Artifact, artifact_id)
