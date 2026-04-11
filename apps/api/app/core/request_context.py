from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class RuntimeRequestContext:
    request_id: str | None = None
    client_ip: str | None = None
    method: str | None = None
    path: str | None = None
    user_id: str | None = None
    workspace_id: str | None = None
    organization_id: str | None = None
    run_id: str | None = None


_runtime_request_context: ContextVar[RuntimeRequestContext] = ContextVar(
    "runtime_request_context",
    default=RuntimeRequestContext(),
)


def get_runtime_request_context() -> RuntimeRequestContext:
    return _runtime_request_context.get()


def set_runtime_request_context(context: RuntimeRequestContext) -> Token[RuntimeRequestContext]:
    return _runtime_request_context.set(context)


def reset_runtime_request_context(token: Token[RuntimeRequestContext]) -> None:
    _runtime_request_context.reset(token)


def update_runtime_request_context(**changes: str | None) -> RuntimeRequestContext:
    context = get_runtime_request_context()
    updated = replace(context, **changes)
    _runtime_request_context.set(updated)
    return updated
