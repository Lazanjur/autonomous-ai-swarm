from __future__ import annotations

import asyncio
import hashlib
from collections import defaultdict, deque
from time import perf_counter, time
from uuid import uuid4

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import get_settings
from app.core.request_context import (
    RuntimeRequestContext,
    reset_runtime_request_context,
    set_runtime_request_context,
)
from app.services.ops import ops_telemetry

settings = get_settings()


class InMemoryRateLimiter:
    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._events: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def evaluate(self, key: str) -> dict[str, int | bool]:
        now = time()
        async with self._lock:
            timestamps = self._events[key]
            while timestamps and timestamps[0] <= now - self.window_seconds:
                timestamps.popleft()

            allowed = len(timestamps) < self.limit
            if allowed:
                timestamps.append(now)

            oldest = timestamps[0] if timestamps else now
            reset_seconds = max(int(oldest + self.window_seconds - now), 0)
            remaining = max(self.limit - len(timestamps), 0)
            return {
                "allowed": allowed,
                "remaining": remaining,
                "limit": self.limit,
                "reset_seconds": reset_seconds,
            }


class EnterpriseGuardMiddleware(BaseHTTPMiddleware):
    def __init__(self, app) -> None:
        super().__init__(app)
        self.limiter = InMemoryRateLimiter(
            limit=settings.rate_limit_requests,
            window_seconds=settings.rate_limit_window_seconds,
        )

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = uuid4().hex
        client_ip = request.client.host if request.client else None
        token = set_runtime_request_context(
            RuntimeRequestContext(
                request_id=request_id,
                client_ip=client_ip,
                method=request.method,
                path=request.url.path,
            )
        )
        started_at = perf_counter()
        rate_limit = None

        try:
            if settings.rate_limit_enabled and self._should_rate_limit(request.url.path):
                key = self._rate_limit_key(request, client_ip)
                rate_limit = await self.limiter.evaluate(key)
                if not rate_limit["allowed"]:
                    retry_after = int(rate_limit["reset_seconds"])
                    ops_telemetry.record_rate_limit(
                        request_id=request_id,
                        key=key,
                        path=request.url.path,
                        retry_after_seconds=retry_after,
                    )
                    response = JSONResponse(
                        status_code=429,
                        content={
                            "detail": "Rate limit exceeded. Please retry after the reset window.",
                            "request_id": request_id,
                        },
                    )
                    self._apply_headers(response, request_id, rate_limit)
                    ops_telemetry.record_request(
                        request_id=request_id,
                        method=request.method,
                        path=request.url.path,
                        status_code=429,
                        duration_ms=(perf_counter() - started_at) * 1000,
                        client_ip=client_ip,
                    )
                    return response

            response = await call_next(request)
            self._apply_headers(response, request_id, rate_limit)
            duration_ms = (perf_counter() - started_at) * 1000
            ops_telemetry.record_request(
                request_id=request_id,
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_ms=duration_ms,
                client_ip=client_ip,
            )
            if response.status_code >= 500:
                ops_telemetry.record_alert(
                    level="error",
                    code="request_failed",
                    message="API request completed with a server error response.",
                    context={
                        "request_id": request_id,
                        "path": request.url.path,
                        "status_code": response.status_code,
                    },
                )
            return response
        except Exception as exc:
            duration_ms = (perf_counter() - started_at) * 1000
            ops_telemetry.record_request(
                request_id=request_id,
                method=request.method,
                path=request.url.path,
                status_code=500,
                duration_ms=duration_ms,
                client_ip=client_ip,
            )
            ops_telemetry.record_alert(
                level="critical",
                code="request_exception",
                message="Unhandled exception escaped the request pipeline.",
                context={
                    "request_id": request_id,
                    "path": request.url.path,
                    "error": f"{exc.__class__.__name__}: {exc}",
                },
            )
            raise
        finally:
            reset_runtime_request_context(token)

    def _apply_headers(
        self,
        response: Response,
        request_id: str,
        rate_limit: dict[str, int | bool] | None,
    ) -> None:
        response.headers["X-Request-ID"] = request_id
        if not rate_limit:
            return
        response.headers["X-RateLimit-Limit"] = str(rate_limit["limit"])
        response.headers["X-RateLimit-Remaining"] = str(rate_limit["remaining"])
        response.headers["X-RateLimit-Reset"] = str(rate_limit["reset_seconds"])
        if not rate_limit["allowed"]:
            response.headers["Retry-After"] = str(rate_limit["reset_seconds"])

    def _should_rate_limit(self, path: str) -> bool:
        return not any(
            path.startswith(prefix)
            for prefix in ("/docs", "/redoc", "/openapi.json", f"{settings.api_v1_prefix}/health")
        )

    def _rate_limit_key(self, request: Request, client_ip: str | None) -> str:
        authorization = request.headers.get("authorization")
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization.split(" ", 1)[1].strip()
            return f"bearer:{hashlib.sha256(token.encode('utf-8')).hexdigest()[:16]}"

        session_cookie = request.cookies.get(settings.session_cookie_name)
        if session_cookie:
            return f"session:{hashlib.sha256(session_cookie.encode('utf-8')).hexdigest()[:16]}"

        return f"ip:{client_ip or 'unknown'}"
