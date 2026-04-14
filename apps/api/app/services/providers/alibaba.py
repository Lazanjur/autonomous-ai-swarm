from __future__ import annotations

from time import perf_counter

from openai import AsyncOpenAI

from app.core.config import get_settings
from app.services.providers.base import CompletionRequest, CompletionResult, EmbeddingRequest, EmbeddingResult

settings = get_settings()


class AlibabaCompatibleProvider:
    def __init__(self) -> None:
        self.client = AsyncOpenAI(
            api_key=settings.alibaba_api_key or "missing",
            base_url=settings.alibaba_openai_base_url,
            timeout=float(settings.external_request_timeout_seconds),
        )

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        if not settings.alibaba_api_key_configured:
            raise RuntimeError("Alibaba API key is not configured.")

        started = perf_counter()
        response = await self.client.chat.completions.create(
            model=request.model,
            messages=[message.model_dump() for message in request.messages],
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )
        latency_ms = int((perf_counter() - started) * 1000)
        content = response.choices[0].message.content or ""
        usage = response.usage.model_dump() if response.usage else {}
        return CompletionResult(
            content=content,
            model=request.model,
            provider="alibaba",
            latency_ms=latency_ms,
            usage=usage,
        )

    async def embed(self, request: EmbeddingRequest) -> EmbeddingResult:
        if not settings.alibaba_api_key_configured:
            raise RuntimeError("Alibaba API key is not configured.")

        response = await self.client.embeddings.create(
            model=request.model,
            input=request.inputs,
            dimensions=request.dimensions,
        )
        vectors = [item.embedding for item in response.data]
        return EmbeddingResult(
            vectors=vectors,
            model=request.model,
            provider="alibaba",
        )
