from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.services.tools.common import ToolRuntimeBase


class WorkspaceFilesystemTool(ToolRuntimeBase):
    name = "workspace_files"

    def __init__(self) -> None:
        super().__init__()
        self.root = Path(__file__).resolve().parents[5]
        self.write_root = (self.root / "var" / "tool-workspace").resolve()
        self.write_root.mkdir(parents=True, exist_ok=True)

    async def describe_policies(self) -> dict[str, Any]:
        request = {"operation": "describe_policies"}
        audit, started_at = self.start_audit("describe_policies", request)
        payload = {
            "workspace_root": str(self.root),
            "write_root": str(self.write_root),
            "allowed_reads": ["workspace_root"],
            "allowed_writes": ["write_root"],
            "notes": [
                "Reads are allowed anywhere under the repository root.",
                "Writes are restricted to var/tool-workspace.",
            ],
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload)
        return self.result(operation="describe_policies", status="completed", payload=payload, audit=audit)

    async def list_files(self, relative_path: str = ".", *, recursive: bool = False) -> dict[str, Any]:
        request = {"relative_path": relative_path, "recursive": recursive}
        audit, started_at = self.start_audit("list_files", request)
        try:
            path = self._resolve_read_path(relative_path)
            normalized_relative_path = (
                "."
                if path == self.root
                else path.relative_to(self.root).as_posix()
            )
            if not path.exists():
                payload = {
                    "path": str(path),
                    "relative_path": normalized_relative_path,
                    "entries": [],
                }
                audit = self.finalize_audit(audit, started_at, status="completed", response=payload)
                return self.result(operation="list_files", status="completed", payload=payload, audit=audit)

            iterator = path.rglob("*") if recursive else path.iterdir()
            entries = []
            for item in iterator:
                entries.append(
                    {
                        "name": item.name,
                        "relative_path": item.relative_to(self.root).as_posix(),
                        "kind": "dir" if item.is_dir() else "file",
                        "extension": item.suffix.lower() or None,
                        "size_bytes": item.stat().st_size if item.is_file() else None,
                    }
                )
            payload = {
                "path": str(path),
                "relative_path": normalized_relative_path,
                "entries": sorted(entries, key=lambda item: item["relative_path"]),
            }
            audit = self.finalize_audit(audit, started_at, status="completed", response={"entry_count": len(entries)})
            return self.result(operation="list_files", status="completed", payload=payload, audit=audit)
        except Exception as exc:
            audit = self.finalize_audit(audit, started_at, status="failed", error=str(exc))
            return self.result(
                operation="list_files",
                status="failed",
                payload={"error": str(exc), "entries": []},
                audit=audit,
            )

    async def read_text(self, relative_path: str, *, max_chars: int = 12000) -> dict[str, Any]:
        request = {"relative_path": relative_path, "max_chars": max_chars}
        audit, started_at = self.start_audit("read_text", request)
        try:
            path = self._resolve_read_path(relative_path)
            content = path.read_text(encoding="utf-8")
            truncated = len(content) > max_chars
            payload = {
                "path": str(path),
                "relative_path": path.relative_to(self.root).as_posix(),
                "name": path.name,
                "extension": path.suffix.lower() or None,
                "size_bytes": path.stat().st_size,
                "content": content[:max_chars],
                "truncated": truncated,
            }
            audit = self.finalize_audit(
                audit,
                started_at,
                status="completed",
                response={"truncated": truncated, "content_length": len(content)},
            )
            return self.result(operation="read_text", status="completed", payload=payload, audit=audit)
        except Exception as exc:
            audit = self.finalize_audit(audit, started_at, status="failed", error=str(exc))
            return self.result(
                operation="read_text",
                status="failed",
                payload={"error": str(exc)},
                audit=audit,
            )

    async def suggest_related_files(self, relative_path: str, *, max_results: int = 8) -> dict[str, Any]:
        request = {"relative_path": relative_path, "max_results": max_results}
        audit, started_at = self.start_audit("suggest_related_files", request)
        try:
            path = self._resolve_read_path(relative_path)
            if not path.exists():
                raise ValueError("Requested file does not exist.")
            if path.is_dir():
                raise ValueError("Requested path is a directory.")

            related_files = self._build_related_file_suggestions(path, max_results=max_results)
            payload = {
                "path": str(path),
                "relative_path": path.relative_to(self.root).as_posix(),
                "related_files": related_files,
            }
            audit = self.finalize_audit(
                audit,
                started_at,
                status="completed",
                response={"related_count": len(related_files)},
            )
            return self.result(
                operation="suggest_related_files",
                status="completed",
                payload=payload,
                audit=audit,
            )
        except Exception as exc:
            audit = self.finalize_audit(audit, started_at, status="failed", error=str(exc))
            return self.result(
                operation="suggest_related_files",
                status="failed",
                payload={"error": str(exc), "related_files": []},
                audit=audit,
            )

    async def write_text(
        self,
        relative_path: str,
        content: str,
        *,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        request = {"relative_path": relative_path, "overwrite": overwrite, "content_preview": content[:200]}
        audit, started_at = self.start_audit("write_text", request)
        try:
            path = self._resolve_write_path(relative_path)
            if path.exists() and not overwrite:
                raise ValueError("Refusing to overwrite an existing file without explicit overwrite=True.")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            payload = {
                "path": str(path),
                "relative_path": path.relative_to(self.root).as_posix(),
                "size_bytes": path.stat().st_size,
            }
            audit = self.finalize_audit(audit, started_at, status="completed", response=payload)
            return self.result(operation="write_text", status="completed", payload=payload, audit=audit)
        except Exception as exc:
            audit = self.finalize_audit(audit, started_at, status="failed", error=str(exc))
            return self.result(
                operation="write_text",
                status="failed",
                payload={"error": str(exc)},
                audit=audit,
            )

    async def write_json(
        self,
        relative_path: str,
        payload: dict[str, Any] | list[Any],
        *,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        return await self.write_text(
            relative_path,
            json.dumps(payload, indent=2, ensure_ascii=False),
            overwrite=overwrite,
        )

    def _resolve_read_path(self, relative_path: str) -> Path:
        return self._resolve_within(self.root, relative_path, "workspace root")

    def resolve_read_path(self, relative_path: str) -> Path:
        return self._resolve_read_path(relative_path)

    def _resolve_write_path(self, relative_path: str) -> Path:
        return self._resolve_within(self.write_root, relative_path, "tool write root")

    def _resolve_within(self, base: Path, relative_path: str, label: str) -> Path:
        path = (base / relative_path).resolve()
        if base not in path.parents and path != base:
            raise ValueError(f"Path is outside the allowed {label}.")
        return path

    def _build_related_file_suggestions(self, path: Path, *, max_results: int) -> list[dict[str, Any]]:
        source_relative = path.relative_to(self.root).as_posix()
        stem = path.stem.lower()
        candidates: dict[Path, dict[str, Any]] = {}

        for item in path.parent.iterdir():
            if item == path or not item.is_file():
                continue
            candidate_stem = item.stem.lower()
            name_lower = item.name.lower()
            if candidate_stem == stem:
                self._register_related_candidate(candidates, item, score=95, reason="Shares the same filename stem.")
            elif candidate_stem.startswith(stem) or stem.startswith(candidate_stem):
                self._register_related_candidate(candidates, item, score=72, reason="Looks like a nearby companion file.")
            if any(token in name_lower for token in (".test.", ".spec.", "_test.", "_spec.")) and stem in name_lower:
                self._register_related_candidate(candidates, item, score=96, reason="Likely test/spec companion.")
            if ".stories." in name_lower and stem in name_lower:
                self._register_related_candidate(candidates, item, score=78, reason="Likely storybook companion.")
            if item.suffix.lower() in {".css", ".scss", ".sass", ".less"} and stem in candidate_stem:
                self._register_related_candidate(candidates, item, score=74, reason="Likely style companion.")

        for imported in self._discover_relative_import_candidates(path):
            self._register_related_candidate(candidates, imported, score=100, reason="Referenced by a relative import.")

        if len(candidates) < max_results:
            search_patterns = (
                f"{stem}.test.*",
                f"{stem}.spec.*",
                f"{stem}.*",
                f"*{stem}*",
            )
            seen_matches = 0
            for pattern in search_patterns:
                for item in self.root.rglob(pattern):
                    if seen_matches >= max_results * 8:
                        break
                    seen_matches += 1
                    if item == path or not item.is_file():
                        continue
                    if item in candidates:
                        continue
                    relative = item.relative_to(self.root).as_posix()
                    if relative == source_relative:
                        continue
                    score = 54 if path.parent == item.parent else 38
                    reason = "Shares a filename pattern with the current file."
                    if any(token in item.name.lower() for token in (".test.", ".spec.", "_test.", "_spec.")):
                        score += 18
                        reason = "Repo-wide test/spec match for the current file."
                    self._register_related_candidate(candidates, item, score=score, reason=reason)
                if len(candidates) >= max_results:
                    break

        ranked = sorted(
            (
                {
                    "relative_path": candidate.relative_to(self.root).as_posix(),
                    "name": candidate.name,
                    "extension": candidate.suffix.lower() or None,
                    "reason": data["reason"],
                    "score": data["score"],
                }
                for candidate, data in candidates.items()
            ),
            key=lambda item: (-int(item["score"]), str(item["relative_path"]).lower()),
        )
        return ranked[:max_results]

    def _register_related_candidate(
        self,
        candidates: dict[Path, dict[str, Any]],
        candidate: Path,
        *,
        score: int,
        reason: str,
    ) -> None:
        if candidate == self.root or not candidate.exists() or not candidate.is_file():
            return
        current = candidates.get(candidate)
        if current is None or score > int(current["score"]):
            candidates[candidate] = {"score": score, "reason": reason}

    def _discover_relative_import_candidates(self, path: Path) -> list[Path]:
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return []

        patterns = (
            r"""from\s+["'](\.[^"']+)["']""",
            r"""import\s+["'](\.[^"']+)["']""",
            r"""from\s+(\.[\w./-]+)\s+import""",
        )
        seen: set[Path] = set()
        resolved: list[Path] = []
        for pattern in patterns:
            for match in re.findall(pattern, content):
                for candidate in self._resolve_relative_import(path, match):
                    if candidate not in seen:
                        seen.add(candidate)
                        resolved.append(candidate)
        return resolved

    def _resolve_relative_import(self, path: Path, raw_import: str) -> list[Path]:
        base = (path.parent / raw_import).resolve()
        extensions = ("", ".ts", ".tsx", ".js", ".jsx", ".py", ".json", ".md", ".css", ".scss")
        candidates: list[Path] = []
        for suffix in extensions:
            direct = Path(str(base) + suffix).resolve()
            if self.root in direct.parents and direct.exists() and direct.is_file():
                candidates.append(direct)
        for index_name in ("index.ts", "index.tsx", "index.js", "index.jsx", "index.py"):
            nested = (base / index_name).resolve()
            if self.root in nested.parents and nested.exists() and nested.is_file():
                candidates.append(nested)
        return candidates
