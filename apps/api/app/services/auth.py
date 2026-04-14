from __future__ import annotations

import secrets
from typing import Literal

from fastapi import HTTPException, status
from slugify import slugify
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_session_token, hash_password, hash_session_token, utc_now, verify_password
from app.models.entities import Organization, User, UserSession, Workspace, WorkspaceMembership
from app.schemas.auth import AuthLoginRequest, AuthRegisterRequest, AuthSessionRead, AuthUserRead, WorkspaceAccessRead

settings = get_settings()

ROLE_RANKS: dict[str, int] = {
    "viewer": 10,
    "member": 20,
    "admin": 30,
    "owner": 40,
}


class AuthService:
    async def register(
        self,
        session: AsyncSession,
        payload: AuthRegisterRequest,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> AuthSessionRead:
        existing = await session.execute(select(User).where(User.email == payload.email.lower()))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists.")

        organization = Organization(
            name=payload.organization_name or settings.default_organization_name,
            slug=self._unique_slug(payload.organization_name or settings.default_organization_name),
        )
        user = User(
            email=payload.email.lower(),
            full_name=payload.full_name,
            role="owner",
            organization_id=organization.id,
            password_hash=hash_password(payload.password),
            is_active=True,
        )
        workspace = Workspace(
            organization_id=organization.id,
            name=payload.workspace_name or settings.default_workspace_name,
            slug=self._unique_slug(payload.workspace_name or settings.default_workspace_name),
            description="Primary workspace created during signup.",
        )
        membership = WorkspaceMembership(
            workspace_id=workspace.id,
            user_id=user.id,
            role="owner",
        )
        session.add_all([organization, user, workspace, membership])
        await session.flush()
        auth_session, plain_token = await self._issue_session(
            session,
            user=user,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        await session.commit()
        return await self._build_session_read(session, user, auth_session, plain_token)

    async def login(
        self,
        session: AsyncSession,
        payload: AuthLoginRequest,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> AuthSessionRead:
        result = await session.execute(select(User).where(User.email == payload.email.lower()))
        user = result.scalar_one_or_none()
        if user is None or not user.password_hash or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
        if not user.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive.")

        user.last_login_at = utc_now()
        auth_session, plain_token = await self._issue_session(
            session,
            user=user,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        await session.commit()
        return await self._build_session_read(session, user, auth_session, plain_token)

    async def resolve_session(
        self,
        session: AsyncSession,
        token: str,
    ) -> tuple[User, UserSession] | None:
        token_hash = hash_session_token(token)
        result = await session.execute(select(UserSession).where(UserSession.token_hash == token_hash))
        auth_session = result.scalar_one_or_none()
        if auth_session is None or auth_session.revoked_at is not None or auth_session.expires_at <= utc_now():
            return None
        user_result = await session.execute(select(User).where(User.id == auth_session.user_id))
        user = user_result.scalar_one_or_none()
        if user is None or not user.is_active:
            return None
        auth_session.last_seen_at = utc_now()
        await session.flush()
        return user, auth_session

    async def logout(self, session: AsyncSession, token: str) -> None:
        token_hash = hash_session_token(token)
        result = await session.execute(select(UserSession).where(UserSession.token_hash == token_hash))
        auth_session = result.scalar_one_or_none()
        if auth_session:
            auth_session.revoked_at = utc_now()
            await session.commit()

    async def get_profile(self, session: AsyncSession, user: User) -> dict:
        workspaces = await self.list_workspace_access(session, user.id)
        return {
            "user": AuthUserRead.model_validate(user),
            "workspaces": workspaces,
        }

    async def list_workspace_access(
        self,
        session: AsyncSession,
        user_id,
    ) -> list[WorkspaceAccessRead]:
        result = await session.execute(
            select(WorkspaceMembership, Workspace)
            .join(Workspace, WorkspaceMembership.workspace_id == Workspace.id)
            .where(WorkspaceMembership.user_id == user_id)
            .where(WorkspaceMembership.status == "active")
        )
        rows = result.all()
        return [
            WorkspaceAccessRead(
                workspace_id=workspace.id,
                workspace_name=workspace.name,
                workspace_slug=workspace.slug,
                role=membership.role,
            )
            for membership, workspace in rows
        ]

    async def assert_workspace_access(
        self,
        session: AsyncSession,
        *,
        user_id,
        workspace_id,
        min_role: Literal["viewer", "member", "admin", "owner"] = "viewer",
    ) -> WorkspaceMembership:
        result = await session.execute(
            select(WorkspaceMembership).where(WorkspaceMembership.user_id == user_id).where(
                WorkspaceMembership.workspace_id == workspace_id
            )
        )
        membership = result.scalar_one_or_none()
        if membership is None or membership.status != "active":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Workspace access denied.")
        if ROLE_RANKS.get(membership.role, 0) < ROLE_RANKS[min_role]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role for action.")
        return membership

    async def ensure_demo_user(self, session: AsyncSession) -> tuple[User, Workspace]:
        if not settings.demo_mode_active:
            raise RuntimeError("Demo mode is disabled in the current environment.")

        existing_user = await session.execute(select(User).where(User.email == settings.demo_user_email))
        user = existing_user.scalar_one_or_none()
        existing_workspace = await session.execute(select(Workspace).where(Workspace.slug == "strategy-lab"))
        workspace = existing_workspace.scalar_one_or_none()

        organization = None
        if user is None and workspace is None:
            organization = Organization(name=settings.default_organization_name, slug="demo-organization")
            session.add(organization)
        elif user is not None:
            organization_result = await session.execute(
                select(Organization).where(Organization.id == user.organization_id)
            )
            organization = organization_result.scalar_one_or_none()
        elif workspace is not None:
            organization_result = await session.execute(
                select(Organization).where(Organization.id == workspace.organization_id)
            )
            organization = organization_result.scalar_one_or_none()

        if organization is None:
            organization_result = await session.execute(
                select(Organization).where(Organization.slug == "demo-organization")
            )
            organization = organization_result.scalar_one_or_none()
            if organization is None:
                organization = Organization(name=settings.default_organization_name, slug="demo-organization")
                session.add(organization)

        if user is None:
            user = User(
                email=settings.demo_user_email,
                full_name="Demo Operator",
                role="owner",
                organization_id=organization.id,
                password_hash=hash_password(settings.demo_user_password),
                is_active=True,
            )
            session.add(user)
        else:
            user.role = "owner"
            user.is_active = True
            if not user.password_hash:
                user.password_hash = hash_password(settings.demo_user_password)

        if workspace is None:
            workspace = Workspace(
                organization_id=organization.id,
                name=settings.default_workspace_name,
                slug="strategy-lab",
                description="Seed workspace for demo orchestration flows.",
            )
            session.add(workspace)

        membership = await session.execute(
            select(WorkspaceMembership)
            .where(WorkspaceMembership.user_id == user.id)
            .where(WorkspaceMembership.workspace_id == workspace.id)
        )
        if membership.scalar_one_or_none() is None:
            session.add(WorkspaceMembership(workspace_id=workspace.id, user_id=user.id, role="owner"))

        await session.commit()
        await session.refresh(user)
        await session.refresh(workspace)
        return user, workspace

    async def _issue_session(
        self,
        session: AsyncSession,
        *,
        user: User,
        user_agent: str | None,
        ip_address: str | None,
    ) -> tuple[UserSession, str]:
        token, token_hash, expires_at = create_session_token()
        auth_session = UserSession(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        session.add(auth_session)
        await session.flush()
        return auth_session, token

    async def _build_session_read(
        self,
        session: AsyncSession,
        user: User,
        auth_session: UserSession,
        plain_token: str,
    ) -> AuthSessionRead:
        workspaces = await self.list_workspace_access(session, user.id)
        return AuthSessionRead(
            token=plain_token,
            expires_at=auth_session.expires_at,
            user=AuthUserRead.model_validate(user),
            workspaces=workspaces,
        )

    def _unique_slug(self, value: str) -> str:
        base = slugify(value) or "workspace"
        return f"{base}-{secrets.token_hex(4)}"
