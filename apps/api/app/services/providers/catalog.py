from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from app.core.config import get_settings

settings = get_settings()


@dataclass(frozen=True)
class ProviderCapability:
    key: str
    label: str
    family: str
    supports_chat: bool
    supports_embeddings: bool
    supports_vision: bool
    detail: str


@dataclass(frozen=True)
class ModelCapability:
    name: str
    provider_key: str
    family: str
    context_window_tokens: int
    latency_tier: str = "balanced"
    supports_embeddings: bool = False
    supports_vision: bool = False
    supports_reasoning: bool = True
    supports_structured_output: bool = True
    supports_planning: bool = False
    supports_research: bool = False
    supports_coding: bool = False
    supports_ui_diagrams: bool = False
    specialties: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()


PROVIDER_CATALOG: dict[str, ProviderCapability] = {
    "alibaba": ProviderCapability(
        key="alibaba",
        label="Alibaba / Qwen",
        family="qwen",
        supports_chat=True,
        supports_embeddings=True,
        supports_vision=True,
        detail="DashScope-compatible Qwen chat, embedding, coder, and VL models.",
    ),
    "openai": ProviderCapability(
        key="openai",
        label="OpenAI",
        family="gpt",
        supports_chat=True,
        supports_embeddings=True,
        supports_vision=True,
        detail="GPT-family chat and embedding models exposed through the OpenAI API.",
    ),
    "anthropic": ProviderCapability(
        key="anthropic",
        label="Anthropic",
        family="claude",
        supports_chat=True,
        supports_embeddings=False,
        supports_vision=True,
        detail="Claude chat and reasoning models exposed through the Anthropic Messages API.",
    ),
    "gemini": ProviderCapability(
        key="gemini",
        label="Google Gemini",
        family="gemini",
        supports_chat=True,
        supports_embeddings=True,
        supports_vision=True,
        detail="Gemini multimodal chat models plus embedding endpoints from Google AI Studio.",
    ),
    "mock-local": ProviderCapability(
        key="mock-local",
        label="Local Fallback",
        family="fallback",
        supports_chat=True,
        supports_embeddings=True,
        supports_vision=False,
        detail="Deterministic local fallback used when provider access is unavailable.",
    ),
}


