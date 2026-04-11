from __future__ import annotations

from dataclasses import dataclass


APPROVAL_TOKENS = (
    "approved",
    "approval granted",
    "allow interaction",
    "interactive action approved",
    "safe to submit",
    "delivery approved",
    "send it now",
)


@dataclass(frozen=True)
class SensitiveActionDecision:
    allowed: bool
    requires_approval: bool
    reason: str
    matched_tokens: tuple[str, ...] = ()


class SensitiveActionPolicy:
    def evaluate_browser_interaction(self, goal: str, *, action_count: int) -> SensitiveActionDecision:
        if action_count <= 0:
            return SensitiveActionDecision(
                allowed=True,
                requires_approval=False,
                reason="No interactive browser actions were requested.",
            )
        matched = self._matched_tokens(goal)
        if matched:
            return SensitiveActionDecision(
                allowed=True,
                requires_approval=True,
                reason="Interactive browser execution is explicitly approved.",
                matched_tokens=matched,
            )
        return SensitiveActionDecision(
            allowed=False,
            requires_approval=True,
            reason="Interactive browser actions require explicit approval language.",
        )

    def evaluate_notification_delivery(
        self,
        *,
        deliver: bool,
        approval_note: str | None = None,
    ) -> SensitiveActionDecision:
        if not deliver:
            return SensitiveActionDecision(
                allowed=True,
                requires_approval=False,
                reason="Notification remained queued as an outbox record.",
            )
        matched = self._matched_tokens(approval_note or "")
        if matched:
            return SensitiveActionDecision(
                allowed=True,
                requires_approval=True,
                reason="Live external delivery is explicitly approved.",
                matched_tokens=matched,
            )
        return SensitiveActionDecision(
            allowed=False,
            requires_approval=True,
            reason="Live external delivery requires explicit approval language.",
        )

    def _matched_tokens(self, text: str) -> tuple[str, ...]:
        lowered = text.lower()
        return tuple(token for token in APPROVAL_TOKENS if token in lowered)
