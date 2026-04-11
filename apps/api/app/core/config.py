import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Autonomous AI Swarm"
    app_env: str = Field(default="development", alias="APP_ENV")
    api_v1_prefix: str = "/api/v1"
    public_app_url: str = Field(default="http://localhost:3000", alias="PUBLIC_APP_URL")
    public_api_url: str = Field(default="http://localhost:8000", alias="PUBLIC_API_URL")
    debug: bool = False
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 480
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/autonomous_ai_swarm"
    async_database_url: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/autonomous_ai_swarm"
    )
    redis_url: str = "redis://localhost:6379/0"
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "artifacts"
    enable_signups: bool = True
    enable_demo_mode: bool | None = None
    auto_create_tables: bool = True
    session_ttl_hours: int = 168
    session_cookie_name: str = "swarm_session_token"
    rate_limit_enabled: bool = True
    rate_limit_requests: int = 90
    rate_limit_window_seconds: int = 60
    rate_limit_burst_requests: int = 30
    request_telemetry_retention: int = 200
    provider_budget_enforced: bool = True
    provider_budget_window_hours: int = 24
    provider_daily_cost_cap_usd: float = 25.0
    provider_budget_alert_threshold: float = 0.8
    allow_local_provider_fallback: bool | None = None
    embedding_model: str = "text-embedding-placeholder"
    embedding_dimensions: int = 1536
    retrieval_keyword_weight: float = 0.45
    retrieval_vector_weight: float = 0.55
    retrieval_trust_weight: float = 0.12
    retrieval_freshness_weight: float = 0.08
    retrieval_max_candidates: int = 128
    retrieval_default_limit: int = 8
    retrieval_max_chunks_per_document: int = 2
    automation_scheduler_enabled: bool = True
    automation_poll_interval_seconds: int = 20
    automation_default_retry_limit: int = 2
    automation_default_timeout_seconds: int = 900
    browser_enabled: bool = True
    browser_headless: bool = True
    browser_navigation_timeout_ms: int = 15000
    browser_action_timeout_ms: int = 6000
    browser_capture_screenshot: bool = True
    browser_capture_html: bool = True
    browser_capture_text_chars: int = 4000
    browser_capture_max_links: int = 8

    alibaba_api_key: str | None = Field(default=None, alias="ALIBABA_API_KEY")
    alibaba_api_host: str = Field(
        default="ws-pq02hrwmtnk68klo.eu-central-1.maas.aliyuncs.com",
        alias="ALIBABA_API_HOST",
    )
    alibaba_openai_base_url: str = Field(
        default=(
            "https://ws-pq02hrwmtnk68klo.eu-central-1.maas.aliyuncs.com/compatible-mode/v1"
        ),
        alias="ALIBABA_OPENAI_BASE_URL",
    )
    alibaba_dashscope_url: str = Field(
        default="https://ws-pq02hrwmtnk68klo.eu-central-1.maas.aliyuncs.com/api/v1",
        alias="ALIBABA_DASHSCOPE_URL",
    )

    supervisor_model: str = "qwen3.5-flash"
    research_model_fast: str = "qwen3.5-flash"
    research_model_slow: str = "qwen3.6-plus"
    analysis_model_fast: str = "qwen3.5-flash"
    analysis_model_slow: str = "qwen3-max"
    content_model_fast: str = "qwen3.5-flash"
    content_model_slow: str = "qwen3.5-plus"
    coding_model_fast: str = "qwen3-coder-flash"
    coding_model_slow: str = "qwen3-coder-plus"
    vision_model_fast: str = "qwen3-vl-flash"
    vision_model_slow: str = "qwen3-vl-plus"

    default_organization_name: str = "Demo Organization"
    default_workspace_name: str = "Strategy Lab"
    demo_user_email: str = "demo@swarm.local"
    demo_user_password: str = "DemoPass123!"
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"],
        alias="CORS_ORIGINS",
    )
    trusted_hosts: list[str] = Field(
        default_factory=lambda: ["localhost", "127.0.0.1", "api"],
        alias="TRUSTED_HOSTS",
    )

    @field_validator("cors_origins", "trusted_hosts", mode="before")
    @classmethod
    def parse_list_setting(cls, value: Any) -> Any:
        if isinstance(value, list):
            return value
        if value is None:
            return []
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                parsed = json.loads(stripped)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def demo_mode_active(self) -> bool:
        if self.enable_demo_mode is not None:
            return self.enable_demo_mode
        return not self.is_production

    @property
    def local_provider_fallback_active(self) -> bool:
        if self.allow_local_provider_fallback is not None:
            return self.allow_local_provider_fallback
        return not self.is_production


@lru_cache
def get_settings() -> Settings:
    return Settings()
