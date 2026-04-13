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
        self.first = self

    async def click(self, timeout: int) -> None:
        self.page.interactions.append(("click", self.selector, timeout))

    async def fill(self, value: str, timeout: int) -> None:
        self.page.interactions.append(("fill", self.selector, value, timeout))


class FakePage:
    def __init__(self) -> None:
        self.url = "https://example.com/landing"
        self.interactions: list[tuple] = []

    async def goto(self, url: str, wait_until: str, timeout: int):
        self.url = url
        self.interactions.append(("goto", url, wait_until, timeout))
        return FakeResponse(status=200)

    async def wait_for_load_state(self, state: str, timeout: int) -> None:
        self.interactions.append(("wait_for_load_state", state, timeout))

    async def evaluate(self, script: str, payload: dict):
        return {
            "page_title": "Example Domain",
            "text": "Example page body",
            "headings": ["Example Domain"],
            "links": [{"text": "More information", "url": "https://example.com/more"}],
            "link_count": 1,
            "button_count": 0,
            "form_count": 0,
            "captured_text_chars": 17,
        }

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
