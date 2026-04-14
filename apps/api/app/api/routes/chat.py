import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.config import get_settings
from app.core.deps import AuthContext, require_auth_context
from app.db.session import get_session
from app.models.entities import ChatThread
from app.schemas.chat import (
    ChatAgentsResponse,
    ChatSearchResponse,
    ChatWorkbenchDiffResponse,
    ChatProjectCreateRequest,
    ChatRunRequest,
    ChatRunResponse,
    ChatTaskTemplatesResponse,
    ChatWorkbenchFileSaveResponse,
    ChatWorkbenchFileUpdateRequest,
    ChatThreadUpdateRequest,
    ChatWorkbenchRepoResponse,
    ChatTodoSyncRequest,
    ChatTodoSyncResponse,
    ChatTaskRailResponse,
    ChatWorkbenchFileResponse,
    ChatWorkbenchTreeResponse,
    ChatThreadCreateRequest,
    ChatWorkspaceResponse,
    DemoWorkspaceResponse,
    MessageRead,
    ProjectRead,
    ProjectSummaryRead,
    RunRead,
    RunStepRead,
    SharedMemoryRead,
    ThreadRead,
    ThreadSummaryRead,
    ToolCallRead,
)
from app.services.auth import AuthService
from app.services.storage import StorageService
from app.services.workflows.run_service import RunService

router = APIRouter()
service = RunService()
auth_service = AuthService()
settings = get_settings()
storage = StorageService()


@router.get("/workspace", response_model=ChatWorkspaceResponse)
async def get_workspace_runtime(
    workspace_id: UUID = Query(...),
    thread_id: UUID | None = Query(default=None),
    project_id: UUID | None = Query(default=None),
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
        project_id=project_id,
    )
    return ChatWorkspaceResponse(
        workspace_id=runtime["workspace"].id,
        selected_thread_id=runtime["selected_thread"].id if runtime["selected_thread"] else None,
        selected_project=(
            ProjectRead.model_validate(runtime["selected_project"])
            if runtime["selected_project"] is not None
            else None
        ),
        task_memory=(
            SharedMemoryRead.model_validate(runtime["task_memory"])
            if runtime["task_memory"] is not None
            else None
        ),
        project_memory=(
            SharedMemoryRead.model_validate(runtime["project_memory"])
            if runtime["project_memory"] is not None
            else None
        ),
        threads=[ThreadSummaryRead.model_validate(thread) for thread in runtime["threads"]],
        messages=[MessageRead.model_validate(message) for message in runtime["messages"]],
        runs=[RunRead.model_validate(run) for run in runtime["runs"]],
        run_steps=[RunStepRead.model_validate(step) for step in runtime["run_steps"]],
        tool_calls=[ToolCallRead.model_validate(call) for call in runtime["tool_calls"]],
    )


