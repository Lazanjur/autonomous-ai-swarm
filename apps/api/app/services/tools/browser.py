from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from time import perf_counter
import re
from urllib.parse import urljoin, urlparse
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
EMAIL_CREDENTIAL_PATTERN = re.compile(
    r"(?:email|e-mail|username|user)\s*[:=]\s*(?P<value>[^\s,;]+)",
    re.IGNORECASE,
)
PASSWORD_CREDENTIAL_PATTERN = re.compile(
    r"(?:password|pass|pw)\s*[:=]\s*(?P<value>[^\s,;]+)",
    re.IGNORECASE,
)
LOGIN_INTENT_PATTERN = re.compile(
    r"\b(?:log\s*in|login|sign\s*in|authenticate|access the account)\b",
    re.IGNORECASE,
)
LOGIN_PATH_PATTERN = re.compile(r"/(?:login|signin|sign-in)(?:/|$)", re.IGNORECASE)
LOGIN_FAILURE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("bad_credentials", re.compile(r"\bbad creds\b|invalid credentials|incorrect credentials", re.IGNORECASE)),
    (
        "access_denied",
        re.compile(
            r"access denied|not authorized|unauthorized|permission denied|contact your administrator|get access",
            re.IGNORECASE,
        ),
    ),
    (
        "account_restricted",
        re.compile(r"only\s+@[\w.-]+\s+accounts?\s+are\s+allowed|account .*restricted", re.IGNORECASE),
    ),
    (
        "login_rejected",
        re.compile(
            r"unable to sign in|sign in failed|login failed|wrong password|incorrect password|incorrect email",
            re.IGNORECASE,
        ),
    ),
)
LOGIN_PENDING_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("signing_in", re.compile(r"signing in|logging in|authenticating", re.IGNORECASE)),
    ("redirecting", re.compile(r"redirecting|please wait|one moment", re.IGNORECASE)),
)
LOGIN_SUCCESS_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bsign out\b|\blog out\b|\blogout\b", re.IGNORECASE),
    re.compile(r"\bdashboard\b|\bworkspace\b|\bmy account\b|\bprofile\b", re.IGNORECASE),
)
MANUAL_TAKEOVER_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("captcha", re.compile(r"\bcaptcha\b", re.IGNORECASE)),
    ("human_verification", re.compile(r"verify (?:that )?you(?:'re| are)? human|are you human", re.IGNORECASE)),
    ("security_check", re.compile(r"security check|security verification|additional security", re.IGNORECASE)),
    ("browser_check", re.compile(r"checking your browser|checking if the site connection is secure", re.IGNORECASE)),
    ("cloudflare_challenge", re.compile(r"cloudflare|attention required", re.IGNORECASE)),
    ("bot_protection", re.compile(r"unusual traffic|automated requests|bot detection|anti-bot", re.IGNORECASE)),
    ("challenge_page", re.compile(r"\bchallenge\b|press and hold|one more step", re.IGNORECASE)),
)


@dataclass(frozen=True)
class BrowserAction:
    kind: str
    selector: str
    value: str | None = None


@dataclass(frozen=True)
class BrowserAuthCredentials:
    identifier: str
    password: str


@dataclass(frozen=True)
class BrowserExecutionRequest:
    goal: str
    target_url: str | None
    actions: list[BrowserAction] = field(default_factory=list)
    auth: BrowserAuthCredentials | None = None
    capture_screenshot: bool = True
    capture_html: bool = True
    max_links: int = 8
    text_budget: int = 4000
    navigation_timeout_ms: int = 15000
    action_timeout_ms: int = 6000


