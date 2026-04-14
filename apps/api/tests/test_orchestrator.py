from types import SimpleNamespace

import pytest

from app.services.agents.orchestrator import PlannedTask, SupervisorOrchestrator, ToolLoopRun
from app.services.agents.registry import AGENT_CATALOG


def test_orchestrator_builds_dependency_aware_plan():
    orchestrator = SupervisorOrchestrator()

    plan = orchestrator.build_plan(
        "Research the market, compare competitors, build an internal launch dashboard, and write the board memo."
    )

    by_key = {step.key: step for step in plan}
    assert "research" in by_key
    assert "analysis" in by_key
    assert "coding" in by_key
    assert "content" in by_key
    assert by_key["analysis"].dependencies == ("research",)
    assert by_key["content"].dependencies == ("research", "analysis", "coding")
    assert [step.plan_index for step in plan] == list(range(len(plan)))


def test_orchestrator_execution_batches_respect_dependencies():
    orchestrator = SupervisorOrchestrator()
    plan = orchestrator.build_plan(
        "Research the market, compare competitors, build an internal launch dashboard, and write the board memo."
    )

    batches = orchestrator._execution_batches(plan)

    assert [task.key for task in batches[0]] == ["research"]
    assert [task.key for task in batches[1]] == ["analysis"]
    assert [task.key for task in batches[2]] == ["coding"]
    assert [task.key for task in batches[3]] == ["content"]


def test_orchestrator_selects_content_for_notebooklm_native_deliverables():
    orchestrator = SupervisorOrchestrator()

    selected = orchestrator._select_agent_keys(
        "Create a podcast audio overview and a flashcard set from this material."
    )

    assert "content" in selected


def test_orchestrator_collects_deduplicated_grounded_citations():
    orchestrator = SupervisorOrchestrator()

    citations = orchestrator._collect_citations(
        [
            {
                "agent_name": "Research Agent",
                "tools": [
                    {
                        "tool": "knowledge_retrieval",
                        "results": [
                            {
                                "title": "Workspace launch brief",
                                "document_id": "doc-1",
                                "chunk_id": "chunk-1",
                                "source_type": "upload",
                                "source_uri": None,
                                "score": 0.92,
                                "excerpt": "Launch readiness details and source-backed findings.",
                            },
                            {
                                "title": "Workspace launch brief",
                                "document_id": "doc-1",
                                "chunk_id": "chunk-1",
                                "source_type": "upload",
                                "source_uri": None,
                                "score": 0.92,
                                "excerpt": "Launch readiness details and source-backed findings.",
                            },
                        ],
                    },
                    {
                        "tool": "web_search",
                        "results": [
                            {
                                "title": "Independent market source",
                                "url": "https://example.com/market-source",
                            }
                        ],
                    },
                ],
            }
        ]
    )

    assert [citation["reference_id"] for citation in citations] == ["S1", "S2"]
    assert citations[0]["kind"] == "knowledge"
    assert citations[0]["document_id"] == "doc-1"
    assert citations[1]["url"] == "https://example.com/market-source"


@pytest.mark.asyncio
async def test_orchestrator_execute_uses_validation_driven_escalation(monkeypatch):
    orchestrator = SupervisorOrchestrator()

    async def fake_preflight(agent_key: str, prompt: str, *, event_handler=None, event_context=None):
        return [{"tool": f"{agent_key}_tool", "status": "completed"}]

    async def fake_run_agent(
        definition,
        prompt,
        task,
        tool_context,
        scratchpad_snapshot,
        metadata,
        *,
        slow,
        feedback=None,
    ):
        if slow:
            content = (
                "Outcome: Comprehensive answer.\n"
                "Key Findings: Strong coverage of the requested objective.\n"
                "Risks: Key execution risks are documented.\n"
                "Assumptions: Dependencies are available.\n"
                "Supervisor Next Step: Move to final synthesis."
            )
            return {
                "agent_key": task.key,
                "agent_name": definition.name,
                "model": definition.slow_model,
                "provider": "mock-local",
                "content": content,
                "fallback": False,
            }

        return {
            "agent_key": task.key,
            "agent_name": definition.name,
            "model": definition.fast_model,
            "provider": "mock-local",
            "content": "Short draft.",
            "fallback": False,
        }

    async def fake_complete(model, system_prompt, user_prompt, **kwargs):
        return SimpleNamespace(content="Supervisor final synthesis", model=model, provider="mock-local", fallback=False)

    monkeypatch.setattr(orchestrator.tools, "preflight", fake_preflight)
    monkeypatch.setattr(orchestrator, "_run_agent", fake_run_agent)
    monkeypatch.setattr(orchestrator.router, "complete", fake_complete)

    result = await orchestrator.execute("Build an internal API for the team.")

    assert "What I'm doing" in result["final_response"]
    assert "Answer\nSupervisor final synthesis" in result["final_response"]
    assert "Three ways to go further" in result["final_response"]
    assert result["execution_batches"] == [["coding"], ["content"]]
    assert result["steps"][0]["validation"]["escalated_from_fast"] is True
    assert result["steps"][0]["dependencies"] == []
    assert result["steps"][1]["dependencies"] == ["coding"]
    assert result["scratchpad"]["completed_agents"] == ["coding", "content"]


