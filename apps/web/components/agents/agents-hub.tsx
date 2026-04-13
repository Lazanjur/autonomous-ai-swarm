"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Radar,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Wrench,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AgentRecentStep, AgentSurface, ChatAgentsData } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { withWorkspacePath } from "@/lib/workspace";

function healthTone(state: string) {
  if (state === "live") {
    return "bg-emerald-600 text-white border-transparent";
  }
  if (state === "active") {
    return "bg-blue-600 text-white border-transparent";
  }
  if (state === "idle") {
    return "bg-amber-500 text-white border-transparent";
  }
  return "bg-black/[0.08] text-black/[0.62] border-transparent";
}

function healthLabel(state: string) {
  if (state === "live") {
    return "Live now";
  }
  if (state === "active") {
    return "Active";
  }
  if (state === "idle") {
    return "Idle";
  }
  return "Quiet";
}

function activityTone(status: string) {
  if (status === "completed") {
    return "bg-emerald-100 text-emerald-900";
  }
  if (status === "failed") {
    return "bg-red-100 text-red-900";
  }
  if (status === "running") {
    return "bg-blue-100 text-blue-900";
  }
  if (status === "escalating") {
    return "bg-amber-100 text-amber-900";
  }
  return "bg-black/[0.05] text-black/[0.62]";
}

function confidenceWidth(value: number) {
  return `${Math.max(6, Math.min(100, Math.round(value * 100)))}%`;
}

