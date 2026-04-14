import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Autonomous AI Swarm"
    app_env: str = Field(default="development", alias="APP_ENV")
    app_domain: str | None = Field(default=None, alias="APP_DOMAIN")
    api_v1_prefix: str = "/api/v1"
    public_app_url: str = Field(default="http://localhost:3000", alias="PUBLIC_APP_URL")
    public_api_url: str = Field(default="http://localhost:8000", alias="PUBLIC_API_URL")
    debug: bool = False
    metrics_enabled: bool = True
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
    production_backup_max_age_hours: int = 30
    secret_rotation_interval_days: int = 90
    ssl_min_valid_days: int = 21
    alert_webhook_url: str | None = None
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
    automation_retry_backoff_seconds: int = 45
    automation_notification_history_limit: int = 12
    external_request_timeout_seconds: int = 15
    notebooklm_enabled: bool = Field(default=True, alias="NOTEBOOKLM_ENABLED")
    notebooklm_storage_dir: str | None = Field(default=None, alias="NOTEBOOKLM_STORAGE_DIR")
    orchestrator_tool_loop_enabled: bool = True
    orchestrator_max_tool_iterations: int = 3
    orchestrator_max_consecutive_tool_failures: int = 2
    orchestrator_max_step_replans: int = 2
    orchestrator_continue_until_done_min_validation: float = 0.68
    browser_enabled: bool = True
    browser_headless: bool = True
    browser_navigation_timeout_ms: int = 15000
    browser_action_timeout_ms: int = 6000
    browser_capture_screenshot: bool = True
    browser_capture_html: bool = True
    browser_capture_text_chars: int = 4000
    browser_capture_max_links: int = 8

    email_from_name: str = "Autonomous AI Swarm"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_use_tls: bool = False
    smtp_starttls: bool = True
    resend_api_key: str | None = None
    resend_base_url: str = "https://api.resend.com"

    slack_bot_token: str | None = None
    slack_webhook_url: str | None = None
    slack_api_base_url: str = "https://slack.com/api"

    google_calendar_access_token: str | None = None
    google_calendar_id: str = "primary"
    google_calendar_base_url: str = "https://www.googleapis.com/calendar/v3"
    microsoft_graph_access_token: str | None = None
    microsoft_calendar_id: str = "primary"
    microsoft_graph_base_url: str = "https://graph.microsoft.com/v1.0"

    sso_google_client_id: str | None = None
    sso_microsoft_client_id: str | None = None
    sso_oidc_client_id: str | None = None
    sso_oidc_issuer_url: str | None = None
    sso_saml_entity_id: str | None = None
    sso_saml_sso_url: str | None = None

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
    demo_user_email: str = "demo@swarm.dev"
    demo_user_password: str = "DemoPass123!"
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"],
        alias="CORS_ORIGINS",
    )
    trusted_hosts: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["localhost", "127.0.0.1", "api", "testserver"],
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

    @property
    def alibaba_api_key_configured(self) -> bool:
        candidate = (self.alibaba_api_key or "").strip()
        return bool(candidate and candidate != "replace-with-real-key")


@lru_cache
def get_settings() -> Settings:
    return Settings()
