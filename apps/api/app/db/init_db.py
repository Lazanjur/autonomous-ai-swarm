from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChatThread, Workspace
from app.services.auth import AuthService

auth_service = AuthService()


async def ensure_demo_workspace(session: AsyncSession) -> Workspace:
    _, workspace = await auth_service.ensure_demo_user(session)

    thread_result = await session.execute(select(ChatThread).where(ChatThread.workspace_id == workspace.id).limit(1))
    thread = thread_result.scalar_one_or_none()
    if thread is None:
        thread = ChatThread(
            workspace_id=workspace.id,
            title="Launch strategy review",
            status="ready",
        )
        session.add(thread)
        await session.commit()
    await session.refresh(workspace)
    return workspace
