from __future__ import annotations

import subprocess
import tempfile
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
    ) -> dict[str, Any]:
        request = {
            "timeout_seconds": timeout_seconds,
            "input_files": sorted((files or {}).keys()),
            "code_preview": code[:240],
        }
        audit, started_at = self.start_audit("execute_python", request)

        with tempfile.TemporaryDirectory() as temp_dir:
            workspace_path = Path(temp_dir)
            script_path = workspace_path / "task.py"
            script_path.write_text(code, encoding="utf-8")
            self._seed_files(workspace_path, files or {})
            command = self.build_command(workspace_path, script_path.name)
            try:
                completed = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=timeout_seconds,
                    check=False,
                )
                artifacts = self._capture_workspace_artifacts(
                    workspace_path,
                    run_id=audit["run_id"],
                    exclude={script_path.name, *request["input_files"]},
                )
                payload = {
                    "command": command,
                    "stdout": completed.stdout,
                    "stderr": completed.stderr,
                    "returncode": completed.returncode,
                    "timed_out": False,
                    "artifacts": artifacts,
                }
                audit = self.finalize_audit(
                    audit,
                    started_at,
                    status="completed" if completed.returncode == 0 else "failed",
                    response={
                        "returncode": completed.returncode,
                        "stdout_preview": completed.stdout[:240],
                        "stderr_preview": completed.stderr[:240],
                    },
                    artifacts=artifacts,
                    error=completed.stderr[:500] if completed.returncode != 0 else None,
                )
                return self.result(
                    operation="execute_python",
                    status="completed" if completed.returncode == 0 else "failed",
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
                    },
                    audit=audit,
                )
            except subprocess.TimeoutExpired:
                artifacts = self._capture_workspace_artifacts(
                    workspace_path,
                    run_id=audit["run_id"],
                    exclude={script_path.name, *request["input_files"]},
                )
                error = "Execution timed out."
                audit = self.finalize_audit(
                    audit,
                    started_at,
                    status="failed",
                    response={"returncode": 124},
                    artifacts=artifacts,
                    error=error,
                )
                return self.result(
                    operation="execute_python",
                    status="failed",
                    payload={
                        "command": command,
                        "stdout": "",
                        "stderr": error,
                        "returncode": 124,
                        "timed_out": True,
                        "artifacts": artifacts,
                    },
                    audit=audit,
                )

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