@router.get("/task-rail", response_model=ChatTaskRailResponse)
async def get_task_rail(
    workspace_id: UUID = Query(...),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatTaskRailResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    runtime = await service.get_task_rail(
        session,
        workspace_id=workspace_id,
    )
    return ChatTaskRailResponse(
        workspace_id=runtime["workspace"].id,
        projects=[ProjectSummaryRead.model_validate(project) for project in runtime["projects"]],
        threads=[ThreadSummaryRead.model_validate(thread) for thread in runtime["threads"]],
    )


@router.get("/templates", response_model=ChatTaskTemplatesResponse)
async def get_task_templates(
    workspace_id: UUID = Query(...),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatTaskTemplatesResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    payload = await service.get_task_templates(
        session,
        workspace_id=workspace_id,
    )
    return ChatTaskTemplatesResponse(
        workspace_id=payload["workspace"].id,
        templates=payload["templates"],
    )


@router.get("/search", response_model=ChatSearchResponse)
async def search_workspace(
    workspace_id: UUID = Query(...),
    q: str = Query(..., min_length=1, max_length=240),
    project_id: UUID | None = Query(default=None),
    limit: int = Query(default=24, ge=1, le=60),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatSearchResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    try:
        runtime = await service.search_workspace(
            session,
            workspace_id=workspace_id,
            query=q,
            project_id=project_id,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ChatSearchResponse(
        workspace_id=runtime["workspace"].id,
        query=runtime["query"],
        scope=runtime["scope"],
        project_id=runtime["project_id"],
        total_results=runtime["total_results"],
        result_counts=runtime["result_counts"],
        searched_fields=runtime["searched_fields"],
        results=runtime["results"],
    )


@router.get("/agents", response_model=ChatAgentsResponse)
async def get_agents_surface(
    workspace_id: UUID = Query(...),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatAgentsResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    payload = await service.get_agents_surface(
        session,
        workspace_id=workspace_id,
    )
    return ChatAgentsResponse(
        workspace_id=payload["workspace"].id,
        supervisor_model=payload["supervisor_model"],
        overview=payload["overview"],
        agents=payload["agents"],
        recent_activity=payload["recent_activity"],
    )


@router.get("/workbench/tree", response_model=ChatWorkbenchTreeResponse)
async def get_workbench_tree(
    workspace_id: UUID = Query(...),
    relative_path: str = Query(default="."),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatWorkbenchTreeResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    try:
        payload = await service.get_workbench_tree(
            session,
            workspace_id=workspace_id,
            relative_path=relative_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ChatWorkbenchTreeResponse(
        workspace_id=payload["workspace"].id,
        root_label=payload["root_label"],
        relative_path=payload["relative_path"],
        parent_relative_path=payload["parent_relative_path"],
        entries=payload["entries"],
    )


@router.get("/workbench/file", response_model=ChatWorkbenchFileResponse)
async def get_workbench_file(
    workspace_id: UUID = Query(...),
    relative_path: str = Query(..., min_length=1, max_length=1024),
    max_chars: int = Query(default=24000, ge=400, le=120000),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatWorkbenchFileResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    try:
        payload = await service.get_workbench_file(
            session,
            workspace_id=workspace_id,
            relative_path=relative_path,
            max_chars=max_chars,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ChatWorkbenchFileResponse(
        workspace_id=payload["workspace"].id,
        root_label=payload["root_label"],
        relative_path=payload["relative_path"],
        name=payload["name"],
        extension=payload["extension"],
        size_bytes=payload["size_bytes"],
        truncated=payload["truncated"],
        content=payload["content"],
    )


@router.patch("/workbench/file", response_model=ChatWorkbenchFileSaveResponse)
async def save_workbench_file(
    payload: ChatWorkbenchFileUpdateRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatWorkbenchFileSaveResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=payload.workspace_id,
        min_role="member",
    )
    try:
        result = await service.save_workbench_file(
            session,
            workspace_id=payload.workspace_id,
            relative_path=payload.relative_path,
            content=payload.content,
            create_if_missing=payload.create_if_missing,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ChatWorkbenchFileSaveResponse(
        workspace_id=result["workspace"].id,
        relative_path=result["relative_path"],
        saved_at=result["saved_at"],
        file=ChatWorkbenchFileResponse.model_validate(result["file"]),
    )


@router.get("/workbench/repo", response_model=ChatWorkbenchRepoResponse)
async def get_workbench_repo(
    workspace_id: UUID = Query(...),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatWorkbenchRepoResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    payload = await service.get_workbench_repo_status(
        session,
        workspace_id=workspace_id,
    )
    return ChatWorkbenchRepoResponse(
        workspace_id=payload["workspace"].id,
        is_repo=payload["is_repo"],
        root_label=payload["root_label"],
        branch=payload["branch"],
        head=payload["head"],
        dirty=payload["dirty"],
        summary=payload["summary"],
        changed_files=payload["changed_files"],
        staged_count=payload["staged_count"],
        unstaged_count=payload["unstaged_count"],
        untracked_count=payload["untracked_count"],
    )


@router.get("/workbench/diff", response_model=ChatWorkbenchDiffResponse)
async def get_workbench_diff(
    workspace_id: UUID = Query(...),
    relative_path: str = Query(..., min_length=1, max_length=1024),
    max_chars: int = Query(default=40000, ge=400, le=120000),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatWorkbenchDiffResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    try:
        payload = await service.get_workbench_diff(
            session,
            workspace_id=workspace_id,
            relative_path=relative_path,
            max_chars=max_chars,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ChatWorkbenchDiffResponse(
        workspace_id=payload["workspace"].id,
        relative_path=payload["relative_path"],
        compare_target=payload["compare_target"],
        has_changes=payload["has_changes"],
        status=payload["status"],
        diff=payload["diff"],
        truncated=payload["truncated"],
        note=payload["note"],
    )


@router.post("/todo-sync", response_model=ChatTodoSyncResponse)
async def sync_todo_file(
    payload: ChatTodoSyncRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ChatTodoSyncResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=payload.workspace_id,
        min_role="member",
    )
    try:
        result = await service.sync_thread_checklist_to_markdown(
            session,
            workspace_id=payload.workspace_id,
            thread_id=payload.thread_id,
            relative_path=payload.relative_path,
            heading=payload.heading,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ChatTodoSyncResponse(
        workspace_id=result["workspace"].id,
        thread_id=result["thread"].id,
        relative_path=result["relative_path"],
        created=result["created"],
        total_items=result["total_items"],
        completed_items=result["completed_items"],
        file=ChatWorkbenchFileResponse.model_validate(result["file"]),
    )


@router.get("/workbench/download")
async def download_workbench_file(
    workspace_id: UUID = Query(...),
    relative_path: str = Query(..., min_length=1, max_length=1024),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    try:
        path = service.resolve_workbench_path(relative_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not path.exists() or path.is_dir():
        raise HTTPException(status_code=404, detail="Workbench file not found.")

    return FileResponse(
        path=path,
        filename=path.name,
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
        selected_project=(
            ProjectRead.model_validate(runtime["selected_project"])
            if runtime["selected_project"] is not None
            else None
        ),
        task_memory=(
            SharedMemoryRead.model_validate(runtime["task_memory"])
            if runtime["task_memory"] is not None
            else None
        ),
        project_memory=(
            SharedMemoryRead.model_validate(runtime["project_memory"])
            if runtime["project_memory"] is not None
            else None
        ),
        threads=[ThreadSummaryRead.model_validate(thread) for thread in runtime["threads"]],
        messages=[MessageRead.model_validate(message) for message in runtime["messages"]],
        runs=[RunRead.model_validate(run) for run in runtime["runs"]],
        run_steps=[RunStepRead.model_validate(step) for step in runtime["run_steps"]],
        tool_calls=[ToolCallRead.model_validate(call) for call in runtime["tool_calls"]],
    )


@router.get("/tool-artifacts/download")
async def download_tool_artifact(
    workspace_id: UUID = Query(...),
    storage_key: str = Query(..., min_length=1, max_length=1024),
    filename: str | None = Query(default=None, max_length=255),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    try:
        path = storage.resolve(storage_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not path.exists():
        raise HTTPException(status_code=404, detail="Tool artifact not found.")

    return FileResponse(
        path=path,
        media_type=storage.guess_content_type(storage_key),
        filename=filename or path.name,
    )


@router.get("/tool-artifacts/preview")
async def preview_tool_artifact(
    workspace_id: UUID = Query(...),
    storage_key: str = Query(..., min_length=1, max_length=1024),
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=workspace_id,
        min_role="viewer",
    )
    try:
        path = storage.resolve(storage_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not path.exists():
        raise HTTPException(status_code=404, detail="Tool artifact not found.")

    return FileResponse(
        path=path,
        media_type=storage.guess_content_type(storage_key),
        content_disposition_type="inline",
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
    try:
        thread = await service.create_thread(
            session,
            workspace_id=payload.workspace_id,
            project_id=payload.project_id,
            title=payload.title,
            actor_id=context.user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ThreadRead.model_validate(thread)


@router.patch("/threads/{thread_id}", response_model=ThreadRead)
async def update_thread(
    thread_id: UUID,
    payload: ChatThreadUpdateRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ThreadRead:
    thread_result = await session.execute(select(ChatThread).where(ChatThread.id == thread_id))
    thread = thread_result.scalar_one_or_none()
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found.")
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=thread.workspace_id,
        min_role="member",
    )
    try:
        updated_thread = await service.update_thread(
            session,
            thread_id=thread_id,
            title=payload.title,
            status=payload.status,
            metadata_updates=payload.metadata_updates,
            actor_id=context.user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ThreadRead.model_validate(updated_thread)


@router.post("/threads/{thread_id}/fork", response_model=ThreadRead)
async def fork_thread(
    thread_id: UUID,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ThreadRead:
    thread_result = await session.execute(select(ChatThread).where(ChatThread.id == thread_id))
    thread = thread_result.scalar_one_or_none()
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found.")
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=thread.workspace_id,
        min_role="member",
    )
    try:
        forked_thread = await service.fork_thread(
            session,
            thread_id=thread_id,
            actor_id=context.user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ThreadRead.model_validate(forked_thread)


@router.post("/projects", response_model=ProjectRead)
async def create_project(
    payload: ChatProjectCreateRequest,
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> ProjectRead:
    await auth_service.assert_workspace_access(
        session,
        user_id=context.user.id,
        workspace_id=payload.workspace_id,
        min_role="member",
    )
    try:
        project = await service.create_project(
            session,
            workspace_id=payload.workspace_id,
            name=payload.name,
            description=payload.description,
            connectors=payload.connectors,
            actor_id=context.user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ProjectRead.model_validate(project)


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