@dataclass(frozen=True)
class BrowserLoginAssessment:
    status: str
    reason: str
    evidence: str | None = None


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
                    if request.actions:
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
                    elif self._should_run_autonomous_login(request):
                        login_actions = await self._run_login_flow(
                            page,
                            request,
                            timeout_ms=request.action_timeout_ms,
                        )
                        executed_actions.extend(login_actions)
                        for action_result in login_actions:
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
                    "snapshot": snapshot,
                }
                manual_takeover = self._manual_takeover_signal(
                    request,
                    snapshot=snapshot,
                    final_url=page.url,
                )
                login_assessment = self._assess_login_outcome(
                    request,
                    snapshot=snapshot,
                    final_url=page.url,
                )
                if login_assessment is not None:
                    metadata_payload["login_assessment"] = asdict(login_assessment)
                if manual_takeover is None and login_assessment and login_assessment.status == "takeover_required":
                    manual_takeover = {
                        "required": True,
                        "reason": login_assessment.reason,
                        "target_url": page.url or request.target_url,
                        "detected_markers": ["login_unconfirmed"],
                    }
                if manual_takeover is not None:
                    metadata_payload["manual_takeover"] = manual_takeover
                    if manual_takeover["reason"] not in warnings:
                        warnings = [*warnings, manual_takeover["reason"]]
                if (
                    login_assessment is not None
                    and login_assessment.status != "completed"
                    and login_assessment.reason not in warnings
                ):
                    warnings = [*warnings, login_assessment.reason]
                metadata_payload["warnings"] = warnings
                metadata_key = f"browser-runs/{session_id}/metadata.json"
                artifacts["metadata"] = {
                    "storage_key": metadata_key,
                    "path": self.storage.save_json(metadata_key, metadata_payload),
                    "content_type": "application/json",
                }
                session_status = self._final_browser_status(
                    manual_takeover=manual_takeover,
                    login_assessment=login_assessment,
                )

                snapshot_event_payload = {
                    **event_payload_base,
                    "status": session_status,
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
                    "manual_takeover": manual_takeover,
                    "login_assessment": asdict(login_assessment) if login_assessment is not None else None,
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
                    "status": session_status,
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
                    "reason": login_assessment.reason if login_assessment and session_status != "completed" else None,
                    "manual_takeover": manual_takeover,
                    "login_assessment": asdict(login_assessment) if login_assessment is not None else None,
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
                completion_event = "computer.session.failed" if session_status == "failed" else "computer.session.completed"
                await self._emit(
                    event_handler,
                    completion_event,
                    {
                        **event_payload_base,
                        "status": session_status,
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
                        "manual_takeover": manual_takeover,
                        "login_assessment": asdict(login_assessment) if login_assessment is not None else None,
                        "reason": payload["reason"],
                        "metrics": payload["metrics"],
                    },
                )
                audit = self.finalize_audit(
                    audit,
                    started_at,
                    status=session_status,
                    response={
                        "final_url": page.url,
                        "action_count": len(executed_actions),
                        "warning_count": len(warnings),
                        "status": session_status,
                    },
                    artifacts=list(artifacts.values()),
                )
                return self.result(operation="execute", status=session_status, payload=payload, audit=audit)
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
            auth=self._extract_auth_credentials(goal),
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
        if self._should_run_autonomous_login(request):
            return "interactive"
        decision = self.policy.evaluate_browser_interaction(request.goal, action_count=len(request.actions))
        if request.actions and decision.allowed:
            return "interactive"
        return "read_only_capture"

    def _has_interaction_approval(self, goal: str) -> bool:
        return self.policy.evaluate_browser_interaction(goal, action_count=1).allowed

    def _request_warnings(self, request: BrowserExecutionRequest) -> list[str]:
        warnings: list[str] = []
        if self._should_run_autonomous_login(request):
            return warnings
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
        if self._should_run_autonomous_login(request):
            steps.append("Find the login surface, fill the supplied credentials, and submit the form")
        elif request.actions:
            steps.append("Apply approved structured UI actions")
        if request.capture_screenshot:
            steps.append("Save a full-page screenshot")
        if request.capture_html:
            steps.append("Save an HTML snapshot and metadata record")
        return steps

    def _extract_auth_credentials(self, goal: str) -> BrowserAuthCredentials | None:
        email_match = EMAIL_CREDENTIAL_PATTERN.search(goal)
        password_match = PASSWORD_CREDENTIAL_PATTERN.search(goal)
        identifier = email_match.group("value").strip() if email_match else None
        password = password_match.group("value").strip() if password_match else None
        if identifier and password:
            return BrowserAuthCredentials(identifier=identifier, password=password)
        return None

    def _has_login_intent(self, goal: str) -> bool:
        return bool(LOGIN_INTENT_PATTERN.search(goal))

    def _should_run_autonomous_login(self, request: BrowserExecutionRequest) -> bool:
        return request.auth is not None and self._has_login_intent(request.goal)

    def _is_safe_url(self, url: str) -> bool:
        parsed = urlparse(url)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

    async def _capture_page_snapshot(self, page, request: BrowserExecutionRequest) -> dict:
        return await page.evaluate(
            """
            ({ textLimit, linkLimit }) => {
              const root = document.querySelector("main, article, body") || document.body;
              const isVisible = (node) => {
                if (!node) {
                  return false;
                }
                const style = window.getComputedStyle(node);
                if (!style) {
                  return true;
                }
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                  return false;
                }
                return !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
              };
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
              const visiblePasswordFields = Array.from(document.querySelectorAll("input[type='password']"))
                .filter((node) => isVisible(node));
              const visibleIdentifierFields = Array.from(document.querySelectorAll(
                "input[type='email'], input[autocomplete='username'], input[name*='email' i], input[id*='email' i], input[name*='user' i], input[id*='user' i]"
              )).filter((node) => isVisible(node));
              const loginSurfaceDetected =
                visiblePasswordFields.length > 0 ||
                Array.from(document.querySelectorAll("button, [role='button'], input[type='submit'], a"))
                  .map((node) => ((node.textContent || node.value || "").replace(/\\s+/g, " ").trim()))
                  .some((label) => /^(log\\s*in|login|sign\\s*in)$/i.test(label));
              return {
                page_title: document.title || "",
                text: cleanText,
                headings,
                links,
                link_count: links.length,
                button_count: document.querySelectorAll("button, [role='button'], input[type='submit']").length,
                form_count: document.querySelectorAll("form").length,
                captured_text_chars: cleanText.length,
                visible_password_field_count: visiblePasswordFields.length,
                visible_identifier_field_count: visibleIdentifierFields.length,
                login_surface_detected: loginSurfaceDetected
              };
            }
            """,
            {"textLimit": request.text_budget, "linkLimit": request.max_links},
        )

    async def _run_action(self, page, action: BrowserAction, *, timeout_ms: int) -> dict:
        if action.kind == "click":
            locator = await self._resolve_interactable_locator(
                page,
                action.selector,
                require_visible=True,
                require_enabled=True,
            )
            await locator.click(timeout=timeout_ms)
        elif action.kind == "wait_for":
            await page.wait_for_selector(action.selector, timeout=timeout_ms)
        elif action.kind == "fill":
            locator = await self._resolve_interactable_locator(
                page,
                action.selector,
                require_visible=True,
                require_enabled=True,
            )
            try:
                await locator.click(timeout=timeout_ms)
            except Exception:
                pass
            await locator.fill(action.value or "", timeout=timeout_ms)
            try:
                await locator.blur()
            except Exception:
                pass
        else:
            raise ValueError(f"Unsupported browser action: {action.kind}")

        executed = asdict(action)
        executed["status"] = "completed"
        return executed

    async def _run_login_flow(
        self,
        page,
        request: BrowserExecutionRequest,
        *,
        timeout_ms: int,
    ) -> list[dict]:
        if request.auth is None:
            return []

        executed_actions: list[dict] = []

        login_trigger_selectors = [
            "a[href*='login' i]",
            "a[href*='signin' i]",
            "a[href*='sign-in' i]",
            "button:has-text('Log In')",
            "button:has-text('Login')",
            "button:has-text('Sign In')",
            "button:has-text('Sign in')",
            "a:has-text('Log In')",
            "a:has-text('Login')",
            "a:has-text('Sign In')",
            "a:has-text('Sign in')",
        ]
        identifier_selectors = [
            "input[type='email']",
            "form input[type='email']",
            "input[name*='email' i]",
            "input[id*='email' i]",
            "input[placeholder*='email' i]",
            "input[autocomplete='username']",
            "input[name*='user' i]",
            "input[id*='user' i]",
            "input[placeholder*='user' i]",
            "input[name*='login' i]",
            "input[id*='login' i]",
            "form input[type='text']",
        ]
        password_selectors = [
            "input[type='password']",
            "form input[type='password']",
        ]
        submit_selectors = [
            "button[type='submit']",
            "input[type='submit']",
            "form button[type='submit']",
            "button:has-text('Log In')",
            "button:has-text('Log in')",
            "button:has-text('Login')",
            "button:has-text('Sign In')",
            "button:has-text('Sign in')",
            "[role='button']:has-text('Log In')",
            "[role='button']:has-text('Log in')",
            "[role='button']:has-text('Login')",
            "[role='button']:has-text('Sign In')",
            "[role='button']:has-text('Sign in')",
            "text=/^log\\s*in$/i",
            "text=/^sign\\s*in$/i",
        ]

        await self._ensure_login_surface(
            page,
            request,
            login_trigger_selectors=login_trigger_selectors,
            password_selectors=password_selectors,
            timeout_ms=timeout_ms,
            executed_actions=executed_actions,
        )

        identifier_match = await self._find_first_available_locator(
            page,
            identifier_selectors,
            require_visible=True,
            require_enabled=True,
        )
        if identifier_match is None:
            raise ValueError("Could not find an email or username field to complete the requested login.")
        identifier_action = await self._fill_locator(
            identifier_match["locator"],
            identifier_match["selector"],
            request.auth.identifier,
            timeout_ms=timeout_ms,
        )
        executed_actions.append(identifier_action)

        password_match = await self._find_first_available_locator(
            page,
            password_selectors,
            require_visible=True,
            require_enabled=True,
        )
        if password_match is None:
            raise ValueError("Could not find a password field to complete the requested login.")
        password_action = await self._fill_locator(
            password_match["locator"],
            password_match["selector"],
            request.auth.password,
            timeout_ms=timeout_ms,
        )
        executed_actions.append(password_action)

        submit_action = await self._submit_login_request(
            page,
            submit_selectors=submit_selectors,
            password_selector=password_match["selector"],
            identifier_selector=identifier_match["selector"],
            timeout_ms=timeout_ms,
        )
        if submit_action is None:
            raise ValueError("Could not find a submit button to complete the requested login.")
        executed_actions.append(submit_action)
        await self._await_post_submit_state(page, timeout_ms=timeout_ms)
        return executed_actions

    async def _ensure_login_surface(
        self,
        page,
        request: BrowserExecutionRequest,
        *,
        login_trigger_selectors: list[str],
        password_selectors: list[str],
        timeout_ms: int,
        executed_actions: list[dict],
    ) -> None:
        if await self._has_available_selector(page, password_selectors):
            return

        current_path = urlparse(page.url).path.lower()
        if "login" not in current_path and "signin" not in current_path and request.target_url:
            for suffix in ("/login", "/signin", "/sign-in"):
                candidate = urljoin(request.target_url, suffix)
                try:
                    await page.goto(candidate, wait_until="domcontentloaded", timeout=timeout_ms)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=min(timeout_ms, 2500))
                    except Exception:
                        pass
                    if await self._has_available_selector(page, password_selectors):
                        executed_actions.append(
                            {
                                "kind": "navigate",
                                "selector": candidate,
                                "status": "completed",
                            }
                        )
                        return
                except Exception:
                    continue

        trigger_action = await self._run_first_available_action(
            page,
            login_trigger_selectors,
            "click",
            timeout_ms=timeout_ms,
        )
        if trigger_action is not None:
            executed_actions.append(trigger_action)
            await self._await_post_submit_state(page, timeout_ms=timeout_ms)

    async def _await_post_submit_state(self, page, *, timeout_ms: int) -> None:
        try:
            await page.wait_for_load_state("networkidle", timeout=min(timeout_ms, 3000))
        except Exception:
            pass

    async def _has_available_selector(self, page, selectors: list[str]) -> bool:
        for selector in selectors:
            try:
                await self._resolve_interactable_locator(
                    page,
                    selector,
                    require_visible=True,
                    require_enabled=False,
                )
                return True
            except Exception:
                continue
        return False

    async def _resolve_interactable_locator(
        self,
        page,
        selector: str,
        *,
        require_visible: bool,
        require_enabled: bool,
    ):
        locator = page.locator(selector)
        count = await locator.count()
        if count == 0:
            raise ValueError(f"Could not find selector: {selector}")

        fallback = None
        for index in range(count):
            candidate = locator.nth(index)
            if fallback is None:
                fallback = candidate
            try:
                if require_visible and not await candidate.is_visible():
                    continue
                if require_enabled and not await candidate.is_enabled():
                    continue
                return candidate
            except Exception:
                continue

        if require_visible or require_enabled:
            raise ValueError(f"Could not find an interactable selector: {selector}")
        if fallback is None:
            raise ValueError(f"Could not find selector: {selector}")
        return fallback

    async def _find_first_available_locator(
        self,
        page,
        selectors: list[str],
        *,
        require_visible: bool,
        require_enabled: bool,
    ) -> dict | None:
        for selector in selectors:
            try:
                locator = await self._resolve_interactable_locator(
                    page,
                    selector,
                    require_visible=require_visible,
                    require_enabled=require_enabled,
                )
                return {"selector": selector, "locator": locator}
            except Exception:
                continue
        return None

    async def _fill_locator(
        self,
        locator,
        selector: str,
        value: str,
        *,
        timeout_ms: int,
    ) -> dict:
        try:
            await locator.click(timeout=timeout_ms)
        except Exception:
            pass
        await locator.fill(value or "", timeout=timeout_ms)
        try:
            await locator.blur()
        except Exception:
            pass
        return {
            "kind": "fill",
            "selector": selector,
            "value": value,
            "status": "completed",
        }

    async def _submit_login_request(
        self,
        page,
        *,
        submit_selectors: list[str],
        password_selector: str,
        identifier_selector: str,
        timeout_ms: int,
    ) -> dict | None:
        submit_action = await self._run_first_available_action(page, submit_selectors, "click", timeout_ms=timeout_ms)
        if submit_action is not None:
            return submit_action

        for selector in (password_selector, identifier_selector):
            try:
                locator = await self._resolve_interactable_locator(
                    page,
                    selector,
                    require_visible=True,
                    require_enabled=True,
                )
                await locator.press("Enter", timeout=timeout_ms)
                return {
                    "kind": "press",
                    "selector": selector,
                    "value": "Enter",
                    "status": "completed",
                }
            except Exception:
                continue

        for selector in (password_selector, identifier_selector):
            try:
                locator = await self._resolve_interactable_locator(
                    page,
                    selector,
                    require_visible=True,
                    require_enabled=False,
                )
                submitted = await locator.evaluate(
                    """
                    (node) => {
                      const form = node.closest('form');
                      if (!form) {
                        return false;
                      }
                      if (typeof form.requestSubmit === 'function') {
                        form.requestSubmit();
                        return true;
                      }
                      form.submit();
                      return true;
                    }
                    """
                )
                if submitted:
                    return {
                        "kind": "submit",
                        "selector": selector,
                        "status": "completed",
                    }
            except Exception:
                continue
        return None

    async def _run_first_available_action(
        self,
        page,
        selectors: list[str],
        kind: str,
        *,
        timeout_ms: int,
    ) -> dict | None:
        last_error: Exception | None = None
        for selector in selectors:
            try:
                return await self._run_action(page, BrowserAction(kind=kind, selector=selector), timeout_ms=timeout_ms)
            except Exception as exc:
                last_error = exc
                continue
        if last_error is not None:
            return None
        return None

    async def _run_first_available_fill(
        self,
        page,
        selectors: list[str],
        value: str,
        *,
        timeout_ms: int,
    ) -> dict | None:
        match = await self._find_first_available_locator(
            page,
            selectors,
            require_visible=True,
            require_enabled=True,
        )
        if match is None:
            return None
        return await self._fill_locator(
            match["locator"],
            match["selector"],
            value,
            timeout_ms=timeout_ms,
        )
        return None

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

    def _assess_login_outcome(
        self,
        request: BrowserExecutionRequest,
        *,
        snapshot: dict,
        final_url: str,
    ) -> BrowserLoginAssessment | None:
        if not self._should_run_autonomous_login(request):
            return None

        page_fragments = [
            request.goal,
            final_url,
            str(snapshot.get("page_title") or ""),
            str(snapshot.get("text") or ""),
            *[str(item) for item in snapshot.get("headings") or []],
        ]
        combined = " ".join(fragment for fragment in page_fragments if fragment).strip()
        lowered = combined.lower()
        login_path = bool(LOGIN_PATH_PATTERN.search(urlparse(final_url).path.lower()))
        password_fields = int(snapshot.get("visible_password_field_count") or 0)
        login_surface_detected = bool(snapshot.get("login_surface_detected")) or password_fields > 0

        for marker, pattern in LOGIN_FAILURE_PATTERNS:
            if pattern.search(combined):
                if marker == "bad_credentials":
                    reason = "The site rejected the supplied credentials after the sign-in attempt."
                elif marker == "access_denied":
                    reason = "The credentials were submitted, but the site denied access after sign-in."
                elif marker == "account_restricted":
                    reason = "The site accepted the sign-in attempt only up to an account restriction page, not an authenticated session."
                else:
                    reason = "The site reported that the sign-in attempt failed."
                return BrowserLoginAssessment(status="failed", reason=reason, evidence=combined[:400])

        for _, pattern in LOGIN_PENDING_PATTERNS:
            if pattern.search(combined) and (login_path or login_surface_detected):
                return BrowserLoginAssessment(
                    status="takeover_required",
                    reason=(
                        "The sign-in stayed in a pending state after submit, so a human should take over the browser, "
                        "finish the protected step, and then hand control back."
                    ),
                    evidence=combined[:400],
                )

        if not login_path and not login_surface_detected:
            return BrowserLoginAssessment(
                status="completed",
                reason="The browser left the login surface and the session looks authenticated.",
                evidence=combined[:400],
            )

        if any(pattern.search(lowered) for pattern in LOGIN_SUCCESS_PATTERNS):
            return BrowserLoginAssessment(
                status="completed",
                reason="The page shows post-login session indicators.",
                evidence=combined[:400],
            )

        if login_path or login_surface_detected:
            return BrowserLoginAssessment(
                status="failed",
                reason="The credentials were submitted, but the site kept the session on the sign-in surface, so login could not be confirmed.",
                evidence=combined[:400],
            )

        return BrowserLoginAssessment(
            status="failed",
            reason="The sign-in attempt finished, but the app could not confirm an authenticated session.",
            evidence=combined[:400],
        )

    def _final_browser_status(
        self,
        *,
        manual_takeover: dict | None,
        login_assessment: BrowserLoginAssessment | None,
    ) -> str:
        if login_assessment is not None and login_assessment.status == "failed":
            return "failed"
        if manual_takeover is not None:
            return "takeover_required"
        if login_assessment is not None:
            return login_assessment.status
        return "completed"

    def _manual_takeover_signal(
        self,
        request: BrowserExecutionRequest,
        *,
        snapshot: dict,
        final_url: str,
    ) -> dict | None:
        page_fragments = [
            request.goal,
            final_url,
            str(snapshot.get("page_title") or ""),
            str(snapshot.get("text") or ""),
            *[str(item) for item in snapshot.get("headings") or []],
        ]
        combined = " ".join(fragment for fragment in page_fragments if fragment).strip()
        if not combined:
            return None

        matched_markers = [
            marker
            for marker, pattern in MANUAL_TAKEOVER_PATTERNS
            if pattern.search(combined)
        ]
        if not matched_markers:
            return None

        reason = (
            "The browser reached a CAPTCHA or protection challenge that requires a human to take control, "
            "complete the blocked step, and then hand a short note back so the agent can continue."
        )
        return {
            "required": True,
            "reason": reason,
            "target_url": final_url or request.target_url,
            "detected_markers": matched_markers,
        }

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
