from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from app.core.config import Settings


def production_configuration_errors(settings: Settings) -> list[str]:
    if not settings.is_production:
        return []

    errors: list[str] = []
    app_domain = (settings.app_domain or "").strip().lower()
    public_app_host = _host(settings.public_app_url)
    public_api_host = _host(settings.public_api_url)
    trusted_hosts = {host.strip().lower() for host in settings.trusted_hosts}
    cors_hosts = {_host(origin) for origin in settings.cors_origins}

    if not app_domain:
        errors.append("APP_DOMAIN must be configured in production.")
    if app_domain.endswith("example.com") or app_domain == "example.com":
        errors.append("APP_DOMAIN still uses an example placeholder.")
    if not public_app_host or public_app_host != app_domain:
        errors.append("PUBLIC_APP_URL must resolve to APP_DOMAIN in production.")
    if not public_api_host or public_api_host != app_domain:
        errors.append("PUBLIC_API_URL must resolve to APP_DOMAIN in production.")
    if app_domain and app_domain not in trusted_hosts:
        errors.append("TRUSTED_HOSTS must include APP_DOMAIN.")
    if app_domain and app_domain not in cors_hosts:
        errors.append("CORS_ORIGINS must include APP_DOMAIN.")
    if settings.demo_mode_active:
        errors.append("ENABLE_DEMO_MODE must be false in production.")
    if settings.local_provider_fallback_active:
        errors.append("ALLOW_LOCAL_PROVIDER_FALLBACK must be false in production.")
    if not settings.alibaba_api_key_configured:
        errors.append("ALIBABA_API_KEY must be configured in production.")
    if _looks_like_placeholder(settings.secret_key):
        errors.append("SECRET_KEY still appears to be a placeholder.")
    if _looks_like_placeholder(settings.minio_secret_key):
        errors.append("MINIO_SECRET_KEY still appears to be a placeholder.")
    if "change-me" in settings.database_url.lower() or "change-me" in settings.async_database_url.lower():
        errors.append("Database connection strings still contain placeholder credentials.")

    return errors


def render_prometheus_metrics(
    *,
    settings: Settings,
    database_ok: bool,
    telemetry: dict[str, Any],
    budget: dict[str, Any],
    config_errors: list[str],
) -> str:
    request_counts = telemetry.get("request_counts", {})
    status_counts = telemetry.get("status_counts", {})
    provider_counts = telemetry.get("provider_counts", {})
    alerts = telemetry.get("recent_alerts", [])
    sensitive_actions = telemetry.get("recent_sensitive_actions", [])

    lines = [
        "# HELP swarm_app_up Whether the API process is serving requests.",
        "# TYPE swarm_app_up gauge",
        "swarm_app_up 1",
        "# HELP swarm_database_up Whether the primary database probe succeeded.",
        "# TYPE swarm_database_up gauge",
        f"swarm_database_up {1 if database_ok else 0}",
        "# HELP swarm_models_configured Whether upstream model credentials are configured.",
        "# TYPE swarm_models_configured gauge",
        f"swarm_models_configured {1 if settings.alibaba_api_key_configured else 0}",
        "# HELP swarm_rate_limit_enabled Whether request rate limiting is enabled.",
        "# TYPE swarm_rate_limit_enabled gauge",
        f"swarm_rate_limit_enabled {1 if settings.rate_limit_enabled else 0}",
        "# HELP swarm_provider_budget_enforced Whether spend guardrails fail closed.",
        "# TYPE swarm_provider_budget_enforced gauge",
        f"swarm_provider_budget_enforced {1 if settings.provider_budget_enforced else 0}",
        "# HELP swarm_production_config_valid Whether production posture validation passed.",
        "# TYPE swarm_production_config_valid gauge",
        f"swarm_production_config_valid {1 if not config_errors else 0}",
        "# HELP swarm_budget_utilization Budget utilization in the active window.",
        "# TYPE swarm_budget_utilization gauge",
        f"swarm_budget_utilization {float(budget.get('utilization') or 0.0):.6f}",
        "# HELP swarm_budget_remaining_usd Remaining provider budget in USD.",
        "# TYPE swarm_budget_remaining_usd gauge",
        f"swarm_budget_remaining_usd {float(budget.get('remaining_usd') or 0.0):.6f}",
        "# HELP swarm_alerts_recent_total Number of recent alerts retained in memory.",
        "# TYPE swarm_alerts_recent_total gauge",
        f"swarm_alerts_recent_total {len(alerts)}",
        "# HELP swarm_sensitive_actions_recent_total Number of recent sensitive actions retained in memory.",
        "# TYPE swarm_sensitive_actions_recent_total gauge",
        f"swarm_sensitive_actions_recent_total {len(sensitive_actions)}",
    ]

    lines.extend(
        [
            "# HELP swarm_request_total Request counters retained by the process.",
            "# TYPE swarm_request_total counter",
        ]
    )
    for key, value in sorted(request_counts.items()):
        lines.append(f'swarm_request_total{{kind="{_escape_label(key)}"}} {int(value)}')

    lines.extend(
        [
            "# HELP swarm_request_status_total Request counters grouped by status bucket.",
            "# TYPE swarm_request_status_total counter",
        ]
    )
    for status_key, value in sorted(status_counts.items()):
        lines.append(f'swarm_request_status_total{{status="{_escape_label(status_key)}"}} {int(value)}')

    lines.extend(
        [
            "# HELP swarm_provider_call_total Provider/runtime call counters retained by the process.",
            "# TYPE swarm_provider_call_total counter",
        ]
    )
    for key, value in sorted(provider_counts.items()):
        lines.append(f'swarm_provider_call_total{{kind="{_escape_label(key)}"}} {int(value)}')

    return "\n".join(lines) + "\n"


def _host(value: str | None) -> str:
    if not value:
        return ""
    parsed = urlparse(value)
    return (parsed.hostname or "").strip().lower()


def _looks_like_placeholder(value: str | None) -> bool:
    candidate = (value or "").strip().lower()
    return not candidate or "change-me" in candidate or candidate in {"minioadmin", "replace-with-real-key"}


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')
