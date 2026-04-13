from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from time import perf_counter
import re
from urllib.parse import urlparse
from uuid import uuid4

from app.core.config import get_settings
from app.core.request_context import get_runtime_request_context
from app.services.approval_policy import SensitiveActionPolicy
from app.services.ops import ops_telemetry
from app.services.storage import StorageService
from app.services.tools.common import ToolRuntimeBase


settings = get_settings()
URL_PATTERN = re.compile(r"(?P<url>(?:https?://|www\.)[^\s<>'\"`]+)", re.IGNORECASE)
DOMAIN_PATTERN = re.compile(
    r"\b(?P<domain>(?:[a-z0-9-]+\.)+[a-z]{2,})(?P<path>/[^\s<>'\"`]*)?",
    re.IGNORECASE,
)
CLICK_PATTERN = re.compile(r"click selector (?P<selector>\"[^\"]+\"|'[^']+')", re.IGNORECASE)
WAIT_PATTERN = re.compile(r"wait for selector (?P<selector>\"[^\"]+\"|'[^']+')", re.IGNORECASE)
FILL_PATTERN = re.compile(
    r"fill selector (?P<selector>\"[^\"]+\"|'[^']+') with (?P<value>\"[^\"]+\"|'[^']+')",
    re.IGNORECASE,
)
@dataclass(frozen=True)
class BrowserAction:
    kind: str
    selector: str
    value: str | None = None


@dataclass(frozen=True)
class BrowserExecutionRequest:
    goal: str
    target_url: str | None
    actions: list[BrowserAction] = field(default_factory=list)
    capture_screenshot: bool = True
    capture_html: bool = True
    max_links: int = 8
    text_budget: int = 4000
    navigation_timeout_ms: int = 15000
    action_timeout_ms: int = 6000


