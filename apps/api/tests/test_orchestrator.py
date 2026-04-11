from types import SimpleNamespace

import pytest

from app.services.agents.orchestrator import SupervisorOrchestrator


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


@pytest.mark.asyncio
async def test_orchestrator_execute_uses_validation_driven_escalation(monkeypatch):
    orchestrator = SupervisorOrchestrator()

    async def fake_preflight(agent_key: str, prompt: str):
        return [{"tool": f"{agent_key}_tool", "status": "completed"}]

    async def fake_run_agent(
        definition,
        prompt,
        task,
        tool_context,
        scratchpad_snapshot,
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

    assert result["final_response"] == "Supervisor final synthesis"
    assert result["execution_batches"] == [["coding"], ["content"]]
    assert result["steps"][0]["validation"]["escalated_from_fast"] is True
    assert result["steps"][0]["dependencies"] == []
    assert result["steps"][1]["dependencies"] == ["coding"]
    assert result["scratchpad"]["completed_agents"] == ["coding", "content"]
