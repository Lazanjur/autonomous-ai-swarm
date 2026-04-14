from __future__ import annotations

import asyncio
import json
import re
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from typing import Any

from app.core.config import get_settings
from app.services.agents.registry import AGENT_CATALOG, AgentDefinition
from app.services.providers.router import ProviderRouter
from app.services.tools.registry import ToolRegistry

settings = get_settings()


@dataclass
class PlannedTask:
    key: str
    objective: str
    reason: str
    dependencies: tuple[str, ...] = ()
    expected_output: str = ""
    execution_mode: str = "parallel"
    priority: int = 1
    plan_index: int = 0


@dataclass
class ExecutionScratchpad:
    user_request: str
    task_memory: dict[str, Any] = field(default_factory=dict)
    project_memory: dict[str, Any] = field(default_factory=dict)
    grounding_sources: list[dict[str, Any]] = field(default_factory=list)
    completed_agents: list[str] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    open_questions: list[str] = field(default_factory=list)
    tool_observations: list[dict[str, Any]] = field(default_factory=list)
    validation_notes: list[str] = field(default_factory=list)


@dataclass
class ToolLoopDecision:
    action: str
    reason: str
    tool_name: str | None = None
    arguments: dict[str, Any] = field(default_factory=dict)
    source: str = "model"


@dataclass
class ToolLoopRun:
    context: list[dict[str, Any]]
    executed_iterations: int = 0
    stop_reason: str = "planner_completed"
    total_failures: int = 0
    consecutive_failures: int = 0


