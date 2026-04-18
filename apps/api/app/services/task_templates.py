from __future__ import annotations

from copy import deepcopy
from typing import Any


_TASK_TEMPLATES: list[dict[str, Any]] = [
    {
        "key": "site_qa_sweep",
        "name": "Website QA sweep",
        "category": "browser",
        "summary": "Open a live site, walk the primary flows, capture screenshots, and flag visible regressions.",
        "description": (
            "Best for release checks, stakeholder QA reviews, and quick website health passes "
            "where the browser session itself is part of the deliverable."
        ),
        "tags": ["browser", "qa", "release"],
        "capabilities": [
            "Navigate the core routes",
            "Capture screenshots and DOM snapshots",
            "Summarize layout and runtime issues",
        ],
        "recommended_operator_tab": "browser",
        "requires_approval": False,
        "chat_defaults": {
            "thread_title": "Website QA sweep",
            "prompt": (
                "Run a browser QA sweep for the target website. Open the main user-facing flows, "
                "capture screenshots, note broken layouts or runtime issues, and finish with a concise "
                "bug list plus recommended fixes."
            ),
            "model_profile": "qwen3.5-flash",
            "use_retrieval": False,
            "suggested_steps": [
                "Open the homepage and primary navigation routes",
                "Capture screenshots for any obvious UI or runtime breakages",
                "Summarize issues by severity with suggested fixes",
            ],
        },
        "automation_defaults": {
            "name": "Website QA sweep",
            "description": "Review a live site in the browser and send a release-ready QA summary.",
            "prompt": (
                "Run a browser QA sweep for {{target_url}}. Visit the main routes, capture screenshots "
                "for any issues, and produce a short release-readiness report with blockers, warnings, "
                "and recommended fixes."
            ),
            "schedule_hint": "daily@08:00",
            "timezone": "UTC",
            "use_retrieval": False,
            "requires_approval": False,
            "retry_limit": 1,
            "timeout_seconds": 1200,
            "notify_on": ["failed", "completed"],
            "steps": [
                "Visit the main public routes",
                "Capture evidence for visible issues",
                "Write a release-readiness summary",
            ],
        },
    },
    {
        "key": "competitor_research_capture",
        "name": "Competitor research capture",
        "category": "browser",
        "summary": "Browse competitor sites, extract key signals, and turn them into a reusable research brief.",
        "description": (
            "Useful for sales, strategy, and product research when we want grounded browsing evidence "
            "instead of a purely language-model summary."
        ),
        "tags": ["browser", "research", "strategy"],
        "capabilities": [
            "Open multiple sources in sequence",
            "Capture page excerpts and screenshots",
            "Summarize differentiators and pricing signals",
        ],
        "recommended_operator_tab": "browser",
        "requires_approval": False,
        "chat_defaults": {
            "thread_title": "Competitor research capture",
            "prompt": (
                "Research the specified competitors in the browser. Capture the most important positioning, "
                "pricing, workflow, and messaging evidence, then synthesize it into a structured brief "
                "with citations and action-oriented takeaways."
            ),
            "model_profile": "qwen3.6-plus",
            "use_retrieval": True,
            "suggested_steps": [
                "Visit each competitor source",
                "Extract pricing, positioning, and workflow evidence",
                "Summarize differentiators and opportunities",
            ],
        },
        "automation_defaults": {
            "name": "Competitor research capture",
            "description": "Capture recurring competitor signals and turn them into a concise strategic brief.",
            "prompt": (
                "Review the configured competitor sources in the browser, capture pricing and positioning "
                "changes, and produce a concise brief with screenshots, citations, and action items."
            ),
            "schedule_hint": "weekly:mon@09:00",
            "timezone": "UTC",
            "use_retrieval": True,
            "requires_approval": False,
            "retry_limit": 2,
            "timeout_seconds": 1500,
            "notify_on": ["failed", "completed"],
            "steps": [
                "Review competitor sources",
                "Capture changes in positioning or pricing",
                "Deliver a strategic brief with evidence",
            ],
        },
    },
    {
        "key": "form_submission_draft",
        "name": "Form submission draft",
        "category": "browser",
        "summary": "Prepare browser form entries and stop at the approval boundary before any risky submission.",
        "description": (
            "Designed for workflows that involve contact forms, partner applications, or other outbound "
            "actions where a human should approve the final step."
        ),
        "tags": ["browser", "approval", "outreach"],
        "capabilities": [
            "Open and inspect the target workflow",
            "Prepare form values and navigation steps",
            "Pause before the final sensitive action",
        ],
        "recommended_operator_tab": "browser",
        "requires_approval": True,
        "chat_defaults": {
            "thread_title": "Form submission draft",
            "prompt": (
                "Open the target browser workflow, inspect the form or step sequence, prepare the required "
                "inputs, and stop before the final sensitive action so I can approve or reject the submission."
            ),
            "model_profile": "qwen3-vl-plus",
            "use_retrieval": False,
            "suggested_steps": [
                "Inspect the target flow and required inputs",
                "Prepare the draft submission path",
                "Pause for human approval before the final action",
            ],
        },
        "automation_defaults": {
            "name": "Approval-gated browser action",
            "description": "Prepare a browser workflow and wait for approval before any outbound action.",
            "prompt": (
                "Open the configured browser workflow, prepare the required fields or navigation steps, and "
                "pause for human approval before any final submission, send, or publish action."
            ),
            "schedule_hint": "weekly:fri@14:00",
            "timezone": "UTC",
            "use_retrieval": False,
            "requires_approval": True,
            "retry_limit": 1,
            "timeout_seconds": 1200,
            "notify_on": ["approval_requested", "failed", "rejected"],
            "steps": [
                "Open the target browser flow",
                "Prepare the draft action",
                "Stop and request approval",
            ],
        },
    },
    {
        "key": "repo_debug_and_fix",
        "name": "Repo debug and fix",
        "category": "computer",
        "summary": "Inspect a repo, run code/tests, iterate in the terminal, and propose or apply the fix.",
        "description": (
            "A coding-first workflow for debugging build failures, broken tests, or runtime regressions "
            "while keeping the operator pane focused on files and terminal output."
        ),
        "tags": ["computer", "coding", "terminal"],
        "capabilities": [
            "Inspect files and git status",
            "Run commands and capture terminal output",
            "Edit code and summarize the fix",
        ],
        "recommended_operator_tab": "terminal",
        "requires_approval": False,
        "chat_defaults": {
            "thread_title": "Repo debug and fix",
            "prompt": (
                "Debug the repository issue step by step. Inspect the relevant files, run the necessary terminal "
                "commands, make the smallest correct code changes, and finish with a concise explanation of what "
                "was wrong, what changed, and how to verify it."
            ),
            "model_profile": "qwen3-coder-plus",
            "use_retrieval": False,
            "suggested_steps": [
                "Inspect the relevant files and repo status",
                "Run the failing command or test path",
                "Apply the fix and explain verification",
            ],
        },
        "automation_defaults": {
            "name": "Repo health debug run",
            "description": "Run a coding-focused health pass for a repository and summarize failures or fixes.",
            "prompt": (
                "Inspect the configured repository, run the target health checks, capture terminal output, and "
                "produce a concise engineering summary with failures, likely causes, and recommended fixes."
            ),
            "schedule_hint": "daily@07:30",
            "timezone": "UTC",
            "use_retrieval": False,
            "requires_approval": False,
            "retry_limit": 1,
            "timeout_seconds": 1800,
            "notify_on": ["failed", "completed"],
            "steps": [
                "Inspect repo status and relevant files",
                "Run target checks in the terminal",
                "Produce a concise engineering summary",
            ],
        },
    },
    {
        "key": "artifact_delivery_builder",
        "name": "Artifact delivery builder",
        "category": "computer",
        "summary": "Turn inputs into a polished document, deck, spreadsheet, or previewable deliverable.",
        "description": (
            "This template is for knowledge-heavy creation work where the end product matters as much as the "
            "conversation: reports, decks, exports, and other stakeholder-ready artifacts."
        ),
        "tags": ["computer", "artifact", "delivery"],
        "capabilities": [
            "Collect the relevant inputs",
            "Generate output artifacts",
            "Present a preview-ready final deliverable",
        ],
        "recommended_operator_tab": "preview",
        "requires_approval": False,
        "chat_defaults": {
            "thread_title": "Artifact delivery builder",
            "prompt": (
                "Gather the relevant source material, create the requested deliverable, and present it as a polished "
                "artifact with a short summary of what was produced and any assumptions that still need review."
            ),
            "model_profile": "qwen3.5-plus",
            "use_retrieval": True,
            "suggested_steps": [
                "Collect the required source material",
                "Generate the requested artifact",
                "Summarize what was delivered and any remaining assumptions",
            ],
        },
        "automation_defaults": {
            "name": "Artifact delivery builder",
            "description": "Generate a polished recurring deliverable such as a report, deck, or spreadsheet.",
            "prompt": (
                "Use the configured sources to generate the target artifact, store the output, and summarize what "
                "was delivered along with any unresolved assumptions."
            ),
            "schedule_hint": "weekly:mon@08:30",
            "timezone": "UTC",
            "use_retrieval": True,
            "requires_approval": False,
            "retry_limit": 2,
            "timeout_seconds": 1800,
            "notify_on": ["failed", "completed"],
            "steps": [
                "Collect the configured sources",
                "Generate the target deliverable",
                "Publish a concise delivery summary",
            ],
        },
    },
    {
        "key": "release_readiness_command_center",
        "name": "Release readiness command center",
        "category": "computer",
        "summary": "Blend browser checks, code inspection, and deliverables into one coordinated release pass.",
        "description": (
            "A fuller operating workflow for launches where we want one task to coordinate browser QA, code "
            "verification, and final release notes."
        ),
        "tags": ["computer", "browser", "release"],
        "capabilities": [
            "Coordinate browser and repo checks",
            "Collect evidence from multiple tools",
            "Produce a release-ready summary artifact",
        ],
        "recommended_operator_tab": "computer",
        "requires_approval": False,
        "chat_defaults": {
            "thread_title": "Release readiness command center",
            "prompt": (
                "Coordinate a release-readiness pass. Inspect the relevant repo state, run the key checks, review "
                "the live experience in the browser where needed, and finish with a release note that clearly "
                "separates blockers, warnings, and go-live recommendations."
            ),
            "model_profile": "qwen3-max",
            "use_retrieval": True,
            "suggested_steps": [
                "Inspect repo and runtime health",
                "Run browser and terminal validation where needed",
                "Publish a release-readiness summary",
            ],
        },
        "automation_defaults": {
            "name": "Release readiness command center",
            "description": "Run a coordinated release-readiness pass across browser, repo, and deliverables.",
            "prompt": (
                "Coordinate the configured release-readiness workflow, combining repo checks, browser review, and "
                "final release notes with clear blockers and go-live recommendations."
            ),
            "schedule_hint": "weekly:thu@15:00",
            "timezone": "UTC",
            "use_retrieval": True,
            "requires_approval": False,
            "retry_limit": 2,
            "timeout_seconds": 2100,
            "notify_on": ["failed", "completed"],
            "steps": [
                "Inspect repo and runtime health",
                "Capture browser evidence where needed",
                "Publish a release-readiness summary",
            ],
        },
    },
    {
        "key": "autonomous_app_builder",
        "name": "Autonomous app builder",
        "category": "computer",
        "summary": "Coordinate research, coding, testing, and delivery to ship a full-stack product slice end to end.",
        "description": (
            "A premium builder workflow for turning a product brief into a working frontend, backend, and data model "
            "with an explicit tester pass before delivery."
        ),
        "tags": ["computer", "builder", "product", "swarm"],
        "capabilities": [
            "Plan the product slice and technical architecture",
            "Implement frontend, backend, and database changes",
            "Run verification before packaging the delivery",
        ],
        "recommended_operator_tab": "computer",
        "requires_approval": False,
        "chat_defaults": {
            "thread_title": "Autonomous app builder",
            "prompt": (
                "Build the requested product slice end to end. Plan the architecture, implement the frontend, "
                "backend, and database changes, run a tester pass to catch regressions, and finish with a clear "
                "delivery summary plus the best next product iteration."
            ),
            "model_profile": "qwen3-max",
            "use_retrieval": True,
            "suggested_steps": [
                "Plan the product slice and architecture",
                "Implement the necessary frontend, backend, and data-model changes",
                "Run a tester pass and summarize what shipped next",
            ],
        },
        "automation_defaults": {
            "name": "Autonomous app builder",
            "description": "Build and verify a full-stack product slice with a coding-plus-tester swarm.",
            "prompt": (
                "Build the configured product slice end to end, including architecture planning, implementation, "
                "verification, and a concise delivery summary with next steps."
            ),
            "schedule_hint": "weekly:tue@09:00",
            "timezone": "UTC",
            "use_retrieval": True,
            "requires_approval": False,
            "retry_limit": 2,
            "timeout_seconds": 2400,
            "notify_on": ["failed", "completed"],
            "steps": [
                "Plan the architecture and work breakdown",
                "Implement the product slice",
                "Verify the build and summarize delivery",
            ],
        },
    },
    {
        "key": "live_debugging_assistant",
        "name": "Live debugging assistant",
        "category": "computer",
        "summary": "Monitor logs, reproduce failures, fix the issue, and verify the repair in one coordinated run.",
        "description": (
            "A premium debugging workflow for incidents, broken deploys, failing tests, or runtime regressions "
            "where coding and verification should stay tightly coupled."
        ),
        "tags": ["computer", "debug", "incident", "qa"],
        "capabilities": [
            "Inspect logs and runtime evidence",
            "Apply the smallest correct fix",
            "Verify the repair with a tester pass",
        ],
        "recommended_operator_tab": "terminal",
        "requires_approval": False,
        "chat_defaults": {
            "thread_title": "Live debugging assistant",
            "prompt": (
                "Act as a live debugging assistant. Inspect the relevant logs and failing checks, reproduce the issue, "
                "apply the smallest correct fix, run a tester pass, and finish with a short incident summary."
            ),
            "model_profile": "qwen3-coder-plus",
            "use_retrieval": False,
            "suggested_steps": [
                "Inspect the failing logs and symptoms",
                "Fix the issue in code or configuration",
                "Verify the repair and summarize impact",
            ],
        },
        "automation_defaults": {
            "name": "Live debugging assistant",
            "description": "Monitor a target debugging workflow, fix the issue, and report the verified result.",
            "prompt": (
                "Inspect the configured failing workflow, reproduce the problem, apply the fix, run verification, "
                "and return a concise incident summary with what changed."
            ),
            "schedule_hint": "daily@06:30",
            "timezone": "UTC",
            "use_retrieval": False,
            "requires_approval": False,
            "retry_limit": 2,
            "timeout_seconds": 2100,
            "notify_on": ["failed", "completed"],
            "steps": [
                "Inspect the runtime evidence",
                "Apply the fix",
                "Run verification and summarize the outcome",
            ],
        },
    },
    {
        "key": "team_delivery_swarm",
        "name": "Team delivery swarm",
        "category": "computer",
        "summary": "Run a shared multi-agent task with explicit handoffs, task memory, and collaborator-friendly outputs.",
        "description": (
            "A premium shared-work mode for teams that want coder, tester, and researcher behavior to stay visible "
            "inside one task with durable shared context."
        ),
        "tags": ["computer", "team", "swarm", "handoff"],
        "capabilities": [
            "Coordinate researcher, coder, and tester roles",
            "Preserve shared task memory and handoffs",
            "Produce a collaborator-ready delivery update",
        ],
        "recommended_operator_tab": "computer",
        "requires_approval": False,
        "chat_defaults": {
            "thread_title": "Team delivery swarm",
            "prompt": (
                "Coordinate this as a team delivery swarm. Use the right mix of research, coding, and tester work, "
                "preserve the important shared context, and finish with a collaborator-friendly status update plus "
                "the next best handoff options."
            ),
            "model_profile": "qwen3-max",
            "use_retrieval": True,
            "suggested_steps": [
                "Coordinate the right specialist roles",
                "Preserve the shared task context and handoffs",
                "Deliver a collaborator-friendly summary",
            ],
        },
        "automation_defaults": {
            "name": "Team delivery swarm",
            "description": "Run a shared multi-agent delivery workflow and summarize the latest handoff-ready state.",
            "prompt": (
                "Coordinate the configured task as a shared delivery swarm, preserve shared context, and return a "
                "clear collaborator-ready summary with next handoff options."
            ),
            "schedule_hint": "weekly:wed@10:00",
            "timezone": "UTC",
            "use_retrieval": True,
            "requires_approval": False,
            "retry_limit": 2,
            "timeout_seconds": 1800,
            "notify_on": ["failed", "completed"],
            "steps": [
                "Coordinate specialist roles",
                "Update the shared task memory",
                "Publish a collaborator-ready summary",
            ],
        },
    },
]


def list_task_templates() -> list[dict[str, Any]]:
    return deepcopy(_TASK_TEMPLATES)


def get_task_template(template_key: str | None) -> dict[str, Any] | None:
    if not template_key:
        return None
    for template in _TASK_TEMPLATES:
        if template["key"] == template_key:
            return deepcopy(template)
    return None