@pytest.mark.asyncio
async def test_orchestrator_appends_grounding_references_when_synthesis_omits_inline_citations(monkeypatch):
    orchestrator = SupervisorOrchestrator()

    async def fake_preflight(agent_key: str, prompt: str, *, event_handler=None, event_context=None):
        del agent_key, prompt, event_handler, event_context
        return [
            {
                "tool": "web_search",
                "status": "completed",
                "results": [
                    {
                        "title": "Source one",
                        "url": "https://example.com/source-one",
                    }
                ],
            }
        ]

    async def fake_run_agent(
        definition,
        prompt,
        task,
        tool_context,
        scratchpad_snapshot,
        metadata,
        *,
        slow,
        feedback=None,
    ):
        del definition, prompt, scratchpad_snapshot, metadata, slow, feedback
        return {
            "agent_key": task.key,
            "agent_name": AGENT_CATALOG[task.key].name,
            "model": AGENT_CATALOG[task.key].fast_model,
            "provider": "mock-local",
            "content": (
                "Outcome: Evidence gathered.\n"
                f"Key Findings: Used {len(tool_context)} grounded source inputs.\n"
                "Risks: Source freshness can change.\n"
                "Assumptions: The gathered context is representative.\n"
                "Supervisor Next Step: Continue with synthesis."
            ),
            "fallback": False,
        }

    async def fake_tool_loop(**kwargs):
        del kwargs
        return ToolLoopRun(
            context=[
                {
                    "tool": "web_search",
                    "status": "completed",
                    "results": [
                        {
                            "title": "Source one",
                            "url": "https://example.com/source-one",
                        }
                    ],
                }
            ],
            executed_iterations=0,
            stop_reason="planner_completed",
        )

    async def fake_complete(model, system_prompt, user_prompt, **kwargs):
        del model, system_prompt, user_prompt, kwargs
        return SimpleNamespace(
            content="Executive summary: Final answer without inline markers.",
            model="mock-supervisor",
            provider="mock-local",
            fallback=False,
        )

    monkeypatch.setattr(orchestrator.tools, "preflight", fake_preflight)
    monkeypatch.setattr(orchestrator, "_run_tool_loop", fake_tool_loop)
    monkeypatch.setattr(orchestrator, "_run_agent", fake_run_agent)
    monkeypatch.setattr(orchestrator.router, "complete", fake_complete)
    monkeypatch.setattr(orchestrator, "_should_escalate", lambda *args, **kwargs: False)

    result = await orchestrator.execute("Research the workspace launch readiness.")

    assert "What I'm doing" in result["final_response"]
    assert "Three ways to go further" in result["final_response"]
    assert "Grounding references: [S1]" in result["final_response"]
    assert result["citations"][0]["reference_id"] == "S1"


