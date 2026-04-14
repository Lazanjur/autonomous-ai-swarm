from __future__ import annotations

import os
import inspect
import importlib
import importlib.util
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.services.tools.common import ToolRuntimeBase

settings = get_settings()


class NotebookLMStudioTool(ToolRuntimeBase):
    name = "notebooklm_studio"

    OUTPUT_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("audio_overview", ("audio overview", "podcast", "podcasts")),
        ("video_overview", ("video overview", "video summary", "video recap")),
        ("mind_map", ("mind map", "mindmap")),
        ("report", ("report", "briefing doc", "study guide")),
        ("flashcards", ("flashcards", "flashcard")),
        ("quiz", ("quiz", "quizzes")),
        ("infographic", ("infographic", "infographics")),
        ("slide_deck", ("slide deck", "slidedeck", "presentation deck")),
        ("data_table", ("data table", "data-table")),
    )
    OUTPUT_EXTENSIONS = {
        "audio_overview": "mp3",
        "video_overview": "mp4",
        "mind_map": "json",
        "report": "md",
        "flashcards": "json",
        "quiz": "json",
        "infographic": "png",
        "slide_deck": "pdf",
        "data_table": "csv",
    }
    DEFAULT_FILE_STEMS = {
        "audio_overview": "audio-overview",
        "video_overview": "video-overview",
        "mind_map": "mind-map",
        "report": "report",
        "flashcards": "flashcards",
        "quiz": "quiz",
        "infographic": "infographic",
        "slide_deck": "slide-deck",
        "data_table": "data-table",
    }
    GENERATE_METHOD_CANDIDATES = {
        "audio_overview": ("generate_audio", "generate_audio_overview"),
        "video_overview": ("generate_video", "generate_video_overview"),
        "mind_map": ("generate_mind_map", "generate_mindmap"),
        "report": ("generate_report", "generate_briefing_doc"),
        "flashcards": ("generate_flashcards", "generate_flash_cards"),
        "quiz": ("generate_quiz", "generate_quizzes"),
        "infographic": ("generate_infographic", "generate_infographics"),
        "slide_deck": ("generate_slide_deck", "generate_slidedeck"),
        "data_table": ("generate_data_table", "generate_datatable"),
    }
    DOWNLOAD_METHOD_CANDIDATES = {
        "audio_overview": ("download_audio", "download_audio_overview"),
        "video_overview": ("download_video", "download_video_overview"),
        "mind_map": ("download_mind_map", "download_mindmap"),
        "report": ("download_report",),
        "flashcards": ("download_flashcards", "download_flash_cards"),
        "quiz": ("download_quiz", "download_quizzes"),
        "infographic": ("download_infographic", "download_infographics"),
        "slide_deck": ("download_slide_deck", "download_slidedeck"),
        "data_table": ("download_data_table", "download_datatable"),
    }

    def __init__(self) -> None:
        super().__init__()
        default_root = Path(__file__).resolve().parents[5] / "var" / "notebooklm"
        self.storage_root = Path(settings.notebooklm_storage_dir or default_root).resolve()
        self.run_workspace_root = self.storage_root / "runs"
        self.storage_root.mkdir(parents=True, exist_ok=True)
        self.run_workspace_root.mkdir(parents=True, exist_ok=True)

    def detect_output_type(self, prompt: str) -> str | None:
        lowered = prompt.lower()
        for output_type, keywords in self.OUTPUT_RULES:
            if any(keyword in lowered for keyword in keywords):
                return output_type
        if "podcast" in lowered:
            return "audio_overview"
        if "flashcard" in lowered:
            return "flashcards"
        if "quiz" in lowered:
            return "quiz"
        if "mind map" in lowered or "mindmap" in lowered:
            return "mind_map"
        if "infographic" in lowered:
            return "infographic"
        if "slide" in lowered and "deck" in lowered:
            return "slide_deck"
        return None

    async def capabilities(self) -> dict[str, Any]:
        request = {"operation": "capabilities"}
        audit, started_at = self.start_audit("capabilities", request)
        payload = {
            "enabled": settings.notebooklm_enabled,
            "installed": self._package_installed(),
            "requires_interactive_login": True,
            "preferred_outputs": [output_type for output_type, _ in self.OUTPUT_RULES],
            "notes": [
                "NotebookLM is preferred for audio overviews, videos, mind maps, reports, flashcards, quizzes, infographics, slide decks, and data tables.",
                "Authentication relies on notebooklm-py browser-backed storage and may require an interactive NotebookLM login before first use.",
            ],
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload)
        return self.result(operation="capabilities", status="completed", payload=payload, audit=audit)

    async def preview_request(
        self,
        prompt: str,
        *,
        output_type: str | None = None,
    ) -> dict[str, Any]:
        request = {"prompt_preview": prompt[:240], "output_type": output_type}
        audit, started_at = self.start_audit("preview_request", request)
        detected_output = output_type or self.detect_output_type(prompt)
        payload = {
            "preferred": bool(detected_output),
            "output_type": detected_output,
            "enabled": settings.notebooklm_enabled,
            "installed": self._package_installed(),
            "requires_sources": True,
            "source_strategy": [
                "Reuse grounded URLs collected earlier in the run.",
                "Upload an execution brief as a NotebookLM source bundle.",
                "Fall back to non-NotebookLM generation only if NotebookLM cannot fulfill the request.",
            ],
            "auth_hint": (
                "NotebookLM login may be required before first use. "
                "If no stored session exists, provide credentials or run notebooklm login."
            ),
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload)
        return self.result(operation="preview_request", status="completed", payload=payload, audit=audit)

    async def generate_deliverable(
        self,
        *,
        prompt: str,
        output_type: str | None = None,
        notebook_name: str | None = None,
        title: str | None = None,
        instructions: str | None = None,
        source_urls: list[str] | None = None,
        source_paths: list[str] | None = None,
        source_bundle_text: str | None = None,
        output_format: str | None = None,
        language: str | None = None,
    ) -> dict[str, Any]:
        request = {
            "output_type": output_type,
            "notebook_name": notebook_name,
            "title": title,
            "url_count": len(source_urls or []),
            "path_count": len(source_paths or []),
            "has_bundle_text": bool(source_bundle_text),
            "output_format": output_format,
            "language": language,
        }
        audit, started_at = self.start_audit("generate_deliverable", request)

        resolved_output = output_type or self.detect_output_type(prompt)
        if not resolved_output:
            error = "NotebookLM could not infer a supported deliverable type from the request."
            audit = self.finalize_audit(audit, started_at, status="failed", error=error)
            return self.result(
                operation="generate_deliverable",
                status="failed",
                payload={"error": error, "supported_outputs": list(self.OUTPUT_EXTENSIONS)},
                audit=audit,
            )

        if not settings.notebooklm_enabled:
            error = "NotebookLM routing is disabled in the current environment."
            audit = self.finalize_audit(audit, started_at, status="failed", error=error)
            return self.result(
                operation="generate_deliverable",
                status="failed",
                payload={"error": error, "output_type": resolved_output},
                audit=audit,
            )

        if not self._package_installed():
            error = (
                "notebooklm-py is not installed. Run `pip install notebooklm-py` "
                "and, if browser login is needed, install the browser extra as well."
            )
            audit = self.finalize_audit(audit, started_at, status="failed", error=error)
            return self.result(
                operation="generate_deliverable",
                status="failed",
                payload={"error": error, "output_type": resolved_output},
                audit=audit,
            )

        try:
            client_factory = self._load_client_factory()
            workspace = self.run_workspace_root / audit["run_id"]
            workspace.mkdir(parents=True, exist_ok=True)
            async with await client_factory() as client:
                notebook = await self._create_notebook(
                    client,
                    notebook_name or title or self._default_notebook_name(prompt, resolved_output),
                )
                notebook_id = self._read_attr(notebook, "id")
                if not notebook_id:
                    raise RuntimeError("NotebookLM create call did not return a notebook id.")

                added_sources = await self._attach_sources(
                    client,
                    notebook_id,
                    workspace=workspace,
                    source_urls=source_urls or [],
                    source_paths=source_paths or [],
                    source_bundle_text=source_bundle_text or self._default_source_bundle(prompt, resolved_output),
                )

                artifact_record = await self._generate_and_download(
                    client,
                    notebook_id=notebook_id,
                    output_type=resolved_output,
                    workspace=workspace,
                    instructions=instructions or prompt,
                    output_format=output_format,
                    language=language,
                )

                artifacts = [artifact_record]
                payload = {
                    "provider": "notebooklm",
                    "output_type": resolved_output,
                    "notebook_id": notebook_id,
                    "notebook_name": self._read_attr(notebook, "name")
                    or notebook_name
                    or title
                    or self._default_notebook_name(prompt, resolved_output),
                    "sources": added_sources,
                    "artifacts": artifacts,
                }
                audit = self.finalize_audit(
                    audit,
                    started_at,
                    status="completed",
                    response=payload,
                    artifacts=artifacts,
                )
                return self.result(
                    operation="generate_deliverable",
                    status="completed",
                    payload=payload,
                    audit=audit,
                )
        except Exception as exc:
            error = (
                f"{exc.__class__.__name__}: {exc}. "
                "NotebookLM may need an authenticated session or a supported source setup before it can run."
            )
            audit = self.finalize_audit(audit, started_at, status="failed", error=error)
            return self.result(
                operation="generate_deliverable",
                status="failed",
                payload={
                    "error": error,
                    "output_type": resolved_output,
                    "auth_required": True,
                },
                audit=audit,
            )

    async def _create_notebook(self, client: Any, notebook_name: str) -> Any:
        notebooks = getattr(client, "notebooks", None)
        if notebooks is None:
            raise RuntimeError("NotebookLM client does not expose notebooks operations.")
        method = getattr(notebooks, "create", None)
        if method is None:
            raise RuntimeError("NotebookLM client does not expose notebooks.create.")
        return await self._call_async(method, notebook_name)

    async def _attach_sources(
        self,
        client: Any,
        notebook_id: str,
        *,
        workspace: Path,
        source_urls: list[str],
        source_paths: list[str],
        source_bundle_text: str,
    ) -> list[dict[str, Any]]:
        sources_api = getattr(client, "sources", None)
        if sources_api is None:
            raise RuntimeError("NotebookLM client does not expose source operations.")

        attached_sources: list[dict[str, Any]] = []
        seen_urls: set[str] = set()
        for url in source_urls:
            normalized = str(url).strip()
            if not normalized or normalized in seen_urls:
                continue
            seen_urls.add(normalized)
            method = getattr(sources_api, "add_url", None)
            if method is None:
                raise RuntimeError("NotebookLM sources.add_url is unavailable.")
            await self._call_async(method, notebook_id, normalized, wait=True)
            attached_sources.append({"kind": "url", "value": normalized})

        for source_path in source_paths:
            normalized_path = str(source_path).strip()
            if not normalized_path:
                continue
            await self._attach_file_source(sources_api, notebook_id, Path(normalized_path))
            attached_sources.append({"kind": "file", "value": normalized_path})

        if source_bundle_text.strip():
            bundle_path = workspace / "execution-brief.md"
            bundle_path.write_text(source_bundle_text, encoding="utf-8")
            await self._attach_file_source(sources_api, notebook_id, bundle_path)
            attached_sources.append({"kind": "generated_brief", "value": str(bundle_path)})

        if not attached_sources:
            raise RuntimeError("NotebookLM requires at least one usable source before generation.")
        return attached_sources

    async def _attach_file_source(self, sources_api: Any, notebook_id: str, path: Path) -> None:
        for method_name in ("add_file", "upload_file", "add_path"):
            method = getattr(sources_api, method_name, None)
            if method is None:
                continue
            await self._call_async(method, notebook_id, str(path), wait=True)
            return
        for method_name in ("add_text", "add_pasted_text", "add_markdown"):
            method = getattr(sources_api, method_name, None)
            if method is None:
                continue
            content = path.read_text(encoding="utf-8")
            await self._call_async(
                method,
                notebook_id,
                content,
                title=path.name,
                wait=True,
            )
            return
        raise RuntimeError("NotebookLM source file attachment methods are unavailable.")

    async def _generate_and_download(
        self,
        client: Any,
        *,
        notebook_id: str,
        output_type: str,
        workspace: Path,
        instructions: str,
        output_format: str | None,
        language: str | None,
    ) -> dict[str, Any]:
        artifacts_api = getattr(client, "artifacts", None)
        if artifacts_api is None:
            raise RuntimeError("NotebookLM client does not expose artifacts operations.")

        generate_method = self._resolve_method(
            artifacts_api,
            self.GENERATE_METHOD_CANDIDATES[output_type],
        )
        generate_kwargs: dict[str, Any] = {}
        if instructions:
            generate_kwargs["instructions"] = instructions
        if language:
            generate_kwargs["language"] = language
        generation_result = await self._call_async(
            generate_method,
            notebook_id,
            **generate_kwargs,
        )

        task_id = self._read_attr(generation_result, "task_id")
        wait_method = getattr(artifacts_api, "wait_for_completion", None)
        if task_id and wait_method is not None:
            await self._call_async(wait_method, notebook_id, task_id)

        extension = self._resolve_extension(output_type, output_format)
        target_path = workspace / f"{self.DEFAULT_FILE_STEMS[output_type]}.{extension}"
        download_method = self._resolve_method(
            artifacts_api,
            self.DOWNLOAD_METHOD_CANDIDATES[output_type],
        )
        download_kwargs: dict[str, Any] = {}
        if output_format:
            download_kwargs["output_format"] = output_format
        await self._call_async(download_method, notebook_id, str(target_path), **download_kwargs)
        if not target_path.exists():
            raise RuntimeError("NotebookLM finished generation but no download file was written.")

        storage_key = f"notebooklm/{workspace.name}/{target_path.name}"
        artifact_path = self.storage.save_bytes(storage_key, target_path.read_bytes())
        return {
            "storage_key": storage_key,
            "path": artifact_path,
            "content_type": self.storage.guess_content_type(storage_key),
            "file_name": target_path.name,
            "output_type": output_type,
            "provider": "notebooklm",
        }

    def _resolve_extension(self, output_type: str, output_format: str | None) -> str:
        if output_type in {"flashcards", "quiz"} and output_format in {"json", "markdown", "html"}:
            return "md" if output_format == "markdown" else output_format
        if output_type == "slide_deck" and output_format in {"pptx", "pdf"}:
            return output_format
        if output_type == "report" and output_format in {"json", "markdown", "html"}:
            return "md" if output_format == "markdown" else output_format
        return self.OUTPUT_EXTENSIONS[output_type]

    async def _call_async(self, method: Any, *args: Any, **kwargs: Any) -> Any:
        signature = inspect.signature(method)
        supports_var_kwargs = any(
            parameter.kind == inspect.Parameter.VAR_KEYWORD
            for parameter in signature.parameters.values()
        )
        filtered_kwargs = (
            kwargs
            if supports_var_kwargs
            else {
                key: value
                for key, value in kwargs.items()
                if key in signature.parameters
            }
        )
        result = method(*args, **filtered_kwargs)
        if inspect.isawaitable(result):
            return await result
        return result

    def _resolve_method(self, owner: Any, candidates: tuple[str, ...]) -> Any:
        for method_name in candidates:
            method = getattr(owner, method_name, None)
            if method is not None:
                return method
        raise RuntimeError(
            f"NotebookLM client is missing expected methods: {', '.join(candidates)}."
        )

    def _load_client_factory(self) -> Any:
        os.environ["NOTEBOOKLM_HOME"] = str(self.storage_root)
        module = importlib.import_module("notebooklm")
        client_class = getattr(module, "NotebookLMClient", None)
        if client_class is None:
            raise RuntimeError("notebooklm-py is installed but NotebookLMClient was not found.")
        factory = getattr(client_class, "from_storage", None)
        if factory is None:
            raise RuntimeError("NotebookLMClient.from_storage is unavailable.")

        async def _factory() -> Any:
            return await self._call_async(
                factory,
                storage_dir=str(self.storage_root),
            )

        return _factory

    def _default_notebook_name(self, prompt: str, output_type: str) -> str:
        trimmed = " ".join(prompt.strip().split())
        prefix = trimmed[:72].rstrip(" -:") or "Autonomous request"
        label = output_type.replace("_", " ")
        return f"{prefix} [{label}]"

    def _default_source_bundle(self, prompt: str, output_type: str) -> str:
        return (
            "# Execution brief\n\n"
            f"Requested deliverable: {output_type.replace('_', ' ')}\n\n"
            "## User request\n\n"
            f"{prompt.strip()}\n"
        )

    def _package_installed(self) -> bool:
        return importlib.util.find_spec("notebooklm") is not None

    def _read_attr(self, value: Any, name: str) -> Any:
        if isinstance(value, dict):
            return value.get(name)
        return getattr(value, name, None)