KNOWN_MODEL_CAPABILITIES: dict[str, ModelCapability] = {
    "qwen3.5-flash": ModelCapability(
        name="qwen3.5-flash",
        provider_key="alibaba",
        family="qwen",
        context_window_tokens=262144,
        latency_tier="fast",
        supports_planning=True,
        supports_research=True,
        supports_structured_output=True,
        specialties=("general", "planning", "research"),
    ),
    "qwen3.6-plus": ModelCapability(
        name="qwen3.6-plus",
        provider_key="alibaba",
        family="qwen",
        context_window_tokens=262144,
        latency_tier="balanced",
        supports_planning=True,
        supports_research=True,
        supports_structured_output=True,
        specialties=("research", "analysis"),
    ),
    "qwen3-max": ModelCapability(
        name="qwen3-max",
        provider_key="alibaba",
        family="qwen",
        context_window_tokens=262144,
        latency_tier="deliberate",
        supports_planning=True,
        supports_research=True,
        supports_structured_output=True,
        specialties=("analysis", "synthesis"),
    ),
    "qwen3.5-plus": ModelCapability(
        name="qwen3.5-plus",
        provider_key="alibaba",
        family="qwen",
        context_window_tokens=262144,
        latency_tier="balanced",
        supports_planning=True,
        supports_research=True,
        supports_structured_output=True,
        specialties=("content", "documentation"),
    ),
    "qwen3-coder-flash": ModelCapability(
        name="qwen3-coder-flash",
        provider_key="alibaba",
        family="qwen",
        context_window_tokens=262144,
        latency_tier="fast",
        supports_coding=True,
        supports_structured_output=True,
        specialties=("coding", "debugging"),
    ),
    "qwen3-coder-plus": ModelCapability(
        name="qwen3-coder-plus",
        provider_key="alibaba",
        family="qwen",
        context_window_tokens=262144,
        latency_tier="balanced",
        supports_coding=True,
        supports_structured_output=True,
        specialties=("coding", "architecture"),
    ),
    "qwen3-vl-flash": ModelCapability(
        name="qwen3-vl-flash",
        provider_key="alibaba",
        family="qwen",
        context_window_tokens=262144,
        latency_tier="fast",
        supports_vision=True,
        supports_research=True,
        supports_ui_diagrams=True,
        specialties=("vision", "browser", "ui"),
    ),
    "qwen3-vl-plus": ModelCapability(
        name="qwen3-vl-plus",
        provider_key="alibaba",
        family="qwen",
        context_window_tokens=262144,
        latency_tier="balanced",
        supports_vision=True,
        supports_research=True,
        supports_ui_diagrams=True,
        specialties=("vision", "browser", "ui"),
    ),
    "gpt-5.4": ModelCapability(
        name="gpt-5.4",
        provider_key="openai",
        family="gpt",
        context_window_tokens=200000,
        latency_tier="deliberate",
        supports_planning=True,
        supports_research=True,
        supports_coding=True,
        supports_ui_diagrams=True,
        supports_structured_output=True,
        specialties=("general", "planning", "coding"),
    ),
    "gpt-5.4-mini": ModelCapability(
        name="gpt-5.4-mini",
        provider_key="openai",
        family="gpt",
        context_window_tokens=200000,
        latency_tier="fast",
        supports_planning=True,
        supports_research=True,
        supports_coding=True,
        supports_ui_diagrams=True,
        supports_structured_output=True,
        specialties=("general", "planning"),
    ),
    "gpt-5.2": ModelCapability(
        name="gpt-5.2",
        provider_key="openai",
        family="gpt",
        context_window_tokens=200000,
        latency_tier="balanced",
        supports_planning=True,
        supports_research=True,
        supports_coding=True,
        supports_ui_diagrams=True,
        supports_structured_output=True,
        specialties=("general", "coding"),
    ),
    "text-embedding-3-large": ModelCapability(
        name="text-embedding-3-large",
        provider_key="openai",
        family="gpt",
        context_window_tokens=8192,
        latency_tier="balanced",
        supports_embeddings=True,
        supports_reasoning=False,
        supports_structured_output=False,
        specialties=("embeddings",),
    ),
    "claude-sonnet-4": ModelCapability(
        name="claude-sonnet-4",
        provider_key="anthropic",
        family="claude",
        context_window_tokens=200000,
        latency_tier="balanced",
        supports_planning=True,
        supports_research=True,
        supports_coding=True,
        supports_ui_diagrams=True,
        supports_structured_output=True,
        specialties=("reasoning", "analysis", "coding"),
    ),
    "claude-opus-4": ModelCapability(
        name="claude-opus-4",
        provider_key="anthropic",
        family="claude",
        context_window_tokens=200000,
        latency_tier="deliberate",
        supports_planning=True,
        supports_research=True,
        supports_coding=True,
        supports_ui_diagrams=True,
        supports_structured_output=True,
        specialties=("reasoning", "analysis", "synthesis"),
    ),
    "gemini-2.5-pro": ModelCapability(
        name="gemini-2.5-pro",
        provider_key="gemini",
        family="gemini",
        context_window_tokens=1048576,
        latency_tier="balanced",
        supports_embeddings=False,
        supports_vision=True,
        supports_planning=True,
        supports_research=True,
        supports_coding=True,
        supports_ui_diagrams=True,
        supports_structured_output=True,
        specialties=("reasoning", "multimodal", "planning"),
    ),
    "gemini-2.5-flash": ModelCapability(
        name="gemini-2.5-flash",
        provider_key="gemini",
        family="gemini",
        context_window_tokens=1048576,
        latency_tier="fast",
        supports_embeddings=False,
        supports_vision=True,
        supports_planning=True,
        supports_research=True,
        supports_coding=True,
        supports_ui_diagrams=True,
        supports_structured_output=True,
        specialties=("multimodal", "research"),
    ),
    "text-embedding-004": ModelCapability(
        name="text-embedding-004",
        provider_key="gemini",
        family="gemini",
        context_window_tokens=8192,
        latency_tier="balanced",
        supports_embeddings=True,
        supports_reasoning=False,
        supports_structured_output=False,
        specialties=("embeddings",),
    ),
}


def _configured_provider_map() -> dict[str, bool]:
    return {
        "alibaba": settings.alibaba_api_key_configured,
        "openai": settings.openai_api_key_configured,
        "anthropic": settings.anthropic_api_key_configured,
        "gemini": settings.gemini_api_key_configured,
        "mock-local": True,
    }


def configured_provider_keys() -> list[str]:
    return [key for key, configured in _configured_provider_map().items() if configured and key != "mock-local"]


def llm_models_configured() -> bool:
    return any(_configured_provider_map().get(key, False) for key in ("alibaba", "openai", "anthropic", "gemini"))


def infer_provider_key(model_name: str) -> str:
    lowered = (model_name or "").strip().lower()
    if not lowered:
        return "mock-local"
    if lowered == "mock-local":
        return "mock-local"
    if lowered.startswith("qwen"):
        return "alibaba"
    if lowered.startswith("gpt") or lowered.startswith("o1") or lowered.startswith("o3") or lowered.startswith("text-embedding-3"):
        return "openai"
    if lowered.startswith("claude"):
        return "anthropic"
    if lowered.startswith("gemini") or lowered.startswith("text-embedding-004") or lowered.startswith("embedding-001"):
        return "gemini"
    return "mock-local"


