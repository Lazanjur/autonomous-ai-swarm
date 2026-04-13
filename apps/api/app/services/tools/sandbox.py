from __future__ import annotations

import asyncio
import shutil
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any
from app.core.config import get_settings
from app.services.tools.common import ToolRuntimeBase

settings = get_settings()


class DockerSandboxExecutor(ToolRuntimeBase):
    name = "python_sandbox"

    def build_command(self, workspace_path: Path, script_name: str) -> list[str]:
        return [
            "docker",
            "run",
            "--rm",
            "--network",
            "none",
            "--cpus",
            "1",
            "--memory",
            "256m",
            "--pids-limit",
            "64",
            "--security-opt",
            "no-new-privileges",
            "--workdir",
            "/workspace",
            "-v",
            f"{workspace_path.resolve()}:/workspace",
            "python:3.12-slim",
            "python",
            f"/workspace/{script_name}",
        ]

    async def execute_python(
        self,
        code: str,
        *,
        files: dict[str, str | bytes] | None = None,
        timeout_seconds: int = 20,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
        event_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = {
            "timeout_seconds": timeout_seconds,
            "input_files": sorted((files or {}).keys()),
            "code_preview": code[:240],
        }
        audit, started_at = self.start_audit("execute_python", request)

        workspace_path = self._prepare_workspace(audit["run_id"])
        try:
            script_path = workspace_path / "task.py"
            script_path.write_text(code, encoding="utf-8")
            self._seed_files(workspace_path, files or {})
            command = self.build_command(workspace_path, script_path.name)
            session_id = audit["run_id"]
            session_payload_base = {
                **(event_context or {}),
                "session_id": session_id,
                "session_kind": "terminal",
                "tool": self.name,
                "command": command,
            }
            try:
                process = await self._create_process(command)
                await self._emit(
                    event_handler,
                    "computer.session.started",
                    {
                        **session_payload_base,
                        "status": "running",
                    },
                )
                stdout_buffer: list[str] = []
                stderr_buffer: list[str] = []
                stdout_task = asyncio.create_task(
                    self._stream_pipe(
                        pipe=process.stdout,
                        stream_name="stdout",
                        buffer=stdout_buffer,
                        event_handler=event_handler,
                        event_payload_base=session_payload_base,
                    )
                )
                stderr_task = asyncio.create_task(
                    self._stream_pipe(
                        pipe=process.stderr,
                        stream_name="stderr",
                        buffer=stderr_buffer,
                        event_handler=event_handler,
                        event_payload_base=session_payload_base,
                    )
                )

                timed_out = False
                try:
                    await asyncio.wait_for(process.wait(), timeout=timeout_seconds)
                    raw_returncode = process.returncode
                except asyncio.TimeoutError:
                    timed_out = True
                    process.kill()
                    await process.wait()
                    raw_returncode = process.returncode

                stdout = await stdout_task
                stderr = await stderr_task
                returncode = 124 if timed_out else (raw_returncode if raw_returncode is not None else 1)
                artifacts = self._capture_workspace_artifacts(
                    workspace_path,
                    run_id=audit["run_id"],
                    exclude={script_path.name, *request["input_files"]},
                )
                payload = {
                    "command": command,
                    "stdout": stdout,
                    "stderr": stderr,
                    "returncode": returncode,
                    "timed_out": timed_out,
                    "artifacts": artifacts,
                    "session_events_emitted": True,
                }
                status = "completed" if returncode == 0 and not timed_out else "failed"
                audit = self.finalize_audit(
                    audit,
                    started_at,
                    status=status,
                    response={
                        "returncode": returncode,
                        "stdout_preview": stdout[:240],
                        "stderr_preview": stderr[:240],
                    },
                    artifacts=artifacts,
                    error=stderr[:500] if status != "completed" else None,
                )
                await self._emit(
                    event_handler,
                    "computer.session.completed" if status == "completed" else "computer.session.failed",
                    {
                        **session_payload_base,
                        "status": status,
                        "stdout": stdout,
                        "stderr": stderr,
                        "returncode": returncode,
                        "timed_out": timed_out,
                        "artifacts": artifacts,
                    },
                )
                return self.result(
                    operation="execute_python",
                    status=status,
                    payload=payload,
                    audit=audit,
                )
            except FileNotFoundError:
                error = "Docker is not available in the current environment."
                audit = self.finalize_audit(
                    audit,
                    started_at,
                    status="failed",
                    response={"returncode": 127},
                    error=error,
                )
                await self._emit(
                    event_handler,
                    "computer.session.failed",
                    {
                        **session_payload_base,
                        "status": "failed",
                        "stdout": "",
                        "stderr": error,
                        "returncode": 127,
                        "timed_out": False,
                        "artifacts": [],
                    },
                )
                return self.result(
                    operation="execute_python",
                    status="failed",
                    payload={
                        "command": command,
                        "stdout": "",
                        "stderr": error,
                        "returncode": 127,
                        "timed_out": False,
                        "artifacts": [],
                        "session_events_emitted": True,
                    },
                    audit=audit,
                )
            except Exception as exc:
                error = f"{exc.__class__.__name__}: {exc}"
                audit = self.finalize_audit(
                    audit,
                    started_at,
                    status="failed",
                    response={"returncode": 1},
                    error=error,
                )
                await self._emit(
                    event_handler,
                    "computer.session.failed",
                    {
                        **session_payload_base,
                        "status": "failed",
                        "stdout": "",
                        "stderr": error,
                        "returncode": 1,
                        "timed_out": False,
                        "artifacts": [],
                    },
                )
                return self.result(
                    operation="execute_python",
                    status="failed",
                    payload={
                        "command": command,
                        "stdout": "",
                        "stderr": error,
                        "returncode": 1,
                        "timed_out": False,
                        "artifacts": [],
                        "session_events_emitted": True,
                    },
                    audit=audit,
                )
        finally:
            shutil.rmtree(workspace_path, ignore_errors=True)

    def _prepare_workspace(self, run_id: str) -> Path:
        workspace_root = (Path.cwd() / "var" / "sandbox-runtime" / run_id).resolve()
        workspace_root.mkdir(parents=True, exist_ok=True)
        return workspace_root

    async def _create_process(self, command: list[str]):
        return await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

    async def _stream_pipe(
        self,
        *,
        pipe,
        stream_name: str,
        buffer: list[str],
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None,
        event_payload_base: dict[str, Any],
    ) -> str:
        if pipe is None:
            return ""

        chunk_index = 0
        while True:
            chunk = await pipe.read(512)
            if not chunk:
                break
            text = chunk.decode("utf-8", errors="replace")
            buffer.append(text)
            chunk_index += 1
            await self._emit(
                event_handler,
                "computer.session.updated",
                {
                    **event_payload_base,
                    "status": "running",
                    "phase": "stream",
                    "stream": stream_name,
                    "chunk_index": chunk_index,
                    "stdout_delta": text if stream_name == "stdout" else None,
                    "stderr_delta": text if stream_name == "stderr" else None,
                },
            )
            await self._emit(
                event_handler,
                f"terminal.{stream_name}",
                {
                    **event_payload_base,
                    "status": "running",
                    "phase": "stream",
                    "stream": stream_name,
                    "chunk_index": chunk_index,
                    "stdout_delta": text if stream_name == "stdout" else None,
                    "stderr_delta": text if stream_name == "stderr" else None,
                },
            )
        return "".join(buffer)

    def _seed_files(self, workspace_path: Path, files: dict[str, str | bytes]) -> None:
        for relative_path, content in files.items():
            target = self._resolve_workspace_file(workspace_path, relative_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(content, bytes):
                target.write_bytes(content)
            else:
                target.write_text(content, encoding="utf-8")

    def _resolve_workspace_file(self, workspace_path: Path, relative_path: str) -> Path:
        candidate = (workspace_path / relative_path).resolve()
        if workspace_path not in candidate.parents and candidate != workspace_path:
            raise ValueError("Sandbox file path resolves outside the temporary workspace.")
        return candidate

    def _capture_workspace_artifacts(
        self,
        workspace_path: Path,
        *,
        run_id: str,
        exclude: set[str],
    ) -> list[dict[str, Any]]:
        artifacts: list[dict[str, Any]] = []
        for file_path in sorted(workspace_path.rglob("*")):
            if not file_path.is_file():
                continue
            if file_path.name in exclude:
                continue
            relative_path = file_path.relative_to(workspace_path).as_posix()
            storage_key = f"sandbox-runs/{run_id}/{relative_path}"
            artifacts.append(
                {
                    "storage_key": storage_key,
                    "path": self.storage.save_bytes(storage_key, file_path.read_bytes()),
                    "relative_path": relative_path,
                    "size_bytes": file_path.stat().st_size,
                }
            )
        return artifacts

    async def _emit(
        self,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None,
        event: str,
        payload: dict[str, Any],
    ) -> None:
        if event_handler is not None:
            await event_handler(event, payload)
