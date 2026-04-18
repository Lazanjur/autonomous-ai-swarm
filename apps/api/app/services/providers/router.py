from __future__ import annotations

import hashlib
import math
from collections import Counter
from typing import Any

from app.core.config import get_settings
from app.core.request_context import get_runtime_request_context
from app.services.ops import ops_telemetry
from app.services.providers.alibaba import AlibabaCompatibleProvider
from app.services.providers.anthropic import AnthropicProvider
from app.services.providers.base import CompletionRequest, CompletionResult, EmbeddingRequest, EmbeddingResult
from app.services.providers.catalog import infer_provider_key
from app.services.providers.gemini import GeminiProvider
from app.services.providers.openai_provider import OpenAIProvider
from app.services.usage import UsageAccountingService

settings = get_settings()


class MockLocalProvider:
    async def complete(self, request: CompletionRequest) -> CompletionResult:
        user_prompt = next(
            (message.content for message in reversed(request.messages) if message.role == "user"),
            "",
        )
        system_prompt = next(
            (message.content for message in request.messages if message.role == "system"),
            "",
        )
        content = (
            f"Fallback provider generated a structured response for model `{request.model}`.\n\n"
            f"System focus: {system_prompt[:180]}\n\n"
            f"User request summary: {user_prompt[:500]}\n\n"
            "Recommended output:\n"
            "1. Clarify goals and constraints.\n"
            "2. Build a concrete execution plan.\n"
            "3. Return high-signal actions, risks, and deliverables.\n"
            "4. Capture assumptions and next steps."
        )
        return CompletionResult(
            content=content,
            model=request.model,
            provider="mock-local",
            fallback=True,
        )

    async def embed(self, request: EmbeddingRequest) -> EmbeddingResult:
        vectors = [self._deterministic_embedding(text, request.dimensions) for text in request.inputs]
        return EmbeddingResult(
            vectors=vectors,
            model=request.model,
            provider="mock-local",
            fallback=True,
        )

    def _deterministic_embedding(self, text: str, dimensions: int) -> list[float]:
        vector = [0.0] * dimensions
        tokens = [token.strip().lower() for token in text.split() if token.strip()]
        if not tokens:
            return vector

        counts = Counter(tokens)
        for token, frequency in counts.items():
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            bucket = int.from_bytes(digest[:8], "big") % dimensions
            sign = 1.0 if (digest[8] % 2 == 0) else -1.0
            vector[bucket] += float(frequency) * sign

        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0:
            return vector
        return [value / norm for value in vector]


