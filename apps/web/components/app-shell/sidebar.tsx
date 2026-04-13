"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Bot,
  BookOpen,
  Boxes,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  FolderOpen,
  FolderPlus,
  History,
  Layers3,
  LoaderCircle,
  LogOut,
  MessageSquarePlus,
  Search,
  Settings2,
  ShieldCheck,
  TimerReset
} from "lucide-react";
import type {
  AuthProfile,
  ChatSearchResponse,
  ChatProjectCreatePayload,
  ChatTaskRailData,
  ProjectSummary,
  SearchResult,
  Thread
} from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { resolveActiveWorkspace, withWorkspacePath } from "@/lib/workspace";

const workspaceItems = [
  { href: "/app/agents", label: "Agents", icon: Bot },
  { href: "/app/library", label: "Library", icon: Layers3 },
  { href: "/app/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/app/artifacts", label: "Artifacts", icon: Boxes },
  { href: "/app/automations", label: "Automations", icon: TimerReset },
  { href: "/app/monitor", label: "Monitor", icon: Activity },
  { href: "/app/admin", label: "Admin", icon: ShieldCheck },
  { href: "/app/settings", label: "Settings", icon: Settings2 }
];

const SIDEBAR_COLLAPSE_STORAGE_KEY = "swarm.sidebar.collapsed.v1";

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

function splitItems<T>(items: T[]) {
  return {
    recent: items.slice(0, 4),
    history: items.slice(4)
  };
}

function sortProjects(projects: ProjectSummary[]) {
  return [...projects].sort((left, right) => {
    const leftAt = left.last_activity_at ?? left.updated_at;
    const rightAt = right.last_activity_at ?? right.updated_at;
    return rightAt.localeCompare(leftAt) || left.name.localeCompare(right.name);
  });
}

type TaskRailDisplayItem = {
  thread: Thread;
  highlight: string | null;
  matched_by: string[];
  score?: number;
};

type GroupedProjectTasks = {
  key: string;
  label: string;
  description: string;
  items: TaskRailDisplayItem[];
};

