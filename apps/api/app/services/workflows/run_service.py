from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.request_context import update_runtime_request_context
from app.models.entities import (
    AuditLog,
    ChatThread,
    Message,
    Run,
    RunStep,
    ToolCall,
    Workspace,
    utc_now,
)
from app.schemas.chat import ChatRunRequest
from app.services.agents.orchestrator import SupervisorOrchestrator

settings = get_settings()


class RunService:
    def __init__(self) -> None:
        self.orchestrator = SupervisorOrchestrator()

    async def list_workspace_threads(
        self,
        session: AsyncSession,
        workspace_id,
    ) -> tuple[Workspace, list[ChatThread]]:
        workspace_result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
        workspace = workspace_result.scalar_one()
        result = await session.execute(
            select(ChatThread)
            .where(ChatThread.workspace_id == workspace.id)
            .order_by(desc(ChatThread.updated_at), desc(ChatThread.created_at))
        )
        threads = list(result.scalars().all())
        if not threads:
            thread = ChatThread(
                workspace_id=workspace.id,
                title="General assistant",
                status="active",
            )
            session.add(thread)
            await session.commit()
            await session.refresh(thread)
            threads = [thread]
        return workspace, threads

    async def list_thread_runs(
        self,
        session: AsyncSession,
        thread_id,
        *,
        limit: int = 15,
    ) -> list[Run]:
        result = await session.execute(
            select(Run)
            .where(Run.thread_id == thread_id)
            .order_by(desc(Run.created_at))
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_messages(self, session: AsyncSession, thread_id) -> list[Message]:
        result = await session.execute(
            select(Message).where(Message.thread_id == thread_id).order_by(Message.created_at)
        )
        return list(result.scalars().all())

    async def get_chat_workspace(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        thread_id=None,
        run_limit: int = 15,
    ) -> dict[str, Any]:
        workspace, threads = await self.list_workspace_threads(session, workspace_id)
        selected_thread = None
        if thread_id is not None:
            selected_thread = next((thread for thread in threads if thread.id == thread_id), None)
        if selected_thread is None and threads:
            selected_thread = threads[0]

        thread_summaries = await self._build_thread_summaries(session, threads)
        messages = await self.get_messages(session, selected_thread.id) if selected_thread else []
        runs = await self.list_thread_runs(session, selected_thread.id, limit=run_limit) if selected_thread else []
        return {
            "workspace": workspace,
            "selected_thread": selected_thread,
            "threads": thread_summaries,
            "messages": messages,
            "runs": runs,
        }

    async def create_thread(
        self,
        session: AsyncSession,
        *,
        workspace_id,
        title: str | None = None,
        actor_id=None,
    ) -> ChatThread:
        thread = ChatThread(
            workspace_id=workspace_id,
            title=(title or "New thread").strip()[:255] or "New thread",
            status="active",
        )
        session.add(thread)
        session.add(
            AuditLog(
                actor_id=actor_id,
                workspace_id=workspace_id,
                action="thread.created",
                resource_type="thread",
                resource_id=str(thread.id),
                details={"title": thread.title},
            )
        )
        await session.commit()
        await session.refresh(thread)
        return thread

    async def create_run(
        self,
        session: AsyncSession,
        payload: ChatRunRequest,
        *,
        actor_id=None,
    ) -> tuple[ChatThread, Run, list[Message]]:
        thread = await self._resolve_thread(session, payload, actor_id=actor_id)
        run = await self._start_run(session, payload=payload, thread=thread)
        update_runtime_request_context(
            user_id=str(actor_id) if actor_id else None,
            workspace_id=str(payload.workspace_id),
            run_id=str(run.id),
        )
        try:
            result = await self.orchestrator.execute(
                payload.message,
                metadata={
                    "workspace_id": str(payload.workspace_id),
                    "run_id": str(run.id),
                    "actor_id": str(actor_id) if actor_id else None,
                },
            )
            _, finalized_run, messages = await self._finalize_run(
                session,
                payload=payload,
                thread=thread,
                run=run,
                result=result,
                actor_id=actor_id,
            )
            return thread, finalized_run, messages
        except Exception as exc:
            await self._mark_run_failed(
                session,
                thread=thread,
                run=run,
                actor_id=actor_id,
                error=str(exc),
            )
            raise

    async def stream_run(
        self,
        session: AsyncSession,
        payload: ChatRunRequest,
        *,
        actor_id=None,
    ) -> AsyncIterator[dict[str, object]]:
        thread = await self._resolve_thread(session, payload, actor_id=actor_id)
        run = await self._start_run(session, payload=payload, thread=thread)
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        update_runtime_request_context(
            user_id=str(actor_id) if actor_id else None,
            workspace_id=str(payload.workspace_id),
            run_id=str(run.id),
        )

        async def emit(event: str, data: dict) -> None:
            await queue.put({"event": event, "data": data})

        async def worker() -> None:
            try:
                await emit(
                    "thread",
                    {
                        "thread_id": str(thread.id),
                        "workspace_id": str(thread.workspace_id),
                        "title": thread.title,
                    },
                )
                await emit(
                    "run.created",
                    {
                        "run_id": str(run.id),
                        "thread_id": str(thread.id),
                        "workspace_id": str(run.workspace_id),
                        "status": run.status,
                        "created_at": run.created_at.isoformat(),
                        "user_message": run.user_message,
                    },
                )
                result = await self.orchestrator.execute(
                    payload.message,
                    metadata={
                        "workspace_id": str(payload.workspace_id),
                        "run_id": str(run.id),
                        "actor_id": str(actor_id) if actor_id else None,
                    },
                    event_handler=emit,
                )
                _, finalized_run, _ = await self._finalize_run(
                    session,
                    payload=payload,
                    result=result,
                    thread=thread,
                    run=run,
                    actor_id=actor_id,
                )
                await emit(
                    "final",
                    {
                        "response": result["final_response"],
                        "summary": result["summary"],
                        "citations": result["citations"],
                        "execution_batches": result.get("execution_batches", []),
                        "scratchpad": result.get("scratchpad", {}),
                    },
                )
                await emit(
                    "run.persisted",
                    {
                        "run_id": str(finalized_run.id),
                        "thread_id": str(thread.id),
                        "status": finalized_run.status,
                    },
                )
            except Exception as exc:
                await self._mark_run_failed(
                    session,
                    thread=thread,
                    run=run,
                    actor_id=actor_id,
                    error=str(exc),
                )
                await emit(
                    "error",
                    {
                        "message": str(exc),
                        "type": exc.__class__.__name__,
                    },
                )
                await emit(
                    "run.persisted",
                    {
                        "run_id": str(run.id),
                        "thread_id": str(thread.id),
                        "status": "failed",
                    },
                )
            finally:
                await emit("done", {"status": "finished"})

        worker_task = asyncio.create_task(worker())
        try:
            while True:
                event = await queue.get()
                yield event
                if event["event"] == "done":
                    break
        finally:
            await worker_task

    async def _resolve_thread(
        self,
        session: AsyncSession,
        payload: ChatRunRequest,
        *,
        actor_id=None,
    ) -> ChatThread:
        if payload.thread_id:
            result = await session.execute(select(ChatThread).where(ChatThread.id == payload.thread_id))
            thread = result.scalar_one_or_none()
            if thread is None:
                raise ValueError("Thread not found.")
            if thread.workspace_id != payload.workspace_id:
                raise ValueError("Thread does not belong to the requested workspace.")
            return thread
        return await self.create_thread(
            session,
            workspace_id=payload.workspace_id,
            title=payload.message[:70],
            actor_id=actor_id,
        )

    async def _start_run(
        self,
        session: AsyncSession,
        *,
        payload: ChatRunRequest,
        thread: ChatThread,
    ) -> Run:
        thread.updated_at = utc_now()
        if thread.title in {"General assistant", "New thread"}:
            thread.title = payload.message[:70]

        run = Run(
            thread_id=thread.id,
            workspace_id=payload.workspace_id,
            status="running",
            supervisor_model=settings.supervisor_model,
            user_message=payload.message,
        )
        session.add(run)
        await session.flush()

        session.add(
            Message(
                thread_id=thread.id,
                run_id=run.id,
                role="user",
                content=payload.message,
            )
        )
        await session.commit()
        await session.refresh(thread)
        await session.refresh(run)
        return run

    async def _finalize_run(
        self,
        session: AsyncSession,
        *,
        payload: ChatRunRequest,
        result: dict[str, Any],
        thread: ChatThread,
        run: Run,
        actor_id=None,
    ) -> tuple[ChatThread, Run, list[Message]]:
        thread.updated_at = utc_now()
        run.status = "completed"
        run.plan = result["plan"]
        run.final_response = result["final_response"]
        run.summary = result["summary"]

        session.add(
            Message(
                thread_id=thread.id,
                run_id=run.id,
                role="assistant",
                content=result["final_response"],
                citations=result["citations"],
                metadata={
                    "summary": result["summary"],
                    "execution_batches": result.get("execution_batches", []),
                    "scratchpad": result.get("scratchpad", {}),
                },
            )
        )

        for step in result["steps"]:
            run_step = RunStep(
                run_id=run.id,
                agent_name=step["agent_name"],
                step_index=step["step_index"],
                status="completed",
                confidence=step["confidence"],
                input_payload={"prompt": payload.message},
                output_payload={
                    "content": step["content"],
                    "model": step["model"],
                    "provider": step["provider"],
                    "fallback": step["fallback"],
                    "dependencies": step.get("dependencies", []),
                    "execution_mode": step.get("execution_mode"),
                    "batch_index": step.get("batch_index"),
                    "validation": step.get("validation", {}),
                    "expected_output": step.get("expected_output"),
                },
            )
            session.add(run_step)
            await session.flush()
            for tool in step.get("tools", []):
                session.add(
                    ToolCall(
                        run_step_id=run_step.id,
                        tool_name=tool.get("tool") or ("web_search" if tool.get("query") else "tool_context"),
                        status="completed",
                        input_payload={"prompt": payload.message},
                        output_payload=tool,
                    )
                )

        session.add(
            AuditLog(
                actor_id=actor_id,
                workspace_id=payload.workspace_id,
                action="run.completed",
                resource_type="run",
                resource_id=str(run.id),
                details={
                    "thread_id": str(thread.id),
                    "plan_length": len(result["plan"]),
                    "execution_batches": result.get("execution_batches", []),
                },
            )
        )

        await session.commit()
        await session.refresh(thread)
        await session.refresh(run)
        messages = await self.get_messages(session, thread.id)
        return thread, run, messages

    async def _mark_run_failed(
        self,
        session: AsyncSession,
        *,
        thread: ChatThread,
        run: Run,
        actor_id=None,
        error: str,
    ) -> None:
        thread.updated_at = utc_now()
        run.status = "failed"
        run.summary = error[:500]
        session.add(
            AuditLog(
                actor_id=actor_id,
                workspace_id=run.workspace_id,
                action="run.failed",
                resource_type="run",
                resource_id=str(run.id),
                details={"thread_id": str(thread.id), "error": error[:1000]},
            )
        )
        await session.commit()

    async def _build_thread_summaries(
        self,
        session: AsyncSession,
        threads: list[ChatThread],
    ) -> list[dict[str, Any]]:
        if not threads:
            return []

        thread_ids = [thread.id for thread in threads]
        message_count_rows = await session.execute(
            select(Message.thread_id, func.count(Message.id))
            .where(Message.thread_id.in_(thread_ids))
            .group_by(Message.thread_id)
        )
        run_count_rows = await session.execute(
            select(Run.thread_id, func.count(Run.id))
            .where(Run.thread_id.in_(thread_ids))
            .group_by(Run.thread_id)
        )
        latest_messages_rows = await session.execute(
            select(Message)
            .where(Message.thread_id.in_(thread_ids))
            .order_by(Message.thread_id, desc(Message.created_at))
        )

        message_counts = {thread_id: int(count) for thread_id, count in message_count_rows.all()}
        run_counts = {thread_id: int(count) for thread_id, count in run_count_rows.all()}
        latest_messages: dict[Any, Message] = {}
        for message in latest_messages_rows.scalars().all():
            latest_messages.setdefault(message.thread_id, message)

        summaries: list[dict[str, Any]] = []
        for thread in threads:
            latest_message = latest_messages.get(thread.id)
            summaries.append(
                {
                    "id": thread.id,
                    "workspace_id": thread.workspace_id,
                    "title": thread.title,
                    "status": thread.status,
                    "created_at": thread.created_at,
                    "updated_at": thread.updated_at,
                    "message_count": message_counts.get(thread.id, 0),
                    "run_count": run_counts.get(thread.id, 0),
                    "last_message_preview": (
                        latest_message.content[:180] if latest_message is not None else None
                    ),
                    "last_activity_at": thread.updated_at,
                }
            )
        return summaries
