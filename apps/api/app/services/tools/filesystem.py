from __future__ import annotations

import json
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
            if not path.exists():
                payload = {"path": str(path), "entries": []}
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
                    }
                )
            payload = {"path": str(path), "entries": sorted(entries, key=lambda item: item["relative_path"])}
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

    def _resolve_write_path(self, relative_path: str) -> Path:
        return self._resolve_within(self.write_root, relative_path, "tool write root")

    def _resolve_within(self, base: Path, relative_path: str, label: str) -> Path:
        path = (base / relative_path).resolve()
        if base not in path.parents and path != base:
            raise ValueError(f"Path is outside the allowed {label}.")
        return path
