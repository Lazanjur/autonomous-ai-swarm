from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.entities import UsageEvent, Workspace, utc_now
from app.services.providers.base import CompletionRequest, CompletionResult, EmbeddingRequest, EmbeddingResult

settings = get_settings()

MODEL_PRICING_USD_PER_1K: dict[str, dict[str, float]] = {
    "qwen3.5-flash": {"prompt": 0.0002, "completion": 0.0006},
    "qwen3.6-plus": {"prompt": 0.0008, "completion": 0.0024},
    "qwen3-max": {"prompt": 0.0015, "completion": 0.0045},
    "qwen3.5-plus": {"prompt": 0.0007, "completion": 0.0021},
    "qwen3-coder-flash": {"prompt": 0.0003, "completion": 0.0009},
    "qwen3-coder-plus": {"prompt": 0.001, "completion": 0.003},
    "qwen3-vl-flash": {"prompt": 0.0004, "completion": 0.0012},
    "qwen3-vl-plus": {"prompt": 0.0012, "completion": 0.0036},
    "text-embedding-placeholder": {"prompt": 0.00008, "completion": 0.0},
}


class UsageAccountingService:
    async def budget_snapshot(self, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        metadata = metadata or {}
        window_started_at = utc_now() - timedelta(hours=settings.provider_budget_window_hours)
        async with SessionLocal() as session:
            statement = select(func.coalesce(func.sum(UsageEvent.estimated_cost), 0.0)).where(
                UsageEvent.created_at >= window_started_at
            )
            workspace_id = self._coerce_uuid(metadata.get("workspace_id"))
            organization_id = self._coerce_uuid(metadata.get("organization_id"))
            if workspace_id is not None:
                statement = statement.where(UsageEvent.workspace_id == workspace_id)
            elif organization_id is not None:
                statement = statement.where(UsageEvent.organization_id == organization_id)

            current_spend = float((await session.execute(statement)).scalar_one() or 0.0)
            return {
                "window_started_at": window_started_at.isoformat(),
                "cap_usd": round(settings.provider_daily_cost_cap_usd, 4),
                "current_spend_usd": round(current_spend, 6),
                "remaining_usd": round(max(settings.provider_daily_cost_cap_usd - current_spend, 0.0), 6),
                "utilization": round(
                    current_spend / settings.provider_daily_cost_cap_usd,
                    4,
                )
                if settings.provider_daily_cost_cap_usd > 0
                else 0.0,
                "enforced": settings.provider_budget_enforced,
            }

    async def record_completion(
        self,
        *,
        request: CompletionRequest,
        result: CompletionResult,
    ) -> float:
        prompt_tokens = int(result.usage.get("prompt_tokens") or self._estimate_message_tokens(request))
        completion_tokens = int(
            result.usage.get("completion_tokens") or self._estimate_text_tokens(result.content)
        )
        estimated_cost = self.estimate_cost(
            provider_name=result.provider,
            model_name=result.model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )
        await self._persist_usage_event(
            metadata=request.metadata,
            provider_name=result.provider,
            model_name=result.model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            estimated_cost=estimated_cost,
        )
        return estimated_cost

    async def record_embedding(
        self,
        *,
        request: EmbeddingRequest,
        result: EmbeddingResult,
    ) -> float:
        prompt_tokens = self._estimate_input_tokens(request.inputs)
        estimated_cost = self.estimate_cost(
            provider_name=result.provider,
            model_name=result.model,
            prompt_tokens=prompt_tokens,
            completion_tokens=0,
        )
        await self._persist_usage_event(
            metadata=request.metadata,
            provider_name=result.provider,
            model_name=result.model,
            prompt_tokens=prompt_tokens,
            completion_tokens=0,
            estimated_cost=estimated_cost,
        )
        return estimated_cost

    def estimate_cost(
        self,
        *,
        provider_name: str,
        model_name: str,
        prompt_tokens: int,
        completion_tokens: int,
    ) -> float:
        if provider_name == "mock-local":
            return 0.0
        pricing = MODEL_PRICING_USD_PER_1K.get(model_name, {"prompt": 0.0004, "completion": 0.0012})
        estimated = (prompt_tokens / 1000) * pricing["prompt"] + (completion_tokens / 1000) * pricing["completion"]
        return round(estimated, 6)

    async def _persist_usage_event(
        self,
        *,
        metadata: dict[str, Any],
        provider_name: str,
        model_name: str,
        prompt_tokens: int,
        completion_tokens: int,
        estimated_cost: float,
    ) -> None:
        async with SessionLocal() as session:
            workspace_id = self._coerce_uuid(metadata.get("workspace_id"))
            organization_id = self._coerce_uuid(metadata.get("organization_id"))
            if organization_id is None and workspace_id is not None:
                workspace_result = await session.execute(
                    select(Workspace.organization_id).where(Workspace.id == workspace_id)
                )
                organization_id = workspace_result.scalar_one_or_none()

            session.add(
                UsageEvent(
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                    provider_name=provider_name,
                    model_name=model_name,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    estimated_cost=estimated_cost,
                )
            )
            await session.commit()

    def _estimate_message_tokens(self, request: CompletionRequest) -> int:
        return self._estimate_input_tokens([message.content for message in request.messages])

    def _estimate_input_tokens(self, texts: list[str]) -> int:
        return sum(self._estimate_text_tokens(text) for text in texts)

    def _estimate_text_tokens(self, text: str) -> int:
        compact = text.strip()
        if not compact:
            return 0
        return max(len(compact) // 4, len(compact.split()))

    def _coerce_uuid(self, value: Any) -> UUID | None:
        if isinstance(value, UUID):
            return value
        if isinstance(value, str) and value.strip():
            try:
                return UUID(value)
            except ValueError:
                return None
        return None
