"use client";

import { FormEvent, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Bot,
  FileText,
  Globe,
  Layers3,
  LoaderCircle,
  MessageSquareMore,
  SendHorizontal,
  Sparkles
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  ChatRun,
  ChatRunRequestPayload,
  ChatThreadCreatePayload,
  ChatWorkspaceData,
  LivePlanStep,
  LiveRunEvent,
  LiveRunStepState,
  Message,
  Thread
} from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

function statusLabel(status: string) {
  return status.replace(".", " ").replace("_", " ");
}

function statusBadgeClass(status: string) {
  if (status === "completed") {
    return "bg-pine text-white border-transparent";
  }
  if (status === "running" || status === "escalating") {
    return "bg-ink text-white border-transparent";
  }
  if (status === "failed") {
    return "bg-red-700 text-white border-transparent";
  }
  return "bg-white/75 text-black/70";
}

async function consumeEventStream(
  response: Response,
  onEvent: (event: LiveRunEvent) => void
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming response body is unavailable.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      let event = "message";
      const dataLines: string[] = [];

      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }

      if (!dataLines.length) {
        continue;
      }

      onEvent({
        event,
        data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>
      });
    }
  }
}

function upsertThread(threads: Thread[], thread: Thread) {
  const existing = threads.find((item) => item.id === thread.id);
  if (!existing) {
    return [thread, ...threads];
  }

  return threads
    .map((item) => (item.id === thread.id ? { ...item, ...thread } : item))
    .sort((left, right) => {
      const leftAt = left.last_activity_at ?? left.updated_at;
      const rightAt = right.last_activity_at ?? right.updated_at;
      return rightAt.localeCompare(leftAt);
    });
}

function upsertLiveStep(steps: LiveRunStepState[], next: LiveRunStepState) {
  const existing = steps.find((step) => step.step_index === next.step_index);
  if (!existing) {
    return [...steps, next].sort(
      (left, right) => left.batch_index - right.batch_index || left.step_index - right.step_index
    );
  }

  return steps
    .map((step) =>
      step.step_index === next.step_index
        ? {
            ...step,
            ...next,
            dependencies: next.dependencies.length ? next.dependencies : step.dependencies
          }
        : step
    )
    .sort((left, right) => left.batch_index - right.batch_index || left.step_index - right.step_index);
}

function provisionalThread(workspaceId: string, title: string): Thread {
  const now = new Date().toISOString();
  return {
    id: `local-thread-${Date.now()}`,
    workspace_id: workspaceId,
    title,
    status: "active",
    created_at: now,
    updated_at: now,
    message_count: 0,
    run_count: 0,
    last_message_preview: null,
    last_activity_at: now
  };
}

