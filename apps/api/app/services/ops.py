from __future__ import annotations

from collections import Counter, deque
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from app.core.config import get_settings

settings = get_settings()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class OpsTelemetryService:
    def __init__(self) -> None:
        self._lock = Lock()
        self._request_counts: Counter[str] = Counter()
        self._status_counts: Counter[str] = Counter()
        self._provider_counts: Counter[str] = Counter()
        self._request_events: deque[dict[str, Any]] = deque(maxlen=settings.request_telemetry_retention)
        self._provider_events: deque[dict[str, Any]] = deque(maxlen=settings.request_telemetry_retention)
        self._alerts: deque[dict[str, Any]] = deque(maxlen=settings.request_telemetry_retention)
        self._sensitive_actions: deque[dict[str, Any]] = deque(maxlen=settings.request_telemetry_retention)

    def record_request(
        self,
        *,
        request_id: str,
        method: str,
        path: str,
        status_code: int,
        duration_ms: float,
        client_ip: str | None = None,
    ) -> None:
        event = {
            "request_id": request_id,
            "method": method,
            "path": path,
            "status_code": status_code,
            "duration_ms": round(duration_ms, 2),
            "client_ip": client_ip,
            "timestamp": utc_now().isoformat(),
        }
        with self._lock:
            self._request_counts["total"] += 1
            self._status_counts[f"{status_code // 100}xx"] += 1
            self._request_events.appendleft(event)

    def record_rate_limit(
        self,
        *,
        request_id: str,
        key: str,
        path: str,
        retry_after_seconds: int,
    ) -> None:
        with self._lock:
            self._request_counts["rate_limited"] += 1
        self.record_alert(
            level="warning",
            code="rate_limit_triggered",
            message="API rate limit exceeded for the current actor key.",
            context={
                "request_id": request_id,
                "path": path,
                "actor_key": key,
                "retry_after_seconds": retry_after_seconds,
            },
        )

    def record_provider_call(
        self,
        *,
        provider: str,
        model: str,
        operation: str,
        latency_ms: int,
        fallback: bool,
        guardrail_reason: str | None = None,
        request_id: str | None = None,
        workspace_id: str | None = None,
    ) -> None:
        event = {
            "provider": provider,
            "model": model,
            "operation": operation,
            "latency_ms": latency_ms,
            "fallback": fallback,
            "guardrail_reason": guardrail_reason,
            "request_id": request_id,
            "workspace_id": workspace_id,
            "timestamp": utc_now().isoformat(),
        }
        with self._lock:
            self._provider_counts["total"] += 1
            self._provider_counts[f"provider:{provider}"] += 1
            if fallback:
                self._provider_counts["fallbacks"] += 1
            if guardrail_reason:
                self._provider_counts[f"guardrail:{guardrail_reason}"] += 1
            self._provider_events.appendleft(event)

    def record_sensitive_action(
        self,
        *,
        action: str,
        outcome: str,
        reason: str,
        request_id: str | None = None,
        workspace_id: str | None = None,
    ) -> None:
        event = {
            "action": action,
            "outcome": outcome,
            "reason": reason,
            "request_id": request_id,
            "workspace_id": workspace_id,
            "timestamp": utc_now().isoformat(),
        }
        with self._lock:
            self._request_counts[f"sensitive_action:{outcome}"] += 1
            self._sensitive_actions.appendleft(event)

    def record_alert(
        self,
        *,
        level: str,
        code: str,
        message: str,
        context: dict[str, Any] | None = None,
    ) -> None:
        event = {
            "level": level,
            "code": code,
            "message": message,
            "context": context or {},
            "timestamp": utc_now().isoformat(),
        }
        with self._lock:
            self._alerts.appendleft(event)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "request_counts": dict(self._request_counts),
                "status_counts": dict(self._status_counts),
                "provider_counts": dict(self._provider_counts),
                "recent_requests": list(self._request_events)[:20],
                "recent_provider_events": list(self._provider_events)[:15],
                "recent_alerts": list(self._alerts)[:15],
                "recent_sensitive_actions": list(self._sensitive_actions)[:15],
            }


ops_telemetry = OpsTelemetryService()
