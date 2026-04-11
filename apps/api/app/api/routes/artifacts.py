from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_auth_context
from app.db.session import get_session
from app.schemas.artifacts import ArtifactRead
from app.services.artifacts import ArtifactService
from app.services.auth import AuthService

router = APIRouter()
artifact_service = ArtifactService()
auth_service = AuthService()


@router.get("", response_model=list[ArtifactRead])
async def list_artifacts(
    workspace_id: UUID = Query(...),
    document_id: UUID | None = Query(default=None),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[ArtifactRead]:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    artifacts = await artifact_service.list_artifacts(
        session,
        workspace_id=workspace_id,
        document_id=document_id,
    )
    return [ArtifactRead.model_validate(artifact) for artifact in artifacts]


@router.get("/{artifact_id}/download")
async def download_artifact(
    artifact_id: UUID,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    artifact = await artifact_service.get_artifact(session, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found.")

    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=artifact.workspace_id,
        min_role="viewer",
    )
    path = artifact_service.storage_path(artifact.storage_key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Artifact file is missing from storage.")

    return FileResponse(
        path=path,
        media_type=artifact_service.content_type(artifact),
        filename=artifact.title,
    )
