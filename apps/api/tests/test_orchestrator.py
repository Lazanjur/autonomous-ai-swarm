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


@pytest.mark.asyncio
async def test_orchestrator_blocks_copyrighted_song_score_request_before_execution():
    orchestrator = SupervisorOrchestrator()

    result = await orchestrator.execute('Write scores of the song "Per sempre si" of Val Da Vinci.')

    assert result["plan"] == []
    assert result["steps"] == []
    assert result["final_response"].startswith(
        "I can't provide the exact score, sheet music, lyrics, or tabs for that song."
    )
    assert "How to continue" in result["final_response"]
    assert "summary of the melody" in result["final_response"]


@pytest.mark.asyncio
async def test_orchestrator_blocks_ambiguous_context_dependent_question_before_execution():
    orchestrator = SupervisorOrchestrator()

    result = await orchestrator.execute("Zašto to odmah nisi rekao?")

    assert result["plan"] == []
    assert result["steps"] == []
    assert result["final_response"].startswith("Nisam siguran na što se pitanje točno odnosi.")


def test_orchestrator_fast_factual_detector_supports_multilingual_name_queries():
    orchestrator = SupervisorOrchestrator()

    assert orchestrator._looks_like_fast_factual_question("Tko je Ivica Kustura")


def test_orchestrator_requires_close_source_match_before_answering():
    orchestrator = SupervisorOrchestrator()

    weak_citations = [
        {
            "title": "ZAŠTO MI TO NIKO NIJE RANIJE REKAO",
            "excerpt": "Naslov knjige o mentalnom zdravlju.",
            "kind": "web",
        }
    ]
    strong_citations = [
        {
            "title": "Ivica Kustura - biografija",
            "excerpt": "Ivica Kustura je poduzetnik i javna osoba.",
            "kind": "web",
        }
    ]

    assert not orchestrator._citations_support_prompt("Zašto to odmah nisi rekao?", weak_citations)
    assert orchestrator._citations_support_prompt("Tko je Ivica Kustura", strong_citations)


@pytest.mark.asyncio
async def test_orchestrator_answers_self_coding_question_without_execution():
    orchestrator = SupervisorOrchestrator()

    result = await orchestrator.execute("How good are you at coding?")

    assert result["plan"] == []
    assert result["steps"] == []
    assert result["citations"] == []
    assert "I’m strong at coding" in result["final_response"]


@pytest.mark.asyncio
async def test_orchestrator_answers_self_working_question_in_bcs_without_execution():
    orchestrator = SupervisorOrchestrator()

    result = await orchestrator.execute("Kako radiš?")

    assert result["plan"] == []
    assert result["steps"] == []
    assert result["citations"] == []
    assert result["final_response"].startswith("Radim tako da razumijem cilj")


@pytest.mark.asyncio
async def test_fast_factual_answers_always_include_follow_up_options():
    orchestrator = SupervisorOrchestrator()

    async def fake_execute_named(*args, **kwargs):
        return {
            "tool": "web_search",
            "status": "completed",
            "results": [
                {
                    "title": "Matija Gubec - Wikipedia",
                    "url": "https://example.com/matija-gubec",
                    "snippet": "Matija Gubec was a Croatian peasant revolt leader.",
                    "source_id": "S1",
                }
            ],
        }

    async def fake_complete(*args, **kwargs):
        return SimpleNamespace(
            content="Matija Gubec was the leader of the Croatian-Slovene Peasant Revolt of 1573. [S1]",
            model="qwen3.5-flash",
            provider="qwen",
            fallback=False,
        )

    orchestrator.tools.execute_named = fake_execute_named
    orchestrator.router.complete = fake_complete

    result = await orchestrator._maybe_execute_fast_factual_question("Who is Matija Gubec?")

    assert result is not None
    assert "How to continue:" in result["final_response"]
    assert "1. **" in result["final_response"]
    assert "2. **" in result["final_response"]
    assert "3. **" in result["final_response"]


