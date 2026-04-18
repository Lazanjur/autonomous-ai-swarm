import pytest

from app.services.tools.browser import BrowserAutomationTool


class FakeStorage:
    def __init__(self) -> None:
        self.saved: dict[str, bytes | str] = {}

    def save_bytes(self, key: str, content: bytes) -> str:
        self.saved[key] = content
        return f"/fake/{key}"

    def save_text(self, key: str, content: str) -> str:
        self.saved[key] = content
        return f"/fake/{key}"

    def save_json(self, key: str, payload: dict) -> str:
        self.saved[key] = payload
        return f"/fake/{key}"


class FakeResponse:
    def __init__(self, status: int = 200) -> None:
        self.status = status


class FakeLocator:
    def __init__(self, page, selector: str) -> None:
        self.page = page
        self.selector = selector
        self.index = 0
        self.first = self

    async def click(self, timeout: int) -> None:
        self.page.interactions.append(("click", self.selector, timeout))
        if "submit" in self.selector.lower() or "log in" in self.selector.lower() or "sign in" in self.selector.lower():
            self.page.trigger_submit()

    async def fill(self, value: str, timeout: int) -> None:
        self.page.interactions.append(("fill", self.selector, value, timeout))

    async def blur(self) -> None:
        self.page.interactions.append(("blur", self.selector))

    async def press(self, key: str, timeout: int) -> None:
        self.page.interactions.append(("press", self.selector, key, timeout))
        if key == "Enter":
            self.page.trigger_submit()

    async def evaluate(self, script: str):
        self.page.interactions.append(("evaluate", self.selector))
        if "requestSubmit" in script or "form.submit" in script:
            self.page.trigger_submit()
        return True

    async def count(self) -> int:
        return len(self.page.locator_states.get(self.selector, []))

    def nth(self, index: int):
        locator = FakeLocator(self.page, self.selector)
        locator.index = index
        return locator

    async def is_visible(self) -> bool:
        state = self.page.locator_states.get(self.selector, [])
        return state[self.index].get("visible", True)

    async def is_enabled(self) -> bool:
        state = self.page.locator_states.get(self.selector, [])
        return state[self.index].get("enabled", True)


class FakePage:
    def __init__(self) -> None:
        self.url = "https://example.com/landing"
        self.interactions: list[tuple] = []
        self.locator_states: dict[str, list[dict[str, bool]]] = {}
        self.snapshot = {
            "page_title": "Example Domain",
            "text": "Example page body",
            "headings": ["Example Domain"],
            "links": [{"text": "More information", "url": "https://example.com/more"}],
            "link_count": 1,
            "button_count": 0,
            "form_count": 0,
            "captured_text_chars": 17,
            "visible_password_field_count": 0,
            "visible_identifier_field_count": 0,
            "login_surface_detected": False,
        }
        self.on_submit = None

    async def goto(self, url: str, wait_until: str, timeout: int):
        self.url = url
        self.interactions.append(("goto", url, wait_until, timeout))
        return FakeResponse(status=200)

    async def wait_for_load_state(self, state: str, timeout: int) -> None:
        self.interactions.append(("wait_for_load_state", state, timeout))

    async def evaluate(self, script: str, payload: dict):
        return dict(self.snapshot)

    async def screenshot(self, full_page: bool, type: str) -> bytes:
        assert full_page is True
        assert type == "png"
        return b"png-bytes"

    async def content(self) -> str:
        return "<html><body>Example</body></html>"

    def locator(self, selector: str) -> FakeLocator:
        return FakeLocator(self, selector)

    async def wait_for_selector(self, selector: str, timeout: int) -> None:
        self.interactions.append(("wait_for_selector", selector, timeout))

    def trigger_submit(self) -> None:
        if callable(self.on_submit):
            self.on_submit()


class FakeContext:
    def __init__(self, page: FakePage) -> None:
        self.page = page

    async def new_page(self) -> FakePage:
        return self.page

    async def close(self) -> None:
        return None


