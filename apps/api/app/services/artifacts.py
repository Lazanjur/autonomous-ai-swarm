from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Artifact, Document
from app.services.storage import StorageService


class ArtifactService:
    def __init__(self) -> None:
        self.storage = StorageService()

    async def create_source_file_artifact(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        document_id,
        filename: str,
        mime_type: str,
        payload: bytes,
        metadata: dict | None = None,
    ) -> Artifact:
        suffix = Path(filename).suffix or ".bin"
        key = f"source-files/{workspace_id}/{document_id}/{uuid4().hex}{suffix}"
        self.storage.save_bytes(key, payload)
        artifact = Artifact(
            workspace_id=workspace_id,
            document_id=document_id,
            kind="source_file",
            title=filename,
            storage_key=key,
            metadata={"mime_type": mime_type, **(metadata or {})},
        )
        session.add(artifact)
        await session.flush()
        return artifact

    async def create_document_export(
        self,
        session: AsyncSession,
        *,
        document: Document,
        format: str = "markdown",
        include_metadata: bool = True,
        title: str | None = None,
    ) -> Artifact:
        rendered, extension, mime_type = self._render_document(document, format, include_metadata)
        artifact_title = title or f"{document.title}{extension}"
        key = f"exports/{document.workspace_id}/{document.id}/{uuid4().hex}{extension}"
        self.storage.save_text(key, rendered)
        artifact = Artifact(
            workspace_id=document.workspace_id,
            document_id=document.id,
            kind="document_export",
            title=artifact_title,
            storage_key=key,
            metadata={"format": format, "mime_type": mime_type},
        )
        session.add(artifact)
        await session.flush()
        return artifact

    async def list_artifacts(self, session: AsyncSession, *, workspace_id, document_id=None) -> list[Artifact]:
        statement = select(Artifact).where(Artifact.workspace_id == workspace_id)
        if document_id:
            statement = statement.where(Artifact.document_id == document_id)
        statement = statement.order_by(desc(Artifact.created_at))
        result = await session.execute(statement)
        return list(result.scalars().all())

    async def get_artifact(self, session: AsyncSession, artifact_id) -> Artifact | None:
        result = await session.execute(select(Artifact).where(Artifact.id == artifact_id))
        return result.scalar_one_or_none()

    def storage_path(self, key: str):
        return self.storage.resolve(key)

    def content_type(self, artifact: Artifact) -> str:
        return artifact.metadata.get("mime_type") or self.storage.guess_content_type(artifact.storage_key)

    def _render_document(self, document: Document, format: str, include_metadata: bool) -> tuple[str, str, str]:
        normalized = format.lower()
        if normalized == "json":
            payload = {
                "title": document.title,
                "source_type": document.source_type,
                "source_uri": document.source_uri,
                "metadata": document.metadata if include_metadata else {},
                "content_text": document.content_text,
            }
            return json.dumps(payload, indent=2, ensure_ascii=False), ".json", "application/json"

        if normalized == "txt":
            prefix = ""
            if include_metadata:
                prefix = (
                    f"TITLE: {document.title}\nSOURCE TYPE: {document.source_type}\n"
                    f"SOURCE URI: {document.source_uri or '-'}\n\n"
                )
            return f"{prefix}{document.content_text}".strip(), ".txt", "text/plain"

        metadata_block = ""
        if include_metadata:
            metadata_lines = [
                f"- Source Type: {document.source_type}",
                f"- Source URI: {document.source_uri or '-'}",
            ]
            for key, value in document.metadata.items():
                metadata_lines.append(f"- {key.replace('_', ' ').title()}: {value}")
            metadata_block = "\n".join(metadata_lines)

        rendered = f"# {document.title}\n\n"
        if metadata_block:
            rendered += f"{metadata_block}\n\n"
        rendered += document.content_text.strip()
        return rendered, ".md", "text/markdown"
