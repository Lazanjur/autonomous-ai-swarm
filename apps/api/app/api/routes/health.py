from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import engine
from app.schemas.common import HealthRead, ReadinessRead

router = APIRouter()
settings = get_settings()


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

    return ReadinessRead(
        status="ready",
        app=settings.app_name,
        database="ok",
        models_configured=bool(settings.alibaba_api_key),
        timestamp=datetime.now(timezone.utc),
    )