@pytest.mark.asyncio
async def test_fast_factual_uses_direct_grounded_snippet_answer_when_possible():
    orchestrator = SupervisorOrchestrator()

    async def fake_execute_named(*args, **kwargs):
        return {
            "tool": "web_search",
            "status": "completed",
            "results": [
                {
                    "title": "Hana Breko Kustura - HAZU",
                    "url": "https://example.com/hazu/hana-breko-kustura",
                    "snippet": "Hana Breko Kustura is a Croatian musicologist and Senior Research Advisor at the Croatian Academy of Sciences and Arts.",
                    "source_id": "S1",
                },
                {
                    "title": "Academy of Music Zagreb",
                    "url": "https://example.com/academy/hana-breko-kustura",
                    "snippet": "She also teaches at the Academy of Music, University of Zagreb.",
                    "source_id": "S2",
                },
            ],
        }

    async def fail_complete(*args, **kwargs):
        raise AssertionError("router.complete should not be called for direct fast factual answers")

    orchestrator.tools.execute_named = fake_execute_named
    orchestrator.router.complete = fail_complete

    result = await orchestrator._maybe_execute_fast_factual_question("Who is Hana Breko Kustura?")

    assert result is not None
    assert "Hana Breko Kustura is a Croatian musicologist" in result["final_response"]
    assert "[S1]" in result["final_response"]
    assert "How to continue:" in result["final_response"]


def test_orchestrator_formats_follow_up_section_with_plain_heading_and_bold_numbered_items():
    orchestrator = SupervisorOrchestrator()

    formatted = orchestrator._format_follow_up_section(["Prva opcija", "Druga opcija", "Treća opcija"])

    assert formatted.startswith("How to continue:\n")
    assert "1. **Prva opcija**" in formatted
    assert "2. **Druga opcija**" in formatted
    assert "3. **Treća opcija**" in formatted


def test_follow_up_options_for_person_question_are_subject_specific():
    orchestrator = SupervisorOrchestrator()

    options = orchestrator._build_follow_up_options(
        "Who is Hana Breko Kustura?",
        [
            {
                "agent_key": "research",
                "content": "Hana Breko Kustura is a Croatian musicologist and professor.",
                "tools": [{"tool": "web_search", "status": "completed"}],
            }
        ],
    )

    assert "Hana Breko Kustura" in options[0]
    assert "profile" in options[2].lower() or "bio" in options[2].lower()


def test_follow_up_options_for_structured_explanation_are_subject_specific():
    orchestrator = SupervisorOrchestrator()

    options = orchestrator._build_follow_up_options(
        "Explain this API in a structured way with headings and bullets.",
        [
            {
                "agent_key": "content",
                "content": "This API handles authentication, uploads, and search.",
                "tools": [],
            }
        ],
    )

    assert "api" in options[0].lower()
    assert "testing strategy" in options[1].lower()


def test_follow_up_options_use_recent_thread_context_when_current_prompt_is_generic():
    orchestrator = SupervisorOrchestrator()

    options = orchestrator._build_follow_up_options(
        "What about her affiliations?",
        [
            {
                "agent_key": "research",
                "content": "She is affiliated with HAZU and the Academy of Music in Zagreb.",
                "tools": [{"tool": "web_search", "status": "completed"}],
            }
        ],
        memory_context={
            "task_memory": {
                "recent_requests": ["Who is Hana Breko Kustura?"],
                "recent_summaries": ["Profile of Hana Breko Kustura and her work in musicology."],
            }
        },
    )

    assert "Hana Breko Kustura" in options[0]
    assert "Hana Breko Kustura" in options[1]


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


def test_orchestrator_routes_open_and_login_prompts_to_vision_automation():
    orchestrator = SupervisorOrchestrator()

    selected = orchestrator._select_agent_keys(
        "Open www.investbusiness.com, and then login with credentials: "
        "email: firma@investbusiness.org and pw: 123456"
    )

    assert "vision_automation" in selected
    assert "content" in selected


