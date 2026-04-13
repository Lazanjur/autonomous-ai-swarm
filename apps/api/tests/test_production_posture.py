from app.core.config import Settings
from app.services.production_posture import production_configuration_errors, render_prometheus_metrics


def test_production_configuration_errors_detect_placeholder_state():
    settings = Settings.model_construct(
        app_env="production",
        app_domain="swarm.example.com",
        public_app_url="https://swarm.example.com",
        public_api_url="https://swarm.example.com",
        trusted_hosts=["localhost"],
        cors_origins=["https://elsewhere.example"],
        enable_demo_mode=True,
        allow_local_provider_fallback=True,
        alibaba_api_key=None,
        secret_key="change-me",
        minio_secret_key="change-me",
        database_url="postgresql://postgres:change-me@localhost/db",
        async_database_url="postgresql://postgres:change-me@localhost/db",
    )

    errors = production_configuration_errors(settings)

    assert "APP_DOMAIN still uses an example placeholder." in errors
    assert "TRUSTED_HOSTS must include APP_DOMAIN." in errors
    assert "CORS_ORIGINS must include APP_DOMAIN." in errors
    assert "ENABLE_DEMO_MODE must be false in production." in errors
    assert "ALLOW_LOCAL_PROVIDER_FALLBACK must be false in production." in errors
    assert "ALIBABA_API_KEY must be configured in production." in errors


def test_render_prometheus_metrics_contains_core_lines():
    settings = Settings.model_construct(
        app_env="production",
        app_domain="swarm.example.com",
        alibaba_api_key="configured",
        rate_limit_enabled=True,
        provider_budget_enforced=True,
    )
    metrics = render_prometheus_metrics(
        settings=settings,
        database_ok=True,
        telemetry={
            "request_counts": {"total": 12, "rate_limited": 1},
            "status_counts": {"2xx": 10, "5xx": 2},
            "provider_counts": {"total": 6, "fallbacks": 1},
            "recent_alerts": [{"code": "budget_warning"}],
            "recent_sensitive_actions": [{"action": "browser_click"}],
        },
        budget={"utilization": 0.42, "remaining_usd": 14.75},
        config_errors=[],
    )

    assert "swarm_app_up 1" in metrics
    assert "swarm_database_up 1" in metrics
    assert 'swarm_request_total{kind="total"} 12' in metrics
    assert 'swarm_request_status_total{status="5xx"} 2' in metrics
    assert 'swarm_provider_call_total{kind="fallbacks"} 1' in metrics
    assert "swarm_budget_utilization 0.420000" in metrics
