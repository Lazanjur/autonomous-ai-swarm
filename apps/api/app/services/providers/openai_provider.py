from __future__ import annotations

from time import perf_counter

from openai import AsyncOpenAI

from app.core.config import get_settings
from app.services.providers.base import CompletionRequest, CompletionResult, EmbeddingRequest, EmbeddingResult

settings = get_settings()


class OpenAIProvider:
    def __init__(self) -> None:
        client_kwargs = {
            "api_key": settings.openai_api_key or "missing",
            "timeout": float(settings.external_request_timeout_seconds),
        }
        if settings.openai_base_url:
            client_kwargs["base_url"] = settings.openai_base_url
        self.client = AsyncOpenAI(**client_kwargs)

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        if not settings.openai_api_key_configured:
            raise RuntimeError("OpenAI API key is not configured.")

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
            provider="openai",
            latency_ms=latency_ms,
            usage=usage,
        )

    async def embed(self, request: EmbeddingRequest) -> EmbeddingResult:
        if not settings.openai_api_key_configured:
            raise RuntimeError("OpenAI API key is not configured.")

        response = await self.client.embeddings.create(
            model=request.model,
            input=request.inputs,
            dimensions=request.dimensions,
        )
        vectors = [item.embedding for item in response.data]
        return EmbeddingResult(
            vectors=vectors,
            model=request.model,
            provider="openai",
        )