class FakeBrowser:
    def __init__(self, page: FakePage) -> None:
        self.page = page

    async def new_context(self, viewport: dict, ignore_https_errors: bool) -> FakeContext:
        assert viewport["width"] == 1440
        assert ignore_https_errors is True
        return FakeContext(self.page)

    async def close(self) -> None:
        return None


class FakeChromium:
    def __init__(self, page: FakePage) -> None:
        self.page = page

    async def launch(self, headless: bool) -> FakeBrowser:
        assert isinstance(headless, bool)
        return FakeBrowser(self.page)


class FakePlaywright:
    def __init__(self, page: FakePage) -> None:
        self.chromium = FakeChromium(page)


class FakePlaywrightManager:
    def __init__(self, page: FakePage) -> None:
        self.page = page

    async def __aenter__(self) -> FakePlaywright:
        return FakePlaywright(self.page)

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


@pytest.mark.asyncio
async def test_execute_returns_planned_result_without_explicit_url():
    tool = BrowserAutomationTool(storage=FakeStorage())

    result = await tool.execute("Open the pricing page and review the layout.")

    assert result["status"] == "planned"
    assert result["target_url"] is None
    assert "explicit target URL" in result["reason"]


@pytest.mark.asyncio
async def test_execute_runs_playwright_capture_and_persists_artifacts(monkeypatch):
    storage = FakeStorage()
    page = FakePage()
    tool = BrowserAutomationTool(storage=storage)
    monkeypatch.setattr(tool, "_playwright_factory", lambda: FakePlaywrightManager(page))

    result = await tool.execute("Review https://example.com and capture the visible content.")

    assert result["status"] == "completed"
    assert result["target_url"] == "https://example.com"
    assert result["page_title"] == "Example Domain"
    assert result["metrics"]["response_status"] == 200
    assert "screenshot" in result["artifacts"]
    assert "html_snapshot" in result["artifacts"]
    assert "metadata" in result["artifacts"]
    assert any(key.endswith("page.png") for key in storage.saved)
    assert any(item[0] == "goto" for item in page.interactions)


@pytest.mark.asyncio
async def test_execute_runs_approved_actions_in_prompt_order(monkeypatch):
    storage = FakeStorage()
    page = FakePage()
    page.locator_states = {
        "input[name='email']": [{"visible": True, "enabled": True}],
        "button[type='submit']": [{"visible": True, "enabled": True}],
    }
    tool = BrowserAutomationTool(storage=storage)
    monkeypatch.setattr(tool, "_playwright_factory", lambda: FakePlaywrightManager(page))

    result = await tool.execute(
        (
            "Approved interactive action on https://example.com. "
            "fill selector \"input[name='email']\" with \"demo@example.com\" "
            "click selector \"button[type='submit']\""
        )
    )

    assert result["status"] == "completed"
    assert result["action_mode"] == "interactive"
    assert [item["kind"] for item in result["executed_actions"]] == ["fill", "click"]
    assert result["skipped_actions"] == []
    assert ("fill", "input[name='email']", "demo@example.com", 6000) in page.interactions
    assert ("click", "button[type='submit']", 6000) in page.interactions


@pytest.mark.asyncio
async def test_execute_skips_actions_without_approval(monkeypatch):
    storage = FakeStorage()
    page = FakePage()
    tool = BrowserAutomationTool(storage=storage)
    monkeypatch.setattr(tool, "_playwright_factory", lambda: FakePlaywrightManager(page))

    result = await tool.execute(
        'Visit https://example.com and click selector "#checkout" to continue.'
    )

    assert result["status"] == "completed"
    assert result["action_mode"] == "read_only_capture"
    assert result["executed_actions"] == []
    assert result["skipped_actions"][0]["kind"] == "click"
    assert any("skipped" in warning.lower() for warning in result["warnings"])


