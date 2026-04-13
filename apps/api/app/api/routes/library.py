from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_auth_context
from app.db.session import get_session
from app.schemas.library import LibraryDashboardRead, LibraryItemRead, LibraryItemUpdateRequest
from app.services.auth import AuthService
from app.services.library import LibraryService

router = APIRouter()
auth_service = AuthService()
library_service = LibraryService()


@router.get("", response_model=LibraryDashboardRead)
async def get_library_dashboard(
    workspace_id: UUID = Query(...),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> LibraryDashboardRead:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    return LibraryDashboardRead.model_validate(
        await library_service.get_dashboard(session, workspace_id)
    )


@router.patch("/{item_type}/{item_id}", response_model=LibraryItemRead)
async def update_library_item(
    item_type: str,
    item_id: UUID,
    payload: LibraryItemUpdateRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> LibraryItemRead:
    workspace_id = await library_service.get_item_workspace_id(
        session,
        item_type=item_type,
        item_id=item_id,
    )
    if workspace_id is None:
        if item_type not in {"document", "artifact"}:
            raise HTTPException(status_code=400, detail="Unsupported library item type.")
        raise HTTPException(status_code=404, detail=f"{item_type.title()} not found.")

    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="member",
    )
    try:
        item = await library_service.update_item(
            session,
            item_type=item_type,
            item_id=item_id,
            update=payload.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        detail = str(exc)
        if "Unsupported" in detail:
            raise HTTPException(status_code=400, detail=detail) from exc
        raise HTTPException(status_code=404, detail=detail) from exc
    return LibraryItemRead.model_validate(item)