function compactText(value: string | null | undefined, limit = 140) {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

function stepLabel(step: AgentRecentStep) {
  return compactText(
    step.summary || step.validation_summary || `${step.thread_title} step update`,
    120
  );
}

function AgentHealthCard({ agent }: { agent: AgentSurface }) {
  const statusEntries = Object.entries(agent.status_breakdown ?? {}).filter(([, count]) => count > 0);
  return (
    <article className="rounded-[26px] border border-black/10 bg-white/78 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-black/[0.82]">{agent.name}</p>
            <Badge className={healthTone(agent.health_state)}>{healthLabel(agent.health_state)}</Badge>
          </div>
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.46]">{agent.key}</p>
        </div>
        <div className="rounded-[18px] bg-sand/65 px-4 py-3 text-right text-sm text-black/[0.68]">
          <div>{agent.workload_score}/100 workload</div>
          <div className="mt-1">
            {agent.last_active_at ? formatRelativeTime(agent.last_active_at) : "No recent activity"}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.16em] text-black/[0.45]">
          <span>Confidence</span>
          <span>{(agent.average_confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/[0.06]">
          <div
            className={cn(
              "h-full rounded-full",
              agent.average_confidence >= 0.8
                ? "bg-emerald-500"
                : agent.average_confidence >= 0.6
                  ? "bg-amber-500"
                  : "bg-red-500"
            )}
            style={{ width: confidenceWidth(agent.average_confidence) }}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[18px] border border-black/10 bg-sand/50 p-4 text-sm text-black/[0.72]">
          <p className="text-xs uppercase tracking-[0.14em] text-black/[0.44]">Steps</p>
          <p className="mt-2 font-medium">{agent.step_count}</p>
          <p className="mt-1 text-xs text-black/[0.56]">{agent.recent_step_count} in last 24h</p>
        </div>
        <div className="rounded-[18px] border border-black/10 bg-sand/50 p-4 text-sm text-black/[0.72]">
          <p className="text-xs uppercase tracking-[0.14em] text-black/[0.44]">Escalations</p>
          <p className="mt-2 font-medium">{agent.escalation_count}</p>
          <p className="mt-1 text-xs text-black/[0.56]">{agent.tool_call_count} tool calls</p>
        </div>
        <div className="rounded-[18px] border border-black/10 bg-sand/50 p-4 text-sm text-black/[0.72]">
          <p className="text-xs uppercase tracking-[0.14em] text-black/[0.44]">Coverage</p>
          <p className="mt-2 font-medium">{agent.active_thread_count} tasks</p>
          <p className="mt-1 text-xs text-black/[0.56]">{agent.active_project_count} projects</p>
        </div>
        <div className="rounded-[18px] border border-black/10 bg-sand/50 p-4 text-sm text-black/[0.72]">
          <p className="text-xs uppercase tracking-[0.14em] text-black/[0.44]">Model ladder</p>
          <p className="mt-2 font-medium">{agent.fast_model}</p>
          <p className="mt-1 text-xs text-black/[0.56]">{agent.slow_model}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.46]">
        {agent.specialties.map((specialty) => (
          <span key={`${agent.key}-${specialty}`} className="rounded-full border border-black/10 px-3 py-1">
            {specialty}
          </span>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[22px] border border-black/10 bg-white/72 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-black/[0.8]">
            <Radar className="h-4 w-4" />
            Monitoring signals
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {statusEntries.length > 0 ? (
              statusEntries.map(([status, count]) => (
                <span
                  key={`${agent.key}-${status}`}
                  className={cn(
                    "rounded-full px-3 py-2 text-xs uppercase tracking-[0.14em]",
                    activityTone(status)
                  )}
                >
                  {status.replaceAll("_", " ")} {count}
                </span>
              ))
            ) : (
              <span className="text-sm text-black/[0.52]">No persisted status data yet.</span>
            )}
          </div>
          <div className="mt-4 space-y-2 text-sm text-black/[0.68]">
            <p>
              Last model: <span className="font-medium text-black/[0.82]">{agent.last_model ?? "n/a"}</span>
            </p>
            <p>
              Provider: <span className="font-medium text-black/[0.82]">{agent.last_provider ?? "n/a"}</span>
            </p>
            <p>
              Last persisted status:{" "}
              <span className="font-medium text-black/[0.82]">{agent.last_status ?? "ready"}</span>
            </p>
          </div>
          <div className="mt-4">
            <p className="text-xs uppercase tracking-[0.16em] text-black/[0.44]">Recent tools</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {agent.recent_tools.length > 0 ? (
                agent.recent_tools.map((tool) => (
                  <span
                    key={`${agent.key}-${tool}`}
                    className="rounded-full border border-black/10 bg-sand/45 px-3 py-2 text-xs text-black/[0.68]"
                  >
                    {tool}
                  </span>
                ))
              ) : (
                <span className="text-sm text-black/[0.52]">No recent tool usage persisted for this agent yet.</span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-[22px] border border-black/10 bg-white/72 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-black/[0.8]">
            <Activity className="h-4 w-4" />
            Recent step details
          </div>
          <div className="mt-4 space-y-3">
            {agent.recent_steps.length > 0 ? (
              agent.recent_steps.map((step) => (
                <div key={step.run_step_id} className="rounded-[18px] border border-black/10 bg-sand/45 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-black/[0.8]">{step.thread_title}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/[0.45]">
                        {formatRelativeTime(step.created_at)}
                      </p>
                    </div>
                    <span className={cn("rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.12em]", activityTone(step.status))}>
                      {step.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-black/[0.68]">{stepLabel(step)}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.46]">
                    <span>{(step.confidence * 100).toFixed(0)}% confidence</span>
                    {step.model && <span>{step.model}</span>}
                    {step.tools.map((tool) => (
                      <span key={`${step.run_step_id}-${tool}`} className="rounded-full bg-black/[0.04] px-2 py-1">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-black/[0.52]">No recent persisted steps yet for this agent.</p>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function AgentsHub({ data }: { data: ChatAgentsData }) {
  const [snapshot, setSnapshot] = useState(data);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refreshAgents = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetch(`/api/chat/agents?workspace_id=${snapshot.workspace_id}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => ({
        detail: "Agent monitor refresh failed."
      }))) as ChatAgentsData & { detail?: string };
      if (!response.ok) {
        setRefreshError(payload.detail ?? "Agent monitor refresh failed.");
        return;
      }
      setSnapshot(payload);
    } catch {
      setRefreshError("Agent monitor refresh is unavailable right now.");
    } finally {
      setRefreshing(false);
    }
  }, [snapshot.workspace_id]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshAgents();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refreshAgents, snapshot.workspace_id]);

  const mostLoadedAgent = useMemo(
    () => snapshot.agents.reduce<AgentSurface | null>((current, agent) => {
      if (!current || agent.workload_score > current.workload_score) {
        return agent;
      }
      return current;
    }, null),
    [snapshot.agents]
  );

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge>Agents</Badge>
            <h1 className="mt-4 font-display text-5xl">Swarm monitoring for every specialist operator.</h1>
            <p className="mt-4 max-w-3xl text-base text-black/62">
              This view is now a monitoring surface, not just a catalog. It shows which agents are live,
              which ones are carrying current workload, where escalations are happening, and what each
              specialist has actually been doing across the workspace.
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void refreshAgents()}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm text-black/72 transition hover:bg-white disabled:opacity-60"
              >
                {refreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {refreshing ? "Refreshing..." : "Refresh monitor"}
              </button>
              <button
                type="button"
                onClick={() => setAutoRefresh((current) => !current)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm transition",
                  autoRefresh
                    ? "bg-ink text-white"
                    : "border border-black/10 bg-white/80 text-black/72 hover:bg-white"
                )}
              >
                {autoRefresh ? "Auto refresh on" : "Auto refresh off"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.48]">
              <span className="rounded-full bg-black/[0.04] px-3 py-2">
                Supervisor {snapshot.supervisor_model}
              </span>
              <span className="rounded-full bg-black/[0.04] px-3 py-2">
                {snapshot.overview.activity_window_hours}h activity window
              </span>
              {mostLoadedAgent && (
                <span className="rounded-full bg-black/[0.04] px-3 py-2">
                  Highest load {mostLoadedAgent.name}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={withWorkspacePath("/app/chat", snapshot.workspace_id)}
            className="rounded-full bg-ink px-4 py-2 text-sm text-white transition hover:bg-ink/90"
          >
            Open Task Workspace
          </Link>
          <Link
            href={withWorkspacePath("/app/monitor", snapshot.workspace_id)}
            className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm text-black/72 transition hover:bg-white"
          >
            Open Ops Monitor
          </Link>
        </div>
        {refreshError && <p className="mt-4 text-sm text-red-700">{refreshError}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 xl:col-span-1">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Agents</p>
          <p className="mt-3 font-display text-4xl">{snapshot.overview.total_agents}</p>
          <p className="mt-2 text-sm text-black/60">Specialist operators available to the supervisor.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 xl:col-span-1">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Active</p>
          <p className="mt-3 font-display text-4xl">{snapshot.overview.active_agents_24h}</p>
          <p className="mt-2 text-sm text-black/60">Agents with activity in the current monitoring window.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 xl:col-span-1">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Busy</p>
          <p className="mt-3 font-display text-4xl">{snapshot.overview.busy_agents}</p>
          <p className="mt-2 text-sm text-black/60">Agents carrying the heaviest current workload.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 xl:col-span-1">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Steps</p>
          <p className="mt-3 font-display text-4xl">{snapshot.overview.total_steps}</p>
          <p className="mt-2 text-sm text-black/60">Persisted recent execution steps across the workspace.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 xl:col-span-1">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Tools</p>
          <p className="mt-3 font-display text-4xl">{snapshot.overview.total_tool_calls}</p>
          <p className="mt-2 text-sm text-black/60">Recent tool calls observed across specialist agents.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 xl:col-span-1">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Escalations</p>
          <p className="mt-3 font-display text-4xl">{snapshot.overview.escalation_count}</p>
          <p className="mt-2 text-sm text-black/60">
            Avg confidence {(snapshot.overview.average_confidence * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="panel p-6">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5" />
              <h2 className="font-display text-3xl">Health board</h2>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-black/[0.62]">
              Each card combines persisted execution history into monitoring signals: health state,
              workload pressure, tool usage, escalations, and the last concrete steps the agent completed.
            </p>
            <div className="mt-5 space-y-4">
              {snapshot.agents.map((agent) => (
                <AgentHealthCard key={agent.key} agent={agent} />
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel p-6">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              <h2 className="font-display text-3xl">Recent workspace activity</h2>
            </div>
            <div className="mt-5 space-y-3">
              {snapshot.recent_activity.length > 0 ? (
                snapshot.recent_activity.map((entry) => (
                  <div key={entry.run_step_id} className="rounded-[22px] border border-black/10 bg-white/78 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-black/[0.82]">{entry.agent_name}</p>
                          <span className={cn("rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.12em]", activityTone(entry.status))}>
                            {entry.status.replaceAll("_", " ")}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-black/[0.66]">{entry.thread_title}</p>
                      </div>
                      <p className="text-xs uppercase tracking-[0.14em] text-black/[0.46]">
                        {formatRelativeTime(entry.created_at)}
                      </p>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-black/[0.7]">{stepLabel(entry)}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.46]">
                      <span>{(entry.confidence * 100).toFixed(0)}% confidence</span>
                      {entry.model && <span>{entry.model}</span>}
                      {entry.tools.map((tool) => (
                        <span key={`${entry.run_step_id}-${tool}`} className="rounded-full bg-black/[0.04] px-2 py-1">
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[22px] border border-dashed border-black/10 bg-white/70 px-4 py-8 text-center text-sm text-black/[0.58]">
                  Recent agent activity will populate here as soon as the workspace starts executing runs.
                </div>
              )}
            </div>
          </div>

          <div className="panel p-6">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              <h2 className="font-display text-3xl">Capability matrix</h2>
            </div>
            <div className="mt-5 space-y-4">
              {snapshot.agents.map((agent) => (
                <div key={`${agent.key}-matrix`} className="rounded-[22px] border border-black/10 bg-white/78 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-black/[0.82]">{agent.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/[0.45]">
                        {agent.fast_model}
                        {" -> "}
                        {agent.slow_model}
                      </p>
                    </div>
                    <Badge className={healthTone(agent.health_state)}>{healthLabel(agent.health_state)}</Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {agent.tools.map((tool) => (
                      <span
                        key={`${agent.key}-${tool.name}`}
                        className="rounded-full border border-black/10 bg-sand/45 px-3 py-2 text-xs text-black/[0.68]"
                      >
                        {tool.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-6">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              <h2 className="font-display text-3xl">Supervisor signals</h2>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-[22px] border border-black/10 bg-white/78 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Stable fleet
                </div>
                <p className="mt-3 text-sm leading-7 text-black/[0.68]">
                  {snapshot.overview.active_agents_24h} of {snapshot.overview.total_agents} agents have recent workspace activity.
                </p>
              </div>
              <div className="rounded-[22px] border border-black/10 bg-white/78 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                  <TriangleAlert className="h-4 w-4 text-amber-600" />
                  Escalation pressure
                </div>
                <p className="mt-3 text-sm leading-7 text-black/[0.68]">
                  {snapshot.overview.escalation_count} escalations were recorded inside the monitored activity window.
                </p>
              </div>
              <div className="rounded-[22px] border border-black/10 bg-white/78 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                  <Clock3 className="h-4 w-4 text-blue-600" />
                  Last activity
                </div>
                <p className="mt-3 text-sm leading-7 text-black/[0.68]">
                  {snapshot.overview.last_activity_at
                    ? `The most recent persisted agent step was ${formatRelativeTime(snapshot.overview.last_activity_at)}.`
                    : "No persisted agent activity has been recorded for this workspace yet."}
                </p>
              </div>
              <div className="rounded-[22px] border border-black/10 bg-white/78 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                  <Zap className="h-4 w-4 text-fuchsia-600" />
                  Load concentration
                </div>
                <p className="mt-3 text-sm leading-7 text-black/[0.68]">
                  {mostLoadedAgent
                    ? `${mostLoadedAgent.name} currently carries the strongest monitoring load signal at ${mostLoadedAgent.workload_score}/100.`
                    : "No agent has accumulated workload signals yet."}
                </p>
              </div>
            </div>
          </div>

          <div className="panel p-6">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              <h2 className="font-display text-3xl">Why this view is stronger</h2>
            </div>
            <p className="mt-4 text-sm leading-8 text-black/[0.66]">
              The old surface mostly reflected static catalog state and a couple of persisted counters.
              This version turns the same backend into a monitoring console: real agent health, workload,
              escalation pressure, tool usage, recent step detail, and live refresh behavior that operators
              can actually use while work is happening.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