def test_orchestrator_selects_ui_diagram_and_content_for_visualization_documentation_requests():
    orchestrator = SupervisorOrchestrator()

    selected = orchestrator._select_agent_keys(
        "Create a high-fidelity UI mockup and onboarding documentation for the operator dashboard."
    )

    assert "ui_diagram" in selected
    assert "content" in selected


def test_orchestrator_selects_ui_diagram_for_diagram_focused_requests():
    orchestrator = SupervisorOrchestrator()

    selected = orchestrator._select_agent_keys(
        "Create a sequence diagram and ERD for the service orchestration flow."
    )

    assert "ui_diagram" in selected
    assert "content" not in selected


def test_orchestrator_selects_coding_for_code_explanation_requests():
    orchestrator = SupervisorOrchestrator()

    selected = orchestrator._select_agent_keys(
        "Explain code in this function and walk me through this code."
    )

    assert "coding" in selected


def test_orchestrator_routes_api_explanations_to_content_without_coding():
    orchestrator = SupervisorOrchestrator()

    selected = orchestrator._select_agent_keys(
        "Explain this API in a structured way with headings, bullets, and one short code block."
    )

    assert "content" in selected
    assert "coding" not in selected


def test_orchestrator_selects_tester_for_live_debug_requests():
    orchestrator = SupervisorOrchestrator()

    selected = orchestrator._select_agent_keys(
        "Monitor the logs, fix the production issue, and run a regression check before we close the incident."
    )

    assert "coding" in selected
    assert "tester" in selected
    assert "content" in selected


def test_orchestrator_selects_full_swarm_for_autonomous_app_builder_requests():
    orchestrator = SupervisorOrchestrator()

    selected = orchestrator._select_agent_keys(
        "Build a full-stack SaaS app with a frontend, backend, and database, then verify it before delivery."
    )

    assert "research" in selected
    assert "analysis" in selected
    assert "coding" in selected
    assert "tester" in selected
    assert "content" in selected


def test_orchestrator_builds_tester_step_after_coding_when_requested():
    orchestrator = SupervisorOrchestrator()

    plan = orchestrator.build_plan(
        "Debug the failing deploy, fix the code, and run a regression test before shipping."
    )

    by_key = {step.key: step for step in plan}
    assert "coding" in by_key
    assert "tester" in by_key
    assert by_key["tester"].dependencies == ("coding",)


def test_orchestrator_heuristic_prefers_research_pipeline_for_structured_requests():
    orchestrator = SupervisorOrchestrator()

    decision = orchestrator._heuristic_tool_loop_decision(
        task=PlannedTask(key="research", objective="Extract verified competitor data", reason=""),
        prompt="Research competitors, verify the sources, and export the findings to CSV.",
        available_tools=[
            {"name": "web_search"},
        ],
        tool_context=[],
        raw_content="",
        planner_error="Planner returned malformed JSON.",
    )

    assert decision.action == "use_tool"
    assert decision.tool_name == "web_search"
    assert decision.arguments["action"] == "build_pipeline"


def test_orchestrator_heuristic_prefers_visualization_docs_for_mockup_requests():
    orchestrator = SupervisorOrchestrator()

    decision = orchestrator._heuristic_tool_loop_decision(
        task=PlannedTask(key="content", objective="Create a polished visual deliverable", reason=""),
        prompt="Create a high-fidelity UI mockup for an executive swarm dashboard.",
        available_tools=[
            {"name": "visualization_docs"},
            {"name": "document_export"},
        ],
        tool_context=[],
        raw_content="",
        planner_error="Planner returned malformed JSON.",
    )

    assert decision.action == "use_tool"
    assert decision.tool_name == "visualization_docs"
    assert decision.arguments["action"] == "generate_mockup"


