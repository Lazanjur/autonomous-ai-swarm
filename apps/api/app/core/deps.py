from __future__ import annotations

from dataclasses import dataclass

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_session
from app.models.entities import User, UserSession
from app.services.auth import AuthService

settings = get_settings()
auth_service = AuthService()


@dataclass
class AuthContext:
    user: User
    session: UserSession


async def get_optional_auth_context(
    session: AsyncSession = Depends(get_session),
    authorization: str | None = Header(default=None),
    session_cookie: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> AuthContext | None:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    elif session_cookie:
        token = session_cookie

    if not token:
        return None

    resolved = await auth_service.resolve_session(session, token)
    if not resolved:
        return None
    user, active_session = resolved
    return AuthContext(user=user, session=active_session)


async def require_auth_context(
    context: AuthContext | None = Depends(get_optional_auth_context),
) -> AuthContext:
    if context is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return context
