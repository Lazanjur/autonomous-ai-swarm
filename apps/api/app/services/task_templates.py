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
