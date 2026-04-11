import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.config import get_settings
from app.core.deps import AuthContext, require_auth_context
from app.db.session import get_session
from app.models.entities import ChatThread
from app.schemas.chat import (
    ChatRunRequest,
    ChatRunResponse,
    ChatThreadCreateRequest,
    ChatWorkspaceResponse,
    DemoWorkspaceResponse,
    MessageRead,
    RunRead,
    ThreadRead,
    ThreadSummaryRead,
)
from app.services.auth import AuthService
from app.services.workflows.run_service import RunService

router = APIRouter()
service = RunService()
auth_service = AuthService()
settings = get_settings()


@router.get("/workspace", response_model=ChatWorkspaceResponse)
async def get_workspace_runtime(
    workspace_id: UUID = Query(...),
    thread_id: UUID | None = Query(default=None),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatWorkspaceResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    runtime = await service.get_chat_workspace(
        session,
        workspace_id=workspace_id,
        thread_id=thread_id,
    )
    return ChatWorkspaceResponse(
        workspace_id=runtime["workspace"].id,
        selected_thread_id=runtime["selected_thread"].id if runtime["selected_thread"] else None,
        threads=[ThreadSummaryRead.model_validate(thread) for thread in runtime["threads"]],
        messages=[MessageRead.model_validate(message) for message in runtime["messages"]],
        runs=[RunRead.model_validate(run) for run in runtime["runs"]],
    )


@router.get("/demo", response_model=DemoWorkspaceResponse)
async def demo_workspace(
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> DemoWorkspaceResponse:
    if not settings.demo_mode_active:
        raise HTTPException(status_code=404, detail="Demo mode is disabled.")
    workspaces = await auth_service.list_workspace_access(session, context.user.id)
    if not workspaces:
        raise HTTPException(status_code=404, detail="No accessible workspaces found.")
    runtime = await service.get_chat_workspace(session, workspace_id=workspaces[0].workspace_id)
    return DemoWorkspaceResponse(
        workspace_id=runtime["workspace"].id,
        selected_thread_id=runtime["selected_thread"].id if runtime["selected_thread"] else None,
        threads=[ThreadSummaryRead.model_validate(thread) for thread in runtime["threads"]],
        messages=[MessageRead.model_validate(message) for message in runtime["messages"]],
        runs=[RunRead.model_validate(run) for run in runtime["runs"]],
    )


@router.post("/threads", response_model=ThreadRead)
async def create_thread(
    payload: ChatThreadCreateRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ThreadRead:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=payload.workspace_id,
        min_role="member",
    )
    thread = await service.create_thread(
        session,
        workspace_id=payload.workspace_id,
        title=payload.title,
        actor_id=context.user.id,
    )
    return ThreadRead.model_validate(thread)


@router.get("/threads/{thread_id}/messages", response_model=list[MessageRead])
async def list_messages(
    thread_id: UUID,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[MessageRead]:
    thread_result = await session.execute(select(ChatThread).where(ChatThread.id == thread_id))
    thread = thread_result.scalar_one_or_none()
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found.")
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=thread.workspace_id,
        min_role="viewer",
    )
    messages = await service.get_messages(session, thread_id)
    return [MessageRead.model_validate(message) for message in messages]


@router.get("/threads/{thread_id}/runs", response_model=list[RunRead])
async def list_runs(
    thread_id: UUID,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[RunRead]:
    thread_result = await session.execute(select(ChatThread).where(ChatThread.id == thread_id))
    thread = thread_result.scalar_one_or_none()
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found.")
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=thread.workspace_id,
        min_role="viewer",
    )
    runs = await service.list_thread_runs(session, thread_id)
    return [RunRead.model_validate(run) for run in runs]


@router.post("/runs", response_model=ChatRunResponse)
async def create_run(
    payload: ChatRunRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatRunResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=payload.workspace_id,
        min_role="member",
    )
    try:
        thread, run, messages = await service.create_run(session, payload, actor_id=context.user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ChatRunResponse(
        thread=ThreadRead.model_validate(thread),
        run=RunRead.model_validate(run),
        messages=[MessageRead.model_validate(message) for message in messages],
    )


@router.post("/runs/stream")
async def stream_run(
    payload: ChatRunRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> EventSourceResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=payload.workspace_id,
        min_role="member",
    )
    if payload.thread_id:
        thread_result = await session.execute(select(ChatThread).where(ChatThread.id == payload.thread_id))
        thread = thread_result.scalar_one_or_none()
        if thread is None:
            raise HTTPException(status_code=400, detail="Thread not found.")
        if thread.workspace_id != payload.workspace_id:
            raise HTTPException(
                status_code=400,
                detail="Thread does not belong to the requested workspace.",
            )

    async def event_generator():
        async for event in service.stream_run(session, payload, actor_id=context.user.id):
            yield {"event": event["event"], "data": json.dumps(event["data"])}

    return EventSourceResponse(event_generator())