def test_orchestrator_heuristic_prefers_visualization_docs_for_docs_requests():
    orchestrator = SupervisorOrchestrator()

    decision = orchestrator._heuristic_tool_loop_decision(
        task=PlannedTask(key="content", objective="Produce onboarding docs", reason=""),
        prompt="Create a README and onboarding guide for this API platform.",
        available_tools=[
            {"name": "visualization_docs"},
        ],
        tool_context=[],
        raw_content="",
        planner_error="Planner returned malformed JSON.",
    )

    assert decision.action == "use_tool"
    assert decision.tool_name == "visualization_docs"
    assert decision.arguments["action"] == "generate_docs_bundle"


def test_orchestrator_tool_loop_prompt_includes_maximum_autonomy_guidance():
    orchestrator = SupervisorOrchestrator()

    prompt = orchestrator._build_tool_loop_prompt(
        prompt="Open the website and finish the setup flow.",
        task=PlannedTask(key="vision_automation", objective="Finish the browser workflow", reason=""),
        scratchpad_snapshot={},
        feedback=None,
        tool_context=[],
        available_tools=[{"name": "browser_automation", "description": "Drive the browser."}],
        autonomy_mode="maximum",
    )

    assert "Autonomy mode: Maximum autonomy." in prompt
    assert "do not stop while a directly implied, allowed next action is still available" in prompt


def test_orchestrator_normalizes_unknown_autonomy_mode_to_default():
    orchestrator = SupervisorOrchestrator()

    assert orchestrator._normalize_autonomy_mode("unexpected") == "autonomous"


@pytest.mark.asyncio
async def test_orchestrator_tool_loop_planner_uses_planner_model(monkeypatch):
    orchestrator = SupervisorOrchestrator()
    calls: list[tuple[str, dict[str, object]]] = []

    async def fake_complete(model, system_prompt, user_prompt, **kwargs):
        del system_prompt, user_prompt
        calls.append((model, kwargs.get("metadata", {})))
        return SimpleNamespace(
            content='{"action":"complete","reason":"Enough context is already available."}',
            model=model,
            provider="mock-local",
            fallback=False,
        )

    monkeypatch.setattr(orchestrator.router, "complete", fake_complete)

    decision = await orchestrator._plan_next_tool_action(
        definition=AGENT_CATALOG["coding"],
        task=PlannedTask(key="coding", objective="Implement the requested feature", reason=""),
        prompt="Implement the requested feature.",
        scratchpad_snapshot={},
        metadata={"workspace_id": "workspace-1"},
        feedback=None,
        tool_context=[],
        available_tools=[{"name": "workspace_files", "description": "Read and edit workspace files."}],
        slow=False,
        iteration=0,
    )

    assert decision.action == "complete"
    assert calls[0][0] == AGENT_CATALOG["planner"].fast_model
    assert calls[0][1]["agent_key"] == "planner"
    assert calls[0][1]["delegated_for_agent_key"] == "coding"


def test_orchestrator_heuristic_prefers_shell_sandbox_for_install_and_test_prompts():
    orchestrator = SupervisorOrchestrator()

    decision = orchestrator._heuristic_tool_loop_decision(
        task=PlannedTask(key="coding", objective="Install dependencies and run tests", reason=""),
        prompt="Install dependencies, run pytest, and fix the failing environment setup.",
        available_tools=[
            {"name": "workspace_files"},
            {"name": "shell_sandbox"},
        ],
        tool_context=[],
        raw_content="",
        planner_error="Planner returned malformed JSON.",
    )

    assert decision.action == "use_tool"
    assert decision.tool_name == "shell_sandbox"