class BrowserAutomationTool(ToolRuntimeBase):
    name = "browser_automation"

    def __init__(self, storage: StorageService | None = None) -> None:
        super().__init__(storage=storage)
        self.policy = SensitiveActionPolicy()

    async def preview(self, goal: str) -> dict:
        audit, started_at = self.start_audit("preview", {"goal_preview": goal[:240]})
        request = self._build_request(goal)
        warnings = self._request_warnings(request)
        payload = {
            "tool": self.name,
            "goal": goal,
            "status": "planned",
            "target_url": request.target_url,
            "action_mode": self._action_mode(request),
            "steps": self._planned_steps(request),
            "actions": [asdict(action) for action in request.actions],
            "warnings": warnings,
            "reason": self._preview_reason(request, warnings),
        }
        audit = self.finalize_audit(
            audit,
            started_at,
            status="completed",
            response={"target_url": request.target_url, "action_count": len(request.actions)},
        )
        return self.result(operation="preview", status="completed", payload=payload, audit=audit)

    async def execute(self, goal: str) -> dict:
        return await self.execute_with_events(goal)

    async def execute_with_events(
        self,
        goal: str,
        *,
        event_handler: Callable[[str, dict], Awaitable[None]] | None = None,
        event_context: dict | None = None,
    ) -> dict:
        audit, started_at = self.start_audit("execute", {"goal_preview": goal[:240]})
        request = self._build_request(goal)
        warnings = self._request_warnings(request)
        action_mode = self._action_mode(request)
        session_id = uuid4().hex
        event_payload_base = {
            "session_id": session_id,
            "session_kind": "browser",
            "tool": self.name,
            **(event_context or {}),
        }

        if not settings.browser_enabled:
            return self._audited_failed_result(
                audit,
                started_at,
                request,
                reason="Browser automation is disabled by configuration.",
                warnings=warnings,
            )

        if not request.target_url:
            payload = {
                "goal": goal,
                "target_url": None,
                "action_mode": action_mode,
                "steps": self._planned_steps(request),
                "actions": [asdict(action) for action in request.actions],
                "warnings": warnings,
                "reason": "No explicit target URL was detected, so the browser session was not started.",
            }
            audit = self.finalize_audit(
                audit,
                started_at,
                status="completed",
                response={"planned": True, "target_url": None},
            )
            return self.result(operation="execute", status="planned", payload=payload, audit=audit)

        if not self._is_safe_url(request.target_url):
            return self._audited_failed_result(
                audit,
                started_at,
                request,
                reason="Only explicit http:// or https:// targets are allowed for browser execution.",
                warnings=warnings,
            )

        try:
            playwright_factory = self._playwright_factory()
        except ImportError:
            return self._audited_failed_result(
                audit,
                started_at,
                request,
                reason="Playwright is not installed in the current Python environment.",
                warnings=warnings + ["Install dependencies and run `python -m playwright install chromium`."],
            )

        executed_actions: list[dict] = []
        skipped_actions = [asdict(action) for action in request.actions] if action_mode != "interactive" else []
        started_at = perf_counter()
        await self._emit(
            event_handler,
            "computer.session.started",
            {
                **event_payload_base,
                "status": "running",
                "target_url": request.target_url,
                "action_mode": action_mode,
                "actions": [asdict(action) for action in request.actions],
                "warnings": warnings,
            },
        )

        try:
            async with playwright_factory as playwright:
                browser = await playwright.chromium.launch(headless=settings.browser_headless)
                browser_context = await browser.new_context(
                    viewport={"width": 1440, "height": 900},
                    ignore_https_errors=True,
                )
                page = await browser_context.new_page()

                navigation_started_at = perf_counter()
                response = await page.goto(
                    request.target_url,
                    wait_until="domcontentloaded",
                    timeout=request.navigation_timeout_ms,
                )
                navigation_ms = self._elapsed_ms(navigation_started_at)
                await self._emit(
                    event_handler,
                    "computer.session.updated",
                    {
                        **event_payload_base,
                        "status": "running",
                        "phase": "navigated",
                        "target_url": request.target_url,
                        "final_url": page.url,
                        "response_status": response.status if response else None,
                        "navigation_ms": round(navigation_ms, 2),
                    },
                )

                try:
                    await page.wait_for_load_state(
                        "networkidle",
                        timeout=min(request.navigation_timeout_ms, 5000),
                    )
                except Exception:
                    warnings.append(
                        "The page did not reach network-idle state before timeout; captured the current DOM snapshot instead."
                    )

                if action_mode == "interactive":
                    for action in request.actions:
                        action_result = await self._run_action(
                            page,
                            action,
                            timeout_ms=request.action_timeout_ms,
                        )
                        executed_actions.append(action_result)
                        await self._emit(
                            event_handler,
                            "computer.session.updated",
                            {
                                **event_payload_base,
                                "status": "running",
                                "phase": "action",
                                "target_url": request.target_url,
                                "final_url": page.url,
                                "executed_action": action_result,
                                "executed_actions": executed_actions,
                            },
                        )
                        try:
                            await page.wait_for_load_state("networkidle", timeout=2500)
                        except Exception:
                            pass
                elif request.actions:
                    warnings.append(
                        "Structured browser actions were detected but skipped because the goal did not indicate approval for interactive execution."
                    )

                snapshot = await self._capture_page_snapshot(page, request)
                artifacts = {}
                if request.capture_screenshot:
                    screenshot = await page.screenshot(full_page=True, type="png")
                    screenshot_key = f"browser-runs/{session_id}/page.png"
                    artifacts["screenshot"] = {
                        "storage_key": screenshot_key,
                        "path": self.storage.save_bytes(screenshot_key, screenshot),
                        "content_type": "image/png",
                    }

                if request.capture_html:
                    html_key = f"browser-runs/{session_id}/page.html"
                    artifacts["html_snapshot"] = {
                        "storage_key": html_key,
                        "path": self.storage.save_text(html_key, await page.content()),
                        "content_type": "text/html",
                    }

                metadata_payload = {
                    "goal": request.goal,
                    "target_url": request.target_url,
                    "final_url": page.url,
                    "action_mode": action_mode,
                    "actions": [asdict(action) for action in request.actions],
                    "executed_actions": executed_actions,
                    "warnings": warnings,
                    "snapshot": snapshot,
                }
                metadata_key = f"browser-runs/{session_id}/metadata.json"
                artifacts["metadata"] = {
                    "storage_key": metadata_key,
                    "path": self.storage.save_json(metadata_key, metadata_payload),
                    "content_type": "application/json",
                }

                snapshot_event_payload = {
                    **event_payload_base,
                    "status": "running",
                    "phase": "snapshot",
                    "target_url": request.target_url,
                    "final_url": page.url,
                    "page_title": snapshot["page_title"],
                    "action_mode": action_mode,
                    "executed_actions": executed_actions,
                    "skipped_actions": skipped_actions,
                    "headings": snapshot["headings"],
                    "links": snapshot["links"],
                    "extracted_text": snapshot["text"],
                    "warnings": warnings,
                    "artifacts": artifacts,
                    "metrics": {
                        "response_status": response.status if response else None,
                        "navigation_ms": round(navigation_ms, 2),
                        "link_count": snapshot["link_count"],
                        "heading_count": len(snapshot["headings"]),
                        "button_count": snapshot["button_count"],
                        "form_count": snapshot["form_count"],
                        "captured_text_chars": snapshot["captured_text_chars"],
                    },
                }
                await self._emit(
                    event_handler,
                    "browser.snapshot",
                    snapshot_event_payload,
                )

                await browser_context.close()
                await browser.close()

                total_ms = self._elapsed_ms(started_at)
                payload = {
                    "tool": self.name,
                    "goal": goal,
                    "status": "completed",
                    "target_url": request.target_url,
                    "final_url": page.url,
                    "page_title": snapshot["page_title"],
                    "action_mode": action_mode,
                    "steps": self._planned_steps(request),
                    "executed_actions": executed_actions,
                    "skipped_actions": skipped_actions,
                    "extracted_text": snapshot["text"],
                    "headings": snapshot["headings"],
                    "links": snapshot["links"],
                    "artifacts": artifacts,
                    "warnings": warnings,
                    "metrics": {
                        "response_status": response.status if response else None,
                        "navigation_ms": round(navigation_ms, 2),
                        "total_ms": round(total_ms, 2),
                        "link_count": snapshot["link_count"],
                        "heading_count": len(snapshot["headings"]),
                        "button_count": snapshot["button_count"],
                        "form_count": snapshot["form_count"],
                        "captured_text_chars": snapshot["captured_text_chars"],
                    },
                }
                await self._emit(
                    event_handler,
                    "computer.session.completed",
                    {
                        **event_payload_base,
                        "status": "completed",
                        "target_url": request.target_url,
                        "final_url": page.url,
                        "page_title": snapshot["page_title"],
                        "action_mode": action_mode,
                        "executed_actions": executed_actions,
                        "skipped_actions": skipped_actions,
                        "headings": snapshot["headings"],
                        "links": snapshot["links"],
                        "extracted_text": snapshot["text"],
                        "warnings": warnings,
                        "artifacts": artifacts,
                        "metrics": payload["metrics"],
                    },
                )
                audit = self.finalize_audit(
                    audit,
                    started_at,
                    status="completed",
                    response={
                        "final_url": page.url,
                        "action_count": len(executed_actions),
                        "warning_count": len(warnings),
                    },
                    artifacts=list(artifacts.values()),
                )
                return self.result(operation="execute", status="completed", payload=payload, audit=audit)
        except Exception as exc:
            install_hint = self._playwright_install_hint(str(exc))
            if install_hint:
                warnings.append(install_hint)
            await self._emit(
                event_handler,
                "computer.session.failed",
                {
                    **event_payload_base,
                    "status": "failed",
                    "target_url": request.target_url,
                    "action_mode": action_mode,
                    "warnings": warnings,
                    "error": f"{exc.__class__.__name__}: {exc}",
                },
            )
            return self._audited_failed_result(
                audit,
                started_at,
                request,
                reason="Playwright browser execution failed.",
                warnings=warnings,
                error=f"{exc.__class__.__name__}: {exc}",
                action_mode=action_mode,
            )

    def _build_request(self, goal: str) -> BrowserExecutionRequest:
        return BrowserExecutionRequest(
            goal=goal,
            target_url=self._extract_target_url(goal),
            actions=self._parse_actions(goal),
            capture_screenshot=settings.browser_capture_screenshot,
            capture_html=settings.browser_capture_html,
            max_links=settings.browser_capture_max_links,
            text_budget=settings.browser_capture_text_chars,
            navigation_timeout_ms=settings.browser_navigation_timeout_ms,
            action_timeout_ms=settings.browser_action_timeout_ms,
        )

    def _extract_target_url(self, goal: str) -> str | None:
        explicit_match = URL_PATTERN.search(goal)
        if explicit_match:
            return self._normalize_url(explicit_match.group("url"))

        for match in DOMAIN_PATTERN.finditer(goal):
            candidate = match.group("domain")
            if "@" in candidate:
                continue
            return self._normalize_url(candidate + (match.group("path") or ""))
        return None

    def _normalize_url(self, candidate: str) -> str | None:
        normalized = candidate.rstrip(".,);:]}>")
        if normalized.startswith("www."):
            normalized = f"https://{normalized}"
        elif "://" not in normalized:
            normalized = f"https://{normalized}"
        return normalized

    def _parse_actions(self, goal: str) -> list[BrowserAction]:
        matches: list[tuple[int, BrowserAction]] = []
        for pattern, kind in (
            (CLICK_PATTERN, "click"),
            (WAIT_PATTERN, "wait_for"),
        ):
            for match in pattern.finditer(goal):
                matches.append(
                    (
                        match.start(),
                        BrowserAction(
                            kind=kind,
                            selector=self._strip_quotes(match.group("selector")),
                        ),
                    )
                )

        for match in FILL_PATTERN.finditer(goal):
            matches.append(
                (
                    match.start(),
                    BrowserAction(
                        kind="fill",
                        selector=self._strip_quotes(match.group("selector")),
                        value=self._strip_quotes(match.group("value")),
                    )
                )
            )
        matches.sort(key=lambda item: item[0])
        return [action for _, action in matches]

    def _action_mode(self, request: BrowserExecutionRequest) -> str:
        decision = self.policy.evaluate_browser_interaction(request.goal, action_count=len(request.actions))
        if request.actions and decision.allowed:
            return "interactive"
        return "read_only_capture"

    def _has_interaction_approval(self, goal: str) -> bool:
        return self.policy.evaluate_browser_interaction(goal, action_count=1).allowed

    def _request_warnings(self, request: BrowserExecutionRequest) -> list[str]:
        warnings: list[str] = []
        decision = self.policy.evaluate_browser_interaction(request.goal, action_count=len(request.actions))
        if request.actions and not decision.allowed:
            warnings.append("Interactive actions require explicit approval keywords; only navigation and capture will run.")
            runtime_context = get_runtime_request_context()
            ops_telemetry.record_sensitive_action(
                action="browser_interaction",
                outcome="blocked",
                reason=decision.reason,
                request_id=runtime_context.request_id,
                workspace_id=runtime_context.workspace_id,
            )
        return warnings

    def _preview_reason(self, request: BrowserExecutionRequest, warnings: list[str]) -> str:
        if not request.target_url:
            return "Waiting for an explicit target URL before starting a Playwright session."
        if warnings:
            return warnings[0]
        return "Ready to launch a headless Playwright session and capture the page state."

    def _planned_steps(self, request: BrowserExecutionRequest) -> list[str]:
        steps = [
            "Launch headless Chromium session",
            "Navigate to the requested page",
            "Capture visible text, headings, links, and page metrics",
        ]
        if request.actions:
            steps.append("Apply approved structured UI actions")
        if request.capture_screenshot:
            steps.append("Save a full-page screenshot")
        if request.capture_html:
            steps.append("Save an HTML snapshot and metadata record")
        return steps

    def _is_safe_url(self, url: str) -> bool:
        parsed = urlparse(url)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

    async def _capture_page_snapshot(self, page, request: BrowserExecutionRequest) -> dict:
        return await page.evaluate(
            """
            ({ textLimit, linkLimit }) => {
              const root = document.querySelector("main, article, body") || document.body;
              const cleanText = (root?.innerText || document.body?.innerText || "")
                .replace(/\\s+/g, " ")
                .trim()
                .slice(0, textLimit);
              const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
                .map((node) => (node.textContent || "").trim())
                .filter(Boolean)
                .slice(0, 8);
              const links = Array.from(document.querySelectorAll("a[href]"))
                .map((node) => ({
                  text: (node.textContent || "").replace(/\\s+/g, " ").trim(),
                  url: node.href
                }))
                .filter((item) => item.url)
                .slice(0, linkLimit);
              return {
                page_title: document.title || "",
                text: cleanText,
                headings,
                links,
                link_count: links.length,
                button_count: document.querySelectorAll("button, [role='button'], input[type='submit']").length,
                form_count: document.querySelectorAll("form").length,
                captured_text_chars: cleanText.length
              };
            }
            """,
            {"textLimit": request.text_budget, "linkLimit": request.max_links},
        )

    async def _run_action(self, page, action: BrowserAction, *, timeout_ms: int) -> dict:
        locator = page.locator(action.selector).first
        if action.kind == "click":
            await locator.click(timeout=timeout_ms)
        elif action.kind == "wait_for":
            await page.wait_for_selector(action.selector, timeout=timeout_ms)
        elif action.kind == "fill":
            await locator.fill(action.value or "", timeout=timeout_ms)
        else:
            raise ValueError(f"Unsupported browser action: {action.kind}")

        executed = asdict(action)
        executed["status"] = "completed"
        return executed

    def _failed_result(
        self,
        request: BrowserExecutionRequest,
        *,
        reason: str,
        warnings: list[str],
        error: str | None = None,
        action_mode: str | None = None,
    ) -> dict:
        return {
            "tool": self.name,
            "goal": request.goal,
            "status": "failed",
            "target_url": request.target_url,
            "action_mode": action_mode or self._action_mode(request),
            "steps": self._planned_steps(request),
            "actions": [asdict(action) for action in request.actions],
            "warnings": warnings,
            "reason": reason,
            "error": error,
        }

    def _audited_failed_result(
        self,
        audit: dict,
        started_at: float,
        request: BrowserExecutionRequest,
        *,
        reason: str,
        warnings: list[str],
        error: str | None = None,
        action_mode: str | None = None,
    ) -> dict:
        payload = self._failed_result(
            request,
            reason=reason,
            warnings=warnings,
            error=error,
            action_mode=action_mode,
        )
        audit = self.finalize_audit(
            audit,
            started_at,
            status="failed",
            response={"target_url": request.target_url, "warning_count": len(warnings)},
            error=error or reason,
        )
        return self.result(operation="execute", status="failed", payload=payload, audit=audit)

    def _playwright_factory(self):
        from playwright.async_api import async_playwright

        return async_playwright()

    def _playwright_install_hint(self, message: str) -> str | None:
        if "Executable doesn't exist" in message or "playwright install" in message.lower():
            return "Chromium is not installed for Playwright. Run `python -m playwright install chromium`."
        return None

    def _strip_quotes(self, value: str) -> str:
        return value.strip().strip("\"'")

    def _elapsed_ms(self, started_at: float) -> float:
        return (perf_counter() - started_at) * 1000

    async def _emit(
        self,
        event_handler: Callable[[str, dict], Awaitable[None]] | None,
        event: str,
        payload: dict,
    ) -> None:
        if event_handler is not None:
            await event_handler(event, payload)
