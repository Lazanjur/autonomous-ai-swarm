"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bot,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  FolderPlus,
  History,
  LoaderCircle,
  LogOut,
  MessageSquarePlus,
  PlugZap,
  RotateCcw,
  Search,
  Sparkles,
  Workflow,
  X
} from "lucide-react";

import type {
  AuthProfile,
  ChatProjectCreatePayload,
  ChatSearchResponse,
  ChatTaskRailData,
  IntegrationProviderStatus,
  ProjectSummary,
  SearchResult,
  Thread
} from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { resolveActiveWorkspace, withWorkspacePath } from "@/lib/workspace";

const SIDEBAR_COLLAPSE_STORAGE_KEY = "swarm.sidebar.collapsed.v2";

const FALLBACK_CONNECTORS: IntegrationProviderStatus[] = [
  {
    key: "email",
    provider: "email",
    configured: false,
    live_delivery_supported: true,
    uses_approval_gate: false,
    detail: "Deliver updates and generated outputs by email."
  },
  {
    key: "slack",
    provider: "slack",
    configured: false,
    live_delivery_supported: true,
    uses_approval_gate: true,
    detail: "Send operator updates and approvals to Slack."
  },
  {
    key: "webhook",
    provider: "webhook",
    configured: false,
    live_delivery_supported: true,
    uses_approval_gate: true,
    detail: "Trigger downstream systems with webhooks."
  },
  {
    key: "calendar",
    provider: "calendar",
    configured: false,
    live_delivery_supported: true,
    uses_approval_gate: false,
    detail: "Sync schedules and event-driven work."
  }
];

function taskRailHref(
  workspaceId?: string | null,
  projectId?: string | null,
  threadId?: string | null,
  newTask = false
) {
  return withWorkspacePath("/app/chat", workspaceId, {
    project: projectId,
    thread: threadId,
    new: newTask ? "1" : null
  });
}

function taskReplayHref(
  workspaceId?: string | null,
  projectId?: string | null,
  threadId?: string | null
) {
  return withWorkspacePath("/app/chat", workspaceId, {
    project: projectId,
    thread: threadId,
    replay: threadId ? "1" : null
  });
}

function knowledgeSearchHref(workspaceId: string | null | undefined, query: string, documentId?: string | null) {
  return withWorkspacePath("/app/knowledge", workspaceId, {
    q: query || null,
    document: documentId
  });
}

function artifactSearchHref(workspaceId: string | null | undefined, query: string, artifactId?: string | null) {
  return withWorkspacePath("/app/artifacts", workspaceId, {
    q: query || null,
    artifact: artifactId
  });
}

function sortProjects(projects: ProjectSummary[]) {
  return [...projects].sort((left, right) => {
    const leftAt = left.last_activity_at ?? left.updated_at;
    const rightAt = right.last_activity_at ?? right.updated_at;
    return rightAt.localeCompare(leftAt) || left.name.localeCompare(right.name);
  });
}

function searchResultHref(
  result: SearchResult,
  workspaceId: string | null | undefined,
  query: string
) {
  if (result.kind === "task" && result.thread) {
    return taskRailHref(
      workspaceId,
      result.thread.project_id ?? result.project?.id ?? null,
      result.thread.id
    );
  }
  if (result.kind === "project" && result.project) {
    return taskRailHref(workspaceId, result.project.id, null);
  }
  if (result.kind === "document" && result.document) {
    return knowledgeSearchHref(workspaceId, query, result.document.id);
  }
  if (result.kind === "artifact" && result.artifact) {
    return artifactSearchHref(workspaceId, query, result.artifact.id);
  }
  return withWorkspacePath("/app/chat", workspaceId);
}

function connectorLabel(connector: IntegrationProviderStatus) {
  return connector.key.replaceAll("_", " ");
}