@pytest.mark.asyncio
async def test_orchestrator_tool_loop_executes_named_tools_before_agent(monkeypatch):
    orchestrator = SupervisorOrchestrator()
    task = PlannedTask(
        key="research",
        objective="Collect grounded evidence about enterprise AI competitors.",
        reason="The task needs source-backed discovery.",
        expected_output="A concise evidence brief with competitor findings.",
        plan_index=0,
    )
    execute_calls: list[tuple[str, str, dict[str, object]]] = []

    async def fake_preflight(agent_key: str, prompt: str, *, event_handler=None, event_context=None):
        return [{"tool": "preflight_context", "status": "completed"}]

    async def fake_execute_named(
        agent_key: str,
        tool_name: str,
        arguments: dict[str, object] | None = None,
        *,
        event_handler=None,
        event_context=None,
    ):
        payload = dict(arguments or {})
        execute_calls.append((agent_key, tool_name, payload))
        return {
            "tool": tool_name,
            "operation": "execute",
            "status": "completed",
            "query": payload.get("query", ""),
            "results": [{"title": "Source", "url": "https://example.com"}],
        }

    async def fake_complete(model, system_prompt, user_prompt, **kwargs):
        if kwargs.get("metadata", {}).get("operation") == "tool_loop_planning":
            iteration = kwargs["metadata"]["tool_iteration"]
            content = (
                '{"action":"use_tool","reason":"Need more evidence","tool_name":"web_search",'
                '"arguments":{"query":"enterprise AI swarm competitors","max_results":2}}'
                if iteration == 0
                else '{"action":"complete","reason":"Enough evidence gathered.","tool_name":null,"arguments":{}}'
            )
            return SimpleNamespace(
                content=content,
                model=model,
                provider="mock-local",
                fallback=False,
            )
        raise AssertionError("Unexpected router.complete call in tool-loop test.")

    async def fake_run_agent(
        definition,
        prompt,
        task,
        tool_context,
        scratchpad_snapshot,
        metadata,
        *,
        slow,
        feedback=None,
    ):
        return {
            "agent_key": task.key,
            "agent_name": definition.name,
            "model": definition.fast_model,
            "provider": "mock-local",
            "content": (
                "Outcome: Evidence gathered.\n"
                f"Key Findings: Used {len(tool_context)} tool records.\n"
                "Risks: Source freshness can change.\n"
                "Assumptions: The research scope is competitor-focused.\n"
                "Supervisor Next Step: Continue with synthesis."
            ),
            "fallback": False,
        }

    monkeypatch.setattr(orchestrator.tools, "preflight", fake_preflight)
    monkeypatch.setattr(orchestrator.tools, "execute_named", fake_execute_named)
    monkeypatch.setattr(orchestrator.router, "complete", fake_complete)
    monkeypatch.setattr(orchestrator, "_run_agent", fake_run_agent)
    monkeypatch.setattr(orchestrator, "_should_escalate", lambda *args, **kwargs: False)

    result = await orchestrator._execute_task(
        definition=AGENT_CATALOG["research"],
        task=task,
        prompt="Research enterprise AI swarm competitors and collect source-backed evidence.",
        batch_index=0,
        scratchpad_snapshot={},
        metadata={},
    )

    assert execute_calls == [
        (
            "research",
            "web_search",
            {"query": "enterprise AI swarm competitors", "max_results": 2},
        )
    ]
    assert len(result["tools"]) == 2
    assert result["tools"][1]["tool"] == "web_search"


@pytest.mark.asyncio
async def test_orchestrator_tool_loop_falls_back_when_planner_is_not_json(monkeypatch):
    orchestrator = SupervisorOrchestrator()
    task = PlannedTask(
        key="research",
        objective="Collect grounded evidence.",
        reason="The task needs factual discovery.",
        expected_output="An evidence brief.",
        plan_index=0,
    )
    execute_calls: list[tuple[str, str, dict[str, object]]] = []

    async def fake_preflight(agent_key: str, prompt: str, *, event_handler=None, event_context=None):
        return []

    async def fake_execute_named(
        agent_key: str,
        tool_name: str,
        arguments: dict[str, object] | None = None,
        *,
        event_handler=None,
        event_context=None,
    ):
        payload = dict(arguments or {})
        execute_calls.append((agent_key, tool_name, payload))
        return {
            "tool": tool_name,
            "operation": "execute",
            "status": "completed",
            "query": payload.get("query", ""),
            "results": [{"title": "Fallback Source", "url": "https://example.com"}],
        }

    async def fake_complete(model, system_prompt, user_prompt, **kwargs):
        if kwargs.get("metadata", {}).get("operation") == "tool_loop_planning":
            return SimpleNamespace(
                content="Use the web_search tool to gather the latest evidence first.",
                model=model,
                provider="mock-local",
                fallback=True,
            )
        raise AssertionError("Unexpected router.complete call in fallback tool-loop test.")

    async def fake_run_agent(
        definition,
        prompt,
        task,
        tool_context,
        scratchpad_snapshot,
        metadata,
        *,
        slow,
        feedback=None,
    ):
        return {
            "agent_key": task.key,
            "agent_name": definition.name,
            "model": definition.fast_model,
            "provider": "mock-local",
            "content": (
                "Outcome: Evidence gathered.\n"
                f"Key Findings: Used {len(tool_context)} tool records.\n"
                "Risks: Source freshness can change.\n"
                "Assumptions: The fallback heuristic selected an appropriate tool.\n"
                "Supervisor Next Step: Continue with synthesis."
            ),
            "fallback": False,
        }

    monkeypatch.setattr(orchestrator.tools, "preflight", fake_preflight)
    monkeypatch.setattr(orchestrator.tools, "execute_named", fake_execute_named)
    monkeypatch.setattr(orchestrator.router, "complete", fake_complete)
    monkeypatch.setattr(orchestrator, "_run_agent", fake_run_agent)
    monkeypatch.setattr(orchestrator, "_should_escalate", lambda *args, **kwargs: False)

    result = await orchestrator._execute_task(
        definition=AGENT_CATALOG["research"],
        task=task,
        prompt="Research enterprise AI agent competitors and source the latest evidence.",
        batch_index=0,
        scratchpad_snapshot={},
        metadata={},
    )

    assert execute_calls == [
        (
            "research",
            "web_search",
            {
                "query": "Research enterprise AI agent competitors and source the latest evidence.",
                "max_results": 3,
            },
        )
    ]
    assert result["tools"][0]["tool"] == "web_search"