def infer_model_capability(model_name: str) -> ModelCapability:
    provider_key = infer_provider_key(model_name)
    lowered = (model_name or "").strip().lower()
    if provider_key == "alibaba":
        supports_vision = "vl" in lowered or "vision" in lowered
        supports_coding = "coder" in lowered
        specialties = tuple(
            value
            for value, enabled in (
                ("vision", supports_vision),
                ("coding", supports_coding),
                ("research", not supports_coding),
            )
            if enabled
        ) or ("general",)
        return ModelCapability(
            name=model_name,
            provider_key=provider_key,
            family="qwen",
            context_window_tokens=262144,
            latency_tier="fast" if "flash" in lowered else "balanced",
            supports_embeddings=False,
            supports_vision=supports_vision,
            supports_planning=not supports_coding,
            supports_research=True,
            supports_coding=supports_coding,
            supports_ui_diagrams=supports_vision or not supports_coding,
            specialties=specialties,
        )
    if provider_key == "openai":
        is_embedding = lowered.startswith("text-embedding")
        return ModelCapability(
            name=model_name,
            provider_key=provider_key,
            family="gpt",
            context_window_tokens=200000 if not is_embedding else 8192,
            latency_tier="fast" if "mini" in lowered else "balanced",
            supports_embeddings=is_embedding,
            supports_vision=not is_embedding,
            supports_reasoning=not is_embedding,
            supports_structured_output=not is_embedding,
            supports_planning=not is_embedding,
            supports_research=not is_embedding,
            supports_coding=not is_embedding,
            supports_ui_diagrams=not is_embedding,
            specialties=("embeddings",) if is_embedding else ("general",),
        )
    if provider_key == "anthropic":
        return ModelCapability(
            name=model_name,
            provider_key=provider_key,
            family="claude",
            context_window_tokens=200000,
            latency_tier="deliberate" if "opus" in lowered else "balanced",
            supports_vision=True,
            supports_planning=True,
            supports_research=True,
            supports_coding=True,
            supports_ui_diagrams=True,
            specialties=("reasoning", "analysis"),
        )
    if provider_key == "gemini":
        is_embedding = "embedding" in lowered
        return ModelCapability(
            name=model_name,
            provider_key=provider_key,
            family="gemini",
            context_window_tokens=1048576 if not is_embedding else 8192,
            latency_tier="fast" if "flash" in lowered else "balanced",
            supports_embeddings=is_embedding,
            supports_vision=not is_embedding,
            supports_reasoning=not is_embedding,
            supports_structured_output=not is_embedding,
            supports_planning=not is_embedding,
            supports_research=not is_embedding,
            supports_coding=not is_embedding,
            supports_ui_diagrams=not is_embedding,
            specialties=("embeddings",) if is_embedding else ("multimodal", "planning"),
        )
    return ModelCapability(
        name=model_name or "mock-local",
        provider_key="mock-local",
        family="fallback",
        context_window_tokens=32768,
        latency_tier="fast",
        supports_embeddings=True,
        supports_reasoning=True,
        supports_structured_output=True,
        supports_planning=True,
        supports_research=True,
        supports_coding=True,
        specialties=("fallback",),
        notes=("Local deterministic fallback provider",),
    )


def get_model_capability(model_name: str) -> dict[str, Any]:
    capability = KNOWN_MODEL_CAPABILITIES.get(model_name) or infer_model_capability(model_name)
    provider = PROVIDER_CATALOG[capability.provider_key]
    configured = _configured_provider_map().get(capability.provider_key, False)
    payload = asdict(capability)
    payload.update(
        {
            "provider_label": provider.label,
            "configured": configured,
            "supports_chat": provider.supports_chat,
        }
    )
    return payload


def list_provider_capabilities() -> list[dict[str, Any]]:
    configured_map = _configured_provider_map()
    providers: list[dict[str, Any]] = []
    for provider in PROVIDER_CATALOG.values():
        payload = asdict(provider)
        payload["configured"] = configured_map.get(provider.key, False)
        providers.append(payload)
    return providers


def role_model_map() -> dict[str, dict[str, str]]:
    return {
        "supervisor": {"primary": settings.supervisor_model},
        "planner": {
            "fast": settings.planner_model_fast,
            "slow": settings.planner_model_slow,
        },
        "research": {
            "fast": settings.research_model_fast,
            "slow": settings.research_model_slow,
        },
        "analysis": {
            "fast": settings.analysis_model_fast,
            "slow": settings.analysis_model_slow,
        },
        "content": {
            "fast": settings.content_model_fast,
            "slow": settings.content_model_slow,
        },
        "coding": {
            "fast": settings.coding_model_fast,
            "slow": settings.coding_model_slow,
        },
        "vision_automation": {
            "fast": settings.vision_model_fast,
            "slow": settings.vision_model_slow,
        },
        "ui_diagram": {
            "fast": settings.ui_diagram_model_fast,
            "slow": settings.ui_diagram_model_slow,
        },
        "embeddings": {"primary": settings.embedding_model},
    }


def build_role_model_catalog() -> list[dict[str, Any]]:
    models: list[str] = []
    for role_payload in role_model_map().values():
        for model_name in role_payload.values():
            if model_name and model_name not in models:
                models.append(model_name)
    return [get_model_capability(model_name) for model_name in models]
