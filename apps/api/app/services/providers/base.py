from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    content: str


class CompletionRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    temperature: float = 0.2
    max_tokens: int = 1200
    metadata: dict = Field(default_factory=dict)


class CompletionResult(BaseModel):
    content: str
    model: str
    provider: str
    latency_ms: int = 0
    usage: dict = Field(default_factory=dict)
    fallback: bool = False
    estimated_cost: float = 0.0
    guardrail_reason: str | None = None


class EmbeddingRequest(BaseModel):
    model: str
    inputs: list[str]
    dimensions: int = 1536
    metadata: dict = Field(default_factory=dict)


class EmbeddingResult(BaseModel):
    vectors: list[list[float]]
    model: str
    provider: str
    fallback: bool = False
    estimated_cost: float = 0.0
    guardrail_reason: str | None = None


class ModelProvider(Protocol):
    async def complete(self, request: CompletionRequest) -> CompletionResult: ...
