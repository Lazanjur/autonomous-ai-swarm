from __future__ import annotations

from time import perf_counter

import httpx

from app.core.config import get_settings
from app.services.providers.base import CompletionRequest, CompletionResult, EmbeddingRequest

settings = get_settings()


class AnthropicProvider:
    def __init__(self) -> None:
        self.client = httpx.AsyncClient(
            base_url=settings.anthropic_base_url.rstrip("/"),
            timeout=float(settings.external_request_timeout_seconds),
        )

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        if not settings.anthropic_api_key_configured:
            raise RuntimeError("Anthropic API key is not configured.")

        system_prompt = "\n\n".join(
            message.content.strip()
            for message in request.messages
            if message.role == "system" and message.content.strip()
        )
        messages = [
            {
                "role": "assistant" if message.role == "assistant" else "user",
                "content": [{"type": "text", "text": message.content}],
            }
            for message in request.messages
            if message.role != "system"
        ]
        started = perf_counter()
        response = await self.client.post(
            "/messages",
            headers={
                "x-api-key": settings.anthropic_api_key or "",
                "anthropic-version": settings.anthropic_version,
            },
            json={
                "model": request.model,
                "system": system_prompt or None,
                "messages": messages,
                "max_tokens": request.max_tokens,
                "temperature": request.temperature,
            },
        )
        response.raise_for_status()
        payload = response.json()
        latency_ms = int((perf_counter() - started) * 1000)
        content = "\n".join(
            block.get("text", "")
            for block in payload.get("content", [])
            if block.get("type") == "text"
        ).strip()
        usage = payload.get("usage") or {}
        return CompletionResult(
            content=content,
            model=request.model,
            provider="anthropic",
            latency_ms=latency_ms,
            usage=usage,
        )

    async def embed(self, request: EmbeddingRequest):
        del request
        raise RuntimeError("Anthropic embedding support is not available in this runtime.")