class SupervisorOrchestrator:
    def __init__(self) -> None:
        self.router = ProviderRouter()
        self.tools = ToolRegistry()

    def build_plan(self, prompt: str) -> list[PlannedTask]:
        selected = self._select_agent_keys(prompt)
        plan: list[PlannedTask] = []

        if "research" in selected:
            plan.append(
                PlannedTask(
                    key="research",
                    objective="Collect grounded evidence, facts, references, and external signals.",
                    reason="The request needs factual discovery, market context, or source-backed research.",
                    dependencies=(),
                    expected_output="A concise evidence brief with source-backed findings and gaps.",
                    execution_mode="parallel",
                    priority=1,
                )
            )

        analysis_dependencies = tuple(key for key in ("research",) if key in selected)
        if "analysis" in selected:
            plan.append(
                PlannedTask(
                    key="analysis",
                    objective="Turn raw evidence into decisions, tradeoffs, risks, and structured recommendations.",
                    reason="The request benefits from synthesis, scenario thinking, or decision support.",
                    dependencies=analysis_dependencies,
                    expected_output="A decision-oriented analysis with risks, assumptions, and recommended path.",
                    execution_mode="sequential" if analysis_dependencies else "parallel",
                    priority=2,
                )
            )

        coding_dependencies = tuple(
            key for key in ("analysis", "research") if key in selected and key != "coding"
        )[:1]
        if "coding" in selected:
            plan.append(
                PlannedTask(
                    key="coding",
                    objective="Design or implement the technical solution, architecture, or code-level approach.",
                    reason="The request includes software delivery, implementation, or debugging work.",
                    dependencies=coding_dependencies,
                    expected_output="A technical implementation plan or code-ready output with constraints and risks.",
                    execution_mode="sequential" if coding_dependencies else "parallel",
                    priority=3,
                )
            )

        vision_dependencies = tuple(key for key in ("research",) if key in selected)
        if "vision_automation" in selected:
            plan.append(
                PlannedTask(
                    key="vision_automation",
                    objective="Execute browser or UI workflows, capture page state, and report automation-safe outcomes.",
                    reason="The request includes browser actions, UI workflows, or automation tasks.",
                    dependencies=vision_dependencies,
                    expected_output="A browser execution record with outcomes, artifacts, and any approval-sensitive actions.",
                    execution_mode="sequential" if vision_dependencies else "parallel",
                    priority=3,
                )
            )

        content_dependencies = tuple(
            key for key in ("research", "analysis", "coding", "vision_automation") if key in selected
        )
        if "content" in selected:
            plan.append(
                PlannedTask(
                    key="content",
                    objective="Synthesize prior work into a polished deliverable tailored to the user outcome.",
                    reason="The request requires a consumable final artifact, narrative, or stakeholder-ready response.",
                    dependencies=content_dependencies,
                    expected_output="A polished final deliverable that references key findings, risks, and next steps.",
                    execution_mode="sequential" if content_dependencies else "parallel",
                    priority=4,
                )
            )

        if not plan:
            plan = [
                PlannedTask(
                    key="research",
                    objective="Establish baseline context and collect facts relevant to the request.",
                    reason="Default first step for ambiguous work so the system starts from grounded context.",
                    expected_output="A baseline evidence brief with factual anchors and known unknowns.",
                    execution_mode="parallel",
                    priority=1,
                ),
                PlannedTask(
                    key="analysis",
                    objective="Transform baseline context into a decision-ready structure.",
                    reason="Default synthesis step to convert collected context into an actionable frame.",
                    dependencies=("research",),
                    expected_output="A structured set of insights, risks, and recommended actions.",
                    execution_mode="sequential",
                    priority=2,
                ),
                PlannedTask(
                    key="content",
                    objective="Present the work as a clear final deliverable for the user.",
                    reason="Default communication layer to package the outcome coherently.",
                    dependencies=("analysis",),
                    expected_output="A final response with summary, supporting detail, and next steps.",
                    execution_mode="sequential",
                    priority=3,
                ),
            ]

        for index, task in enumerate(plan):
            task.plan_index = index

        return plan

    async def execute(
        self,
        prompt: str,
        *,
        metadata: dict[str, Any] | None = None,
        memory_context: dict[str, Any] | None = None,
        grounding_context: list[dict[str, Any]] | None = None,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        plan = self.build_plan(prompt)
        execution_batches = self._execution_batches(plan)
        scratchpad = ExecutionScratchpad(
            user_request=prompt,
            task_memory=self._normalize_shared_memory(
                memory_context.get("task_memory") if isinstance(memory_context, dict) else {}
            ),
            project_memory=self._normalize_shared_memory(
                memory_context.get("project_memory") if isinstance(memory_context, dict) else {}
            ),
            grounding_sources=self._normalize_grounding_sources(grounding_context or []),
        )
        step_results: list[dict[str, Any]] = []

        await self._emit(
            event_handler,
            "plan",
            {"plan": [asdict(task) for task in plan]},
        )
        await self._emit(
            event_handler,
            "batches",
            {"batches": [[task.key for task in batch] for batch in execution_batches]},
        )

        for batch_index, batch in enumerate(execution_batches):
            await self._emit(
                event_handler,
                "batch.started",
                {
                    "batch_index": batch_index,
                    "tasks": [task.key for task in batch],
                    "statuses": {task.key: "queued" for task in batch},
                },
            )
            batch_results = await asyncio.gather(
                *[
                    self._execute_task(
                        definition=AGENT_CATALOG[task.key],
                        task=task,
                        prompt=prompt,
                        batch_index=batch_index,
                        scratchpad_snapshot=self._scratchpad_view(scratchpad),
                        metadata=metadata or {},
                        grounding_context=grounding_context or [],
                        event_handler=event_handler,
                    )
                    for task in batch
                ]
            )
            for result in sorted(batch_results, key=lambda item: item["step_index"]):
                step_results.append(result)
                self._update_scratchpad(scratchpad, result)
                await self._emit(
                    event_handler,
                    "scratchpad.updated",
                    {
                        "step_index": result["step_index"],
                        "agent_key": result["agent_key"],
                        "scratchpad": self._scratchpad_view(scratchpad),
                    },
                )
            await self._emit(
                event_handler,
                "batch.completed",
                {
                    "batch_index": batch_index,
                    "tasks": [task.key for task in batch],
                    "statuses": {result["agent_key"]: "completed" for result in batch_results},
                },
            )

        citations = self._collect_citations(step_results)
        synthesis = await self.router.complete(
            settings.supervisor_model,
            (
                "You are the supervisor for a multi-agent AI swarm. Synthesize agent outputs into one"
                " cohesive answer body that is accurate, useful, and grounded. Focus on the core answer"
                " itself. Do not add a separate meta section about what you are doing, and do not add"
                " follow-up options because the product layer will add those automatically."
            ),
            self._build_synthesis_prompt(prompt, step_results, scratchpad, citations),
            metadata={
                **(metadata or {}),
                "agent_key": "supervisor",
                "operation": "synthesis",
            },
        )
        final_response = self._compose_autonomous_response(
            prompt=prompt,
            content=synthesis.content,
            step_results=step_results,
            scratchpad=scratchpad,
        )
        final_response = self._ensure_citation_references(final_response, citations)
        grounded_citations = self._finalize_citations(final_response, citations)

        return {
            "plan": [asdict(task) for task in plan],
            "execution_batches": [[task.key for task in batch] for batch in execution_batches],
            "steps": step_results,
            "final_response": final_response,
            "summary": self._summarize(step_results),
            "citations": grounded_citations,
            "scratchpad": self._scratchpad_view(scratchpad),
        }

    async def _execute_task(
        self,
        *,
        definition: AgentDefinition,
        task: PlannedTask,
        prompt: str,
        batch_index: int,
        scratchpad_snapshot: dict[str, Any],
        metadata: dict[str, Any],
        grounding_context: list[dict[str, Any]] | None = None,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
        ) -> dict[str, Any]:
        await self._emit(
            event_handler,
            "step.started",
            {
                "step_index": task.plan_index,
                "batch_index": batch_index,
                "agent_key": task.key,
                "agent_name": definition.name,
                "objective": task.objective,
                "dependencies": list(task.dependencies),
                "execution_mode": task.execution_mode,
                "status": "running",
            },
        )
        step_event_context = {
            **metadata,
            "agent_key": task.key,
            "agent_name": definition.name,
            "step_index": task.plan_index,
            "batch_index": batch_index,
        }
        seed_tool_context = list(grounding_context or [])
        seed_tool_context.extend(
            await self.tools.preflight(
                task.key,
                prompt,
                event_handler=event_handler,
                event_context=step_event_context,
            )
        )
        fast_result, replan_feedback, fast_completed = await self._run_step_attempt_cycle(
            definition=definition,
            task=task,
            prompt=prompt,
            batch_index=batch_index,
            scratchpad_snapshot=scratchpad_snapshot,
            metadata=metadata,
            event_handler=event_handler,
            seed_tool_context=seed_tool_context,
            slow=False,
        )
        result = fast_result
        force_escalation = not fast_completed

        if force_escalation or self._should_escalate(prompt, task, fast_result, fast_result["validation"]):
            await self._emit(
                event_handler,
                "step.escalated",
                {
                    "step_index": task.plan_index,
                    "batch_index": batch_index,
                    "agent_key": task.key,
                    "agent_name": definition.name,
                    "status": "escalating",
                    "validation": fast_result["validation"],
                    "attempt_count": fast_result["attempt_count"],
                    "replan_count": fast_result["replan_count"],
                },
            )
            slow_result, _, _ = await self._run_step_attempt_cycle(
                definition=definition,
                task=task,
                prompt=prompt,
                batch_index=batch_index,
                scratchpad_snapshot=scratchpad_snapshot,
                metadata=metadata,
                event_handler=event_handler,
                slow=True,
                feedback=replan_feedback or fast_result["validation"]["summary"],
                seed_tool_context=fast_result["tools"],
            )
            if slow_result["confidence"] >= result["confidence"] or force_escalation:
                result = slow_result | {
                    "validation": slow_result["validation"] | {"escalated_from_fast": True}
                }

        await self._emit(
            event_handler,
            "step.completed",
            {
                "step_index": result["step_index"],
                "batch_index": batch_index,
                "agent_key": result["agent_key"],
                "agent_name": result["agent_name"],
                "status": "completed",
                "dependencies": result["dependencies"],
                "execution_mode": result["execution_mode"],
                "confidence": result["confidence"],
                "validation": result["validation"],
                "summary": self._compact_summary(result["content"]),
                "model": result["model"],
                "provider": result["provider"],
                "attempt_count": result["attempt_count"],
                "replan_count": result["replan_count"],
                "tool_loop": result["tool_loop"],
                "tools": [
                    {
                        "tool": tool.get("tool") or ("web_search" if tool.get("query") else "tool_context"),
                        "status": tool.get("status", "completed"),
                    }
                    for tool in result.get("tools", [])
                ],
            },
        )
        return result

    async def _run_step_attempt_cycle(
        self,
        *,
        definition: AgentDefinition,
        task: PlannedTask,
        prompt: str,
        batch_index: int,
        scratchpad_snapshot: dict[str, Any],
        metadata: dict[str, Any],
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None,
        seed_tool_context: list[dict[str, Any]],
        slow: bool,
        feedback: str | None = None,
    ) -> tuple[dict[str, Any], str | None, bool]:
        total_attempts = max(1, settings.orchestrator_max_step_replans + 1)
        current_feedback = feedback
        current_seed_context = list(seed_tool_context)
        best_result: dict[str, Any] | None = None
        best_confidence = -1.0
        continue_reason: str | None = None
        step_event_context = {
            **metadata,
            "agent_key": task.key,
            "agent_name": definition.name,
            "step_index": task.plan_index,
            "batch_index": batch_index,
        }

        for attempt_index in range(total_attempts):
            if attempt_index > 0:
                await self._emit(
                    event_handler,
                    "step.replanned",
                    {
                        **step_event_context,
                        "status": "replanning",
                        "attempt_index": attempt_index,
                        "attempt_count": attempt_index + 1,
                        "replan_count": attempt_index,
                        "reason": continue_reason or current_feedback or "Supervisor requested another attempt.",
                        "escalated": slow,
                    },
                )

            tool_loop = await self._run_tool_loop(
                definition=definition,
                task=task,
                prompt=prompt,
                batch_index=batch_index,
                scratchpad_snapshot=scratchpad_snapshot,
                metadata=metadata,
                event_handler=event_handler,
                feedback=current_feedback,
                seed_tool_context=current_seed_context,
                slow=slow,
            )
            agent_result = await self._run_agent(
                definition,
                prompt,
                task,
                tool_loop.context,
                scratchpad_snapshot,
                metadata,
                slow=slow,
                feedback=current_feedback,
            )
            validation = self._validate_result(task, agent_result["content"], tool_loop.context)
            confidence = self._confidence_score(agent_result["content"], tool_loop.context, validation)
            attempt_result = agent_result | {
                "confidence": confidence,
                "step_index": task.plan_index,
                "dependencies": list(task.dependencies),
                "execution_mode": task.execution_mode,
                "batch_index": batch_index,
                "tools": tool_loop.context,
                "validation": validation,
                "expected_output": task.expected_output,
                "attempt_count": attempt_index + 1,
                "replan_count": attempt_index,
                "tool_loop": self._tool_loop_view(tool_loop),
            }

            if confidence >= best_confidence:
                best_result = attempt_result
                best_confidence = confidence

            continue_reason = self._continue_until_done_reason(
                task=task,
                prompt=prompt,
                result=attempt_result,
                validation=validation,
                tool_loop=tool_loop,
                slow=slow,
            )
            if continue_reason is None:
                return attempt_result, current_feedback, True

            current_feedback = self._build_replan_feedback(
                task=task,
                result=attempt_result,
                validation=validation,
                tool_loop=tool_loop,
                continue_reason=continue_reason,
            )
            current_seed_context = tool_loop.context

        if best_result is None:
            raise RuntimeError(f"No result was produced for agent step {task.key}.")

        return best_result | {"continue_until_done_reason": continue_reason}, current_feedback, False

    async def _run_agent(
        self,
        definition: AgentDefinition,
        prompt: str,
        task: PlannedTask,
        tool_context: list[dict[str, Any]],
        scratchpad_snapshot: dict[str, Any],
        metadata: dict[str, Any],
        *,
        slow: bool,
        feedback: str | None = None,
    ) -> dict[str, Any]:
        model = definition.slow_model if slow else definition.fast_model
        result = await self.router.complete(
            model,
            definition.system_prompt,
            self._build_agent_prompt(
                prompt=prompt,
                task=task,
                tool_context=tool_context,
                scratchpad_snapshot=scratchpad_snapshot,
                feedback=feedback,
            ),
            temperature=0.25 if slow else 0.15,
            metadata={
                **metadata,
                "agent_key": next(key for key, value in AGENT_CATALOG.items() if value == definition),
                "operation": "agent_step",
                "escalated": slow,
            },
        )
        return {
            "agent_key": next(key for key, value in AGENT_CATALOG.items() if value == definition),
            "agent_name": definition.name,
            "model": result.model,
            "provider": result.provider,
            "content": result.content,
            "fallback": result.fallback,
        }

    async def _run_tool_loop(
        self,
        *,
        definition: AgentDefinition,
        task: PlannedTask,
        prompt: str,
        batch_index: int,
        scratchpad_snapshot: dict[str, Any],
        metadata: dict[str, Any],
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None,
        feedback: str | None,
        seed_tool_context: list[dict[str, Any]],
        slow: bool,
    ) -> ToolLoopRun:
        tool_context = list(seed_tool_context)
        available_tools = self.tools.list_for_agent(task.key)
        if not settings.orchestrator_tool_loop_enabled or not available_tools:
            return ToolLoopRun(context=tool_context, stop_reason="tool_loop_disabled_or_unavailable")

        step_event_context = {
            **metadata,
            "agent_key": task.key,
            "agent_name": definition.name,
            "step_index": task.plan_index,
            "batch_index": batch_index,
        }
        await self._emit(
            event_handler,
            "step.loop.started",
            {
                **step_event_context,
                "allowed_tools": [tool["name"] for tool in available_tools],
                "existing_tool_count": len(tool_context),
                "iteration_limit": settings.orchestrator_max_tool_iterations,
                "escalated": slow,
            },
        )

        executed_iterations = 0
        stop_reason = "planner_completed"
        seen_signatures: set[str] = set()
        consecutive_failures = 0
        total_failures = 0

        for iteration in range(settings.orchestrator_max_tool_iterations):
            decision = await self._plan_next_tool_action(
                definition=definition,
                task=task,
                prompt=prompt,
                scratchpad_snapshot=scratchpad_snapshot,
                metadata=metadata,
                feedback=feedback,
                tool_context=tool_context,
                available_tools=available_tools,
                slow=slow,
                iteration=iteration,
            )

            await self._emit(
                event_handler,
                "step.loop.iteration",
                {
                    **step_event_context,
                    "iteration": iteration,
                    "phase": "decision",
                    "action": decision.action,
                    "reason": decision.reason,
                    "tool_name": decision.tool_name,
                    "arguments": decision.arguments,
                    "decision_source": decision.source,
                    "status": "planned",
                },
            )

            if decision.action != "use_tool" or not decision.tool_name:
                stop_reason = "planner_completed"
                break

            signature = self._tool_decision_signature(decision)
            if signature in seen_signatures:
                stop_reason = "duplicate_tool_decision"
                await self._emit(
                    event_handler,
                    "step.loop.iteration",
                    {
                        **step_event_context,
                        "iteration": iteration,
                        "phase": "guardrail",
                        "action": decision.action,
                        "reason": "The planner repeated a previously executed tool call, so the loop stopped.",
                        "tool_name": decision.tool_name,
                        "arguments": decision.arguments,
                        "decision_source": decision.source,
                        "status": "stopped",
                    },
                )
                break
            seen_signatures.add(signature)

            tool_result = await self.tools.execute_named(
                task.key,
                decision.tool_name,
                decision.arguments,
                event_handler=event_handler,
                event_context={
                    **step_event_context,
                    "loop_iteration": iteration,
                    "loop_mode": "slow" if slow else "fast",
                },
            )
            tool_context.append(tool_result)
            executed_iterations += 1
            tool_failed = tool_result.get("status") == "failed"
            consecutive_failures = consecutive_failures + 1 if tool_failed else 0
            total_failures += 1 if tool_failed else 0

            await self._emit(
                event_handler,
                "step.loop.iteration",
                {
                    **step_event_context,
                    "iteration": iteration,
                    "phase": "result",
                    "action": decision.action,
                    "reason": decision.reason,
                    "tool_name": decision.tool_name,
                    "arguments": decision.arguments,
                    "decision_source": decision.source,
                    "status": tool_result.get("status", "completed"),
                    "tool_result_summary": self._tool_result_summary(tool_result),
                    "consecutive_failures": consecutive_failures,
                    "total_failures": total_failures,
                },
            )

            if consecutive_failures >= settings.orchestrator_max_consecutive_tool_failures:
                stop_reason = "too_many_tool_failures"
                break
        else:
            stop_reason = "iteration_limit_reached"

        await self._emit(
            event_handler,
            "step.loop.completed",
            {
                **step_event_context,
                "executed_iterations": executed_iterations,
                "total_tool_count": len(tool_context),
                "stop_reason": stop_reason,
                "total_failures": total_failures,
                "consecutive_failures": consecutive_failures,
                "escalated": slow,
            },
        )
        return ToolLoopRun(
            context=tool_context,
            executed_iterations=executed_iterations,
            stop_reason=stop_reason,
            total_failures=total_failures,
            consecutive_failures=consecutive_failures,
        )

    async def _plan_next_tool_action(
        self,
        *,
        definition: AgentDefinition,
        task: PlannedTask,
        prompt: str,
        scratchpad_snapshot: dict[str, Any],
        metadata: dict[str, Any],
        feedback: str | None,
        tool_context: list[dict[str, Any]],
        available_tools: list[dict[str, Any]],
        slow: bool,
        iteration: int,
    ) -> ToolLoopDecision:
        model = definition.slow_model if slow else definition.fast_model
        try:
            result = await self.router.complete(
                model,
                (
                    "You are a tool-planning controller inside a multi-agent orchestrator. "
                    "Choose exactly one next tool call if more evidence or execution is needed, "
                    "or choose complete if the existing context is sufficient. "
                    "Respond with strict JSON only."
                ),
                self._build_tool_loop_prompt(
                    prompt=prompt,
                    task=task,
                    scratchpad_snapshot=scratchpad_snapshot,
                    feedback=feedback,
                    tool_context=tool_context,
                    available_tools=available_tools,
                ),
                temperature=0.0,
                max_tokens=260,
                metadata={
                    **metadata,
                    "agent_key": task.key,
                    "operation": "tool_loop_planning",
                    "escalated": slow,
                    "tool_iteration": iteration,
                },
            )
        except Exception as exc:
            return self._heuristic_tool_loop_decision(
                task=task,
                prompt=prompt,
                available_tools=available_tools,
                tool_context=tool_context,
                raw_content="",
                planner_error=f"{exc.__class__.__name__}: {exc}",
            )

        return self._parse_tool_loop_decision(
            raw_content=result.content,
            task=task,
            prompt=prompt,
            available_tools=available_tools,
            tool_context=tool_context,
            fallback_source="fallback" if result.fallback else "model",
        )

    def _build_tool_loop_prompt(
        self,
        *,
        prompt: str,
        task: PlannedTask,
        scratchpad_snapshot: dict[str, Any],
        feedback: str | None,
        tool_context: list[dict[str, Any]],
        available_tools: list[dict[str, Any]],
    ) -> str:
        feedback_block = f"Supervisor feedback for the retry:\n{feedback}\n\n" if feedback else ""
        available_block = "\n".join(
            f"- {tool['name']}: {tool['description']}" for tool in available_tools
        )
        context_block = self._render_tool_context_for_loop(tool_context)
        return (
            f"Primary request:\n{prompt}\n\n"
            f"Current agent objective:\n{task.objective}\n\n"
            f"Expected output:\n{task.expected_output}\n\n"
            f"Shared scratchpad snapshot:\n{scratchpad_snapshot}\n\n"
            f"Existing tool context:\n{context_block}\n\n"
            f"Available tools:\n{available_block}\n\n"
            f"{feedback_block}"
            "Return strict JSON with this schema:\n"
            '{"action":"use_tool"|"complete","reason":"short reason","tool_name":"tool or null","arguments":{"arg":"value"}}\n'
            "Rules:\n"
            "- Use at most one tool per iteration.\n"
            "- Choose complete if the current tool context is already enough.\n"
            "- Do not repeat the same tool call unless it would materially change the outcome.\n"
            "- Only choose tool_name values from the available tools list.\n"
            "- For web_search use arguments like {\"query\":\"...\",\"max_results\":3}.\n"
            "- For browser_automation use {\"goal\":\"...\"}.\n"
            "- For notebooklm_studio use action generate_deliverable with prompt, output_type, source_urls, and source_bundle_text.\n"
            "- For NotebookLM-native deliverables such as audio overviews, podcasts, video overviews, mind maps, reports, flashcards, quizzes, infographics, slide decks, and data tables, prefer notebooklm_studio first unless it already failed or the user explicitly asked for a non-NotebookLM version.\n"
            "- For workspace_files use an action such as list_files or read_text.\n"
            "- For python_sandbox only call it if you can provide concrete Python code.\n"
            "- Output JSON only, with no markdown fences or commentary."
        )

    def _parse_tool_loop_decision(
        self,
        *,
        raw_content: str,
        task: PlannedTask,
        prompt: str,
        available_tools: list[dict[str, Any]],
        tool_context: list[dict[str, Any]],
        fallback_source: str,
    ) -> ToolLoopDecision:
        parsed = self._extract_json_object(raw_content)
        if parsed is None:
            return self._heuristic_tool_loop_decision(
                task=task,
                prompt=prompt,
                available_tools=available_tools,
                tool_context=tool_context,
                raw_content=raw_content,
                planner_error="Planner response was not valid JSON.",
            )

        action = str(parsed.get("action") or "").strip().lower()
        if action in {"tool", "call_tool"}:
            action = "use_tool"
        if action in {"finish", "respond", "done"}:
            action = "complete"

        tool_name = str(parsed.get("tool_name") or parsed.get("tool") or "").strip() or None
        arguments = parsed.get("arguments") if isinstance(parsed.get("arguments"), dict) else {}
        reason = str(parsed.get("reason") or parsed.get("summary") or "").strip() or "Planner returned no reason."
        available_names = {tool["name"] for tool in available_tools}

        if action == "use_tool" and tool_name in available_names:
            return ToolLoopDecision(
                action="use_tool",
                reason=reason,
                tool_name=tool_name,
                arguments=arguments,
                source=fallback_source,
            )
        if action == "complete":
            return ToolLoopDecision(action="complete", reason=reason, source=fallback_source)

        return self._heuristic_tool_loop_decision(
            task=task,
            prompt=prompt,
            available_tools=available_tools,
            tool_context=tool_context,
            raw_content=raw_content,
            planner_error="Planner returned an unsupported action or tool.",
        )

    def _heuristic_tool_loop_decision(
        self,
        *,
        task: PlannedTask,
        prompt: str,
        available_tools: list[dict[str, Any]],
        tool_context: list[dict[str, Any]],
        raw_content: str,
        planner_error: str,
    ) -> ToolLoopDecision:
        available_names = {tool["name"] for tool in available_tools}
        lowered_prompt = prompt.lower()
        lowered_raw = raw_content.lower()
        notebooklm_output = self.tools.notebooklm.detect_output_type(prompt)

        if (
            notebooklm_output
            and "notebooklm_studio" in available_names
            and not self._tool_operation_already_used(
                tool_context,
                "notebooklm_studio",
                "generate_deliverable",
            )
            and task.key in {"content", "analysis"}
            and "another version" not in lowered_prompt
            and "non-notebooklm" not in lowered_prompt
        ):
            return ToolLoopDecision(
                action="use_tool",
                reason=f"Heuristic planner fallback selected notebooklm_studio because: {planner_error}",
                tool_name="notebooklm_studio",
                arguments=self._build_notebooklm_tool_arguments(
                    prompt=prompt,
                    output_type=notebooklm_output,
                    tool_context=tool_context,
                ),
                source="heuristic",
            )

        if (
            "web_search" in available_names
            and not self._tool_already_used(tool_context, "web_search")
            and (
                task.key == "research"
                or any(
                    token in lowered_prompt
                    for token in ("research", "source", "market", "competitor", "trend", "latest", "news")
                )
            )
        ):
            return ToolLoopDecision(
                action="use_tool",
                reason=f"Heuristic planner fallback selected web_search because: {planner_error}",
                tool_name="web_search",
                arguments={"query": prompt, "max_results": 3},
                source="heuristic",
            )

        if (
            "browser_automation" in available_names
            and not self._tool_already_used(tool_context, "browser_automation")
            and any(
                token in lowered_prompt
                for token in ("browser", "website", "site", "navigate", "page", "click", "url", "http")
            )
        ):
            return ToolLoopDecision(
                action="use_tool",
                reason=f"Heuristic planner fallback selected browser_automation because: {planner_error}",
                tool_name="browser_automation",
                arguments={"goal": prompt},
                source="heuristic",
            )

        if (
            "workspace_files" in available_names
            and not self._tool_already_used(tool_context, "workspace_files")
            and task.key == "coding"
        ):
            return ToolLoopDecision(
                action="use_tool",
                reason=f"Heuristic planner fallback selected workspace_files because: {planner_error}",
                tool_name="workspace_files",
                arguments={"action": "list_files", "relative_path": ".", "recursive": False},
                source="heuristic",
            )

        if (
            "notification_dispatch" in available_names
            and not self._tool_already_used(tool_context, "notification_dispatch")
            and any(token in lowered_prompt for token in ("notify", "notification", "webhook", "slack", "email"))
        ):
            return ToolLoopDecision(
                action="use_tool",
                reason=f"Heuristic planner fallback selected notification_dispatch because: {planner_error}",
                tool_name="notification_dispatch",
                arguments={"action": "preview_dispatch", "prompt": prompt},
                source="heuristic",
            )

        if (
            "background_jobs" in available_names
            and not self._tool_already_used(tool_context, "background_job")
            and any(token in lowered_prompt for token in ("background", "long-running", "long running", "batch", "bulk"))
        ):
            return ToolLoopDecision(
                action="use_tool",
                reason=f"Heuristic planner fallback selected background_jobs because: {planner_error}",
                tool_name="background_jobs",
                arguments={"action": "preview", "prompt": prompt},
                source="heuristic",
            )

        completion_reason = "Planner chose completion."
        if planner_error:
            completion_reason = f"Tool loop completed via heuristic fallback because: {planner_error}"
        if tool_context and any(token in lowered_raw for token in ("complete", "enough", "sufficient", "ready", "final")):
            completion_reason = "Planner text indicated the current tool context is sufficient."

        return ToolLoopDecision(action="complete", reason=completion_reason, source="heuristic")

    def _extract_json_object(self, raw_content: str) -> dict[str, Any] | None:
        cleaned = raw_content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.removeprefix("```json").removeprefix("```JSON").removeprefix("```").strip()
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3].strip()

        candidates = [cleaned]
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            candidates.append(cleaned[start : end + 1])

        for candidate in candidates:
            if not candidate:
                continue
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed
        return None

    def _render_tool_context_for_loop(self, tool_context: list[dict[str, Any]]) -> str:
        if not tool_context:
            return "No tool results yet."

        lines = []
        for index, tool in enumerate(tool_context[-6:], start=max(len(tool_context) - 5, 1)):
            tool_name = str(tool.get("tool", "tool"))
            operation = str(tool.get("operation", "execute"))
            status = str(tool.get("status", "completed"))
            summary = self._tool_result_summary(tool)
            lines.append(f"{index}. {tool_name} | {operation} | {status} | {summary}")
        return "\n".join(lines)

    def _tool_result_summary(self, tool_result: dict[str, Any]) -> str:
        if tool_result.get("tool") == "web_search":
            return f"Query `{tool_result.get('query', '')}` returned {len(tool_result.get('results', []))} result(s)."
        if tool_result.get("tool") == "browser_automation":
            return f"Captured {tool_result.get('final_url') or tool_result.get('target_url') or 'browser session'}."
        if tool_result.get("tool") == "notebooklm_studio":
            output_type = str(tool_result.get("output_type") or "deliverable").replace("_", " ")
            artifact_count = len(tool_result.get("artifacts", []))
            return (
                f"NotebookLM handled {output_type} generation and produced "
                f"{artifact_count} artifact{'s' if artifact_count != 1 else ''}."
            )
        if tool_result.get("tool") == "workspace_files":
            return self._compact_summary(str(tool_result.get("path") or tool_result.get("relative_path") or tool_result))
        if tool_result.get("tool") == "python_sandbox":
            return f"Sandbox return code {tool_result.get('returncode', 'n/a')}."
        if tool_result.get("tool") in {
            "document_export",
            "notification_dispatch",
            "background_job",
        }:
            return self._compact_summary(str(tool_result))
        return self._compact_summary(str(tool_result))

    def _tool_already_used(self, tool_context: list[dict[str, Any]], tool_name: str) -> bool:
        return any(str(tool.get("tool")) == tool_name for tool in tool_context)

    def _tool_operation_already_used(
        self,
        tool_context: list[dict[str, Any]],
        tool_name: str,
        operation: str,
    ) -> bool:
        return any(
            str(tool.get("tool")) == tool_name and str(tool.get("operation")) == operation
            for tool in tool_context
        )

    def _tool_decision_signature(self, decision: ToolLoopDecision) -> str:
        serialized_arguments = json.dumps(decision.arguments, sort_keys=True, default=str)
        return f"{decision.tool_name}:{serialized_arguments}"

    def _tool_loop_view(self, tool_loop: ToolLoopRun) -> dict[str, Any]:
        return {
            "executed_iterations": tool_loop.executed_iterations,
            "stop_reason": tool_loop.stop_reason,
            "total_failures": tool_loop.total_failures,
            "consecutive_failures": tool_loop.consecutive_failures,
        }

    def _continue_until_done_reason(
        self,
        *,
        task: PlannedTask,
        prompt: str,
        result: dict[str, Any],
        validation: dict[str, Any],
        tool_loop: ToolLoopRun,
        slow: bool,
    ) -> str | None:
        response_incomplete = self._response_looks_incomplete(result["content"])
        structured_grounded_completion = (
            tool_loop.stop_reason == "planner_completed"
            and validation["section_score"] >= 0.8
            and validation["evidence_score"] >= 1.0
        )
        grounded_research_completion = (
            task.key == "research"
            and tool_loop.stop_reason == "planner_completed"
            and tool_loop.executed_iterations > 0
            and validation["section_score"] >= 0.95
            and validation["evidence_score"] >= 1.0
            and validation["overall_score"] >= 0.6
            and not response_incomplete
        )
        threshold = settings.orchestrator_continue_until_done_min_validation - (0.04 if slow else 0.0)
        if structured_grounded_completion:
            threshold = max(threshold - 0.03, 0.0)
        if grounded_research_completion:
            threshold = min(threshold, 0.6)
        if validation["overall_score"] < threshold:
            return (
                "Validation score is still below the continue-until-done threshold "
                f"({validation['overall_score']:.2f} < {threshold:.2f})."
            )
        if validation["coverage_score"] < 0.35 and not structured_grounded_completion and not grounded_research_completion:
            return "Coverage of the task objective is still too narrow."
        if tool_loop.stop_reason in {"too_many_tool_failures", "iteration_limit_reached"}:
            return f"Tool loop stopped due to {tool_loop.stop_reason.replace('_', ' ')}."
        if tool_loop.total_failures > 0 and validation["evidence_score"] < 1.0:
            return "Recent tool failures likely left gaps in the supporting context."
        if response_incomplete:
            return "The agent response still signals incomplete work."
        if task.key == "research" and not result.get("tools"):
            return "Research work completed without grounded tool context."
        if any(token in prompt.lower() for token in ("production", "enterprise", "launch", "deploy")) and validation["section_score"] < 0.8:
            return "High-stakes request still needs a more complete structured response."
        return None

    def _build_replan_feedback(
        self,
        *,
        task: PlannedTask,
        result: dict[str, Any],
        validation: dict[str, Any],
        tool_loop: ToolLoopRun,
        continue_reason: str,
    ) -> str:
        failed_tools = [
            self._tool_result_summary(tool)
            for tool in result.get("tools", [])
            if tool.get("status") == "failed"
        ][-3:]
        guidance = [
            f"Continue until done reason: {continue_reason}",
            f"Validation summary: {validation['summary']}",
            f"Expected output reminder: {task.expected_output or task.objective}",
            "Recover from failed tool paths if needed, avoid repeating duplicate tool calls, and close any obvious coverage gaps before answering.",
        ]
        if failed_tools:
            guidance.append("Recent failed tool outcomes:")
            guidance.extend(f"- {summary}" for summary in failed_tools)
        if tool_loop.stop_reason != "planner_completed":
            guidance.append(
                f"Tool-loop stop reason from the last attempt: {tool_loop.stop_reason.replace('_', ' ')}."
            )
        return "\n".join(guidance)

    def _response_looks_incomplete(self, content: str) -> bool:
        lowered = content.lower()
        incomplete_markers = (
            "need more information",
            "insufficient information",
            "cannot complete",
            "unable to complete",
            "would need",
            "follow-up required",
            "further research required",
            "continue researching",
            "continue research",
            "pending verification",
            "not enough context",
        )
        return any(marker in lowered for marker in incomplete_markers)

    def _build_agent_prompt(
        self,
        *,
        prompt: str,
        task: PlannedTask,
        tool_context: list[dict[str, Any]],
        scratchpad_snapshot: dict[str, Any],
        feedback: str | None,
    ) -> str:
        feedback_block = f"Supervisor feedback for retry:\n{feedback}\n\n" if feedback else ""
        notebooklm_block = (
            "NotebookLM-first guidance:\n"
            "This request maps to a NotebookLM-native deliverable. Prefer notebooklm_studio before other"
            " generation routes. Only fall back to non-NotebookLM generation if NotebookLM cannot fulfill"
            " the request or the user explicitly asks for another version.\n\n"
            if task.key == "content" and self._is_notebooklm_deliverable_request(prompt)
            else ""
        )
        return (
            f"Primary request:\n{prompt}\n\n"
            f"Current agent objective:\n{task.objective}\n\n"
            f"Reason selected:\n{task.reason}\n\n"
            f"Expected output:\n{task.expected_output}\n\n"
            f"Dependencies already completed:\n{task.dependencies or 'None'}\n\n"
            f"Shared scratchpad snapshot:\n{scratchpad_snapshot}\n\n"
            f"Available tool context:\n{tool_context}\n\n"
            f"{notebooklm_block}"
            f"{feedback_block}"
            "Respond with the following sections:\n"
            "- Outcome\n"
            "- Key Findings\n"
            "- Risks\n"
            "- Assumptions\n"
            "- Supervisor Next Step\n"
        )

    def _validate_result(
        self,
        task: PlannedTask,
        content: str,
        tool_context: list[dict[str, Any]],
    ) -> dict[str, Any]:
        lowered = content.lower()
        section_tokens = {
            "outcome": "outcome" in lowered,
            "findings": "finding" in lowered,
            "risks": "risk" in lowered,
            "assumptions": "assumption" in lowered,
            "next_step": "next step" in lowered or "supervisor next" in lowered,
        }
        structure_score = sum(1 for present in section_tokens.values() if present) / len(section_tokens)
        length_score = min(len(content) / 1800, 1.0)
        evidence_score = 1.0 if tool_context else 0.4
        objective_keywords = {
            token.strip(".,").lower()
            for token in task.objective.split()
            if len(token.strip(".,").lower()) > 4
        }
        coverage_hits = sum(1 for token in objective_keywords if token in lowered)
        coverage_score = coverage_hits / max(len(objective_keywords), 1)
        overall = round(
            structure_score * 0.35
            + length_score * 0.2
            + evidence_score * 0.2
            + coverage_score * 0.25,
            4,
        )

        issues: list[str] = []
        if structure_score < 0.6:
            issues.append("Response is missing one or more required sections.")
        if len(content) < 320:
            issues.append("Response is brief relative to the requested objective.")
        if not tool_context:
            issues.append("No supporting tool context was available for this step.")
        if coverage_score < 0.35:
            issues.append("Response does not strongly cover the step objective.")

        return {
            "overall_score": overall,
            "section_score": round(structure_score, 4),
            "length_score": round(length_score, 4),
            "evidence_score": round(evidence_score, 4),
            "coverage_score": round(coverage_score, 4),
            "issues": issues,
            "summary": "; ".join(issues) if issues else "Validation passed with adequate structure and coverage.",
        }

    def _should_escalate(
        self,
        prompt: str,
        task: PlannedTask,
        result: dict[str, Any],
        validation: dict[str, Any],
    ) -> bool:
        if validation["overall_score"] < 0.62:
            return True
        if result.get("fallback"):
            return True
        if any(token in prompt.lower() for token in ("enterprise", "production", "strictly")):
            return True
        if task.key == "content" and validation["coverage_score"] < 0.55:
            return True
        return False

    def _confidence_score(
        self,
        content: str,
        tool_context: list[dict[str, Any]],
        validation: dict[str, Any],
    ) -> float:
        base = 0.35 + validation["overall_score"] * 0.45
        if tool_context:
            base += 0.08
        if "risk" in content.lower():
            base += 0.03
        return round(min(base, 0.97), 4)

    def _select_agent_keys(self, prompt: str) -> list[str]:
        lowered = prompt.lower()
        matched: list[str] = []
        rules = [
            ("research", ("research", "fact", "find", "source", "market", "web", "look up")),
            ("analysis", ("analy", "trend", "forecast", "data", "compare", "risk", "evaluate")),
            (
                "content",
                (
                    "write",
                    "report",
                    "presentation",
                    "deck",
                    "article",
                    "copy",
                    "summarize",
                    "podcast",
                    "audio overview",
                    "video overview",
                    "mind map",
                    "flashcard",
                    "quiz",
                    "infographic",
                    "slide deck",
                    "data table",
                    "study guide",
                ),
            ),
            ("coding", ("build", "code", "api", "website", "app", "debug", "deploy", "implement")),
            (
                "vision_automation",
                ("browser", "automation", "workflow", "ui", "image", "visual", "click", "navigate"),
            ),
        ]
        for key, keywords in rules:
            if any(self._keyword_matches(lowered, keyword) for keyword in keywords):
                matched.append(key)

        if not matched:
            return ["research", "analysis", "content"]

        if "research" in matched and "analysis" not in matched:
            matched.append("analysis")
        if any(key in matched for key in ("research", "analysis", "coding", "vision_automation")) and "content" not in matched:
            matched.append("content")

        ordered = []
        seen = set()
        for key in ("research", "analysis", "coding", "vision_automation", "content"):
            if key in matched and key not in seen:
                ordered.append(key)
                seen.add(key)
        return ordered

    def _is_notebooklm_deliverable_request(self, prompt: str) -> bool:
        return self.tools.notebooklm.detect_output_type(prompt) is not None

    def _build_notebooklm_tool_arguments(
        self,
        *,
        prompt: str,
        output_type: str,
        tool_context: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "action": "generate_deliverable",
            "prompt": prompt,
            "output_type": output_type,
            "instructions": prompt,
            "source_urls": self._notebooklm_source_urls(tool_context),
            "source_bundle_text": self._notebooklm_source_bundle(prompt, tool_context),
        }

    def _notebooklm_source_urls(self, tool_context: list[dict[str, Any]]) -> list[str]:
        urls: list[str] = []
        for tool in tool_context:
            for result in tool.get("results", []) if isinstance(tool.get("results"), list) else []:
                candidate = str(result.get("url") or result.get("source_uri") or "").strip()
                if candidate and candidate not in urls:
                    urls.append(candidate)
            final_url = str(tool.get("final_url") or tool.get("target_url") or "").strip()
            if final_url and final_url not in urls:
                urls.append(final_url)
        return urls[:8]

    def _notebooklm_source_bundle(
        self,
        prompt: str,
        tool_context: list[dict[str, Any]],
    ) -> str:
        lines = ["# Autonomous execution brief", "", "## User request", "", prompt.strip(), ""]
        if tool_context:
            lines.extend(["## Tool context", ""])
        for tool in tool_context[:6]:
            tool_name = str(tool.get("tool") or "tool").strip() or "tool"
            lines.append(f"### {tool_name}")
            summary = self._tool_result_summary(tool)
            if summary:
                lines.append(summary)
            for result in tool.get("results", []) if isinstance(tool.get("results"), list) else []:
                title = str(result.get("title") or result.get("name") or "").strip()
                url = str(result.get("url") or result.get("source_uri") or "").strip()
                excerpt = str(result.get("excerpt") or result.get("snippet") or "").strip()
                if title or url:
                    lines.append(f"- {title or url}")
                if url and url != title:
                    lines.append(f"  Source: {url}")
                if excerpt:
                    lines.append(f"  Note: {excerpt[:280]}")
            final_url = str(tool.get("final_url") or tool.get("target_url") or "").strip()
            if final_url:
                lines.append(f"- Final URL: {final_url}")
            lines.append("")
        return "\n".join(lines).strip()

    def _keyword_matches(self, prompt: str, keyword: str) -> bool:
        if " " in keyword:
            return keyword in prompt
        return bool(re.search(rf"\b{re.escape(keyword)}\w*\b", prompt))

    def _execution_batches(self, plan: list[PlannedTask]) -> list[list[PlannedTask]]:
        task_by_key = {task.key: task for task in plan}
        dependencies = {task.key: set(task.dependencies) for task in plan}
        dependents: dict[str, set[str]] = defaultdict(set)
        for task in plan:
            for dependency in task.dependencies:
                dependents[dependency].add(task.key)

        ready = sorted(
            [task.key for task in plan if not dependencies[task.key]],
            key=lambda key: task_by_key[key].priority,
        )
        batches: list[list[PlannedTask]] = []
        scheduled: set[str] = set()

        while ready:
            current_batch_keys = ready
            batches.append([task_by_key[key] for key in current_batch_keys])
            scheduled.update(current_batch_keys)
            next_ready: list[str] = []
            for key in current_batch_keys:
                for dependent in dependents.get(key, set()):
                    dependencies[dependent].discard(key)
                    if not dependencies[dependent] and dependent not in scheduled:
                        next_ready.append(dependent)
            ready = sorted(set(next_ready), key=lambda key: task_by_key[key].priority)

        if len(scheduled) != len(plan):
            return [[task] for task in sorted(plan, key=lambda item: item.priority)]

        return batches

    def _update_scratchpad(self, scratchpad: ExecutionScratchpad, result: dict[str, Any]) -> None:
        scratchpad.completed_agents.append(result["agent_key"])
        scratchpad.findings.append(
            {
                "agent": result["agent_name"],
                "summary": self._compact_summary(result["content"]),
                "confidence": result["confidence"],
                "batch_index": result["batch_index"],
            }
        )
        scratchpad.validation_notes.append(result["validation"]["summary"])
        scratchpad.risks.extend(self._extract_sentences(result["content"], "risk"))
        scratchpad.open_questions.extend(self._extract_sentences(result["content"], "assumption"))
        for tool in result.get("tools", []):
            scratchpad.tool_observations.append(
                {
                    "tool": tool.get("tool") or ("web_search" if tool.get("query") else "tool_context"),
                    "status": tool.get("status", "completed"),
                    "summary": self._compact_summary(str(tool)),
                }
            )

    def _scratchpad_view(self, scratchpad: ExecutionScratchpad) -> dict[str, Any]:
        return {
            "task_memory": scratchpad.task_memory,
            "project_memory": scratchpad.project_memory,
            "grounding_sources": scratchpad.grounding_sources[:6],
            "completed_agents": scratchpad.completed_agents[-6:],
            "findings": scratchpad.findings[-6:],
            "risks": scratchpad.risks[-6:],
            "open_questions": scratchpad.open_questions[-6:],
            "tool_observations": scratchpad.tool_observations[-6:],
            "validation_notes": scratchpad.validation_notes[-6:],
        }

    def _normalize_shared_memory(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            return {}
        normalized: dict[str, Any] = {}
        for key in (
            "summary",
            "findings",
            "risks",
            "open_questions",
            "recent_requests",
            "recent_summaries",
            "focus_areas",
            "agent_memory",
            "run_count",
            "last_updated_at",
            "source_run_id",
            "source_thread_id",
        ):
            current = value.get(key)
            if current is None:
                continue
            normalized[key] = current
        return normalized

    def _normalize_grounding_sources(self, tool_context: list[dict[str, Any]]) -> list[dict[str, Any]]:
        sources: list[dict[str, Any]] = []
        for tool in tool_context:
            citations = self._citations_from_tool("Grounding context", tool)
            for citation in citations:
                sources.append(
                    {
                        "title": citation["title"],
                        "kind": citation["kind"],
                        "source_uri": citation.get("source_uri"),
                        "url": citation.get("url"),
                        "excerpt": citation.get("excerpt"),
                        "document_id": citation.get("document_id"),
                        "score": citation.get("score"),
                    }
                )
        deduped: list[dict[str, Any]] = []
        seen: set[str] = set()
        for source in sources:
            key = "|".join(
                filter(
                    None,
                    [
                        str(source.get("document_id") or ""),
                        str(source.get("url") or source.get("source_uri") or ""),
                        str(source.get("title") or ""),
                    ],
                )
            )
            if not key or key in seen:
                continue
            seen.add(key)
            deduped.append(source)
        return deduped[:6]

    def _build_synthesis_prompt(
        self,
        prompt: str,
        step_results: list[dict[str, Any]],
        scratchpad: ExecutionScratchpad,
        citations: list[dict[str, Any]],
    ) -> str:
        rendered = "\n\n".join(
            (
                f"[{step['agent_name']} | {step['model']} | confidence {step['confidence']}]\n"
                f"Dependencies: {step['dependencies']}\n"
                f"Validation: {step['validation']['summary']}\n"
                f"{step['content']}"
            )
            for step in step_results
        )
        citation_block = self._render_citation_catalog(citations)
        citation_instructions = (
            "Grounded citation catalog:\n"
            f"{citation_block}\n\n"
            "When a claim depends on evidence, append the relevant source IDs inline like [S1] or [S2]. "
            "Only use IDs from the catalog and do not invent source references.\n\n"
            if citations
            else ""
        )
        return (
            f"User request:\n{prompt}\n\n"
            f"Execution scratchpad:\n{self._scratchpad_view(scratchpad)}\n\n"
            f"Agent outputs:\n{rendered}\n\n"
            f"{citation_instructions}"
            "Return only the core answer body for the user.\n"
            "Make it strong, direct, and solution-oriented.\n"
            "Cover the best answer, the key reasoning, and the most important risks or caveats.\n"
            "Do not add a separate 'what I'm doing' section.\n"
            "Do not add follow-up options.\n"
        )

    def _compose_autonomous_response(
        self,
        *,
        prompt: str,
        content: str,
        step_results: list[dict[str, Any]],
        scratchpad: ExecutionScratchpad,
    ) -> str:
        answer_body = content.strip() or (
            "I completed the run, but the final synthesis came back empty. The safest next move is to rerun the task or"
            " inspect the execution details in the workbench before acting on it."
        )
        notebooklm_summary = self._build_notebooklm_completion_summary(step_results)
        if notebooklm_summary:
            if self._looks_like_provider_placeholder(answer_body):
                answer_body = notebooklm_summary
            else:
                answer_body = f"{notebooklm_summary}\n\n{answer_body}"
        process_lines = self._build_autonomous_process_lines(step_results, scratchpad)
        follow_up_options = self._build_follow_up_options(
            prompt,
            step_results,
            notebooklm_used=bool(notebooklm_summary),
        )

        return (
            "What I'm doing\n"
            + "\n".join(f"- {line}" for line in process_lines)
            + "\n\nAnswer\n"
            + answer_body
            + "\n\nThree ways to go further\n"
            + "\n".join(f"{index}. {option}" for index, option in enumerate(follow_up_options, start=1))
        )

    def _successful_notebooklm_result(self, step_results: list[dict[str, Any]]) -> dict[str, Any] | None:
        for step in reversed(step_results):
            for tool in reversed(step.get("tools", [])):
                if (
                    str(tool.get("tool") or "") == "notebooklm_studio"
                    and str(tool.get("status") or "") == "completed"
                    and str(tool.get("operation") or "") == "generate_deliverable"
                    and isinstance(tool.get("artifacts"), list)
                    and tool.get("artifacts")
                ):
                    return tool
        return None

    def _build_notebooklm_completion_summary(self, step_results: list[dict[str, Any]]) -> str | None:
        tool = self._successful_notebooklm_result(step_results)
        if tool is None:
            return None

        output_type = self._humanize_output_type(str(tool.get("output_type") or "deliverable"))
        notebook_name = str(tool.get("notebook_name") or "NotebookLM notebook").strip()
        artifacts = [artifact for artifact in tool.get("artifacts", []) if isinstance(artifact, dict)]
        primary_artifact = artifacts[0] if artifacts else None
        artifact_name = (
            str(
                primary_artifact.get("file_name")
                or primary_artifact.get("name")
                or primary_artifact.get("storage_key")
                or ""
            ).strip()
            if primary_artifact
            else ""
        )
        source_count = len(tool.get("sources", []) if isinstance(tool.get("sources"), list) else [])
        detail_parts = [f"NotebookLM completed the {output_type} run"]
        if artifact_name:
            detail_parts.append(f"and produced `{artifact_name}`")
        detail = " ".join(detail_parts) + "."

        meta_parts: list[str] = []
        if notebook_name:
            meta_parts.append(f"Notebook: {notebook_name}")
        if source_count > 0:
            meta_parts.append(f"Sources attached: {source_count}")
        if len(artifacts) > 1:
            meta_parts.append(f"Artifacts: {len(artifacts)}")

        if meta_parts:
            return detail + "\n" + "\n".join(f"- {part}" for part in meta_parts)
        return detail

    def _looks_like_provider_placeholder(self, content: str) -> bool:
        lowered = content.lower()
        markers = (
            "fallback provider generated",
            "structured response for model",
            "this is a local development fallback",
            "mock-local",
        )
        return any(marker in lowered for marker in markers)

    def _humanize_output_type(self, output_type: str) -> str:
        lowered = output_type.strip().lower().replace("-", "_")
        labels = {
            "audio_overview": "audio overview",
            "video_overview": "video overview",
            "mind_map": "mind map",
            "slide_deck": "slide deck",
            "data_table": "data table",
        }
        return labels.get(lowered, lowered.replace("_", " "))

    def _build_autonomous_process_lines(
        self,
        step_results: list[dict[str, Any]],
        scratchpad: ExecutionScratchpad,
    ) -> list[str]:
        agent_names = [step["agent_name"] for step in step_results if step.get("agent_name")]
        unique_agents = list(dict.fromkeys(agent_names))
        tool_count = sum(len(step.get("tools", [])) for step in step_results)
        grounded_count = len(scratchpad.grounding_sources)
        notebooklm_result = self._successful_notebooklm_result(step_results)

        lines = [
            (
                f"I coordinated {len(unique_agents)} specialist agent"
                f"{'' if len(unique_agents) == 1 else 's'}: {', '.join(unique_agents)}."
                if unique_agents
                else "I coordinated the autonomous run and kept the task moving across the available agent stack."
            )
        ]
        if notebooklm_result is not None:
            lines.append(
                "I'm using NotebookLM as the primary generation path for this deliverable and keeping the produced artifact anchored in the workbench."
            )

        if grounded_count > 0 or tool_count > 0:
            detail_parts: list[str] = []
            if grounded_count > 0:
                detail_parts.append(
                    f"{grounded_count} grounded source{'s' if grounded_count != 1 else ''}"
                )
            if tool_count > 0:
                detail_parts.append(f"{tool_count} tool result{'s' if tool_count != 1 else ''}")
            lines.append(
                "I checked " + " and ".join(detail_parts) + " to keep the answer evidence-aware and execution-aware."
            )
        else:
            lines.append(
                "I reviewed the available workspace context, task memory, and agent outputs to shape the strongest answer."
            )

        lines.append(
            "I’m aiming for the best next step for your query, not just a raw answer, so I’m surfacing the key caveats and the most useful ways to continue."
        )
        lines[-1] = (
            "I'm aiming for the best next step for your query, not just a raw answer, so I'm surfacing the key caveats and the most useful ways to continue."
        )
        return lines

    def _build_follow_up_options(
        self,
        prompt: str,
        step_results: list[dict[str, Any]],
        *,
        notebooklm_used: bool = False,
    ) -> list[str]:
        lowered_prompt = prompt.lower()
        agent_keys = {str(step.get("agent_key") or "") for step in step_results}

        if notebooklm_used:
            return [
                "Refine this deliverable into a second NotebookLM pass with a different tone, audience, or structure.",
                "Turn the generated output into a companion asset, like a slide deck, quiz, or flashcard set.",
                "Audit the result against the source material and tighten gaps, citations, or missing sections.",
            ]

        if "coding" in agent_keys or any(
            token in lowered_prompt
            for token in ("code", "build", "implement", "debug", "api", "app", "script", "fix")
        ):
            return [
                "Turn this answer into an implementation plan with concrete steps, files, and priorities.",
                "Pressure-test the solution by reviewing edge cases, failure modes, and testing strategy.",
                "Convert the recommendation into code, pseudocode, or a ready-to-ship technical spec.",
            ]

        if "research" in agent_keys or any(
            token in lowered_prompt
            for token in ("latest", "news", "current", "president", "market", "research", "compare", "trend")
        ):
            return [
                "Go deeper on the latest sources and evidence behind this answer.",
                "Expand this into broader context, timeline, stakeholders, and implications.",
                "Turn the findings into a concise briefing, comparison table, or decision memo.",
            ]

        if "analysis" in agent_keys or any(
            token in lowered_prompt
            for token in ("strategy", "plan", "decision", "option", "tradeoff", "risk")
        ):
            return [
                "Compare the main alternatives, tradeoffs, and likely outcomes around this topic.",
                "Stress-test the recommendation against risks, assumptions, and edge cases.",
                "Turn the answer into a concrete action plan with milestones and owners.",
            ]

        return [
            "Go deeper on the evidence, assumptions, or sources behind this answer.",
            "Explore alternatives, risks, and edge cases around this topic.",
            "Turn this into a practical next-step plan, checklist, or deliverable.",
        ]

    def _summarize(self, step_results: list[dict[str, Any]]) -> str:
        labels = ", ".join(step["agent_name"] for step in step_results)
        batches = sorted({step["batch_index"] for step in step_results})
        return (
            f"Supervisor coordinated {len(step_results)} agents across {len(batches)} execution batches: {labels}."
        )

    def _collect_citations(self, step_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        citations: list[dict[str, Any]] = []
        seen: set[str] = set()
        for step in step_results:
            for tool in step.get("tools", []):
                for citation in self._citations_from_tool(step["agent_name"], tool):
                    key = self._citation_dedupe_key(citation)
                    if key in seen:
                        continue
                    seen.add(key)
                    citations.append(citation | {"reference_id": f"S{len(citations) + 1}"})
        return citations

    def _citations_from_tool(self, agent_name: str, tool: dict[str, Any]) -> list[dict[str, Any]]:
        tool_name = str(tool.get("tool") or "")
        results = tool.get("results")
        citations: list[dict[str, Any]] = []
        if isinstance(results, list):
            for item in results:
                if not isinstance(item, dict):
                    continue
                citation = self._citation_from_result_item(agent_name, tool_name, item)
                if citation is not None:
                    citations.append(citation)

        if tool_name == "browser_automation":
            final_url = str(tool.get("final_url") or tool.get("target_url") or "").strip()
            if final_url:
                citations.append(
                    {
                        "agent": agent_name,
                        "title": str(tool.get("page_title") or final_url),
                        "url": final_url,
                        "kind": "browser",
                        "excerpt": self._compact_summary(str(tool.get("extracted_text") or ""), limit=260),
                    }
                )

        if tool_name == "workspace_files" and str(tool.get("operation") or "") == "read_text":
            relative_path = str(tool.get("relative_path") or "").strip()
            if relative_path:
                citations.append(
                    {
                        "agent": agent_name,
                        "title": relative_path,
                        "url": "",
                        "kind": "workspace_file",
                        "relative_path": relative_path,
                        "excerpt": self._compact_summary(str(tool.get("content") or ""), limit=260),
                    }
                )
        return citations

    def _citation_from_result_item(
        self,
        agent_name: str,
        tool_name: str,
        item: dict[str, Any],
    ) -> dict[str, Any] | None:
        if tool_name == "knowledge_retrieval":
            title = str(item.get("title") or item.get("document_title") or "Knowledge source").strip()
            return {
                "agent": agent_name,
                "title": title,
                "url": str(item.get("url") or item.get("source_uri") or "").strip(),
                "kind": "knowledge",
                "excerpt": self._compact_summary(
                    str(item.get("excerpt") or item.get("content") or ""),
                    limit=260,
                ),
                "document_id": str(item.get("document_id") or "").strip() or None,
                "chunk_id": str(item.get("chunk_id") or "").strip() or None,
                "source_type": str(item.get("source_type") or "").strip() or None,
                "source_uri": str(item.get("source_uri") or "").strip() or None,
                "score": round(float(item.get("score") or 0.0), 4) if item.get("score") is not None else None,
            }

        title = str(
            item.get("title")
            or item.get("name")
            or item.get("relative_path")
            or item.get("url")
            or "Source"
        ).strip()
        url = str(item.get("url") or item.get("source_uri") or "").strip()
        excerpt = self._compact_summary(
            str(item.get("excerpt") or item.get("content") or item.get("summary") or ""),
            limit=220,
        )
        if not title and not url:
            return None
        return {
            "agent": agent_name,
            "title": title or "Source",
            "url": url,
            "kind": "web" if tool_name == "web_search" else tool_name or "tool",
            "excerpt": excerpt or None,
        }

    def _citation_dedupe_key(self, citation: dict[str, Any]) -> str:
        return "|".join(
            filter(
                None,
                [
                    str(citation.get("kind") or ""),
                    str(citation.get("document_id") or ""),
                    str(citation.get("chunk_id") or ""),
                    str(citation.get("relative_path") or ""),
                    str(citation.get("url") or citation.get("source_uri") or ""),
                    str(citation.get("title") or ""),
                ],
            )
        )

    def _render_citation_catalog(self, citations: list[dict[str, Any]]) -> str:
        if not citations:
            return "No grounded sources were captured."
        lines: list[str] = []
        for citation in citations[:8]:
            parts = [
                f"[{citation['reference_id']}]",
                str(citation.get("title") or "Source"),
            ]
            if citation.get("kind"):
                parts.append(f"kind={citation['kind']}")
            if citation.get("source_type"):
                parts.append(f"source_type={citation['source_type']}")
            if citation.get("url"):
                parts.append(f"url={citation['url']}")
            elif citation.get("source_uri"):
                parts.append(f"source={citation['source_uri']}")
            if citation.get("score") is not None:
                parts.append(f"score={citation['score']}")
            line = " | ".join(parts)
            excerpt = str(citation.get("excerpt") or "").strip()
            if excerpt:
                line = f"{line}\nExcerpt: {excerpt}"
            lines.append(line)
        return "\n".join(lines)

    def _extract_citation_reference_ids(self, content: str) -> list[str]:
        return list(dict.fromkeys(re.findall(r"\[(S\d+)\]", content)))

    def _ensure_citation_references(self, content: str, citations: list[dict[str, Any]]) -> str:
        if not citations:
            return content
        if self._extract_citation_reference_ids(content):
            return content
        fallback_ids = ", ".join(f"[{citation['reference_id']}]" for citation in citations[:3])
        return f"{content.rstrip()}\n\nGrounding references: {fallback_ids}"

    def _finalize_citations(self, content: str, citations: list[dict[str, Any]]) -> list[dict[str, Any]]:
        referenced = set(self._extract_citation_reference_ids(content))
        if not referenced:
            return citations[:3]
        filtered = [citation for citation in citations if citation["reference_id"] in referenced]
        return filtered or citations[:3]

    def _extract_sentences(self, content: str, token: str) -> list[str]:
        lines = []
        for raw_line in content.splitlines():
            line = raw_line.strip(" -\t")
            if token in line.lower():
                lines.append(line)
        return lines[:3]

    def _compact_summary(self, value: str, limit: int = 220) -> str:
        compact = " ".join(value.split())
        return compact[:limit] + ("..." if len(compact) > limit else "")

    async def _emit(
        self,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None,
        event: str,
        payload: dict[str, Any],
    ) -> None:
        if event_handler is not None:
            await event_handler(event, payload)
