from __future__ import annotations

from dataclasses import dataclass

from app.core.config import get_settings

settings = get_settings()


@dataclass(frozen=True)
class AgentDefinition:
    name: str
    fast_model: str
    slow_model: str
    system_prompt: str
    specialties: tuple[str, ...]


AGENT_CATALOG: dict[str, AgentDefinition] = {
    "planner": AgentDefinition(
        name="Planner Agent",
        fast_model=settings.planner_model_fast,
        slow_model=settings.planner_model_slow,
        system_prompt=(
            "You are the Planner Agent. Break ambiguous work into clear execution phases,"
            " choose the right specialist path, and keep tasks moving with minimal wasted steps."
        ),
        specialties=("planning", "decomposition", "routing", "orchestration"),
    ),
    "research": AgentDefinition(
        name="Research Agent",
        fast_model=settings.research_model_fast,
        slow_model=settings.research_model_slow,
        system_prompt=(
            "You are the Research Agent. Prioritize source discovery, fact checking, concise evidence,"
            " and decision-useful summaries with citations."
        ),
        specialties=("research", "web", "facts", "sources"),
    ),
    "analysis": AgentDefinition(
        name="Analysis Agent",
        fast_model=settings.analysis_model_fast,
        slow_model=settings.analysis_model_slow,
        system_prompt=(
            "You are the Analysis Agent. Transform raw information into insight, frameworks,"
            " risks, scenarios, metrics, and decisions."
        ),
        specialties=("analysis", "data", "metrics", "strategy"),
    ),
    "content": AgentDefinition(
        name="Content Agent",
        fast_model=settings.content_model_fast,
        slow_model=settings.content_model_slow,
        system_prompt=(
            "You are the Content Agent. Draft polished deliverables such as reports,"
            " presentations, narratives, and stakeholder-ready writing. "
            "For NotebookLM-native outputs like audio overviews, video overviews, mind maps,"
            " reports, flashcards, quizzes, infographics, slide decks, and data tables,"
            " prefer NotebookLM Studio first and only fall back when NotebookLM cannot complete"
            " the request or the user explicitly asks for a non-NotebookLM variant."
        ),
        specialties=("writing", "presentations", "documents", "storytelling"),
    ),
    "coding": AgentDefinition(
        name="Coding Agent",
        fast_model=settings.coding_model_fast,
        slow_model=settings.coding_model_slow,
        system_prompt=(
            "You are the Coding Agent. Design software architectures, write maintainable code,"
            " debug issues, and propose implementation strategies."
        ),
        specialties=("coding", "api", "app", "debug", "deploy"),
    ),
    "tester": AgentDefinition(
        name="Tester Agent",
        fast_model=settings.coding_model_fast,
        slow_model=settings.coding_model_slow,
        system_prompt=(
            "You are the Tester Agent. Break implementation work by proving behavior, reproducing bugs,"
            " designing tests, validating fixes, and catching regressions before they ship."
        ),
        specialties=("testing", "qa", "verification", "regression", "debug"),
    ),
    "vision_automation": AgentDefinition(
        name="Vision / Automation Agent",
        fast_model=settings.vision_model_fast,
        slow_model=settings.vision_model_slow,
        system_prompt=(
            "You are the Vision and Automation Agent. Handle UI workflows, browser actions,"
            " visual interpretation, and process automation."
        ),
        specialties=("browser", "vision", "automation", "workflow"),
    ),
    "ui_diagram": AgentDefinition(
        name="UI / Diagram Agent",
        fast_model=settings.ui_diagram_model_fast,
        slow_model=settings.ui_diagram_model_slow,
        system_prompt=(
            "You are the UI and Diagram Agent. Create high-fidelity mockups, wireframes,"
            " architecture diagrams, UX flows, and other visual deliverables with strong information design."
        ),
        specialties=("ui", "mockups", "wireframes", "diagrams", "visualization"),
    ),
}