def test_orchestrator_heuristic_prefers_notebooklm_for_native_deliverables():
    orchestrator = SupervisorOrchestrator()
    task = PlannedTask(
        key="content",
        objective="Generate a polished deliverable for the user.",
        reason="The request asks for a finished artifact.",
        expected_output="A complete deliverable.",
        plan_index=0,
    )

    decision = orchestrator._heuristic_tool_loop_decision(
        task=task,
        prompt="Create a podcast audio overview about the uploaded material.",
        available_tools=orchestrator.tools.list_for_agent("content"),
        tool_context=[
            {
                "tool": "web_search",
                "status": "completed",
                "results": [{"title": "Source", "url": "https://example.com/source"}],
            }
        ],
        raw_content="",
        planner_error="Planner response was not valid JSON.",
    )

    assert decision.tool_name == "notebooklm_studio"
    assert decision.arguments["output_type"] == "audio_overview"
    assert decision.arguments["source_urls"] == ["https://example.com/source"]


def test_orchestrator_promotes_successful_notebooklm_output_in_final_response():
    orchestrator = SupervisorOrchestrator()

    final_response = orchestrator._compose_autonomous_response(
        prompt="Create a flashcards set from the workspace knowledge.",
        content="Fallback provider generated a structured response for model `qwen3.5-flash`.",
        step_results=[
            {
                "agent_key": "content",
                "agent_name": "Content Agent",
                "tools": [
                    {
                        "tool": "notebooklm_studio",
                        "operation": "generate_deliverable",
                        "status": "completed",
                        "output_type": "flashcards",
                        "notebook_name": "Workspace study guide",
                        "sources": [{"kind": "url", "value": "https://example.com/source"}],
                        "artifacts": [
                            {
                                "file_name": "flashcards.json",
                                "storage_key": "notebooklm/test/flashcards.json",
                            }
                        ],
                    }
                ],
            }
        ],
        scratchpad=SimpleNamespace(grounding_sources=[], completed_agents=[], findings=[], risks=[], open_questions=[]),
    )

    assert "NotebookLM completed the flashcards run" in final_response
    assert "flashcards.json" in final_response
    assert "Fallback provider generated" not in final_response
    assert "Refine this deliverable into a second NotebookLM pass" in final_response


@pytest.mark.asyncio
async def test_orchestrator_replans_fast_attempt_until_validation_recovers(monkeypatch):
    orchestrator = SupervisorOrchestrator()
    task = PlannedTask(
        key="research",
        objective="Collect grounded evidence about the launch category.",
        reason="The request needs factual discovery.",
        expected_output="An evidence brief with grounded findings.",
        plan_index=0,
    )
    events: list[str] = []
    run_count = {"value": 0}

    async def fake_preflight(agent_key: str, prompt: str, *, event_handler=None, event_context=None):
        return [{"tool": "preflight_context", "status": "completed"}]

    async def fake_tool_loop(**kwargs):
        return ToolLoopRun(
            context=[{"tool": "preflight_context", "status": "completed"}],
            executed_iterations=0,
            stop_reason="planner_completed",
        )

    async def fake_run_agent(
        definition,
        prompt,
        task,
        tool_context,
        scratchpad_snapshot,
        metadata,
        *,
        slow,
        feedback=None,
    ):
        run_count["value"] += 1
        if run_count["value"] == 1:
            content = (
                "Outcome: Partial draft.\n"
                "Key Findings: A few signals were collected.\n"
                "Risks: Evidence is still thin.\n"
                "Assumptions: More grounding may be needed.\n"
                "Supervisor Next Step: Continue researching."
            )
        else:
            content = (
                "Outcome: Grounded evidence brief completed.\n"
                "Key Findings: Launch-category evidence was collected, compared, synthesized, and organized into a clearer evidence brief with grounded findings about demand signals, competitor posture, and execution constraints.\n"
                "Risks: Source freshness should still be monitored before launch, and the launch category can shift if the competitor set changes materially during rollout.\n"
                "Assumptions: The currently indexed sources are representative of the category, the evidence set is broad enough for a first decision pass, and no major source family is missing.\n"
                "Supervisor Next Step: Hand the brief to downstream synthesis."
            )
        return {
            "agent_key": task.key,
            "agent_name": definition.name,
            "model": definition.fast_model,
            "provider": "mock-local",
            "content": content,
            "fallback": False,
        }

    async def capture_event(event: str, payload: dict[str, object]):
        del payload
        events.append(event)

    monkeypatch.setattr(orchestrator.tools, "preflight", fake_preflight)
    monkeypatch.setattr(orchestrator, "_run_tool_loop", fake_tool_loop)
    monkeypatch.setattr(orchestrator, "_run_agent", fake_run_agent)
    monkeypatch.setattr(orchestrator, "_should_escalate", lambda *args, **kwargs: False)

    result = await orchestrator._execute_task(
        definition=AGENT_CATALOG["research"],
        task=task,
        prompt="Research the launch category and gather grounded evidence.",
        batch_index=0,
        scratchpad_snapshot={},
        metadata={},
        event_handler=capture_event,
    )

    assert result["attempt_count"] == 2
    assert result["replan_count"] == 1
    assert result["model"] == AGENT_CATALOG["research"].fast_model
    assert "step.replanned" in events


