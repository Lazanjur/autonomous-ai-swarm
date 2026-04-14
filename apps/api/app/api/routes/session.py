from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.init_db import ensure_demo_workspace
from app.db.session import get_session

router = APIRouter()
settings = get_settings()


@router.get("/demo")
async def demo_session(session: AsyncSession = Depends(get_session)) -> dict:
    if not settings.demo_mode_active:
        raise HTTPException(status_code=404, detail="Demo mode is disabled.")
    workspace = await ensure_demo_workspace(session)
    return {
        "user": {
            "email": "demo@swarm.dev",
            "name": "Demo Operator",
            "role": "owner",
        },
        "workspace": {
            "id": str(workspace.id),
            "name": workspace.name,
            "slug": workspace.slug,
        },
    }