class ProviderRouter:
    def __init__(self) -> None:
        self.providers: dict[str, Any] = {
            "alibaba": AlibabaCompatibleProvider(),
            "openai": OpenAIProvider(),
            "anthropic": AnthropicProvider(),
            "gemini": GeminiProvider(),
        }
        self.mock = MockLocalProvider()
        self.usage = UsageAccountingService()

    async def complete(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.2,
        max_tokens: int = 1200,
        metadata: dict[str, Any] | None = None,
    ) -> CompletionResult:
        request = CompletionRequest(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
            metadata=metadata or {},
        )

        budget = await self.usage.budget_snapshot(request.metadata)
        if self._should_force_fallback(budget):
            if not settings.local_provider_fallback_active:
                ops_telemetry.record_alert(
                    level="error",
                    code="provider_budget_exceeded",
                    message="Provider budget was exceeded and local fallback is disabled in the current environment.",
                    context={
                        "request_id": get_runtime_request_context().request_id,
                        "model": model,
                        "workspace_id": request.metadata.get("workspace_id"),
                    },
                )
                raise RuntimeError("Provider budget exceeded and local fallback is disabled.")
            result = await self.mock.complete(request)
            result.guardrail_reason = "budget_exceeded"
            await self._record_completion_usage(request, result, budget=budget)
            return result

        provider_key = self._resolve_provider_key(request.model)
        try:
            result = await self._complete_with_provider(provider_key, request)
        except Exception as exc:
            ops_telemetry.record_alert(
                level="warning",
                code="provider_completion_fallback",
                message="Primary provider completion failed and the router fell back to the local provider.",
                context={
                    "request_id": get_runtime_request_context().request_id,
                    "model": model,
                    "provider": provider_key,
                    "error": f"{exc.__class__.__name__}: {exc}",
                },
            )
            if not settings.local_provider_fallback_active:
                raise RuntimeError(
                    "Primary provider completion failed and local fallback is disabled."
                ) from exc
            result = await self.mock.complete(request)
            result.guardrail_reason = "provider_error_fallback"

        await self._record_completion_usage(request, result, budget=budget)
        return result

    async def embed(
        self,
        texts: list[str],
        *,
        model: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> EmbeddingResult:
        request = EmbeddingRequest(
            model=model or settings.embedding_model,
            inputs=texts,
            dimensions=settings.embedding_dimensions,
            metadata=metadata or {},
        )

        budget = await self.usage.budget_snapshot(request.metadata)
        if self._should_force_fallback(budget):
            if not settings.local_provider_fallback_active:
                ops_telemetry.record_alert(
                    level="error",
                    code="embedding_budget_exceeded",
                    message="Embedding budget was exceeded and local fallback is disabled in the current environment.",
                    context={
                        "request_id": get_runtime_request_context().request_id,
                        "model": request.model,
                        "workspace_id": request.metadata.get("workspace_id"),
                    },
                )
                raise RuntimeError("Provider budget exceeded and local embedding fallback is disabled.")
            result = await self.mock.embed(request)
            result.guardrail_reason = "budget_exceeded"
            await self._record_embedding_usage(request, result, budget=budget)
            return result

        provider_key = self._resolve_provider_key(request.model)
        try:
            result = await self._embed_with_provider(provider_key, request)
        except Exception as exc:
            ops_telemetry.record_alert(
                level="warning",
                code="provider_embedding_fallback",
                message="Primary provider embedding call failed and the router fell back to the local provider.",
                context={
                    "request_id": get_runtime_request_context().request_id,
                    "model": request.model,
                    "provider": provider_key,
                    "error": f"{exc.__class__.__name__}: {exc}",
                },
            )
            if not settings.local_provider_fallback_active:
                raise RuntimeError(
                    "Primary provider embedding failed and local fallback is disabled."
                ) from exc
            result = await self.mock.embed(request)
            result.guardrail_reason = "provider_error_fallback"

        await self._record_embedding_usage(request, result, budget=budget)
        return result

    async def _record_completion_usage(
        self,
        request: CompletionRequest,
        result: CompletionResult,
        *,
        budget: dict[str, Any],
    ) -> None:
        result.estimated_cost = await self.usage.record_completion(request=request, result=result)
        self._emit_provider_telemetry(
            provider=result.provider,
            model=result.model,
            operation="completion",
            fallback=result.fallback,
            latency_ms=result.latency_ms,
            guardrail_reason=result.guardrail_reason,
            metadata=request.metadata,
        )
        self._emit_budget_alert_if_needed(budget, result.estimated_cost, request.metadata)

    async def _record_embedding_usage(
        self,
        request: EmbeddingRequest,
        result: EmbeddingResult,
        *,
        budget: dict[str, Any],
    ) -> None:
        result.estimated_cost = await self.usage.record_embedding(request=request, result=result)
        self._emit_provider_telemetry(
            provider=result.provider,
            model=result.model,
            operation="embedding",
            fallback=result.fallback,
            latency_ms=0,
            guardrail_reason=result.guardrail_reason,
            metadata=request.metadata,
        )
        self._emit_budget_alert_if_needed(budget, result.estimated_cost, request.metadata)

    def _should_force_fallback(self, budget: dict[str, Any]) -> bool:
        return bool(
            settings.provider_budget_enforced
            and budget["cap_usd"] > 0
            and budget["current_spend_usd"] >= budget["cap_usd"]
        )

    def _emit_provider_telemetry(
        self,
        *,
        provider: str,
        model: str,
        operation: str,
        fallback: bool,
        latency_ms: int,
        guardrail_reason: str | None,
        metadata: dict[str, Any],
    ) -> None:
        runtime_context = get_runtime_request_context()
        ops_telemetry.record_provider_call(
            provider=provider,
            model=model,
            operation=operation,
            latency_ms=latency_ms,
            fallback=fallback,
            guardrail_reason=guardrail_reason,
            request_id=runtime_context.request_id,
            workspace_id=str(metadata.get("workspace_id")) if metadata.get("workspace_id") else runtime_context.workspace_id,
        )

    def _emit_budget_alert_if_needed(
        self,
        budget: dict[str, Any],
        estimated_cost: float,
        metadata: dict[str, Any],
    ) -> None:
        cap = float(budget.get("cap_usd") or 0.0)
        if cap <= 0:
            return
        current = float(budget.get("current_spend_usd") or 0.0)
        projected = current + estimated_cost
        if current < cap * settings.provider_budget_alert_threshold <= projected:
            ops_telemetry.record_alert(
                level="warning",
                code="provider_budget_threshold",
                message="Provider spend crossed the configured alert threshold.",
                context={
                    "workspace_id": str(metadata.get("workspace_id")) if metadata.get("workspace_id") else None,
                    "cap_usd": cap,
                    "projected_spend_usd": round(projected, 6),
                    "threshold": settings.provider_budget_alert_threshold,
                },
            )

    def _resolve_provider_key(self, model: str) -> str:
        provider_key = infer_provider_key(model)
        return provider_key if provider_key in self.providers else "alibaba"

    async def _complete_with_provider(
        self,
        provider_key: str,
        request: CompletionRequest,
    ) -> CompletionResult:
        provider = self.providers.get(provider_key)
        if provider is None:
            raise RuntimeError(f"No provider is registered for key `{provider_key}`.")
        return await provider.complete(request)

    async def _embed_with_provider(
        self,
        provider_key: str,
        request: EmbeddingRequest,
    ) -> EmbeddingResult:
        provider = self.providers.get(provider_key)
        if provider is None:
            raise RuntimeError(f"No provider is registered for key `{provider_key}`.")
        embed = getattr(provider, "embed", None)
        if embed is None:
            raise RuntimeError(f"Provider `{provider_key}` does not support embeddings.")
        return await embed(request)
