from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.entities import ChatThread, Message
from app.services.workflows.run_service import RunService


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _ScalarsResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return self

    def all(self):
        return self._values


class _SessionStub:
    def __init__(self, responses):
        self._responses = responses
        self._index = 0
        self.added = []
        self.workspace = SimpleNamespace(metadata_={})

    async def execute(self, _query):
        response = self._responses[self._index]
        self._index += 1
        return response

    def add(self, value):
        self.added.append(value)

    async def get(self, _model, _id):
        return self.workspace

    async def scalar(self, _query):
        return 0

    async def commit(self):
        return None

    async def refresh(self, _value):
        return None

    async def flush(self):
        return None


@pytest.mark.asyncio
async def test_update_thread_merges_metadata_and_status():
    service = RunService()
    thread = ChatThread(
        id=uuid4(),
        workspace_id=uuid4(),
        title="Initial task",
        status="active",
        metadata={"share_enabled": False},
    )
    session = _SessionStub([_ScalarResult(thread)])

    updated = await service.update_thread(
        session,
        thread_id=thread.id,
        title="Renamed task",
        status="paused",
        metadata_updates={"model_profile": "qwen3-max", "published": True},
    )

    assert updated.title == "Renamed task"
    assert updated.status == "paused"
    assert updated.metadata_["model_profile"] == "qwen3-max"
    assert updated.metadata_["published"] is True
    assert updated.metadata_["share_enabled"] is False


@pytest.mark.asyncio
async def test_create_thread_persists_requested_metadata():
    service = RunService()
    workspace_id = uuid4()
    session = _SessionStub([])

    created = await service.create_thread(
        session,
        workspace_id=workspace_id,
        title="Model scoped task",
        metadata={"model_profile": "qwen3-vl-plus"},
    )

    assert created.workspace_id == workspace_id
    assert created.metadata_["shared_memory"]["summary"] is None
    assert created.metadata_["model_profile"] == "qwen3-vl-plus"


@pytest.mark.asyncio
async def test_fork_thread_copies_messages_and_marks_source():
    service = RunService()
    workspace_id = uuid4()
    source_thread = ChatThread(
        id=uuid4(),
        workspace_id=workspace_id,
        title="Source task",
        status="active",
        metadata={"model_profile": "qwen3.6-plus", "published": True},
    )
    source_messages = [
        Message(
            id=uuid4(),
            thread_id=source_thread.id,
            run_id=None,
            role="user",
            content="Please deploy the app.",
            citations=[],
            metadata={},
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        ),
        Message(
            id=uuid4(),
            thread_id=source_thread.id,
            run_id=None,
            role="assistant",
            content="I will prepare the rollout plan.",
            citations=[],
            metadata={"summary": "Prepared rollout plan."},
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        ),
    ]
    session = _SessionStub([
        _ScalarResult(source_thread),
        _ScalarsResult(source_messages),
    ])

    forked = await service.fork_thread(session, thread_id=source_thread.id)

    copied_messages = [
        item for item in session.added if isinstance(item, Message) and item.thread_id == forked.id
    ]
    assert forked.title.startswith("Fork of Source task")
    assert forked.metadata_["forked_from_thread_id"] == str(source_thread.id)
    assert forked.metadata_["published"] is False
    assert len(copied_messages) == len(source_messages)
