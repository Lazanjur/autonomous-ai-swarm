import pytest

from app.core.middleware import InMemoryRateLimiter
from app.services.approval_policy import SensitiveActionPolicy
from app.services.providers.base import CompletionResult
from app.services.providers.router import ProviderRouter
from app.services.tools.notifications import NotificationDispatchTool


class FakeStorage:
    def __init__(self) -> None:
        self.saved = {}

    def save_json(self, key: str, payload):
        self.saved[key] = payload
        return f"/fake/{key}"

    def save_text(self, key: str, content: str):
        self.saved[key] = content
        return f"/fake/{key}"

    def save_bytes(self, key: str, payload: bytes):
        self.saved[key] = payload
        return f"/fake/{key}"


@pytest.mark.asyncio
async def test_in_memory_rate_limiter_blocks_after_limit():
    limiter = InMemoryRateLimiter(limit=2, window_seconds=60)

    first = await limiter.evaluate("actor")
    second = await limiter.evaluate("actor")
    third = await limiter.evaluate("actor")

    assert first["allowed"] is True
    assert second["allowed"] is True
    assert third["allowed"] is False
    assert third["remaining"] == 0


def test_sensitive_action_policy_requires_explicit_approval():
    policy = SensitiveActionPolicy()

    denied = policy.evaluate_notification_delivery(deliver=True, approval_note=None)
    allowed = policy.evaluate_browser_interaction(
        'Open https://example.com and click selector "#buy". approved',
        action_count=1,
    )

    assert denied.allowed is False
    assert denied.requires_approval is True
    assert allowed.allowed is True
    assert "approved" in allowed.matched_tokens


@pytest.mark.asyncio
async def test_notification_delivery_without_approval_is_blocked():
    tool = NotificationDispatchTool(storage=FakeStorage())

    result = await tool.send_webhook(
        url="https://example.com/webhook",
        payload={"hello": "world"},
        deliver=True,
    )

    assert result["status"] == "failed"
    assert result["reason"] == "Live external delivery requires explicit approval language."


@pytest.mark.asyncio
async def test_provider_router_uses_mock_when_budget_is_exhausted(monkeypatch):
    router = ProviderRouter()

    async def fake_budget_snapshot(metadata):
        return {
            "cap_usd": 1.0,
            "current_spend_usd": 1.0,
            "remaining_usd": 0.0,
            "utilization": 1.0,
            "window_started_at": "2026-04-11T00:00:00+00:00",
            "enforced": True,
        }

    async def fake_record_completion(*, request, result):
        return 0.0

    monkeypatch.setattr(router.usage, "budget_snapshot", fake_budget_snapshot)
    monkeypatch.setattr(router.usage, "record_completion", fake_record_completion)

    result = await router.complete(
        "qwen3.5-flash",
        "You are helpful.",
        "Give me a concise answer.",
        metadata={"workspace_id": "00000000-0000-0000-0000-000000000001"},
    )

    assert result.provider == "mock-local"
    assert result.guardrail_reason == "budget_exceeded"
    assert result.fallback is True


@pytest.mark.asyncio
async def test_provider_router_fails_closed_when_local_fallback_is_disabled(monkeypatch):
    router = ProviderRouter()

    async def fake_budget_snapshot(metadata):
        return {
            "cap_usd": 1.0,
            "current_spend_usd": 1.0,
            "remaining_usd": 0.0,
            "utilization": 1.0,
            "window_started_at": "2026-04-11T00:00:00+00:00",
            "enforced": True,
        }

    monkeypatch.setattr(router.usage, "budget_snapshot", fake_budget_snapshot)
    monkeypatch.setattr("app.services.providers.router.settings.allow_local_provider_fallback", False, raising=False)

    with pytest.raises(RuntimeError, match="Provider budget exceeded"):
        await router.complete(
            "qwen3.5-flash",
            "You are helpful.",
            "Give me a concise answer.",
            metadata={"workspace_id": "00000000-0000-0000-0000-000000000001"},
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("model_name", "provider_key"),
    [
        ("gpt-5.4", "openai"),
        ("claude-sonnet-4", "anthropic"),
        ("gemini-2.5-pro", "gemini"),
    ],
)
async def test_provider_router_routes_completion_to_matching_provider(monkeypatch, model_name, provider_key):
    router = ProviderRouter()
    calls: list[tuple[str, str]] = []

    async def fake_budget_snapshot(metadata):
        return {
            "cap_usd": 0.0,
            "current_spend_usd": 0.0,
            "remaining_usd": 0.0,
            "utilization": 0.0,
            "window_started_at": "2026-04-11T00:00:00+00:00",
            "enforced": False,
        }

    async def fake_record_completion(*, request, result):
        return 0.0

    monkeypatch.setattr(router.usage, "budget_snapshot", fake_budget_snapshot)
    monkeypatch.setattr(router.usage, "record_completion", fake_record_completion)

    for key in ("openai", "anthropic", "gemini"):
        async def fake_complete(request, *, _key=key):
            calls.append((_key, request.model))
            return CompletionResult(
                content=f"{_key} handled the request",
                model=request.model,
                provider=_key,
            )

        monkeypatch.setattr(router.providers[key], "complete", fake_complete)

    result = await router.complete(
        model_name,
        "You are helpful.",
        "Respond concisely.",
        metadata={"workspace_id": "00000000-0000-0000-0000-000000000001"},
    )

    assert result.provider == provider_key
    assert calls == [(provider_key, model_name)]