@pytest.mark.asyncio
async def test_orchestrator_recovers_after_tool_failures_before_escalating(monkeypatch):
    orchestrator = SupervisorOrchestrator()
    task = PlannedTask(
        key="research",
        objective="Collect grounded evidence about enterprise AI agents.",
        reason="The request needs factual discovery.",
        expected_output="A source-backed evidence brief.",
        plan_index=0,
    )
    loop_calls = {"value": 0}
    events: list[str] = []

    async def fake_preflight(agent_key: str, prompt: str, *, event_handler=None, event_context=None):
        return []

    async def fake_tool_loop(**kwargs):
        loop_calls["value"] += 1
        if loop_calls["value"] == 1:
            return ToolLoopRun(
                context=[{"tool": "web_search", "status": "failed", "query": "enterprise AI agents"}],
                executed_iterations=1,
                stop_reason="too_many_tool_failures",
                total_failures=2,
                consecutive_failures=2,
            )
        return ToolLoopRun(
            context=[{"tool": "web_search", "status": "completed", "query": "enterprise AI agents"}],
            executed_iterations=1,
            stop_reason="planner_completed",
            total_failures=0,
            consecutive_failures=0,
        )

    async def fake_run_agent(
        definition,
        prompt,
        task,
        tool_context,
        scratchpad_snapshot,
        metadata,
        *,
        slow,
        feedback=None,
    ):
        del definition, prompt, scratchpad_snapshot, metadata, slow, feedback
        return {
            "agent_key": task.key,
            "agent_name": AGENT_CATALOG["research"].name,
            "model": AGENT_CATALOG["research"].fast_model,
            "provider": "mock-local",
            "content": (
                "Outcome: Evidence brief completed.\n"
                "Key Findings: Enterprise AI agent evidence was gathered from search results, compared against the task objective, and turned into a more grounded summary of market themes, active players, and decision-relevant signals.\n"
                "Risks: Competitive positioning can still shift quickly, and the evidence should still be refreshed if this brief is used for an external or launch-facing decision.\n"
                "Assumptions: The current search results are representative of the market and the supervisor now has enough grounded context to continue without another research retry.\n"
                "Supervisor Next Step: Continue with synthesis."
            ),
            "fallback": False,
        }

    async def capture_event(event: str, payload: dict[str, object]):
        del payload
        events.append(event)

    monkeypatch.setattr(orchestrator.tools, "preflight", fake_preflight)
    monkeypatch.setattr(orchestrator, "_run_tool_loop", fake_tool_loop)
    monkeypatch.setattr(orchestrator, "_run_agent", fake_run_agent)
    monkeypatch.setattr(orchestrator, "_should_escalate", lambda *args, **kwargs: False)

    result = await orchestrator._execute_task(
        definition=AGENT_CATALOG["research"],
        task=task,
        prompt="Research enterprise AI agents and gather grounded evidence.",
        batch_index=0,
        scratchpad_snapshot={},
        metadata={},
        event_handler=capture_event,
    )

    assert result["attempt_count"] == 2
    assert result["replan_count"] == 1
    assert result["tool_loop"]["stop_reason"] == "planner_completed"
    assert result["tool_loop"]["total_failures"] == 0
    assert "step.replanned" in events