@pytest.mark.asyncio
async def test_execute_runs_autonomous_login_when_credentials_are_supplied(monkeypatch):
    storage = FakeStorage()
    page = FakePage()
    page.locator_states = {
        "input[type='email']": [{"visible": True, "enabled": True}],
        "input[type='password']": [{"visible": True, "enabled": True}],
        "button[type='submit']": [{"visible": True, "enabled": True}],
    }

    def complete_login() -> None:
        page.url = "https://example.com/dashboard"
        page.snapshot = {
            **page.snapshot,
            "page_title": "Example Dashboard",
            "text": "Welcome back. Sign out.",
            "headings": ["Dashboard"],
            "visible_password_field_count": 0,
            "visible_identifier_field_count": 0,
            "login_surface_detected": False,
        }

    page.on_submit = complete_login
    tool = BrowserAutomationTool(storage=storage)
    monkeypatch.setattr(tool, "_playwright_factory", lambda: FakePlaywrightManager(page))

    result = await tool.execute(
        (
            "Open https://example.com, then login with credentials: "
            "email: demo@example.com and pw: hunter2"
        )
    )

    assert result["status"] == "completed"
    assert result["action_mode"] == "interactive"
    assert [item["kind"] for item in result["executed_actions"]] == ["fill", "fill", "click"]
    assert any(
        item[:3] == ("fill", "input[type='email']", "demo@example.com")
        for item in page.interactions
    )
    assert any(
        item[:3] == ("fill", "input[type='password']", "hunter2")
        for item in page.interactions
    )
    assert result["skipped_actions"] == []
    assert result["warnings"] == []


@pytest.mark.asyncio
async def test_execute_login_falls_back_to_enter_submission(monkeypatch):
    storage = FakeStorage()
    page = FakePage()
    page.locator_states = {
        "input[type='email']": [{"visible": True, "enabled": True}],
        "input[type='password']": [{"visible": True, "enabled": True}],
    }
    tool = BrowserAutomationTool(storage=storage)
    monkeypatch.setattr(tool, "_playwright_factory", lambda: FakePlaywrightManager(page))

    result = await tool.execute(
        (
            "Open https://example.com, then login with credentials: "
            "email: demo@example.com and pw: hunter2"
        )
    )

    assert result["status"] == "completed"
    assert [item["kind"] for item in result["executed_actions"]] == ["fill", "fill", "press"]
    assert ("press", "input[type='password']", "Enter", 6000) in page.interactions


@pytest.mark.asyncio
async def test_execute_prefers_visible_login_fields_and_direct_login_surface(monkeypatch):
    storage = FakeStorage()
    page = FakePage()
    page.locator_states = {"button[type='submit']": [{"visible": True, "enabled": True}]}

    original_goto = page.goto

    async def goto_with_login_surface(url: str, wait_until: str, timeout: int):
        response = await original_goto(url, wait_until, timeout)
        if url.endswith("/login"):
            page.locator_states.update(
                {
                    "input[type='email']": [
                        {"visible": False, "enabled": True},
                        {"visible": True, "enabled": True},
                    ],
                    "form input[type='email']": [{"visible": True, "enabled": True}],
                    "input[type='password']": [{"visible": True, "enabled": True}],
                    "form input[type='password']": [{"visible": True, "enabled": True}],
                }
            )
            page.snapshot = {
                **page.snapshot,
                "page_title": "Example Login",
                "text": "Sign in to your account",
                "headings": ["Sign in"],
                "visible_password_field_count": 1,
                "visible_identifier_field_count": 1,
                "login_surface_detected": True,
            }
        return response

    page.goto = goto_with_login_surface

    def complete_login() -> None:
        page.url = "https://example.com/dashboard"
        page.snapshot = {
            **page.snapshot,
            "page_title": "Example Dashboard",
            "text": "Welcome back. Sign out.",
            "headings": ["Dashboard"],
            "visible_password_field_count": 0,
            "visible_identifier_field_count": 0,
            "login_surface_detected": False,
        }

    page.on_submit = complete_login
    tool = BrowserAutomationTool(storage=storage)
    monkeypatch.setattr(tool, "_playwright_factory", lambda: FakePlaywrightManager(page))

    result = await tool.execute(
        "Open https://example.com and then login with credentials: email: demo@example.com and pw: hunter2"
    )

    assert result["status"] == "completed"
    assert any(
        item[:2] == ("goto", "https://example.com/login")
        for item in page.interactions
    )
    assert ("fill", "input[type='email']", "demo@example.com", 6000) in page.interactions
    assert ("blur", "input[type='email']") in page.interactions


