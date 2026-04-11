from fastapi import APIRouter, Depends, Request
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import utc_now
from app.core.deps import AuthContext, require_auth_context
from app.db.session import get_session
from app.schemas.auth import AuthLoginRequest, AuthProfileRead, AuthRegisterRequest, AuthSessionRead
from app.services.auth import AuthService

router = APIRouter()
auth_service = AuthService()
settings = get_settings()


@router.post("/register", response_model=AuthSessionRead)
async def register(
    payload: AuthRegisterRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AuthSessionRead:
    if not settings.enable_signups:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Signups are disabled.")
    return await auth_service.register(
        session,
        payload,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )


@router.post("/login", response_model=AuthSessionRead)
async def login(
    payload: AuthLoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AuthSessionRead:
    return await auth_service.login(
        session,
        payload,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )


@router.post("/logout")
async def logout(
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    context.session.revoked_at = utc_now()
    await session.commit()
    return {"status": "ok"}


@router.get("/me", response_model=AuthProfileRead)
async def me(
    context: AuthContext = Depends(require_auth_context),
    session: AsyncSession = Depends(get_session),
) -> AuthProfileRead:
    profile = await auth_service.get_profile(session, context.user)
    return AuthProfileRead(**profile)