function compactSearchGroups(results: SearchResult[]) {
  const groups: Array<{ key: SearchResult["kind"]; label: string; items: SearchResult[] }> = [
    { key: "project", label: "Projects", items: [] },
    { key: "task", label: "Tasks", items: [] },
    { key: "document", label: "Library", items: [] },
    { key: "artifact", label: "Artifacts", items: [] }
  ];

  for (const result of results) {
    const group = groups.find((entry) => entry.key === result.kind);
    group?.items.push(result);
  }

  return groups.filter((group) => group.items.length > 0);
}

export function AppSidebar({
  session,
  taskRail
}: {
  session: AuthProfile;
  taskRail: ChatTaskRailData | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const searchParamKey = searchParams.toString();
  const requestedWorkspaceId = searchParams.get("workspace");
  const activeWorkspace = resolveActiveWorkspace(session, requestedWorkspaceId);
  const activeWorkspaceId = activeWorkspace?.workspace_id ?? session.workspaces[0]?.workspace_id ?? null;

  const [taskRailState, setTaskRailState] = useState(taskRail);
  const [taskSearchState, setTaskSearchState] = useState<ChatSearchResponse | null>(null);
  const [taskSearchLoading, setTaskSearchLoading] = useState(false);
  const [taskSearchError, setTaskSearchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDesktopSidebar, setIsDesktopSidebar] = useState(false);
  const [focusSearchOnExpand, setFocusSearchOnExpand] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [connectorCatalog, setConnectorCatalog] = useState<IntegrationProviderStatus[]>([]);
  const [connectorLoading, setConnectorLoading] = useState(false);
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const deferredSearch = useDeferredValue(search);

  const currentThreadId = searchParams.get("thread");
  const selectedProjectIdFromRoute = searchParams.get("project");
  const newTaskRequested = searchParams.get("new") === "1";
  const deferredQuery = deferredSearch.trim();
  const searchReady = deferredQuery.length >= 2;
  const searchActive = deferredQuery.length > 0;
  const compactSidebar = sidebarCollapsed && isDesktopSidebar;

  useEffect(() => {
    setTaskRailState(taskRail);
  }, [taskRail]);

  useEffect(() => {
    if (searchActive) {
      setSearchPanelOpen(true);
    }
  }, [searchActive]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const sync = () => setIsDesktopSidebar(media.matches);
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
      if (stored) {
        setSidebarCollapsed(stored === "true");
      }
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      return;
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    document.body.classList.toggle("left-rail-collapsed", compactSidebar);
    return () => document.body.classList.remove("left-rail-collapsed");
  }, [compactSidebar]);

  useEffect(() => {
    if (!focusSearchOnExpand || compactSidebar) {
      return;
    }
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 90);
    setFocusSearchOnExpand(false);
    return () => window.clearTimeout(timer);
  }, [compactSidebar, focusSearchOnExpand]);

  useEffect(() => {
    if (!projectModalOpen || !activeWorkspaceId) {
      return;
    }

    let cancelled = false;
    setConnectorLoading(true);

    void (async () => {
      try {
        const response = await fetch(`/api/admin/integrations?workspace_id=${activeWorkspaceId}`, {
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => null)) as
          | { providers?: IntegrationProviderStatus[] }
          | { detail?: string }
          | null;

        if (cancelled) {
          return;
        }

        const providers =
          response.ok && payload && "providers" in payload && Array.isArray(payload.providers)
            ? payload.providers
            : [];
        setConnectorCatalog(providers.length > 0 ? providers : FALLBACK_CONNECTORS);
      } catch {
        if (!cancelled) {
          setConnectorCatalog(FALLBACK_CONNECTORS);
        }
      } finally {
        if (!cancelled) {
          setConnectorLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectModalOpen, activeWorkspaceId]);

  useEffect(() => {
    if (!projectModalOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [projectModalOpen]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({ workspace_id: activeWorkspaceId });
    const endpoint = searchReady
      ? (() => {
          query.set("q", deferredQuery);
          if (selectedProjectIdFromRoute) {
            query.set("project_id", selectedProjectIdFromRoute);
          }
          query.set("limit", "24");
          return `/api/chat/search?${query.toString()}`;
        })()
      : `/api/chat/task-rail?${query.toString()}`;

    if (searchReady) {
      setTaskSearchLoading(true);
      setTaskSearchError(null);
    } else {
      setTaskSearchLoading(false);
      setTaskSearchError(null);
    }

    void (async () => {
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => null)) as
          | ChatTaskRailData
          | ChatSearchResponse
          | { detail?: string }
          | null;

        if (controller.signal.aborted) {
          return;
        }

        if (!response.ok) {
          if (searchReady) {
            setTaskSearchState(null);
            setTaskSearchError(
              typeof payload === "object" && payload && "detail" in payload && payload.detail
                ? payload.detail
                : "Search is unavailable right now."
            );
          }
          return;
        }

        if (searchReady) {
          setTaskSearchState(payload as ChatSearchResponse);
        } else {
          const nextTaskRail = payload as ChatTaskRailData;
          setTaskRailState({
            ...nextTaskRail,
            projects: sortProjects(nextTaskRail.projects ?? [])
          });
          setTaskSearchState(null);
        }
      } catch {
        if (!controller.signal.aborted && searchReady) {
          setTaskSearchState(null);
          setTaskSearchError("Search is unavailable right now.");
        }
      } finally {
        if (!controller.signal.aborted && searchReady) {
          setTaskSearchLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [activeWorkspaceId, deferredQuery, pathname, searchReady, selectedProjectIdFromRoute, searchParamKey]);

  const projects = useMemo(() => sortProjects(taskRailState?.projects ?? []), [taskRailState?.projects]);
  const allThreads = useMemo(() => {
    return [...(taskRailState?.threads ?? [])].sort((left, right) => {
      const leftAt = left.last_activity_at ?? left.updated_at;
      const rightAt = right.last_activity_at ?? right.updated_at;
      return rightAt.localeCompare(leftAt) || left.title.localeCompare(right.title);
    });
  }, [taskRailState?.threads]);
  const currentThread = useMemo(
    () => allThreads.find((thread) => thread.id === currentThreadId) ?? null,
    [allThreads, currentThreadId]
  );
  const selectedProjectId = selectedProjectIdFromRoute ?? currentThread?.project_id ?? null;
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );
  const groupedSearchResults = useMemo(
    () => compactSearchGroups(taskSearchState?.results ?? []),
    [taskSearchState?.results]
  );

  const firstVisibleThreadId = allThreads[0]?.id ?? null;
  const newTaskHref = taskRailHref(activeWorkspaceId, selectedProjectId, null, true);
  const allTasksHref = taskRailHref(activeWorkspaceId, null, currentThreadId ?? firstVisibleThreadId);
  const cappedProjectsList = projects.length > 4;
  const cappedAllTasksList = allThreads.length > 4;

  const navItems = useMemo(
    () => [
      {
        label: "New task",
        icon: MessageSquarePlus,
        href: newTaskHref,
        active: pathname === "/app/chat" && newTaskRequested
      },
      {
        label: "Agent",
        icon: Bot,
        href: withWorkspacePath("/app/agents", activeWorkspaceId),
        active: pathname === "/app/agents"
      },
      {
        label: "Library",
        icon: BookOpen,
        href: withWorkspacePath("/app/library", activeWorkspaceId),
        active: pathname === "/app/library"
      }
    ],
    [activeWorkspaceId, newTaskHref, newTaskRequested, pathname]
  );

  const bottomItems = useMemo(
    () => [
      {
        label: "Plugins",
        icon: PlugZap,
        href: withWorkspacePath("/app/plugins", activeWorkspaceId),
        active: pathname === "/app/plugins"
      },
      {
        label: "Automation",
        icon: Workflow,
        href: withWorkspacePath("/app/automations", activeWorkspaceId),
        active: pathname === "/app/automations"
      }
    ],
    [activeWorkspaceId, pathname]
  );

  function openSearch() {
    if (compactSidebar) {
      setSidebarCollapsed(false);
      setFocusSearchOnExpand(true);
      setSearchPanelOpen(true);
      return;
    }
    setSearchPanelOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 60);
  }

  function openProjectModal() {
    if (compactSidebar) {
      setSidebarCollapsed(false);
    }
    setProjectModalOpen(true);
    setProjectError(null);
  }

  function closeProjectModal() {
    setProjectModalOpen(false);
    setProjectName("");
    setProjectDescription("");
    setSelectedConnectors([]);
    setProjectError(null);
  }

  function toggleConnector(key: string) {
    setSelectedConnectors((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key]
    );
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/signin");
    router.refresh();
  }

  function switchWorkspace(nextWorkspaceId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("workspace", nextWorkspaceId);
    params.delete("thread");
    params.delete("project");
    params.delete("new");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
    router.refresh();
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId || !projectName.trim() || projectSubmitting) {
      return;
    }

    setProjectSubmitting(true);
    setProjectError(null);

    try {
      const payload: ChatProjectCreatePayload = {
        workspace_id: activeWorkspaceId,
        name: projectName.trim(),
        description: projectDescription.trim() || null,
        connectors: selectedConnectors
      };
      const response = await fetch("/api/chat/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const created = (await response.json().catch(() => ({
        detail: "Project creation failed."
      }))) as Partial<ProjectSummary> & { detail?: string; metadata?: Record<string, unknown> };

      if (!response.ok) {
        setProjectError(created.detail ?? "Project creation failed.");
        setProjectSubmitting(false);
        return;
      }

      const nextProject: ProjectSummary = {
        id: String(created.id ?? `project-${Date.now()}`),
        workspace_id: String(created.workspace_id ?? activeWorkspaceId),
        name: String(created.name ?? payload.name),
        description: typeof created.description === "string" ? created.description : null,
        status: String(created.status ?? "active"),
        metadata: created.metadata ?? { connectors: payload.connectors ?? [] },
        created_at: String(created.created_at ?? new Date().toISOString()),
        updated_at: String(created.updated_at ?? new Date().toISOString()),
        thread_count: Number(created.thread_count ?? 0),
        last_activity_at: (created.last_activity_at as string | null | undefined) ?? null
      };

      setTaskRailState((current) => ({
        workspace_id: current?.workspace_id ?? activeWorkspaceId,
        projects: sortProjects([
          nextProject,
          ...(current?.projects ?? []).filter((project) => project.id !== nextProject.id)
        ]),
        threads: current?.threads ?? []
      }));

      closeProjectModal();
      router.push(taskRailHref(activeWorkspaceId, nextProject.id));
      router.refresh();
    } catch {
      setProjectError("Project service is unavailable right now.");
    } finally {
      setProjectSubmitting(false);
    }
  }

  function renderProjectRow(project: ProjectSummary | null, label = "All tasks") {
    const active = project ? selectedProjectId === project.id : !selectedProjectId;
    const href = project
      ? taskRailHref(
          activeWorkspaceId,
          project.id,
          currentThread?.project_id === project.id ? currentThread.id : null
        )
      : allTasksHref;
    const taskCount = project?.thread_count ?? taskRailState?.threads.length ?? 0;

    return (
      <Link
        key={project?.id ?? "__all__"}
        href={href}
        className={cn("sidebar-list-item", active && "sidebar-list-item-active")}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{project?.name ?? label}</p>
          <p className="mt-0.5 truncate text-xs text-black/[0.42]">
            {project?.last_activity_at
              ? `${taskCount} tasks · ${formatRelativeTime(project.last_activity_at)}`
              : `${taskCount} tasks`}
          </p>
        </div>
      </Link>
    );
  }

  function renderThreadRow(thread: Thread) {
    const active =
      pathname === "/app/chat" &&
      (currentThreadId ? currentThreadId === thread.id : firstVisibleThreadId === thread.id);
    const project = thread.project_id ? projects.find((entry) => entry.id === thread.project_id) : null;
    const replayHref = taskReplayHref(activeWorkspaceId, thread.project_id ?? null, thread.id);

    return (
      <div
        key={thread.id}
        className={cn(
          "group flex items-center gap-2 rounded-2xl px-3 py-2 transition",
          active ? "bg-black/[0.06]" : "hover:bg-black/[0.03]"
        )}
      >
        <Link
          href={taskRailHref(activeWorkspaceId, thread.project_id ?? null, thread.id)}
          className="min-w-0 flex-1"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{thread.title}</p>
            <p className="mt-0.5 truncate text-xs text-black/[0.42]">
              {project ? `${project.name} · ` : ""}
              {formatRelativeTime(thread.last_activity_at ?? thread.updated_at)}
            </p>
          </div>
        </Link>
        {thread.last_message_preview ? (
          <Link
            href={replayHref}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.54] opacity-0 transition hover:bg-black/[0.03] group-hover:opacity-100 focus:opacity-100",
              active && "opacity-100"
            )}
            aria-label={`Replay ${thread.title}`}
            title={`Replay ${thread.title}`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    );
  }

  function renderSearchRow(result: SearchResult) {
    const title =
      result.thread?.title ??
      result.project?.name ??
      result.document?.title ??
      result.artifact?.title ??
      "Result";
    const subtitle =
      result.highlight ??
      result.project?.description ??
      result.document?.source_type ??
      result.artifact?.kind ??
      "";

    return (
      <Link
        key={`${result.kind}-${title}-${result.score}`}
        href={searchResultHref(result, activeWorkspaceId, deferredQuery)}
        className="sidebar-search-result"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-black/[0.78]">{title}</p>
          <p className="mt-0.5 truncate text-xs text-black/[0.42]">{subtitle}</p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.16em] text-black/[0.34]">
          {result.kind}
        </span>
      </Link>
    );
  }

  function renderProjectModal() {
    const availableConnectors = connectorCatalog.length > 0 ? connectorCatalog : FALLBACK_CONNECTORS;

    if (typeof document === "undefined") {
      return null;
    }

    return createPortal(
      <div
        className="sidebar-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
        onClick={closeProjectModal}
      >
        <div
          className="w-full max-w-[560px] rounded-[30px] border border-black/10 bg-white p-6 shadow-[0_40px_100px_rgba(17,19,24,0.16)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-project-title"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-black/[0.38]">New project</p>
              <h2
                id="create-project-title"
                className="mt-2 text-[1.9rem] font-semibold tracking-[-0.03em] text-black"
              >
                Create a new project
              </h2>
              <p className="mt-2 max-w-md text-sm leading-7 text-black/[0.6]">
                Add a short description and pick the connectors this project should be aligned with from day one.
              </p>
            </div>
            <button
              type="button"
              onClick={closeProjectModal}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.68] transition hover:bg-black/[0.03]"
              aria-label="Close project modal"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={createProject} className="mt-6 space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-black/[0.78]">Project name</label>
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Enter a project name"
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none placeholder:text-black/[0.32]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-black/[0.78]">Description</label>
              <textarea
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                placeholder="Describe the objective, tone, or operating constraints for this project."
                rows={5}
                className="w-full resize-none rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm leading-7 outline-none placeholder:text-black/[0.32]"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-black/[0.78]">Connectors</label>
                {connectorLoading ? (
                  <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-black/[0.42]">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    Loading
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {availableConnectors.map((connector) => {
                  const selected = selectedConnectors.includes(connector.key);
                  return (
                    <button
                      key={connector.key}
                      type="button"
                      onClick={() => toggleConnector(connector.key)}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition",
                        selected
                          ? "border-black bg-black text-white"
                          : "border-black/10 bg-white text-black/[0.68] hover:bg-black/[0.03]"
                      )}
                    >
                      <span className="capitalize">{connectorLabel(connector)}</span>
                      <span
                        className={cn(
                          "text-[10px] uppercase tracking-[0.16em]",
                          selected ? "text-white/70" : "text-black/[0.42]"
                        )}
                      >
                        {connector.configured ? "ready" : "optional"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {projectError ? <p className="text-sm text-red-700">{projectError}</p> : null}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeProjectModal}
                className="rounded-full border border-black/10 px-4 py-2 text-sm text-black/[0.62] transition hover:bg-black/[0.03]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={projectSubmitting || !projectName.trim()}
                className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-2.5 text-sm text-white transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {projectSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderKanban className="h-4 w-4" />}
                <span>Create project</span>
              </button>
            </div>
          </form>
        </div>
      </div>,
      document.body
    );
  }

  if (compactSidebar) {
    return (
      <>
        <aside className="shell-sidebar flex h-full min-h-0 flex-col items-center gap-3 px-2 py-3">
          <div className="flex w-full items-center justify-between px-1">
            <Link
              href={withWorkspacePath("/app/chat", activeWorkspaceId)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black text-white"
              aria-label="Swarm"
              title={activeWorkspace?.workspace_name ?? "Swarm"}
            >
              <Sparkles className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.68] transition hover:bg-black/[0.03]"
              aria-label="Expand left rail"
              title="Expand left rail"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex w-full flex-col items-center gap-2">
            <Link href={newTaskHref} className="sidebar-icon-button sidebar-icon-button-active" aria-label="New task" title="New task">
              <MessageSquarePlus className="h-4 w-4" />
            </Link>
            <button type="button" onClick={openSearch} className="sidebar-icon-button" aria-label="Search" title="Search">
              <Search className="h-4 w-4" />
            </button>
            <Link
              href={withWorkspacePath("/app/agents", activeWorkspaceId)}
              className={cn("sidebar-icon-button", pathname === "/app/agents" && "sidebar-icon-button-active")}
              aria-label="Agent"
              title="Agent"
            >
              <Bot className="h-4 w-4" />
            </Link>
            <Link
              href={withWorkspacePath("/app/library", activeWorkspaceId)}
              className={cn("sidebar-icon-button", pathname === "/app/library" && "sidebar-icon-button-active")}
              aria-label="Library"
              title="Library"
            >
              <BookOpen className="h-4 w-4" />
            </Link>
            <button type="button" onClick={openProjectModal} className="sidebar-icon-button" aria-label="New project" title="New project">
              <FolderPlus className="h-4 w-4" />
            </button>
            <Link
              href={allTasksHref}
              className={cn("sidebar-icon-button", pathname === "/app/chat" && !searchActive && "sidebar-icon-button-active")}
              aria-label="All tasks"
              title="All tasks"
            >
              <History className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-auto flex w-full flex-col items-center gap-2">
            {bottomItems.map(({ label, href, icon: Icon, active }) => (
              <Link
                key={label}
                href={href}
                className={cn("sidebar-icon-button", active && "sidebar-icon-button-active")}
                aria-label={label}
                title={label}
              >
                <Icon className="h-4 w-4" />
              </Link>
            ))}
            <button
              type="button"
              onClick={signOut}
              className="sidebar-icon-button"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>
        {projectModalOpen ? renderProjectModal() : null}
      </>
    );
  }

  return (
    <>
      <aside className="shell-sidebar flex h-full min-h-0 flex-col px-3 py-4">
        <div className="flex items-center justify-between gap-3 px-2">
          <Link href={withWorkspacePath("/app/chat", activeWorkspaceId)} className="min-w-0">
            <p className="text-lg font-semibold tracking-[-0.02em] text-black">swarm</p>
            <p className="truncate text-xs uppercase tracking-[0.18em] text-black/[0.38]">
              {activeWorkspace?.workspace_name ?? "Workspace"}
            </p>
          </Link>
          {isDesktopSidebar ? (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.68] transition hover:bg-black/[0.03]"
              aria-label="Collapse left rail"
              title="Collapse left rail"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <nav className="mt-5 space-y-1">
          {navItems.slice(0, 1).map(({ label, href, icon: Icon, active }) => (
            <Link key={label} href={href} className={cn("sidebar-nav-item", active && "sidebar-nav-item-active")}>
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={openSearch}
            className={cn("sidebar-nav-item w-full text-left", (searchPanelOpen || searchActive) && "sidebar-nav-item-active")}
          >
            <Search className="h-4 w-4" />
            <span>Search</span>
          </button>
          {navItems.slice(1).map(({ label, href, icon: Icon, active }) => (
            <Link key={label} href={href} className={cn("sidebar-nav-item", active && "sidebar-nav-item-active")}>
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        {searchPanelOpen ? (
          <section className="mt-4">
            <div className="sidebar-search-shell">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-black/[0.36]" />
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={selectedProject ? `Search ${selectedProject.name}` : "Search"}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-black/[0.34]"
                />
              </div>
            </div>
            {searchActive ? (
              <div className="mt-3 space-y-3">
                {!searchReady ? (
                  <p className="px-2 text-xs text-black/[0.42]">Type at least 2 characters to search.</p>
                ) : taskSearchLoading ? (
                  <p className="px-2 text-xs text-black/[0.42]">Searching workspace...</p>
                ) : taskSearchError ? (
                  <p className="px-2 text-xs text-red-700">{taskSearchError}</p>
                ) : groupedSearchResults.length > 0 ? (
                  groupedSearchResults.map((group) => (
                    <div key={group.key} className="space-y-1.5">
                      <p className="sidebar-section-title px-2">{group.label}</p>
                      {group.items.slice(0, 5).map((item) => renderSearchRow(item))}
                    </div>
                  ))
                ) : (
                  <p className="px-2 text-xs text-black/[0.42]">No results yet for this query.</p>
                )}
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
          <section className="space-y-2">
            <div className="flex items-center justify-between px-2">
              <p className="sidebar-section-title">Projects</p>
              <button
                type="button"
                onClick={openProjectModal}
                className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs text-black/[0.54] transition hover:bg-black/[0.03]"
                aria-label="New project"
                title="New project"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                <span>New project</span>
              </button>
            </div>
            <div
              className={cn(
                "space-y-1.5",
                cappedProjectsList &&
                  "sidebar-scroll-column max-h-[16rem] overflow-y-auto pr-1"
              )}
            >
              {projects.length > 0 ? (
                projects.map((project) => renderProjectRow(project))
              ) : (
                <div className="px-2 py-1 text-xs text-black/[0.42]">No projects yet.</div>
              )}
            </div>
          </section>

          <section className="mt-6 space-y-2">
            <div className="flex items-center justify-between px-2">
              <p className="sidebar-section-title">All tasks</p>
              <Link href={allTasksHref} className="text-xs text-black/[0.44] transition hover:text-black">
                Open
              </Link>
            </div>
            <div
              className={cn(
                "space-y-1.5",
                cappedAllTasksList &&
                  "sidebar-scroll-column max-h-[16rem] overflow-y-auto pr-1"
              )}
            >
              {allThreads.length > 0 ? (
                allThreads.map((thread) => renderThreadRow(thread))
              ) : (
                <div className="rounded-2xl border border-dashed border-black/10 px-3 py-3 text-xs text-black/[0.42]">
                  No task history yet.
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="mt-4 border-t border-black/8 pt-4">
          <nav className="space-y-1">
            {bottomItems.map(({ label, href, icon: Icon, active }) => (
              <Link key={label} href={href} className={cn("sidebar-nav-item", active && "sidebar-nav-item-active")}>
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>

          {session.workspaces.length > 1 ? (
            <div className="mt-4 px-2">
              <select
                value={activeWorkspaceId ?? ""}
                onChange={(event) => switchWorkspace(event.target.value)}
                className="w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm text-black/[0.66] outline-none"
              >
                {session.workspaces.map((workspace) => (
                  <option key={workspace.workspace_id} value={workspace.workspace_id}>
                    {workspace.workspace_name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <button
            type="button"
            onClick={signOut}
            className="sidebar-nav-item mt-3 w-full text-left text-black/[0.62]"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      {projectModalOpen ? renderProjectModal() : null}
    </>
  );
}
