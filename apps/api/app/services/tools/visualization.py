from __future__ import annotations

import html
import json
import re
from typing import Any

from slugify import slugify

from app.services.tools.common import ToolRuntimeBase


class VisualizationDocumentationTool(ToolRuntimeBase):
    name = "visualization_docs"

    def detect_request_type(self, prompt: str) -> str | None:
        lowered = prompt.lower()
        if any(token in lowered for token in ("explain this code", "code explanation", "explain code", "walk me through this code")):
            return "code_explanation"
        if any(token in lowered for token in ("readme", "api docs", "api documentation", "onboarding", "developer guide", "documentation guide")):
            return "docs_bundle"
        if any(token in lowered for token in ("wireframe", "ux flow", "user flow", "journey map")):
            return "wireframe"
        if any(
            token in lowered
            for token in ("sequence diagram", "erd", "entity relationship", "flowchart", "architecture diagram", "svg diagram", "diagram")
        ):
            return "diagram"
        if any(token in lowered for token in ("mockup", "mock-up", "ui concept", "screen design", "high fidelity ui", "high-fidelity ui")):
            return "mockup"
        return None

    async def preview_request(self, prompt: str, *, preferred_type: str | None = None) -> dict[str, Any]:
        request_type = preferred_type or self.detect_request_type(prompt) or "docs_bundle"
        request = {"prompt": prompt, "preferred_type": preferred_type, "request_type": request_type}
        audit, started_at = self.start_audit("preview_request", request)
        title = self._derive_title(prompt, request_type)
        payload = {
            "request_type": request_type,
            "title": title,
            "recommended_action": self._recommended_action(request_type),
            "suggested_arguments": self._suggested_arguments(request_type, prompt=prompt, title=title),
            "notes": self._request_notes(request_type),
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload)
        return self.result(operation="preview_request", status="completed", payload=payload, audit=audit)

    async def generate_mockup(
        self,
        *,
        prompt: str,
        title: str | None = None,
        screen_type: str = "dashboard",
        fidelity: str = "high",
    ) -> dict[str, Any]:
        resolved_title = title or self._derive_title(prompt, "mockup")
        request = {
            "prompt": prompt,
            "title": resolved_title,
            "screen_type": screen_type,
            "fidelity": fidelity,
        }
        audit, started_at = self.start_audit("generate_mockup", request)
        spec = self._build_mockup_spec(prompt=prompt, title=resolved_title, screen_type=screen_type, fidelity=fidelity)
        svg = self._render_mockup_svg(spec)
        artifacts = [
            self._save_text_artifact(resolved_title, "mockup.svg", svg, "image/svg+xml"),
            self._save_json_artifact(resolved_title, "mockup-spec.json", spec),
        ]
        payload = {"title": resolved_title, "request_type": "mockup", "spec": spec, "artifacts": artifacts}
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=artifacts)
        return self.result(operation="generate_mockup", status="completed", payload=payload, audit=audit)

    async def generate_wireframe(
        self,
        *,
        prompt: str,
        title: str | None = None,
        flow_steps: list[str] | None = None,
    ) -> dict[str, Any]:
        resolved_title = title or self._derive_title(prompt, "wireframe")
        request = {"prompt": prompt, "title": resolved_title, "flow_steps": flow_steps or []}
        audit, started_at = self.start_audit("generate_wireframe", request)
        spec = self._build_wireframe_spec(prompt=prompt, title=resolved_title, flow_steps=flow_steps)
        svg = self._render_wireframe_svg(spec)
        artifacts = [
            self._save_text_artifact(resolved_title, "wireframe.svg", svg, "image/svg+xml"),
            self._save_json_artifact(resolved_title, "wireframe-spec.json", spec),
        ]
        payload = {"title": resolved_title, "request_type": "wireframe", "spec": spec, "artifacts": artifacts}
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=artifacts)
        return self.result(operation="generate_wireframe", status="completed", payload=payload, audit=audit)

    async def generate_svg_diagram(
        self,
        *,
        prompt: str,
        title: str | None = None,
        diagram_type: str | None = None,
    ) -> dict[str, Any]:
        resolved_title = title or self._derive_title(prompt, "diagram")
        resolved_type = (diagram_type or self._infer_diagram_type(prompt) or "architecture").strip().lower()
        request = {"prompt": prompt, "title": resolved_title, "diagram_type": resolved_type}
        audit, started_at = self.start_audit("generate_svg_diagram", request)
        spec = self._build_diagram_spec(prompt=prompt, title=resolved_title, diagram_type=resolved_type)
        svg = self._render_diagram_svg(spec)
        artifacts = [
            self._save_text_artifact(resolved_title, f"{resolved_type}.svg", svg, "image/svg+xml"),
            self._save_json_artifact(resolved_title, f"{resolved_type}-spec.json", spec),
        ]
        payload = {
            "title": resolved_title,
            "request_type": "diagram",
            "diagram_type": resolved_type,
            "spec": spec,
            "artifacts": artifacts,
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=artifacts)
        return self.result(operation="generate_svg_diagram", status="completed", payload=payload, audit=audit)

    async def generate_docs_bundle(
        self,
        *,
        prompt: str,
        title: str | None = None,
        include_readme: bool = True,
        include_api_docs: bool = True,
        include_onboarding: bool = True,
    ) -> dict[str, Any]:
        resolved_title = title or self._derive_title(prompt, "documentation")
        request = {
            "prompt": prompt,
            "title": resolved_title,
            "include_readme": include_readme,
            "include_api_docs": include_api_docs,
            "include_onboarding": include_onboarding,
        }
        audit, started_at = self.start_audit("generate_docs_bundle", request)
        artifacts: list[dict[str, Any]] = []
        bundle_manifest: dict[str, Any] = {
            "title": resolved_title,
            "request_type": "docs_bundle",
            "documents": [],
        }

        if include_readme:
            readme = self._render_readme(prompt=prompt, title=resolved_title)
            artifact = self._save_text_artifact(resolved_title, "README.md", readme, "text/markdown")
            artifacts.append(artifact)
            bundle_manifest["documents"].append({"kind": "readme", "storage_key": artifact["storage_key"]})
        if include_api_docs:
            api_docs = self._render_api_docs(prompt=prompt, title=resolved_title)
            artifact = self._save_text_artifact(resolved_title, "API-DOCS.md", api_docs, "text/markdown")
            artifacts.append(artifact)
            bundle_manifest["documents"].append({"kind": "api_docs", "storage_key": artifact["storage_key"]})
        if include_onboarding:
            onboarding = self._render_onboarding(prompt=prompt, title=resolved_title)
            artifact = self._save_text_artifact(resolved_title, "ONBOARDING.md", onboarding, "text/markdown")
            artifacts.append(artifact)
            bundle_manifest["documents"].append({"kind": "onboarding", "storage_key": artifact["storage_key"]})

        artifacts.append(self._save_json_artifact(resolved_title, "bundle-manifest.json", bundle_manifest))
        payload = {
            "title": resolved_title,
            "request_type": "docs_bundle",
            "document_count": len(bundle_manifest["documents"]),
            "artifacts": artifacts,
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=artifacts)
        return self.result(operation="generate_docs_bundle", status="completed", payload=payload, audit=audit)

    async def explain_code(
        self,
        *,
        code: str,
        title: str = "code-explanation",
        language: str | None = None,
        focus: str | None = None,
    ) -> dict[str, Any]:
        request = {"title": title, "language": language, "focus": focus}
        audit, started_at = self.start_audit("explain_code", request)
        summary = self._analyze_code(code=code, language=language, focus=focus)
        explanation = self._render_code_explanation(title=title, summary=summary, focus=focus)
        artifacts = [
            self._save_text_artifact(title, "code-explanation.md", explanation, "text/markdown"),
            self._save_json_artifact(title, "code-explanation.json", summary),
        ]
        payload = {
            "title": title,
            "request_type": "code_explanation",
            "summary": summary,
            "artifacts": artifacts,
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=artifacts)
        return self.result(operation="explain_code", status="completed", payload=payload, audit=audit)

    def _recommended_action(self, request_type: str) -> str:
        return {
            "mockup": "generate_mockup",
            "wireframe": "generate_wireframe",
            "diagram": "generate_svg_diagram",
            "docs_bundle": "generate_docs_bundle",
            "code_explanation": "explain_code",
        }.get(request_type, "generate_docs_bundle")

    def _suggested_arguments(self, request_type: str, *, prompt: str, title: str) -> dict[str, Any]:
        if request_type == "code_explanation":
            return {"action": "explain_code", "title": title, "code": "<paste code here>", "focus": prompt}
        if request_type == "diagram":
            return {
                "action": "generate_svg_diagram",
                "title": title,
                "prompt": prompt,
                "diagram_type": self._infer_diagram_type(prompt) or "architecture",
            }
        if request_type == "wireframe":
            return {"action": "generate_wireframe", "title": title, "prompt": prompt}
        if request_type == "mockup":
            return {"action": "generate_mockup", "title": title, "prompt": prompt, "screen_type": "dashboard"}
        return {"action": "generate_docs_bundle", "title": title, "prompt": prompt}

    def _request_notes(self, request_type: str) -> list[str]:
        notes = {
            "mockup": [
                "Generates an SVG mockup and a structured JSON spec.",
                "Best for dashboard screens, product concepts, and marketing-ready UI direction.",
            ],
            "wireframe": [
                "Generates a lower-fidelity SVG wireframe and a flow-oriented JSON spec.",
                "Best for UX journeys, handoff flows, and layout planning.",
            ],
            "diagram": [
                "Generates an SVG diagram plus a machine-readable diagram specification.",
                "Supports architecture diagrams, flowcharts, ERDs, and sequence views.",
            ],
            "docs_bundle": [
                "Creates README, API docs, onboarding material, and a manifest bundle.",
                "Best when the user asks for reusable documentation assets.",
            ],
            "code_explanation": [
                "Creates a human-readable markdown walkthrough and a structured JSON summary.",
                "Best when the user wants code explanation mode or onboarding help.",
            ],
        }
        return notes.get(request_type, ["Generates documentation and visualization artifacts."])

    def _derive_title(self, prompt: str, fallback: str) -> str:
        cleaned = re.sub(r"\s+", " ", prompt).strip()
        if not cleaned:
            return fallback.replace("_", " ").title()
        shortened = cleaned[:72].strip(" .:-")
        if len(cleaned) > 72:
            shortened = shortened.rstrip() + "..."
        return shortened

    def _infer_diagram_type(self, prompt: str) -> str | None:
        lowered = prompt.lower()
        if "sequence" in lowered:
            return "sequence"
        if "erd" in lowered or "entity relationship" in lowered:
            return "erd"
        if "flowchart" in lowered or "workflow" in lowered:
            return "flowchart"
        if "architecture" in lowered:
            return "architecture"
        return None

    def _save_text_artifact(self, title: str, filename: str, content: str, content_type: str) -> dict[str, Any]:
        base = slugify(title) or "visualization"
        key = f"visualization/{base}/{filename}"
        return {"storage_key": key, "path": self.storage.save_text(key, content), "content_type": content_type}

    def _save_json_artifact(self, title: str, filename: str, payload: dict[str, Any]) -> dict[str, Any]:
        base = slugify(title) or "visualization"
        key = f"visualization/{base}/{filename}"
        return {"storage_key": key, "path": self.storage.save_json(key, payload), "content_type": "application/json"}

    def _build_mockup_spec(self, *, prompt: str, title: str, screen_type: str, fidelity: str) -> dict[str, Any]:
        callouts = self._extract_callouts(prompt)[:3] or ["Primary metric", "Workflow status", "Recent activity"]
        return {
            "title": title,
            "screen_type": screen_type,
            "fidelity": fidelity,
            "headline": title,
            "subheadline": self._compact_text(prompt, limit=140),
            "panels": [
                {"label": "Navigation", "items": ["Overview", "Projects", "Automation", "Reports"]},
                {"label": "Primary view", "items": callouts},
                {"label": "Context rail", "items": ["Owner", "Status", "Next action"]},
            ],
            "cta_labels": ["Primary action", "Secondary action"],
        }

    def _build_wireframe_spec(self, *, prompt: str, title: str, flow_steps: list[str] | None) -> dict[str, Any]:
        steps = flow_steps or self._extract_flow_steps(prompt) or ["Entry", "Review", "Complete"]
        return {"title": title, "steps": steps[:5], "annotations": self._extract_callouts(prompt)[:4]}

    def _build_diagram_spec(self, *, prompt: str, title: str, diagram_type: str) -> dict[str, Any]:
        nodes = self._extract_diagram_nodes(prompt)
        if diagram_type == "sequence":
            return {
                "title": title,
                "diagram_type": diagram_type,
                "actors": nodes[:4] or ["User", "API", "Worker"],
                "messages": self._extract_sequence_messages(prompt),
            }
        if diagram_type == "erd":
            entities = nodes[:3] or ["Workspace", "Task", "Artifact"]
            return {
                "title": title,
                "diagram_type": diagram_type,
                "entities": [{"name": entity, "fields": ["id", "name", "created_at"]} for entity in entities],
            }
        return {
            "title": title,
            "diagram_type": diagram_type,
            "nodes": nodes[:4] or ["Client", "API", "Worker", "Storage"],
            "edges": self._pairwise_edges(nodes[:4] or ["Client", "API", "Worker", "Storage"]),
        }

    def _render_mockup_svg(self, spec: dict[str, Any]) -> str:
        nav_items = "".join(
            f'<text x="76" y="{170 + index * 34}" font-size="18" fill="#525252">{html.escape(item)}</text>'
            for index, item in enumerate(spec["panels"][0]["items"])
        )
        primary_items = "".join(
            f'<rect x="{368 + index * 210}" y="278" width="180" height="88" rx="18" fill="#f7f4ec" stroke="#ddd7c8"/>'
            f'<text x="{458 + index * 210}" y="326" font-size="16" text-anchor="middle" fill="#2f2f2f">{html.escape(item)}</text>'
            for index, item in enumerate(spec["panels"][1]["items"])
        )
        ctas = "".join(
            f'<rect x="{920 + index * 152}" y="118" width="132" height="42" rx="21" fill="{("#121212" if index == 0 else "#ffffff")}" stroke="#d7d1c4"/>'
            f'<text x="{986 + index * 152}" y="144" font-size="15" text-anchor="middle" fill="{("#ffffff" if index == 0 else "#444444")}">{html.escape(label)}</text>'
            for index, label in enumerate(spec["cta_labels"])
        )
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="960" viewBox="0 0 1440 960" fill="none">'
            '<rect width="1440" height="960" rx="36" fill="#fbfaf6"/>'
            '<rect x="36" y="36" width="248" height="888" rx="28" fill="#ffffff" stroke="#e8e2d6"/>'
            '<rect x="314" y="36" width="1090" height="888" rx="28" fill="#ffffff" stroke="#e8e2d6"/>'
            f'<text x="72" y="104" font-size="28" fill="#171717">{html.escape(spec["headline"])}</text>'
            f'<text x="364" y="108" font-size="44" fill="#171717">{html.escape(spec["headline"])}</text>'
            f'<text x="364" y="154" font-size="20" fill="#6a6a6a">{html.escape(spec["subheadline"])}</text>'
            '<text x="72" y="138" font-size="14" letter-spacing="4" fill="#9a9488">MAIN NAVIGATION</text>'
            f"{nav_items}"
            '<rect x="364" y="196" width="998" height="1" fill="#ebe5d9"/>'
            f"{ctas}"
            '<rect x="364" y="230" width="800" height="470" rx="30" fill="#fcfbf8" stroke="#e7e0d4"/>'
            '<rect x="1188" y="230" width="174" height="470" rx="26" fill="#fcfbf8" stroke="#e7e0d4"/>'
            '<text x="1218" y="282" font-size="14" letter-spacing="3" fill="#9a9488">CONTEXT</text>'
            '<text x="1218" y="326" font-size="18" fill="#333333">Owner</text>'
            '<text x="1218" y="360" font-size="18" fill="#333333">Status</text>'
            '<text x="1218" y="394" font-size="18" fill="#333333">Next action</text>'
            f"{primary_items}</svg>"
        )

    def _render_wireframe_svg(self, spec: dict[str, Any]) -> str:
        boxes = []
        for index, step in enumerate(spec["steps"]):
            x = 80 + index * 240
            boxes.append(
                f'<rect x="{x}" y="180" width="180" height="96" rx="16" fill="#ffffff" stroke="#c9c2b2" stroke-dasharray="8 6"/>'
                f'<text x="{x + 90}" y="235" font-size="18" text-anchor="middle" fill="#2f2f2f">{html.escape(step)}</text>'
            )
            if index < len(spec["steps"]) - 1:
                boxes.append(f'<line x1="{x + 180}" y1="228" x2="{x + 240}" y2="228" stroke="#a7a093" stroke-width="2"/>')
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" fill="none">'
            '<rect width="1280" height="720" rx="28" fill="#faf8f2"/>'
            f'<text x="72" y="88" font-size="34" fill="#1b1b1b">{html.escape(spec["title"])}</text>'
            '<text x="72" y="122" font-size="14" letter-spacing="4" fill="#9d988c">UX FLOW / WIREFRAME</text>'
            + "".join(boxes)
            + "</svg>"
        )

    def _render_diagram_svg(self, spec: dict[str, Any]) -> str:
        if spec["diagram_type"] == "sequence":
            actors = spec["actors"]
            messages = spec["messages"] or [{"from": actors[0], "to": actors[min(1, len(actors) - 1)], "label": "Request"}]
            columns = [180 + index * 220 for index in range(len(actors))]
            actor_labels = "".join(
                f'<text x="{x}" y="84" font-size="18" text-anchor="middle" fill="#1f1f1f">{html.escape(actor)}</text>'
                f'<line x1="{x}" y1="110" x2="{x}" y2="520" stroke="#bbb3a6" stroke-dasharray="7 7"/>'
                for actor, x in zip(actors, columns, strict=False)
            )
            arrows = "".join(
                self._sequence_arrow(columns, actors, message, index)
                for index, message in enumerate(messages[:5])
            )
            return (
                '<svg xmlns="http://www.w3.org/2000/svg" width="1180" height="620" viewBox="0 0 1180 620" fill="none">'
                '<rect width="1180" height="620" rx="28" fill="#fbfaf6"/>'
                f'<text x="64" y="52" font-size="30" fill="#161616">{html.escape(spec["title"])}</text>'
                + actor_labels
                + arrows
                + "</svg>"
            )
        if spec["diagram_type"] == "erd":
            entity_blocks = []
            for index, entity in enumerate(spec["entities"]):
                x = 80 + index * 320
                fields = "".join(
                    f'<text x="{x + 24}" y="{174 + field_index * 24}" font-size="15" fill="#4b4b4b">{html.escape(field)}</text>'
                    for field_index, field in enumerate(entity["fields"])
                )
                entity_blocks.append(
                    f'<rect x="{x}" y="110" width="240" height="160" rx="18" fill="#ffffff" stroke="#d8d1c3"/>'
                    f'<text x="{x + 24}" y="144" font-size="20" fill="#202020">{html.escape(entity["name"])}</text>'
                    f"{fields}"
                )
            return (
                '<svg xmlns="http://www.w3.org/2000/svg" width="1180" height="420" viewBox="0 0 1180 420" fill="none">'
                '<rect width="1180" height="420" rx="28" fill="#fbfaf6"/>'
                f'<text x="64" y="60" font-size="30" fill="#161616">{html.escape(spec["title"])}</text>'
                + "".join(entity_blocks)
                + "</svg>"
            )
        nodes = spec["nodes"]
        edges = spec["edges"]
        positions = [(140 + index * 250, 200 if index % 2 == 0 else 320) for index in range(len(nodes))]
        node_shapes = "".join(
            f'<rect x="{x}" y="{y}" width="180" height="84" rx="18" fill="#ffffff" stroke="#d8d1c3"/>'
            f'<text x="{x + 90}" y="{y + 48}" font-size="18" text-anchor="middle" fill="#202020">{html.escape(node)}</text>'
            for node, (x, y) in zip(nodes, positions, strict=False)
        )
        edge_lines = "".join(
            self._edge_line(nodes, positions, edge)
            for edge in edges
        )
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="620" viewBox="0 0 1280 620" fill="none">'
            '<rect width="1280" height="620" rx="28" fill="#fbfaf6"/>'
            f'<text x="64" y="60" font-size="30" fill="#161616">{html.escape(spec["title"])}</text>'
            + edge_lines
            + node_shapes
            + "</svg>"
        )

    def _render_readme(self, *, prompt: str, title: str) -> str:
        return "\n".join(
            [
                f"# {title}",
                "",
                "## Overview",
                self._compact_text(prompt, 260),
                "",
                "## Core Capabilities",
                "- Goal-driven workflows",
                "- Browser, research, coding, and documentation execution",
                "- Artifact generation and auditability",
                "",
                "## Quick Start",
                "1. Install dependencies.",
                "2. Configure environment variables.",
                "3. Start the application stack.",
                "",
                "## Recommended Next Steps",
                "- Add environment-specific deployment notes.",
                "- Add screenshots or diagrams where useful.",
            ]
        )

    def _render_api_docs(self, *, prompt: str, title: str) -> str:
        return "\n".join(
            [
                f"# {title} API Docs",
                "",
                "## Intent",
                self._compact_text(prompt, 220),
                "",
                "## Suggested Endpoints",
                "| Endpoint | Method | Purpose |",
                "| --- | --- | --- |",
                "| /health | GET | Health check and readiness signal |",
                "| /tasks | POST | Create a new autonomous task |",
                "| /tasks/{id} | GET | Inspect task status and outputs |",
                "| /artifacts/{id} | GET | Retrieve generated artifacts |",
            ]
        )

    def _render_onboarding(self, *, prompt: str, title: str) -> str:
        return "\n".join(
            [
                f"# {title} Onboarding Guide",
                "",
                "## First Week Goals",
                "- Understand the product outcome this workspace supports.",
                "- Run the app locally and review the main workflows.",
                "- Learn where generated artifacts and docs are stored.",
                "",
                "## Working Agreement",
                "- Prefer small, testable changes.",
                "- Keep run outputs and docs artifact-backed.",
                "- Use diagrams or mockups for ambiguous changes.",
                "",
                "## Context",
                self._compact_text(prompt, 220),
            ]
        )

    def _analyze_code(self, *, code: str, language: str | None, focus: str | None) -> dict[str, Any]:
        imports = re.findall(r"^(?:from\s+\S+\s+import\s+.+|import\s+.+)$", code, flags=re.MULTILINE)
        functions = re.findall(r"^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", code, flags=re.MULTILINE)
        classes = re.findall(r"^\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[:(]", code, flags=re.MULTILINE)
        lines = [line for line in code.splitlines() if line.strip()]
        return {
            "language": language or "text",
            "focus": focus,
            "line_count": len(code.splitlines()),
            "non_empty_lines": len(lines),
            "imports": imports[:8],
            "functions": functions[:12],
            "classes": classes[:8],
            "summary": f"Contains {len(classes)} class(es), {len(functions)} function(s), and {len(imports)} import statement(s).",
        }

    def _render_code_explanation(self, *, title: str, summary: dict[str, Any], focus: str | None) -> str:
        function_list = ", ".join(summary["functions"]) or "No named functions detected."
        class_list = ", ".join(summary["classes"]) or "No classes detected."
        return "\n".join(
            [
                f"# {title}",
                "",
                "## Summary",
                summary["summary"],
                "",
                "## Classes",
                class_list,
                "",
                "## Functions",
                function_list,
                "",
                "## Reading Notes",
                focus or "Focus on entry points, data flow, and side effects first.",
            ]
        )

    def _extract_callouts(self, prompt: str) -> list[str]:
        parts = re.split(r"[,.:\n]", prompt)
        callouts = [part.strip().title() for part in parts if 6 <= len(part.strip()) <= 40]
        return list(dict.fromkeys(callouts))

    def _extract_flow_steps(self, prompt: str) -> list[str]:
        matches = re.findall(r"\b(?:sign up|sign in|review|approve|publish|deploy|analyze|research|build|deliver)\b", prompt.lower())
        return [match.title() for match in dict.fromkeys(matches)]

    def _extract_diagram_nodes(self, prompt: str) -> list[str]:
        candidates = re.findall(r"\b[A-Z][a-zA-Z0-9_-]{2,}\b", prompt)
        cleaned = [candidate for candidate in candidates if candidate.lower() not in {"create", "design", "build"}]
        return list(dict.fromkeys(cleaned))

    def _extract_sequence_messages(self, prompt: str) -> list[dict[str, str]]:
        verbs = self._extract_flow_steps(prompt) or ["Request", "Validate", "Respond"]
        return [
            {"from": "User", "to": "System", "label": verbs[0]},
            {"from": "System", "to": "Worker", "label": verbs[1] if len(verbs) > 1 else "Process"},
            {"from": "Worker", "to": "System", "label": verbs[2] if len(verbs) > 2 else "Return"},
        ]

    def _pairwise_edges(self, nodes: list[str]) -> list[dict[str, str]]:
        return [{"from": nodes[index], "to": nodes[index + 1]} for index in range(len(nodes) - 1)]

    def _sequence_arrow(
        self,
        columns: list[int],
        actors: list[str],
        message: dict[str, str],
        index: int,
    ) -> str:
        from_index = actors.index(message["from"]) if message["from"] in actors else 0
        to_index = actors.index(message["to"]) if message["to"] in actors else min(1, len(actors) - 1)
        y = 150 + index * 70
        x1 = columns[from_index]
        x2 = columns[to_index]
        return (
            f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="#7b7468" stroke-width="2"/>'
            f'<text x="{(x1 + x2) / 2}" y="{y - 10}" font-size="14" text-anchor="middle" fill="#555555">{html.escape(message["label"])}</text>'
        )

    def _edge_line(self, nodes: list[str], positions: list[tuple[int, int]], edge: dict[str, str]) -> str:
        if edge["from"] not in nodes or edge["to"] not in nodes:
            return ""
        from_index = nodes.index(edge["from"])
        to_index = nodes.index(edge["to"])
        x1, y1 = positions[from_index]
        x2, y2 = positions[to_index]
        return f'<line x1="{x1 + 180}" y1="{y1 + 42}" x2="{x2}" y2="{y2 + 42}" stroke="#7b7468" stroke-width="2"/>'

    def _compact_text(self, value: str, limit: int) -> str:
        compact = re.sub(r"\s+", " ", value).strip()
        if len(compact) <= limit:
            return compact
        return compact[: max(limit - 3, 0)].rstrip() + "..."