export function ChatWorkspace({ data }: { data: ChatWorkspaceData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [threads, setThreads] = useState(data.threads);
  const [messages, setMessages] = useState(data.messages);
  const [runs, setRuns] = useState(data.runs);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [livePlan, setLivePlan] = useState<LivePlanStep[]>([]);
  const [executionBatches, setExecutionBatches] = useState<string[][]>([]);
  const [liveSteps, setLiveSteps] = useState<LiveRunStepState[]>([]);
  const [activeBatchIndex, setActiveBatchIndex] = useState<number | null>(null);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(
    data.selected_thread_id ?? data.threads[0]?.id ?? null
  );

  const displayedPlan = useMemo(() => {
    if (livePlan.length > 0) {
      return livePlan;
    }
    return ((runs[0]?.plan ?? []) as LivePlanStep[]) ?? [];
  }, [livePlan, runs]);

  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const stepsByAgent = useMemo(
    () => Object.fromEntries(liveSteps.map((step) => [step.agent_key, step])),
    [liveSteps]
  );

  function syncThreadInUrl(threadId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (threadId) {
      params.set("thread", threadId);
    } else {
      params.delete("thread");
    }
    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(href, { scroll: false });
  }

  async function refreshWorkspace(threadId?: string | null) {
    const query = new URLSearchParams({ workspace_id: data.workspace_id });
    if (threadId) {
      query.set("thread_id", threadId);
    }

    setLoadingThread(true);
    try {
      const response = await fetch(`/api/chat/workspace?${query.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => ({
        detail: "Workspace refresh failed."
      }))) as Partial<ChatWorkspaceData> & { detail?: string };
      if (!response.ok) {
        setError(payload.detail ?? "Workspace refresh failed.");
        setLoadingThread(false);
        return;
      }
      setThreads(payload.threads ?? []);
      setMessages(payload.messages ?? []);
      setRuns(payload.runs ?? []);
      const selectedThreadId = payload.selected_thread_id ?? threadId ?? null;
      setCurrentThreadId(selectedThreadId);
      syncThreadInUrl(selectedThreadId);
      setError(null);
    } catch {
      setError("Workspace refresh is unavailable.");
    } finally {
      setLoadingThread(false);
    }
  }

  async function createThread() {
    if (running) {
      return;
    }

    const previousThreadId = currentThreadId;
    const previousMessages = messages;
    const previousRuns = runs;
    const previousLivePlan = livePlan;
    const previousExecutionBatches = executionBatches;
    const previousLiveSteps = liveSteps;
    const previousActiveBatchIndex = activeBatchIndex;
    const provisional = provisionalThread(data.workspace_id, "New thread");
    setThreads((current) => upsertThread(current, provisional));
    setCurrentThreadId(provisional.id);
    setMessages([]);
    setRuns([]);
    setLivePlan([]);
    setExecutionBatches([]);
    setLiveSteps([]);
    setActiveBatchIndex(null);
    setError(null);

    try {
      const payload: ChatThreadCreatePayload = {
        workspace_id: data.workspace_id,
        title: "New thread"
      };
      const response = await fetch("/api/chat/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const created = (await response.json().catch(() => ({
        detail: "Thread creation failed."
      }))) as Partial<Thread> & { detail?: string };
      if (!response.ok) {
        setError(created.detail ?? "Thread creation failed.");
        setThreads((current) => current.filter((item) => item.id !== provisional.id));
        setCurrentThreadId(previousThreadId);
        setMessages(previousMessages);
        setRuns(previousRuns);
        setLivePlan(previousLivePlan);
        setExecutionBatches(previousExecutionBatches);
        setLiveSteps(previousLiveSteps);
        setActiveBatchIndex(previousActiveBatchIndex);
        syncThreadInUrl(previousThreadId);
        return;
      }
      const nextThread: Thread = {
        id: String(created.id ?? provisional.id),
        workspace_id: String(created.workspace_id ?? data.workspace_id),
        title: String(created.title ?? "New thread"),
        status: String(created.status ?? "active"),
        created_at: String(created.created_at ?? provisional.created_at),
        updated_at: String(created.updated_at ?? provisional.updated_at),
        message_count: 0,
        run_count: 0,
        last_message_preview: null,
        last_activity_at: String(created.updated_at ?? provisional.updated_at)
      };
      setThreads((current) => upsertThread(current.filter((item) => item.id !== provisional.id), nextThread));
      setCurrentThreadId(nextThread.id);
      await refreshWorkspace(nextThread.id);
    } catch {
      setError("Thread creation is unavailable.");
      setThreads((current) => current.filter((item) => item.id !== provisional.id));
      setCurrentThreadId(previousThreadId);
      setMessages(previousMessages);
      setRuns(previousRuns);
      setLivePlan(previousLivePlan);
      setExecutionBatches(previousExecutionBatches);
      setLiveSteps(previousLiveSteps);
      setActiveBatchIndex(previousActiveBatchIndex);
      syncThreadInUrl(previousThreadId);
    }
  }

  async function handleThreadSelect(threadId: string) {
    if (running || threadId === currentThreadId) {
      return;
    }
    setLivePlan([]);
    setExecutionBatches([]);
    setLiveSteps([]);
    setActiveBatchIndex(null);
    await refreshWorkspace(threadId);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || running) {
      return;
    }

    let resolvedThreadId = currentThreadId;
    let resolvedRunId: string | null = null;

    const optimisticId = `local-user-${Date.now()}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      thread_id: resolvedThreadId ?? "pending-thread",
      run_id: null,
      role: "user",
      content: message,
      citations: [],
      metadata: {},
      created_at: new Date().toISOString()
    };

    setMessages((current) => [...current, optimisticMessage]);
    setDraft("");
    setError(null);
    setRunning(true);
    setLivePlan([]);
    setExecutionBatches([]);
    setLiveSteps([]);
    setActiveBatchIndex(null);

    const payload: ChatRunRequestPayload = {
      workspace_id: data.workspace_id,
      thread_id: currentThreadId,
      message,
      mode: "autonomous",
      use_retrieval: true
    };

    try {
      const response = await fetch("/api/chat/runs/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const failure = await response.json().catch(() => ({ detail: "Streaming failed." }));
        setError(failure.detail ?? "Streaming failed.");
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
        setRunning(false);
        return;
      }

      await consumeEventStream(response, (streamEvent) => {
        const { event, data } = streamEvent;
        if (event === "thread") {
          const threadId = String(data.thread_id ?? resolvedThreadId ?? "pending-thread");
          resolvedThreadId = threadId;
          const nextThread: Thread = {
            id: threadId,
            workspace_id: String(data.workspace_id ?? ""),
            title: String(data.title ?? message.slice(0, 70)),
            status: "active",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 0,
            run_count: 0,
            last_message_preview: message,
            last_activity_at: new Date().toISOString()
          };
          setCurrentThreadId(threadId);
          syncThreadInUrl(threadId);
          setThreads((current) => upsertThread(current, nextThread));
          setMessages((current) =>
            current.map((item) => (item.id === optimisticId ? { ...item, thread_id: threadId } : item))
          );
          return;
        }

        if (event === "run.created") {
          resolvedRunId = String(data.run_id ?? "");
          const provisionalRun: ChatRun = {
            id: resolvedRunId,
            thread_id: String(data.thread_id ?? resolvedThreadId ?? ""),
            workspace_id: String(data.workspace_id ?? ""),
            status: String(data.status ?? "running"),
            supervisor_model: "qwen3.5-flash",
            user_message: String(data.user_message ?? message),
            final_response: null,
            summary: null,
            plan: [],
            created_at: String(data.created_at ?? new Date().toISOString())
          };
          setRuns((current) => [provisionalRun, ...current.filter((item) => item.id !== provisionalRun.id)]);
          return;
        }

        if (event === "plan") {
          setLivePlan((data.plan as LivePlanStep[]) ?? []);
          if (resolvedRunId) {
            setRuns((current) =>
              current.map((run) =>
                run.id === resolvedRunId ? { ...run, plan: ((data.plan as ChatRun["plan"]) ?? []) } : run
              )
            );
          }
          return;
        }

        if (event === "batches") {
          setExecutionBatches((data.batches as string[][]) ?? []);
          return;
        }

        if (event === "batch.started") {
          setActiveBatchIndex(Number(data.batch_index ?? 0));
          return;
        }

        if (event === "batch.completed") {
          setActiveBatchIndex((current) =>
            current === Number(data.batch_index ?? -1) ? null : current
          );
          return;
        }

        if (event === "step.started") {
          setLiveSteps((current) =>
            upsertLiveStep(current, {
              step_index: Number(data.step_index ?? 0),
              batch_index: Number(data.batch_index ?? 0),
              agent_key: String(data.agent_key ?? ""),
              agent_name: String(data.agent_name ?? ""),
              status: String(data.status ?? "running"),
              objective: String(data.objective ?? ""),
              dependencies: ((data.dependencies as string[]) ?? []).map(String),
              execution_mode: String(data.execution_mode ?? "")
            })
          );
          return;
        }

        if (event === "step.escalated") {
          setLiveSteps((current) =>
            upsertLiveStep(current, {
              step_index: Number(data.step_index ?? 0),
              batch_index: Number(data.batch_index ?? 0),
              agent_key: String(data.agent_key ?? ""),
              agent_name: String(data.agent_name ?? ""),
              status: String(data.status ?? "escalating"),
              dependencies: [],
              validation_summary: String(
                ((data.validation as Record<string, unknown>)?.summary as string) ?? ""
              ),
              escalated: true
            })
          );
          return;
        }

        if (event === "step.completed") {
          setLiveSteps((current) =>
            upsertLiveStep(current, {
              step_index: Number(data.step_index ?? 0),
              batch_index: Number(data.batch_index ?? 0),
              agent_key: String(data.agent_key ?? ""),
              agent_name: String(data.agent_name ?? ""),
              status: String(data.status ?? "completed"),
              dependencies: ((data.dependencies as string[]) ?? []).map(String),
              execution_mode: String(data.execution_mode ?? ""),
              confidence: Number(data.confidence ?? 0),
              validation_summary: String(
                ((data.validation as Record<string, unknown>)?.summary as string) ?? ""
              ),
              summary: String(data.summary ?? ""),
              model: String(data.model ?? ""),
              provider: String(data.provider ?? ""),
              tools: (((data.tools as { tool: string; status: string }[]) ?? []) as {
                tool: string;
                status: string;
              }[])
            })
          );
          return;
        }

        if (event === "final") {
          const assistantMessage: Message = {
            id: `local-assistant-${Date.now()}`,
            thread_id: resolvedThreadId ?? "pending-thread",
            run_id: resolvedRunId,
            role: "assistant",
            content: String(data.response ?? ""),
            citations: ((data.citations as Message["citations"]) ?? []) as Message["citations"],
            metadata: {
              summary: String(data.summary ?? ""),
              execution_batches: data.execution_batches ?? [],
              scratchpad: data.scratchpad ?? {}
            },
            created_at: new Date().toISOString()
          };
          setMessages((current) => [...current, assistantMessage]);
          if (resolvedRunId) {
            setRuns((current) =>
              current.map((run) =>
                run.id === resolvedRunId
                  ? {
                      ...run,
                      status: "completed",
                      final_response: assistantMessage.content,
                      summary: String(data.summary ?? "")
                    }
                  : run
              )
            );
          }
          return;
        }

        if (event === "run.persisted") {
          if (resolvedThreadId) {
            void refreshWorkspace(resolvedThreadId);
          }
          return;
        }

        if (event === "error") {
          setError(String(data.message ?? "Streaming failed."));
          if (resolvedRunId) {
            setRuns((current) =>
              current.map((run) =>
                run.id === resolvedRunId ? { ...run, status: "failed", summary: String(data.message ?? "") } : run
              )
            );
          }
          return;
        }

        if (event === "done") {
          setRunning(false);
          setActiveBatchIndex(null);
        }
      });
    } catch {
      setError("Live run streaming is unavailable.");
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setRunning(false);
      setActiveBatchIndex(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[0.78fr_0.22fr]">
      <div className="panel p-6">
        <div className="flex items-start justify-between gap-4 border-b border-black/10 pb-5">
          <div>
            <Badge>Autonomous Chat</Badge>
            <h1 className="mt-3 font-display text-4xl">Swarm workspace</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-black/[0.65]">
              Real threads, persisted run history, and live streamed orchestration now share the
              same runtime surface.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {running && (
              <Badge className="bg-ink text-white border-transparent">
                <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
                Batch {activeBatchIndex !== null ? activeBatchIndex + 1 : 1}
              </Badge>
            )}
            <button
              type="button"
              className="rounded-full bg-ink px-4 py-3 text-sm text-white"
              onClick={createThread}
            >
              New Thread
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => handleThreadSelect(thread.id)}
              disabled={running || loadingThread}
              className={`rounded-2xl px-4 py-3 text-left text-sm ${
                currentThreadId === thread.id
                  ? "bg-black text-white"
                  : "border border-black/10 bg-white/75 text-black/70"
              } disabled:opacity-70`}
            >
              <div className="font-medium">{thread.title}</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.14em] opacity-70">
                {thread.run_count ?? 0} runs / {thread.message_count ?? 0} messages
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-5">
          {messages.length === 0 && (
            <div className="rounded-[28px] border border-black/10 bg-white/70 p-6 text-sm leading-7 text-black/70">
              {loadingThread
                ? "Loading thread history..."
                : "This thread is empty. Start a run to create a persisted chat history."}
            </div>
          )}
          {messages.map((message) => (
            <article
              key={message.id}
              className={
                message.role === "assistant"
                  ? "rounded-[28px] bg-white p-5"
                  : "rounded-[28px] border border-black/10 bg-black/[0.02] p-5"
              }
            >
              <div className="mb-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      message.role === "assistant" ? "bg-pine text-white" : "bg-black text-white"
                    }`}
                  >
                    {message.role === "assistant" ? <Sparkles className="h-4 w-4" /> : "U"}
                  </div>
                  <div>
                    <p className="text-sm font-semibold capitalize">{message.role}</p>
                    <p className="text-xs text-black/50">{formatRelativeTime(message.created_at)}</p>
                  </div>
                </div>
                {message.role === "assistant" && (
                  <Badge className="bg-mist/70 text-black/70">Supervisor synthesis</Badge>
                )}
              </div>

              <p className="text-sm leading-8 text-black/75">{message.content}</p>

              {message.citations.length > 0 && (
                <div className="mt-5 rounded-[22px] border border-black/10 bg-sand/70 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <Globe className="h-4 w-4" />
                    Sources
                  </div>
                  <div className="space-y-2">
                    {message.citations.map((citation) => (
                      <div
                        key={`${citation.title}-${citation.url}`}
                        className="flex items-center justify-between gap-3 rounded-2xl bg-white/80 px-4 py-3 text-sm"
                      >
                        <span>{citation.title}</span>
                        <ArrowUpRight className="h-4 w-4 text-black/50" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>

        <form className="mt-6 border-t border-black/10 pt-5" onSubmit={handleSubmit}>
          <div className="rounded-[28px] border border-black/10 bg-white/75 p-4">
            <textarea
              className="min-h-[120px] w-full resize-none bg-transparent text-sm leading-7 outline-none"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask the supervisor to research, analyze, automate, code, or synthesize a complex task."
            />
            <div className="mt-3 flex items-center justify-between gap-4">
              <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">
                Persisted run history + live supervisor streaming
              </p>
              <button
                type="submit"
                disabled={running || !draft.trim()}
                className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm text-white disabled:opacity-60"
              >
                {running ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <SendHorizontal className="h-4 w-4" />
                )}
                {running ? "Running..." : "Start Run"}
              </button>
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        </form>
      </div>

      <aside className="space-y-6">
        <div className="panel p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Active Plan</p>
          <div className="mt-4 space-y-3">
            {displayedPlan.length === 0 && (
              <div className="rounded-[22px] border border-black/10 bg-white/70 p-4 text-sm text-black/70">
                Start a run to stream or review the selected thread's orchestration plan.
              </div>
            )}
            {displayedPlan.map((item, index) => {
              const runtime = stepsByAgent[item.key];
              return (
                <div key={`${item.key}-${index}`} className="rounded-[22px] border border-black/10 bg-white/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">
                        Step {item.plan_index !== undefined ? item.plan_index + 1 : index + 1}
                      </p>
                      <p className="mt-2 text-sm font-medium text-black/80">{item.key}</p>
                    </div>
                    <Badge className={statusBadgeClass(runtime?.status ?? "queued")}>
                      {statusLabel(runtime?.status ?? "queued")}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-black/75">
                    {item.objective ?? item.expected_output ?? "Planned agent work."}
                  </p>
                  {item.dependencies && item.dependencies.length > 0 && (
                    <p className="mt-3 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                      depends on: {item.dependencies.join(", ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Layers3 className="h-4 w-4" />
            Execution Batches
          </div>
          <div className="mt-4 space-y-3">
            {executionBatches.length === 0 && (
              <div className="rounded-2xl bg-white/75 px-4 py-3 text-sm text-black/70">
                Batch status will appear live during the next streamed run.
              </div>
            )}
            {executionBatches.map((batch, index) => (
              <div
                key={`${batch.join("-")}-${index}`}
                className={`rounded-[22px] border px-4 py-4 ${
                  activeBatchIndex === index
                    ? "border-transparent bg-ink text-white"
                    : "border-black/10 bg-white/75"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.18em]">Batch {index + 1}</p>
                  {activeBatchIndex === index && running && (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  )}
                </div>
                <p className="mt-3 text-sm leading-7">{batch.join(" / ")}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4" />
            Step Telemetry
          </div>
          <div className="mt-4 space-y-3">
            {liveSteps.length === 0 && (
              <div className="rounded-2xl bg-white/75 px-4 py-3 text-sm text-black/70">
                Step-level validation, escalation, and model data will stream here live.
              </div>
            )}
            {liveSteps.map((step) => (
              <div
                key={`${step.agent_key}-${step.step_index}`}
                className="rounded-[22px] border border-black/10 bg-white/75 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-black/60" />
                    <p className="text-sm font-medium">{step.agent_name}</p>
                  </div>
                  <Badge className={statusBadgeClass(step.status)}>{statusLabel(step.status)}</Badge>
                </div>
                {step.summary && <p className="mt-3 text-sm leading-7 text-black/75">{step.summary}</p>}
                {step.validation_summary && (
                  <p className="mt-3 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                    validation: {step.validation_summary}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                  <span>batch {step.batch_index + 1}</span>
                  {step.confidence !== undefined && <span>confidence {step.confidence}</span>}
                  {step.model && <span>{step.model}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquareMore className="h-4 w-4" />
            Run History
          </div>
          <div className="mt-4 space-y-3">
            {runs.length === 0 && (
              <div className="rounded-2xl bg-white/75 px-4 py-3 text-sm text-black/70">
                Completed and running attempts for the selected thread will appear here.
              </div>
            )}
            {runs.map((run) => (
              <div key={run.id} className="rounded-[22px] border border-black/10 bg-white/75 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{formatRelativeTime(run.created_at)}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                      {run.supervisor_model}
                    </p>
                  </div>
                  <Badge className={statusBadgeClass(run.status)}>{statusLabel(run.status)}</Badge>
                </div>
                <p className="mt-3 text-sm leading-7 text-black/75">{run.user_message}</p>
                {run.summary && (
                  <p className="mt-3 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                    {run.summary}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {latestAssistant?.metadata?.summary && (
          <div className="panel p-5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              Latest Summary
            </div>
            <p className="mt-4 text-sm leading-7 text-black/75">
              {String(latestAssistant.metadata.summary)}
            </p>
          </div>
        )}
      </aside>
    </section>
  );
}
