from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import text

from app.api.router import api_router
from app.api.routes.automations import scheduler as automation_scheduler
from app.core.config import get_settings
from app.core.middleware import EnterpriseGuardMiddleware
from app.db.init_db import ensure_demo_workspace
from app.db.session import SessionLocal, engine
from app.models.entities import SQLModel

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.auto_create_tables:
        async with engine.begin() as connection:
            await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await connection.run_sync(SQLModel.metadata.create_all)
    if settings.demo_mode_active:
        async with SessionLocal() as session:
            await ensure_demo_workspace(session)
    await automation_scheduler.start()
    yield
    await automation_scheduler.stop()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(EnterpriseGuardMiddleware)
if settings.trusted_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/", tags=["meta"])
async def root() -> dict[str, str]:
    return {"message": f"{settings.app_name} is online"}