@pytest.mark.asyncio
async def test_execute_emits_browser_session_events(monkeypatch):
    storage = FakeStorage()
    page = FakePage()
    tool = BrowserAutomationTool(storage=storage)
    monkeypatch.setattr(tool, "_playwright_factory", lambda: FakePlaywrightManager(page))

    events: list[tuple[str, dict]] = []

    async def capture(event: str, payload: dict) -> None:
        events.append((event, payload))

    result = await tool.execute_with_events(
        "Review https://example.com and capture the visible content.",
        event_handler=capture,
        event_context={"agent_key": "vision_automation", "step_index": 0},
    )

    assert result["status"] == "completed"
    assert [name for name, _ in events] == [
        "computer.session.started",
        "computer.session.updated",
        "browser.snapshot",
        "computer.session.completed",
    ]
    assert events[2][1]["session_kind"] == "browser"
    assert events[2][1]["artifacts"]["screenshot"]["storage_key"].endswith("page.png")
    assert events[-1][1]["session_kind"] == "browser"


@pytest.mark.asyncio
async def test_execute_marks_login_as_failed_when_site_rejects_credentials(monkeypatch):
    storage = FakeStorage()
    page = FakePage()
    page.locator_states = {
        "input[type='email']": [{"visible": True, "enabled": True}],
        "input[type='password']": [{"visible": True, "enabled": True}],
        "button[type='submit']": [{"visible": True, "enabled": True}],
    }

    def reject_login() -> None:
        page.url = "https://example.com/login"
        page.snapshot = {
            **page.snapshot,
            "page_title": "Example Login",
            "text": "Sign in to your account. Bad creds. Try again.",
            "headings": ["Sign in to your account"],
            "form_count": 1,
            "button_count": 1,
            "captured_text_chars": 48,
            "visible_password_field_count": 1,
            "visible_identifier_field_count": 1,
            "login_surface_detected": True,
        }

    page.on_submit = reject_login
    tool = BrowserAutomationTool(storage=storage)
    monkeypatch.setattr(tool, "_playwright_factory", lambda: FakePlaywrightManager(page))

    result = await tool.execute(
        "Open https://example.com and then login with credentials: email: demo@example.com and pw: hunter2"
    )

    assert result["status"] == "failed"
    assert "rejected the supplied credentials" in result["reason"]
    assert result["login_assessment"]["status"] == "failed"


@pytest.mark.asyncio
async def test_execute_marks_stalled_login_as_takeover_required(monkeypatch):
    storage = FakeStorage()
    page = FakePage()
    page.locator_states = {
        "input[type='email']": [{"visible": True, "enabled": True}],
        "input[type='password']": [{"visible": True, "enabled": True}],
        "button[type='submit']": [{"visible": True, "enabled": True}],
    }

    def stall_login() -> None:
        page.url = "https://example.com/login"
        page.snapshot = {
            **page.snapshot,
            "page_title": "Example Login",
            "text": "Sign in to your account. Signing in… Please wait.",
            "headings": ["Sign in to your account"],
            "form_count": 1,
            "button_count": 1,
            "captured_text_chars": 50,
            "visible_password_field_count": 1,
            "visible_identifier_field_count": 1,
            "login_surface_detected": True,
        }

    page.on_submit = stall_login
    tool = BrowserAutomationTool(storage=storage)
    monkeypatch.setattr(tool, "_playwright_factory", lambda: FakePlaywrightManager(page))

    result = await tool.execute(
        "Open https://example.com and then login with credentials: email: demo@example.com and pw: hunter2"
    )

    assert result["status"] == "takeover_required"
    assert result["manual_takeover"]["required"] is True
    assert "take over the browser" in result["manual_takeover"]["reason"]