type SearchResultGroup = {
  key: "project" | "task" | "document" | "artifact";
  label: string;
  description: string;
  items: SearchResult[];
};

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
  const requestedWorkspaceId = searchParams.get("workspace");
  const activeWorkspace = resolveActiveWorkspace(session, requestedWorkspaceId);
  const activeWorkspaceId = activeWorkspace?.workspace_id ?? session.workspaces[0]?.workspace_id ?? null;
  const [taskRailState, setTaskRailState] = useState(taskRail);
  const [taskSearchState, setTaskSearchState] = useState<ChatSearchResponse | null>(null);
  const [taskSearchLoading, setTaskSearchLoading] = useState(false);
  const [taskSearchError, setTaskSearchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDesktopSidebar, setIsDesktopSidebar] = useState(false);
  const [focusSearchOnExpand, setFocusSearchOnExpand] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const deferredSearch = useDeferredValue(search);
  const searchParamKey = searchParams.toString();
  const currentThreadId = searchParams.get("thread");
  const currentThread = taskRailState?.threads.find((thread) => thread.id === currentThreadId) ?? null;
  const selectedProjectId = searchParams.get("project") ?? currentThread?.project_id ?? null;
  const searchQuery = deferredSearch.trim();
  const searchReady = searchQuery.length >= 2;
  const searchActive = searchQuery.length > 0;
  const compactSidebar = sidebarCollapsed && isDesktopSidebar;

  useEffect(() => {
    setTaskRailState(taskRail);
  }, [taskRail]);

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
      const rawValue = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
      if (!rawValue) {
        return;
      }
      setSidebarCollapsed(rawValue === "true");
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
    return () => {
      document.body.classList.remove("left-rail-collapsed");
    };
  }, [compactSidebar]);

  useEffect(() => {
    if (!focusSearchOnExpand || compactSidebar) {
      return;
    }
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 60);
    setFocusSearchOnExpand(false);
    return () => window.clearTimeout(timer);
  }, [compactSidebar, focusSearchOnExpand]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({ workspace_id: activeWorkspaceId });
    const endpoint = searchReady
      ? (() => {
          query.set("q", searchQuery);
          if (selectedProjectId) {
            query.set("project_id", selectedProjectId);
          }
          query.set("limit", "40");
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
          setTaskSearchError(null);
        } else {
          const nextTaskRail = payload as ChatTaskRailData;
          setTaskRailState({
            ...nextTaskRail,
            projects: sortProjects(nextTaskRail.projects ?? [])
          });
          setTaskSearchState(null);
          setTaskSearchError(null);
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
  }, [activeWorkspaceId, pathname, searchParamKey, searchQuery, searchReady, selectedProjectId]);

  const projects = useMemo(() => sortProjects(taskRailState?.projects ?? []), [taskRailState?.projects]);
  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const projectLeadThreadIds = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const thread of taskRailState?.threads ?? []) {
      if (!thread.project_id || mapping.has(thread.project_id)) {
        continue;
      }
      mapping.set(thread.project_id, thread.id);
    }
    return mapping;
  }, [taskRailState?.threads]);

  const filteredThreads = useMemo(() => {
    const threads = taskRailState?.threads ?? [];
    const normalizedQuery = searchQuery.toLowerCase();
    if (!normalizedQuery) {
      return threads;
    }

    return threads.filter((thread) => {
      const haystack = [thread.title, thread.last_message_preview ?? "", thread.status]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [searchQuery, taskRailState?.threads]);

  const displayItems = useMemo<TaskRailDisplayItem[]>(() => {
    return filteredThreads.map((thread) => ({
      thread,
      highlight: null,
      matched_by: []
    }));
  }, [filteredThreads]);

  const scopedDisplayItems = useMemo(
    () =>
      selectedProjectId
        ? displayItems.filter((item) => item.thread.project_id === selectedProjectId)
        : displayItems,
    [displayItems, selectedProjectId]
  );

  const groupedProjectTasks = useMemo<GroupedProjectTasks[]>(() => {
    if (selectedProjectId || searchActive) {
      return [];
    }

    const grouped = new Map<string, TaskRailDisplayItem[]>();
    for (const item of displayItems) {
      const key = item.thread.project_id ?? "__general__";
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)?.push(item);
    }

    const groups: GroupedProjectTasks[] = [];
    for (const project of projects) {
      const items = grouped.get(project.id) ?? [];
      if (!items.length) {
        continue;
      }
      groups.push({
        key: project.id,
        label: project.name,
        description: project.description ?? "Project tasks",
        items: items.slice(0, 3)
      });
    }
    const generalItems = grouped.get("__general__") ?? [];
    if (generalItems.length > 0) {
      groups.push({
        key: "__general__",
        label: "General",
        description: "Unassigned tasks",
        items: generalItems.slice(0, 3)
      });
    }
    return groups;
  }, [displayItems, projects, searchActive, selectedProjectId]);
  const selectedProject = selectedProjectId ? projectMap.get(selectedProjectId) ?? null : null;

  const groupedSearchResults = useMemo<SearchResultGroup[]>(() => {
    if (!searchReady) {
      return [];
    }

    const buckets: Record<SearchResultGroup["key"], SearchResult[]> = {
      project: [],
      task: [],
      document: [],
      artifact: []
    };
    for (const result of taskSearchState?.results ?? []) {
      buckets[result.kind].push(result);
    }

    const nextGroups: SearchResultGroup[] = [
      {
        key: "project",
        label: "Projects",
        description: selectedProject
          ? `Project-level matches inside ${selectedProject.name}`
          : "Matched initiatives and project spaces.",
        items: buckets.project
      },
      {
        key: "task",
        label: "Tasks",
        description: selectedProject
          ? `Task history in ${selectedProject.name}`
          : "Matched task history, conversations, and run outputs.",
        items: buckets.task
      },
      {
        key: "document",
        label: "Documents",
        description: selectedProject
          ? `Project-linked knowledge sources for ${selectedProject.name}`
          : "Knowledge-base sources, uploads, and retrieval memory.",
        items: buckets.document
      },
      {
        key: "artifact",
        label: "Artifacts",
        description: selectedProject
          ? `Deliverables and generated files linked to ${selectedProject.name}`
          : "Generated outputs, exports, captures, and deliverables.",
        items: buckets.artifact
      }
    ];

    return nextGroups.filter((group) => group.items.length > 0);
  }, [searchReady, selectedProject, taskSearchState?.results]);

  const { recent, history } = useMemo(() => splitItems(scopedDisplayItems), [scopedDisplayItems]);
  const firstVisibleThreadId = scopedDisplayItems[0]?.thread.id ?? null;
  const newTaskHref = taskRailHref(activeWorkspaceId, selectedProjectId, null, true);
  const currentFocusHref = taskRailHref(
    activeWorkspaceId,
    selectedProjectId,
    currentThreadId ?? firstVisibleThreadId
  );
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
        description: projectDescription.trim() || null
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
      }))) as Partial<ProjectSummary> & { detail?: string };
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
        created_at: String(created.created_at ?? new Date().toISOString()),
        updated_at: String(created.updated_at ?? new Date().toISOString()),
        thread_count: Number(created.thread_count ?? 0),
        last_activity_at: (created.last_activity_at as string | null | undefined) ?? null
      };

      setTaskRailState((current) => ({
        workspace_id: current?.workspace_id ?? activeWorkspaceId,
        projects: sortProjects([nextProject, ...(current?.projects ?? []).filter((project) => project.id !== nextProject.id)]),
        threads: current?.threads ?? []
      }));
      setProjectFormOpen(false);
      setProjectName("");
      setProjectDescription("");
      router.push(taskRailHref(activeWorkspaceId, nextProject.id));
      router.refresh();
    } catch {
      setProjectError("Project service is unavailable right now.");
    } finally {
      setProjectSubmitting(false);
    }
  }

  function renderTaskItem(item: TaskRailDisplayItem, showProjectTag = false) {
    const thread = item.thread;
    const active =
      pathname === "/app/chat" &&
      (currentThreadId ? currentThreadId === thread.id : firstVisibleThreadId === thread.id);
    const project = thread.project_id ? projectMap.get(thread.project_id) : null;
    return (
      <Link
        key={thread.id}
        href={taskRailHref(activeWorkspaceId, thread.project_id ?? null, thread.id)}
        className={cn(
          "block rounded-[18px] border px-3.5 py-3 transition",
          active
            ? "border-transparent bg-ink text-white"
            : "border-black/10 bg-white/[0.58] text-black/[0.72] hover:bg-white"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-medium">{thread.title}</p>
          <span
            className={cn(
              "text-[11px] uppercase tracking-[0.16em]",
              active ? "text-white/65" : "text-black/[0.42]"
            )}
          >
            {thread.run_count ?? 0} runs
          </span>
        </div>
        {showProjectTag && (
          <div
            className={cn(
              "mt-2 inline-flex rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.16em]",
              active ? "bg-white/12 text-white/70" : "bg-black/[0.05] text-black/[0.46]"
            )}
          >
            {project?.name ?? "General"}
          </div>
        )}
        {thread.last_message_preview && (
          <p
            className={cn(
              "mt-2 max-h-[3.4rem] overflow-hidden text-sm leading-6",
              active ? "text-white/75" : "text-black/[0.58]"
            )}
          >
            {item.highlight ?? thread.last_message_preview}
          </p>
        )}
        {item.matched_by.length > 0 && (
          <div
            className={cn(
              "mt-2.5 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em]",
              active ? "text-white/60" : "text-black/[0.42]"
            )}
          >
            {item.matched_by.map((source) => (
              <span
                key={`${thread.id}-${source}`}
                className={cn(
                  "rounded-full px-2 py-1",
                  active ? "bg-white/12" : "bg-black/[0.05]"
                )}
              >
                {source.replaceAll("_", " ")}
              </span>
            ))}
          </div>
        )}
        <div
          className={cn(
            "mt-2.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em]",
            active ? "text-white/55" : "text-black/[0.4]"
          )}
        >
          <span>{thread.message_count ?? 0} messages</span>
          <span>{formatRelativeTime(thread.last_activity_at ?? thread.updated_at)}</span>
        </div>
      </Link>
    );
  }

  function renderSearchResult(result: SearchResult) {
    if (result.kind === "task" && result.thread) {
      return renderTaskItem(
        {
          thread: result.thread,
          highlight: result.highlight,
          matched_by: result.matched_by,
          score: result.score
        },
        !selectedProjectId
      );
    }

    if (result.kind === "project" && result.project) {
      const projectSummary = projectMap.get(result.project.id);
      const active = selectedProjectId === result.project.id && pathname === "/app/chat";
      return (
        <Link
          key={`project-search-${result.project.id}`}
          href={taskRailHref(activeWorkspaceId, result.project.id, projectLeadThreadIds.get(result.project.id) ?? null)}
          className={cn(
            "block rounded-[18px] border px-3.5 py-3 transition",
            active
              ? "border-transparent bg-ink text-white"
              : "border-black/10 bg-white/[0.58] text-black/[0.72] hover:bg-white"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium">{result.project.name}</p>
            <span
              className={cn(
                "text-[11px] uppercase tracking-[0.16em]",
                active ? "text-white/65" : "text-black/[0.42]"
              )}
            >
              {projectSummary?.thread_count ?? 0} tasks
            </span>
          </div>
          <p className={cn("mt-2 text-sm leading-6", active ? "text-white/75" : "text-black/[0.58]")}>
            {result.highlight ?? result.project.description ?? "Project-level search match"}
          </p>
          {result.matched_by.length > 0 && (
            <div
              className={cn(
                "mt-2.5 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em]",
                active ? "text-white/60" : "text-black/[0.42]"
              )}
            >
              {result.matched_by.map((source) => (
                <span
                  key={`project-search-${result.project?.id}-${source}`}
                  className={cn("rounded-full px-2 py-1", active ? "bg-white/12" : "bg-black/[0.05]")}
                >
                  {source.replaceAll("_", " ")}
                </span>
              ))}
            </div>
          )}
        </Link>
      );
    }

    if (result.kind === "document" && result.document) {
      const active = pathname === "/app/knowledge";
      return (
        <Link
          key={`document-search-${result.document.id}`}
          href={knowledgeSearchHref(activeWorkspaceId, searchQuery, result.document.id)}
          className={cn(
            "block rounded-[18px] border px-3.5 py-3 transition",
            active
              ? "border-transparent bg-ink text-white"
              : "border-black/10 bg-white/[0.58] text-black/[0.72] hover:bg-white"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium">{result.document.title}</p>
            <span
              className={cn(
                "text-[11px] uppercase tracking-[0.16em]",
                active ? "text-white/65" : "text-black/[0.42]"
              )}
            >
              {result.document.source_type}
            </span>
          </div>
          <p className={cn("mt-2 text-sm leading-6", active ? "text-white/75" : "text-black/[0.58]")}>
            {result.highlight ?? result.document.source_uri ?? "Knowledge-base match"}
          </p>
          <div
            className={cn(
              "mt-2.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em]",
              active ? "text-white/55" : "text-black/[0.4]"
            )}
          >
            <span>{result.document.status}</span>
            <span>{formatRelativeTime(result.document.created_at)}</span>
          </div>
        </Link>
      );
    }

    if (result.kind === "artifact" && result.artifact) {
      const active = pathname === "/app/artifacts";
      return (
        <Link
          key={`artifact-search-${result.artifact.id}`}
          href={artifactSearchHref(activeWorkspaceId, searchQuery, result.artifact.id)}
          className={cn(
            "block rounded-[18px] border px-3.5 py-3 transition",
            active
              ? "border-transparent bg-ink text-white"
              : "border-black/10 bg-white/[0.58] text-black/[0.72] hover:bg-white"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium">{result.artifact.title}</p>
            <span
              className={cn(
                "text-[11px] uppercase tracking-[0.16em]",
                active ? "text-white/65" : "text-black/[0.42]"
              )}
            >
              {result.artifact.kind}
            </span>
          </div>
          <p className={cn("mt-2 break-all text-sm leading-6", active ? "text-white/75" : "text-black/[0.58]")}>
            {result.highlight ?? result.artifact.storage_key}
          </p>
          <div
            className={cn(
              "mt-2.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em]",
              active ? "text-white/55" : "text-black/[0.4]"
            )}
          >
            <span>{result.matched_by.join(" / ").replaceAll("_", " ")}</span>
            <span>{formatRelativeTime(result.artifact.created_at)}</span>
          </div>
        </Link>
      );
    }

    return null;
  }

  if (compactSidebar) {
    return (
      <aside className="shell-sidebar flex h-full min-h-0 flex-col gap-3 p-2.5">
        <div className="flex items-center justify-center px-1">
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/92 text-black/[0.72] transition hover:bg-sand/45"
            aria-label="Expand left rail"
            title="Expand left rail"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="surface-card flex flex-col items-center gap-2 p-2.5">
          <Link
            href={newTaskHref}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white transition hover:bg-ink/90"
            aria-label={selectedProject ? `New task in ${selectedProject.name}` : "New task"}
            title={selectedProject ? `New task in ${selectedProject.name}` : "New task"}
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={() => {
              setSidebarCollapsed(false);
              setFocusSearchOnExpand(true);
            }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.72] transition hover:bg-sand/45"
            aria-label="Open search"
            title="Open search"
          >
            <Search className="h-4 w-4" />
          </button>
          <Link
            href={taskRailHref(activeWorkspaceId, selectedProjectId, currentThreadId)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.72] transition hover:bg-sand/45"
            aria-label={selectedProject ? `${selectedProject.name} tasks` : "Project tasks"}
            title={selectedProject ? `${selectedProject.name} tasks` : "Project tasks"}
          >
            <FolderOpen className="h-4 w-4" />
          </Link>
          <Link
            href={currentFocusHref}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.72] transition hover:bg-sand/45"
            aria-label="All tasks history"
            title="All tasks history"
          >
            <FileSearch className="h-4 w-4" />
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          <div className="surface-card flex flex-col items-center gap-2 p-2.5">
            {workspaceItems.map((item) => {
              const Icon = item.icon;
              const href = withWorkspacePath(item.href, activeWorkspaceId);
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={href}
                  className={cn(
                    "inline-flex h-11 w-11 items-center justify-center rounded-full transition",
                    active ? "bg-black text-white" : "bg-white/[0.65] text-black/[0.72] hover:bg-white"
                  )}
                  aria-label={item.label}
                  title={item.label}
                >
                  <Icon className="h-4 w-4" />
                </Link>
              );
            })}
          </div>
        </div>

        <div className="surface-card flex flex-col items-center gap-2 p-2.5">
          <Link
            href={withWorkspacePath("/app", activeWorkspaceId)}
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-full transition",
              pathname === "/app" ? "bg-black text-white" : "bg-white/[0.65] text-black/[0.72] hover:bg-white"
            )}
            aria-label="Workspace overview"
            title="Workspace overview"
          >
            <Activity className="h-4 w-4" />
          </Link>
          <button
            onClick={signOut}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white/[0.75] text-black/[0.72] transition hover:bg-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="shell-sidebar flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="surface-card space-y-3 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="surface-label">Navigation</p>
            <p className="truncate text-sm text-black/[0.54]">
              {activeWorkspace?.workspace_name ?? "Workspace"}
            </p>
          </div>
          {isDesktopSidebar ? (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.72] transition hover:bg-sand/45"
              aria-label="Collapse left rail"
              title="Collapse left rail"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <Link
          href={newTaskHref}
          className="flex items-center gap-3 rounded-[18px] bg-ink px-3.5 py-3 text-sm text-white transition hover:bg-ink/90"
        >
          <MessageSquarePlus className="h-4 w-4" />
          {selectedProject ? `New Task in ${selectedProject.name}` : "New Task"}
        </Link>

        <div className="rounded-[18px] border border-black/10 bg-white px-3.5 py-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-black/[0.42]">
            <Search className="h-3.5 w-3.5" />
            Search
          </div>
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              selectedProject
                ? `Search ${selectedProject.name}`
                : "Search tasks, docs, artifacts"
            }
            className="mt-2.5 w-full bg-transparent text-sm leading-6 outline-none placeholder:text-black/[0.35]"
          />
        </div>

        {session.workspaces.length > 1 && (
          <div className="rounded-[18px] border border-black/10 bg-white/70 px-3.5 py-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-black/[0.42]">
              <FolderOpen className="h-3.5 w-3.5" />
              Workspace
            </div>
            <select
              value={activeWorkspaceId ?? ""}
              onChange={(event) => switchWorkspace(event.target.value)}
              className="mt-2.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none"
            >
              {session.workspaces.map((workspace) => (
                <option key={workspace.workspace_id} value={workspace.workspace_id}>
                  {workspace.workspace_name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <section className="surface-card p-3.5">
          <div className="mb-3 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-black/[0.42]">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5" />
              Projects
            </div>
            <button
              type="button"
              onClick={() => {
                setProjectFormOpen((current) => !current);
                setProjectError(null);
              }}
              className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.14em] text-black/[0.58] transition hover:bg-white"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New project
            </button>
          </div>

          {projectFormOpen && (
            <form onSubmit={createProject} className="mb-3 rounded-[18px] border border-black/10 bg-white/70 p-3">
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Project name"
                className="w-full rounded-2xl bg-sand/55 px-3 py-2 text-sm outline-none"
              />
              <textarea
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                placeholder="Short description"
                className="mt-3 min-h-[76px] w-full resize-none rounded-2xl bg-sand/55 px-3 py-2 text-sm outline-none"
              />
              {projectError && <p className="mt-3 text-sm text-red-700">{projectError}</p>}
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setProjectFormOpen(false);
                    setProjectError(null);
                  }}
                  className="rounded-full bg-black/[0.05] px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/[0.58]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={projectSubmitting || !projectName.trim()}
                  className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-2 text-xs uppercase tracking-[0.14em] text-white disabled:opacity-60"
                >
                  {projectSubmitting && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                  Create project
                </button>
              </div>
            </form>
          )}

          <div className="space-y-2">
            <Link
              href={taskRailHref(activeWorkspaceId, null, currentThreadId)}
              className={cn(
                "block rounded-[18px] border px-3.5 py-3 transition",
                !selectedProjectId
                  ? "border-transparent bg-black text-white"
                  : "border-black/10 bg-white/[0.58] text-black/[0.72] hover:bg-white"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">All Projects</p>
                <span className={cn("text-[11px] uppercase tracking-[0.16em]", !selectedProjectId ? "text-white/60" : "text-black/[0.42]")}>
                  {taskRailState?.threads.length ?? 0} tasks
                </span>
              </div>
              <p className={cn("mt-1.5 text-sm leading-6", !selectedProjectId ? "text-white/75" : "text-black/[0.56]")}>
                Cross-project task view.
              </p>
            </Link>

            {projects.length > 0 ? (
              projects.map((project) => {
                const active = selectedProjectId === project.id;
                return (
                  <Link
                    key={project.id}
                    href={taskRailHref(activeWorkspaceId, project.id, projectLeadThreadIds.get(project.id) ?? null)}
                    className={cn(
                      "block rounded-[18px] border px-3.5 py-3 transition",
                      active
                        ? "border-transparent bg-black text-white"
                        : "border-black/10 bg-white/[0.58] text-black/[0.72] hover:bg-white"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium">{project.name}</p>
                      <span
                        className={cn(
                          "text-[11px] uppercase tracking-[0.16em]",
                          active ? "text-white/60" : "text-black/[0.42]"
                        )}
                      >
                        {project.thread_count} tasks
                      </span>
                    </div>
                    <p className={cn("mt-1.5 text-sm leading-6", active ? "text-white/75" : "text-black/[0.56]")}>
                      {project.description ?? "Project task history"}
                    </p>
                    <div
                      className={cn(
                        "mt-2 text-[10px] uppercase tracking-[0.16em]",
                        active ? "text-white/55" : "text-black/[0.42]"
                      )}
                    >
                      {project.last_activity_at
                        ? `Active ${formatRelativeTime(project.last_activity_at)}`
                        : "No task runs yet"}
                    </div>
                  </Link>
                );
              })
            ) : (
              <div className="rounded-[18px] border border-dashed border-black/10 bg-white/55 px-3.5 py-3 text-sm text-black/[0.58]">
                Create the first project to organize task history by initiative.
              </div>
            )}
          </div>
        </section>

        <section className="surface-card p-3.5">
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-black/[0.42]">
            <History className="h-3.5 w-3.5" />
            {searchActive
              ? selectedProject
                ? `Search in ${selectedProject.name}`
                : "Global Search"
              : selectedProject
                ? `Recent Tasks in ${selectedProject.name}`
                : "Recent Tasks"}
          </div>
          <div className="space-y-3">
            {searchActive && !searchReady ? (
              <div className="rounded-[18px] border border-dashed border-black/10 bg-white/55 px-3.5 py-3 text-sm text-black/[0.58]">
                Type at least 2 characters to search projects, tasks, documents, and artifacts.
              </div>
            ) : searchReady && taskSearchLoading ? (
              <div className="rounded-[18px] border border-dashed border-black/10 bg-white/55 px-3.5 py-3 text-sm text-black/[0.58]">
                Searching across the workspace...
              </div>
            ) : searchReady && taskSearchError ? (
              <div className="rounded-[18px] border border-dashed border-black/10 bg-white/55 px-3.5 py-3 text-sm text-black/[0.58]">
                {taskSearchError}
              </div>
            ) : searchReady ? (
              groupedSearchResults.length > 0 ? (
                <div className="space-y-4">
                  <div className="rounded-[18px] border border-black/10 bg-white/60 p-3 text-sm text-black/[0.66]">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-black/[0.42]">
                      <span>{taskSearchState?.total_results ?? 0} matches</span>
                      {taskSearchState?.result_counts?.project ? (
                        <span className="rounded-full bg-black/[0.05] px-2 py-1">
                          {taskSearchState.result_counts.project} projects
                        </span>
                      ) : null}
                      {taskSearchState?.result_counts?.task ? (
                        <span className="rounded-full bg-black/[0.05] px-2 py-1">
                          {taskSearchState.result_counts.task} tasks
                        </span>
                      ) : null}
                      {taskSearchState?.result_counts?.document ? (
                        <span className="rounded-full bg-black/[0.05] px-2 py-1">
                          {taskSearchState.result_counts.document} docs
                        </span>
                      ) : null}
                      {taskSearchState?.result_counts?.artifact ? (
                        <span className="rounded-full bg-black/[0.05] px-2 py-1">
                          {taskSearchState.result_counts.artifact} artifacts
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 leading-6">
                      {selectedProject
                        ? `Showing broader search results connected to ${selectedProject.name}.`
                        : "Showing broader workspace search results across projects, task history, knowledge, and deliverables."}
                    </p>
                  </div>
                  {groupedSearchResults.map((group) => (
                    <div key={group.key} className="space-y-3">
                      <div className="rounded-[18px] border border-black/10 bg-white/60 p-3">
                        <p className="text-sm font-medium text-black/[0.82]">{group.label}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-black/[0.44]">
                          {group.description}
                        </p>
                      </div>
                      {group.items.map((item) => renderSearchResult(item))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[18px] border border-dashed border-black/10 bg-white/55 px-3.5 py-3 text-sm text-black/[0.58]">
                  {selectedProject
                    ? "No projects, tasks, documents, or artifacts matched inside this project scope."
                    : "No projects, tasks, documents, or artifacts matched the current search."}
                </div>
              )
            ) : recent.length > 0 ? (
              recent.map((item) => renderTaskItem(item, Boolean(searchActive && !selectedProjectId)))
            ) : (
              <div className="rounded-[18px] border border-dashed border-black/10 bg-white/55 px-3.5 py-3 text-sm text-black/[0.58]">
                {selectedProject
                  ? "This project does not have task history yet. Start its first task from the rail."
                  : "No task history yet. Start the first task from the rail."}
              </div>
            )}
          </div>
        </section>

        {!searchActive && !selectedProjectId && groupedProjectTasks.length > 0 && (
          <section className="surface-card p-3.5">
            <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-black/[0.42]">
              <Layers3 className="h-3.5 w-3.5" />
              Project Task Groups
            </div>
            <div className="space-y-3">
              {groupedProjectTasks.map((group) => (
                <div key={group.key} className="rounded-[18px] border border-black/10 bg-white/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-black/[0.82]">{group.label}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-black/[0.44]">
                        {group.description}
                      </p>
                    </div>
                    <Link
                      href={taskRailHref(activeWorkspaceId, group.key === "__general__" ? null : group.key)}
                      className="rounded-full bg-sand/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-black/[0.62] transition hover:bg-sand"
                    >
                      Open
                    </Link>
                  </div>
                  <div className="mt-3 space-y-2">
                    {group.items.map((item) => renderTaskItem(item))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!searchActive && (
          <section className="surface-card p-3.5">
            <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-black/[0.42]">
              <FileSearch className="h-3.5 w-3.5" />
              {selectedProject ? `${selectedProject.name} History` : "All Tasks"}
            </div>
            <div className="space-y-3">
              {history.map((item) => renderTaskItem(item))}
              {history.length === 0 && recent.length > 0 && (
                <div className="rounded-[18px] border border-dashed border-black/10 bg-white/55 px-3.5 py-3 text-sm text-black/[0.58]">
                  More task history will appear here as the workspace grows.
                </div>
              )}
            </div>
          </section>
        )}

        <section className="surface-card p-3.5">
          <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-black/[0.42]">Workspace Surfaces</p>
          <nav className="space-y-2">
            {workspaceItems.map((item) => {
              const Icon = item.icon;
              const href = withWorkspacePath(item.href, activeWorkspaceId);
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-[18px] px-3.5 py-2.5 text-sm transition",
                    active ? "bg-black text-white" : "bg-white/[0.55] text-black/70 hover:bg-white"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </section>
      </div>

      <div className="surface-card space-y-2 p-3">
        <Link
          href={withWorkspacePath("/app", activeWorkspaceId)}
            className={cn(
            "flex items-center gap-3 rounded-[18px] px-3.5 py-2.5 text-sm transition",
            pathname === "/app" ? "bg-black text-white" : "bg-white/[0.55] text-black/70 hover:bg-white"
          )}
        >
          <Activity className="h-4 w-4" />
          Workspace Overview
        </Link>
        <button
          onClick={signOut}
          className="w-full rounded-[18px] border border-black/10 bg-white/75 px-3.5 py-2.5 text-left text-sm text-black/[0.7] transition hover:bg-white"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