def test_orchestrator_heuristic_attaches_execution_environment_for_windows_gpu_prompts():
    orchestrator = SupervisorOrchestrator()

    decision = orchestrator._heuristic_tool_loop_decision(
        task=PlannedTask(key="coding", objective="Run a Windows-heavy browser test suite", reason=""),
        prompt="Use a Windows PowerShell runner with GPU to install dependencies and run the test suite.",
        available_tools=[
            {"name": "shell_sandbox"},
        ],
        tool_context=[],
        raw_content="",
        planner_error="Planner returned malformed JSON.",
    )

    assert decision.action == "use_tool"
    assert decision.tool_name == "shell_sandbox"
    assert decision.arguments["execution_environment"] == {
        "target_os": "windows",
        "resource_tier": "gpu",
        "runtime_profile": "powershell",
    }


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

    assert result["final_response"].startswith("I couldn't complete that yet.\n\nSupervisor final synthesis")
    assert "How to continue" in result["final_response"]
    assert result["execution_batches"] == [["coding"], ["content"]]
    assert result["steps"][0]["validation"]["escalated_from_fast"] is True
    assert result["steps"][0]["dependencies"] == []
    assert result["steps"][1]["dependencies"] == ["coding"]
    assert result["scratchpad"]["completed_agents"] == ["coding", "content"]


@pytest.mark.asyncio
async def test_orchestrator_keeps_citations_in_metadata_without_appending_grounding_footer(monkeypatch):
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

    assert result["final_response"].startswith("Here's the answer.") or result["final_response"].startswith("Here’s the answer.")
    assert "How to continue" in result["final_response"]
    assert "Grounding references:" not in result["final_response"]
    assert result["citations"][0]["reference_id"] == "S1"


def test_orchestrator_strips_internal_narration_from_action_response():
    orchestrator = SupervisorOrchestrator()

    final_response = orchestrator._compose_autonomous_response(
        prompt="Open www.webhook.investbusiness.com and login with credentials.",
        content=(
            "What I'm doing - I coordinated 1 specialist agent: Vision / Automation Agent. - I checked 4 tool results.\n\n"
            "Answer Login completed and the page is open.\n\nGrounding references: [S1]"
        ),
        step_results=[
            {
                "agent_key": "vision_automation",
                "agent_name": "Vision / Automation Agent",
                "tools": [{"tool": "browser_automation", "status": "completed"}],
            }
        ],
        scratchpad=SimpleNamespace(grounding_sources=[], completed_agents=[], findings=[], risks=[], open_questions=[]),
    )

    assert final_response.startswith("Done.\n\nLogin completed and the page is open.")
    assert "What I'm doing" not in final_response
    assert "Grounding references:" not in final_response
    assert "How to continue" in final_response


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
                "action": "search",
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


def test_orchestrator_marks_browser_failures_as_blocked_result():
    orchestrator = SupervisorOrchestrator()

    final_response = orchestrator._compose_autonomous_response(
        prompt="Open www.investbusiness.com and then login with credentials.",
        content="**Login Status: Failed** The target site returned Bad creds after submission.",
        step_results=[
            {
                "agent_key": "vision_automation",
                "agent_name": "Vision / Automation Agent",
                "tools": [
                    {
                        "tool": "browser_automation",
                        "status": "failed",
                    }
                ],
            }
        ],
        scratchpad=SimpleNamespace(grounding_sources=[], completed_agents=[], findings=[], risks=[], open_questions=[]),
    )

    assert final_response.startswith("I couldn't complete that yet.")
    assert "How to continue" in final_response


def test_orchestrator_marks_browser_takeover_as_blocked_result():
    orchestrator = SupervisorOrchestrator()

    final_response = orchestrator._compose_autonomous_response(
        prompt="Open www.webhook.investbusiness.com and then login with credentials.",
        content="The sign-in stayed in a protected pending state and needs human takeover to continue.",
        step_results=[
            {
                "agent_key": "vision_automation",
                "agent_name": "Vision / Automation Agent",
                "tools": [
                    {
                        "tool": "browser_automation",
                        "status": "takeover_required",
                    }
                ],
            }
        ],
        scratchpad=SimpleNamespace(grounding_sources=[], completed_agents=[], findings=[], risks=[], open_questions=[]),
    )

    assert final_response.startswith("I couldn't complete that yet.")
    assert "How to continue" in final_response


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
