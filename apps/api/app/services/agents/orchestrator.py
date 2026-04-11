from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from collections import defaultdict
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
    completed_agents: list[str] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    open_questions: list[str] = field(default_factory=list)
    tool_observations: list[dict[str, Any]] = field(default_factory=list)
    validation_notes: list[str] = field(default_factory=list)


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
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        plan = self.build_plan(prompt)
        execution_batches = self._execution_batches(plan)
        scratchpad = ExecutionScratchpad(user_request=prompt)
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

        synthesis = await self.router.complete(
            settings.supervisor_model,
            (
                "You are the supervisor for a multi-agent AI swarm. Synthesize agent outputs into one"
                " cohesive answer with clear sections for outcome, key findings, risks, and next steps."
            ),
            self._build_synthesis_prompt(prompt, step_results, scratchpad),
            metadata={
                **(metadata or {}),
                "agent_key": "supervisor",
                "operation": "synthesis",
            },
        )

        return {
            "plan": [asdict(task) for task in plan],
            "execution_batches": [[task.key for task in batch] for batch in execution_batches],
            "steps": step_results,
            "final_response": synthesis.content,
            "summary": self._summarize(step_results),
            "citations": self._collect_citations(step_results),
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
        tool_context = await self.tools.preflight(task.key, prompt)
        fast_result = await self._run_agent(
            definition,
            prompt,
            task,
            tool_context,
            scratchpad_snapshot,
            metadata,
            slow=False,
        )
        validation = self._validate_result(task, fast_result["content"], tool_context)
        confidence = self._confidence_score(fast_result["content"], tool_context, validation)
        result = fast_result | {
            "confidence": confidence,
            "step_index": task.plan_index,
            "dependencies": list(task.dependencies),
            "execution_mode": task.execution_mode,
            "batch_index": batch_index,
            "tools": tool_context,
            "validation": validation,
            "expected_output": task.expected_output,
        }

        if self._should_escalate(prompt, task, fast_result, validation):
            await self._emit(
                event_handler,
                "step.escalated",
                {
                    "step_index": task.plan_index,
                    "batch_index": batch_index,
                    "agent_key": task.key,
                    "agent_name": definition.name,
                    "status": "escalating",
                    "validation": validation,
                },
            )
            slow_result = await self._run_agent(
                definition,
                prompt,
                task,
                tool_context,
                scratchpad_snapshot,
                metadata,
                slow=True,
                feedback=validation["summary"],
            )
            slow_validation = self._validate_result(task, slow_result["content"], tool_context)
            slow_confidence = self._confidence_score(
                slow_result["content"], tool_context, slow_validation
            )
            if slow_confidence >= confidence:
                result = slow_result | {
                    "confidence": slow_confidence,
                    "step_index": task.plan_index,
                    "dependencies": list(task.dependencies),
                    "execution_mode": task.execution_mode,
                    "batch_index": batch_index,
                    "tools": tool_context,
                    "validation": slow_validation | {"escalated_from_fast": True},
                    "expected_output": task.expected_output,
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
        return (
            f"Primary request:\n{prompt}\n\n"
            f"Current agent objective:\n{task.objective}\n\n"
            f"Reason selected:\n{task.reason}\n\n"
            f"Expected output:\n{task.expected_output}\n\n"
            f"Dependencies already completed:\n{task.dependencies or 'None'}\n\n"
            f"Shared scratchpad snapshot:\n{scratchpad_snapshot}\n\n"
            f"Available tool context:\n{tool_context}\n\n"
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
            ("content", ("write", "report", "presentation", "deck", "article", "copy", "summarize")),
            ("coding", ("build", "code", "api", "website", "app", "debug", "deploy", "implement")),
            (
                "vision_automation",
                ("browser", "automation", "workflow", "ui", "image", "visual", "click", "navigate"),
            ),
        ]
        for key, keywords in rules:
            if any(keyword in lowered for keyword in keywords):
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
            "completed_agents": scratchpad.completed_agents[-6:],
            "findings": scratchpad.findings[-6:],
            "risks": scratchpad.risks[-6:],
            "open_questions": scratchpad.open_questions[-6:],
            "tool_observations": scratchpad.tool_observations[-6:],
            "validation_notes": scratchpad.validation_notes[-6:],
        }

    def _build_synthesis_prompt(
        self,
        prompt: str,
        step_results: list[dict[str, Any]],
        scratchpad: ExecutionScratchpad,
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
        return (
            f"User request:\n{prompt}\n\n"
            f"Execution scratchpad:\n{self._scratchpad_view(scratchpad)}\n\n"
            f"Agent outputs:\n{rendered}\n\n"
            "Return a polished response with:\n"
            "- Executive summary\n"
            "- Recommended plan\n"
            "- Risks and controls\n"
            "- Suggested artifacts or follow-up tasks\n"
        )

    def _summarize(self, step_results: list[dict[str, Any]]) -> str:
        labels = ", ".join(step["agent_name"] for step in step_results)
        batches = sorted({step["batch_index"] for step in step_results})
        return (
            f"Supervisor coordinated {len(step_results)} agents across {len(batches)} execution batches: {labels}."
        )

    def _collect_citations(self, step_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        citations: list[dict[str, Any]] = []
        for step in step_results:
            for tool in step.get("tools", []):
                if tool.get("results"):
                    for item in tool["results"]:
                        citations.append(
                            {
                                "agent": step["agent_name"],
                                "title": item.get("title", "Source"),
                                "url": item.get("url", ""),
                            }
                        )
        return citations

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
