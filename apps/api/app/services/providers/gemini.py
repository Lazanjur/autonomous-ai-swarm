from __future__ import annotations

from time import perf_counter

import httpx

from app.core.config import get_settings
from app.services.providers.base import CompletionRequest, CompletionResult, EmbeddingRequest, EmbeddingResult

settings = get_settings()


class GeminiProvider:
    def __init__(self) -> None:
        self.client = httpx.AsyncClient(
            base_url=settings.gemini_base_url.rstrip("/"),
            timeout=float(settings.external_request_timeout_seconds),
        )

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        if not settings.gemini_api_key_configured:
            raise RuntimeError("Gemini API key is not configured.")

        system_prompt = "\n\n".join(
            message.content.strip()
            for message in request.messages
            if message.role == "system" and message.content.strip()
        )
        contents = [
            {
                "role": "model" if message.role == "assistant" else "user",
                "parts": [{"text": message.content}],
            }
            for message in request.messages
            if message.role != "system"
        ]
        started = perf_counter()
        response = await self.client.post(
            f"/models/{request.model}:generateContent",
            params={"key": settings.gemini_api_key or ""},
            json={
                "systemInstruction": {"parts": [{"text": system_prompt}]} if system_prompt else None,
                "contents": contents,
                "generationConfig": {
                    "temperature": request.temperature,
                    "maxOutputTokens": request.max_tokens,
                },
            },
        )
        response.raise_for_status()
        payload = response.json()
        latency_ms = int((perf_counter() - started) * 1000)
        content = "\n".join(
            part.get("text", "")
            for candidate in payload.get("candidates", [])
            for part in candidate.get("content", {}).get("parts", [])
            if part.get("text")
        ).strip()
        usage = payload.get("usageMetadata") or {}
        return CompletionResult(
            content=content,
            model=request.model,
            provider="gemini",
            latency_ms=latency_ms,
            usage=usage,
        )

    async def embed(self, request: EmbeddingRequest) -> EmbeddingResult:
        if not settings.gemini_api_key_configured:
            raise RuntimeError("Gemini API key is not configured.")

        vectors: list[list[float]] = []
        for text in request.inputs:
            response = await self.client.post(
                f"/models/{request.model}:embedContent",
                params={"key": settings.gemini_api_key or ""},
                json={
                    "model": f"models/{request.model}",
                    "content": {
                        "parts": [{"text": text}],
                    },
                    "outputDimensionality": request.dimensions,
                },
            )
            response.raise_for_status()
            payload = response.json()
            values = payload.get("embedding", {}).get("values") or []
            vectors.append(list(values))

        return EmbeddingResult(
            vectors=vectors,
            model=request.model,
            provider="gemini",
        )
