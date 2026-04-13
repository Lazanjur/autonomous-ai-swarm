from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import engine
from app.schemas.common import HealthRead, ReadinessRead
from app.services.ops import ops_telemetry
from app.services.production_posture import production_configuration_errors, render_prometheus_metrics
from app.services.usage import UsageAccountingService

router = APIRouter()
settings = get_settings()
usage_service = UsageAccountingService()


@router.get("", response_model=HealthRead)
async def healthcheck() -> HealthRead:
    return HealthRead(
        status="ok",
        app=settings.app_name,
        models_configured=bool(settings.alibaba_api_key),
        timestamp=datetime.now(timezone.utc),
    )


@router.get("/ready", response_model=ReadinessRead)
async def readiness() -> ReadinessRead:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - exercised via runtime probes
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable.",
        ) from exc

    posture_errors = production_configuration_errors(settings)
    if posture_errors:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Production configuration is invalid: {posture_errors[0]}",
        )

    return ReadinessRead(
        status="ready",
        app=settings.app_name,
        database="ok",
        models_configured=bool(settings.alibaba_api_key),
        timestamp=datetime.now(timezone.utc),
    )


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
async def metrics() -> PlainTextResponse:
    database_ok = True
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception:
        database_ok = False

    telemetry = ops_telemetry.snapshot()
    budget = await usage_service.budget_snapshot()
    payload = render_prometheus_metrics(
        settings=settings,
        database_ok=database_ok,
        telemetry=telemetry,
        budget=budget,
        config_errors=production_configuration_errors(settings),
    )
    return PlainTextResponse(payload, media_type="text/plain; version=0.0.4; charset=utf-8")
