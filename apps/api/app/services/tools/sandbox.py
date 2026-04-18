from __future__ import annotations

import asyncio
import shutil
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal
from app.core.config import get_settings
from app.services.governance import evaluate_shell_command
from app.services.tools.common import ToolRuntimeBase

settings = get_settings()


@dataclass(frozen=True)
class SandboxResourceTier:
    name: str
    cpus: str
    memory: str
    gpu: bool = False


@dataclass(frozen=True)
class SandboxExecutionProfile:
    target_os: Literal["linux", "windows", "macos"]
    runtime_profile: Literal["auto", "python", "node", "shell", "powershell"]
    resource_tier: Literal["small", "medium", "large", "gpu"]
    network_access: bool
    persistence_scope: Literal["task", "workspace"]
    compatibility_mode: Literal["native", "compatibility"]
    shell_family: Literal["sh", "bash", "powershell"]
    image: str
    cpus: str
    memory: str
    gpu_enabled: bool

    def to_payload(self) -> dict[str, Any]:
        return asdict(self)


class DockerSandboxExecutor(ToolRuntimeBase):
    name = "python_sandbox"
    RESOURCE_TIERS: dict[str, SandboxResourceTier] = {
        "small": SandboxResourceTier(name="small", cpus="1", memory="512m"),
        "medium": SandboxResourceTier(name="medium", cpus="2", memory="2g"),
        "large": SandboxResourceTier(name="large", cpus="4", memory="8g"),
        "gpu": SandboxResourceTier(name="gpu", cpus="6", memory="16g", gpu=True),
    }

    async def describe_capabilities(self) -> dict[str, Any]:
        request = {"operation": "describe_capabilities"}
        audit, started_at = self.start_audit("describe_capabilities", request)
        payload = {
            "runner_backend": "docker",
            "isolated_per_task": True,
            "ephemeral_workspace_root": str((Path.cwd() / "var" / "sandbox-runtime").resolve()),
            "supported_target_os": [
                {
                    "target_os": "linux",
                    "compatibility_mode": "native",
                    "shell_family": "sh",
                },
                {
                    "target_os": "windows",
                    "compatibility_mode": "compatibility",
                    "shell_family": "powershell",
                },
                {
                    "target_os": "macos",
                    "compatibility_mode": "compatibility",
                    "shell_family": "bash",
                },
            ],
            "resource_tiers": [
                {
                    "name": tier.name,
                    "cpus": tier.cpus,
                    "memory": tier.memory,
                    "gpu": tier.gpu and settings.sandbox_gpu_enabled,
                }
                for tier in self.RESOURCE_TIERS.values()
            ],
            "features": [
                "containerized_runner",
                "filesystem_isolation",
                "real_time_terminal_logs",
                "per_task_workspace",
                "runtime_image_selection",
            ],
            "secure_filesystem_access": {
                "workspace_scope": "per-task",
                "artifact_capture": True,
                "path_escape_protection": True,
            },
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload)
        return self.result(operation="describe_capabilities", status="completed", payload=payload, audit=audit)

    def _build_container_base(
        self,
        *,
        workspace_path: Path,
        profile: SandboxExecutionProfile,
    ) -> list[str]:
        command = [
            "docker",
            "run",
            "--rm",
            "--network",
            "bridge" if profile.network_access else "none",
            "--cpus",
            profile.cpus,
            "--memory",
            profile.memory,
            "--pids-limit",
            "64",
            "--security-opt",
            "no-new-privileges",
            "--workdir",
            "/workspace",
            "-e",
            f"SWARM_TARGET_OS={profile.target_os}",
            "-e",
            f"SWARM_RUNTIME_PROFILE={profile.runtime_profile}",
            "-e",
            f"SWARM_RESOURCE_TIER={profile.resource_tier}",
            "-e",
            f"SWARM_COMPATIBILITY_MODE={profile.compatibility_mode}",
            "-v",
            f"{workspace_path.resolve()}:/workspace",
        ]
        if profile.target_os == "macos":
            command.extend(["-e", "OSTYPE=darwin", "-e", "MACOSX_DEPLOYMENT_TARGET=13.0"])
        if profile.gpu_enabled:
            command.extend(["--gpus", "all"])
        command.append(profile.image)
        return command

    def build_command(self, workspace_path: Path, script_name: str) -> list[str]:
        profile = self._resolve_execution_profile(
            workspace_path=workspace_path,
            runtime_hint="python",
            network_access=False,
        )
        return [
            *self._build_container_base(
                workspace_path=workspace_path,
                profile=profile,
            ),
            "python",
            f"/workspace/{script_name}",
        ]

    async def execute_python(
        self,
        code: str,
        *,
        files: dict[str, str | bytes] | None = None,
        timeout_seconds: int = 20,
        execution_environment: dict[str, Any] | None = None,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
        event_context: dict[str, Any] | None = None,
        tool_name: str = "python_sandbox",
    ) -> dict[str, Any]:
        profile = self._resolve_execution_profile(
            workspace_path=None,
            execution_environment=execution_environment,
            runtime_hint="python",
            network_access=False,
        )
        request = {
            "timeout_seconds": timeout_seconds,
            "input_files": sorted((files or {}).keys()),
            "code_preview": code[:240],
            "execution_environment": profile.to_payload(),
        }
        return await self._execute_container(
            operation="execute_python",
            request=request,
            timeout_seconds=timeout_seconds,
            event_handler=event_handler,
            event_context=event_context,
            tool_name=tool_name,
            prepare_workspace=lambda workspace_path: self._prepare_python_workspace(
                workspace_path=workspace_path,
                code=code,
                files=files or {},
                execution_environment=execution_environment,
            ),
        )

    async def execute_command(
        self,
        command: str,
        *,
        files: dict[str, str | bytes] | None = None,
        timeout_seconds: int = 60,
        network_access: bool = True,
        execution_environment: dict[str, Any] | None = None,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
        event_context: dict[str, Any] | None = None,
        tool_name: str = "shell_sandbox",
    ) -> dict[str, Any]:
        normalized_command = command.strip()
        policy = evaluate_shell_command(normalized_command)
        profile = self._resolve_execution_profile(
            workspace_path=None,
            execution_environment=execution_environment,
            command=normalized_command,
            runtime_hint="shell",
            network_access=network_access,
        )
        request = {
            "timeout_seconds": timeout_seconds,
            "input_files": sorted((files or {}).keys()),
            "command_preview": normalized_command[:240],
            "network_access": profile.network_access,
            "execution_environment": profile.to_payload(),
        }
        if not policy["allowed"]:
            audit, started_at = self.start_audit("execute_command", request)
            audit = self.finalize_audit(
                audit,
                started_at,
                status="rejected",
                response={
                    "returncode": 126,
                    "requires_approval": policy["requires_approval"],
                    "command_preview": policy["command_preview"],
                },
                error=policy["reason"],
            )
            return self.result(
                operation="execute_command",
                status="rejected",
                payload={
                    "command": normalized_command,
                    "stdout": "",
                    "stderr": policy["reason"],
                    "returncode": 126,
                    "timed_out": False,
                    "artifacts": [],
                    "requires_approval": policy["requires_approval"],
                    "command_policy": policy,
                    "execution_environment": profile.to_payload(),
                    "session_events_emitted": False,
                },
                audit=audit,
            )
        return await self._execute_container(
            operation="execute_command",
            request=request,
            timeout_seconds=timeout_seconds,
            event_handler=event_handler,
            event_context=event_context,
            tool_name=tool_name,
            prepare_workspace=lambda workspace_path: self._prepare_shell_workspace(
                workspace_path=workspace_path,
                command=normalized_command,
                files=files or {},
                network_access=network_access,
                execution_environment=execution_environment,
            ),
        )

    def _prepare_python_workspace(
        self,
        *,
        workspace_path: Path,
        code: str,
        files: dict[str, str | bytes],
        execution_environment: dict[str, Any] | None,
    ) -> tuple[list[str], set[str], str, dict[str, Any]]:
        script_path = workspace_path / "task.py"
        script_path.write_text(code, encoding="utf-8")
        self._seed_files(workspace_path, files)
        profile = self._resolve_execution_profile(
            workspace_path=workspace_path,
            execution_environment=execution_environment,
            runtime_hint="python",
            network_access=False,
        )
        return (
            [
                *self._build_container_base(
                    workspace_path=workspace_path,
                    profile=profile,
                ),
                "python",
                f"/workspace/{script_path.name}",
            ],
            {script_path.name, *files.keys()},
            profile.image,
            profile.to_payload(),
        )

    def _prepare_shell_workspace(
        self,
        *,
        workspace_path: Path,
        command: str,
        files: dict[str, str | bytes],
        network_access: bool,
        execution_environment: dict[str, Any] | None,
    ) -> tuple[list[str], set[str], str, dict[str, Any]]:
        self._seed_files(workspace_path, files)
        profile = self._resolve_execution_profile(
            workspace_path=workspace_path,
            execution_environment=execution_environment,
            command=command,
            runtime_hint="shell",
            network_access=network_access,
        )
        return (
            [
                *self._build_container_base(
                    workspace_path=workspace_path,
                    profile=profile,
                ),
                *self._shell_entrypoint(profile, command),
            ],
            set(files.keys()),
            profile.image,
            profile.to_payload(),
        )

    def _detect_runtime_image(self, *, workspace_path: Path, command: str) -> str:
        lowered_command = command.lower()
        node_markers = (
            "package.json",
            "package-lock.json",
            "pnpm-lock.yaml",
            "yarn.lock",
            "tsconfig.json",
        )
        python_markers = (
            "pyproject.toml",
            "requirements.txt",
            "requirements-dev.txt",
            "setup.py",
            "pytest.ini",
        )
        if any((workspace_path / marker).exists() for marker in node_markers) or any(
            token in lowered_command for token in ("npm", "pnpm", "yarn", "node", "npx", "jest", "vitest", "next")
        ):
            return "node:20-bookworm-slim"
        if any((workspace_path / marker).exists() for marker in python_markers) or any(
            token in lowered_command for token in ("python", "pip", "pytest", "uv ", "mypy", "ruff")
        ):
            return "python:3.12-slim"
        return "python:3.12-slim"

    def _shell_entrypoint(self, profile: SandboxExecutionProfile, command: str) -> list[str]:
        if profile.shell_family == "powershell":
            return ["pwsh", "-NoLogo", "-NonInteractive", "-Command", command]
        if profile.shell_family == "bash":
            return ["/bin/bash", "-lc", command]
        return ["/bin/sh", "-lc", command]

    def _resolve_execution_profile(
        self,
        *,
        workspace_path: Path | None,
        execution_environment: dict[str, Any] | None = None,
        command: str | None = None,
        runtime_hint: Literal["python", "shell"] = "shell",
        network_access: bool | None = None,
    ) -> SandboxExecutionProfile:
        requested = execution_environment if isinstance(execution_environment, dict) else {}
        target_os = str(
            requested.get("target_os")
            or settings.sandbox_default_target_os
            or "linux"
        ).strip().lower()
        if target_os not in {"linux", "windows", "macos"}:
            target_os = "linux"

        resource_tier = str(
            requested.get("resource_tier")
            or settings.sandbox_default_resource_tier
            or "small"
        ).strip().lower()
        if resource_tier not in self.RESOURCE_TIERS:
            resource_tier = "small"
        tier = self.RESOURCE_TIERS[resource_tier]

        requested_runtime = str(requested.get("runtime_profile") or "auto").strip().lower()
        if requested_runtime not in {"auto", "python", "node", "shell", "powershell"}:
            requested_runtime = "auto"
        runtime_profile = requested_runtime
        if runtime_profile == "auto":
            runtime_profile = runtime_hint
        if target_os == "windows" and runtime_profile == "shell":
            runtime_profile = "powershell"

        effective_network_access = (
            bool(requested.get("network_access"))
            if requested.get("network_access") is not None
            else bool(network_access)
        )
        persistence_scope = str(requested.get("persistence_scope") or "task").strip().lower()
        if persistence_scope not in {"task", "workspace"}:
            persistence_scope = "task"

        compatibility_mode: Literal["native", "compatibility"] = (
            "native" if target_os == "linux" else "compatibility"
        )
        shell_family: Literal["sh", "bash", "powershell"]
        if target_os == "windows":
            shell_family = "powershell"
            image = settings.sandbox_windows_shell_image
        elif target_os == "macos":
            shell_family = "bash"
            image = settings.sandbox_macos_shell_image
        else:
            shell_family = "sh"
            image = self._detect_runtime_image(workspace_path=workspace_path or Path.cwd(), command=command or "")
            if runtime_profile == "node":
                image = "node:20-bookworm-slim"
            elif runtime_profile == "python":
                image = "python:3.12-slim"

        return SandboxExecutionProfile(
            target_os=target_os,  # type: ignore[arg-type]
            runtime_profile=runtime_profile,  # type: ignore[arg-type]
            resource_tier=resource_tier,  # type: ignore[arg-type]
            network_access=effective_network_access,
            persistence_scope=persistence_scope,  # type: ignore[arg-type]
            compatibility_mode=compatibility_mode,
            shell_family=shell_family,
            image=image,
            cpus=tier.cpus,
            memory=tier.memory,
            gpu_enabled=bool(tier.gpu and settings.sandbox_gpu_enabled),
        )

    async def _execute_container(
        self,
        *,
        operation: str,
        request: dict[str, Any],
        timeout_seconds: int,
        event_handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None,
        event_context: dict[str, Any] | None,
        tool_name: str,
        prepare_workspace: Callable[[Path], tuple[list[str], set[str], str]],
    ) -> dict[str, Any]:
        audit, started_at = self.start_audit(operation, request)
        workspace_path = self._prepare_workspace(audit["run_id"])
        try:
            command, exclude, image, execution_profile = prepare_workspace(workspace_path)
            session_id = audit["run_id"]
            session_payload_base = {
                **(event_context or {}),
                "session_id": session_id,
                "session_kind": "terminal",
                "tool": tool_name,
                "command": command,
                "execution_environment": execution_profile,
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
                    exclude=exclude,
                )
                payload = {
                    "command": command,
                    "image": image,
                    "stdout": stdout,
                    "stderr": stderr,
                    "returncode": returncode,
                    "timed_out": timed_out,
                    "artifacts": artifacts,
                    "execution_environment": execution_profile,
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
                        "execution_environment": execution_profile,
                    },
                )
                return self.result(
                    operation=operation,
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
                        "execution_environment": execution_profile,
                    },
                )
                return self.result(
                    operation=operation,
                    status="failed",
                    payload={
                        "command": command,
                        "image": image,
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
                        "execution_environment": execution_profile,
                    },
                )
                return self.result(
                    operation=operation,
                    status="failed",
                    payload={
                        "command": command,
                        "image": image,
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
