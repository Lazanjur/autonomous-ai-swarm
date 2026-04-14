"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  BrainCircuit,
  CalendarDays,
  LoaderCircle,
  Mail,
  MessageSquareShare,
  RefreshCw,
  Sparkles,
  Webhook,
  Workflow
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AgentSurface, ChatAgentsData } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { withWorkspacePath } from "@/lib/workspace";

const heroFeatures = [
  {
    title: "Persistent memory and computer",
    description: "Keep context, workbench state, and approvals connected while tasks stay live."
  },
  {
    title: "Specialist operators",
    description: "Route work across research, coding, analysis, and content agents with clear ownership."
  },
  {
    title: "Custom skills and connectors",
    description: "Plug your agent into external systems, reusable tools, and guided workflows."
  },
  {
    title: "Always-on deployment",
    description: "Move from chat to automations so the same agent stack keeps working between sessions."
  }
];

const heroConnectors = [
  { label: "Slack", icon: MessageSquareShare, tone: "bg-[#4A154B] text-white" },
  { label: "Email", icon: Mail, tone: "bg-[#0A66FF] text-white" },
  { label: "Calendar", icon: CalendarDays, tone: "bg-[#0F766E] text-white" },
  { label: "Webhook", icon: Webhook, tone: "bg-black text-white" }
];

function healthTone(state: string) {
  if (state === "live") {
    return "bg-emerald-600 text-white";
  }
  if (state === "active") {
    return "bg-blue-600 text-white";
  }
  if (state === "idle") {
    return "bg-amber-500 text-white";
  }
  return "bg-black/[0.06] text-black/[0.6]";
}

function compactSummary(agent: AgentSurface) {
  return (
    agent.recent_summaries[0] ??
    agent.recent_steps[0]?.summary ??
    `Specialized in ${agent.specialties.join(", ").toLowerCase()}.`
  );
}

export function AgentsHub({ data }: { data: ChatAgentsData }) {
  const [snapshot, setSnapshot] = useState(data);
  const [refreshing, setRefreshing] = useState(false);
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
    const timer = window.setInterval(() => {
      void refreshAgents();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [refreshAgents]);

  const busiestAgent = useMemo(
    () =>
      snapshot.agents.reduce<AgentSurface | null>((current, agent) => {
        if (!current || agent.workload_score > current.workload_score) {
          return agent;
        }
        return current;
      }, null),
    [snapshot.agents]
  );

  return (
    <section className="space-y-6">
      <div className="panel overflow-hidden p-6 lg:p-8">
        <div className="grid gap-8 xl:grid-cols-[0.95fr_1.05fr] xl:items-center">
          <div>
            <Badge>Agent</Badge>
            <h1 className="mt-5 max-w-3xl font-display text-[clamp(2.3rem,4vw,4.4rem)] leading-[0.95] tracking-[-0.05em]">
              Deploy a persistent agent for work that has to keep moving.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-black/[0.62]">
              Keep a specialist stack ready for research, coding, delivery, and follow-up. This surface is lighter and more product-like, but it still stays grounded in the real agent fleet already running in the workspace.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={withWorkspacePath("/app/chat", snapshot.workspace_id)}
                className="rounded-full bg-black px-5 py-2.5 text-sm text-white transition hover:bg-black/90"
              >
                Get started
              </Link>
              <Link
                href={withWorkspacePath("/app/automations", snapshot.workspace_id)}
                className="rounded-full border border-black/10 bg-white px-5 py-2.5 text-sm text-black/[0.72] transition hover:bg-black/[0.03]"
              >
                Open automation
              </Link>
            </div>
          </div>

          <div className="relative rounded-[32px] border border-black/10 bg-white/88 p-6 shadow-[0_30px_80px_rgba(17,19,24,0.08)]">
            <div className="mx-auto flex h-[250px] max-w-[260px] items-center justify-center rounded-[34px] border-4 border-black/10 bg-gradient-to-b from-white to-sand/70 shadow-[0_30px_60px_rgba(17,19,24,0.08)]">
              <div className="rounded-[22px] border border-black/10 bg-white px-5 py-4 shadow-[0_20px_40px_rgba(17,19,24,0.08)]">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black text-white">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-black/[0.82]">Swarm Agent</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-black/[0.42]">
                      {snapshot.overview.active_agents_24h} active specialists
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pointer-events-none absolute left-8 top-6 flex flex-wrap gap-3">
              {heroConnectors.map((connector) => {
                const Icon = connector.icon;
                return (
                  <div
                    key={connector.label}
                    className={cn(
                      "inline-flex h-14 w-14 items-center justify-center rounded-full shadow-[0_18px_38px_rgba(17,19,24,0.12)]",
                      connector.tone
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-4 xl:grid-cols-4">
          {heroFeatures.map((feature) => (
            <article key={feature.title} className="rounded-[24px] border border-black/10 bg-white/80 p-5">
              <p className="text-sm font-medium text-black/[0.82]">{feature.title}</p>
              <p className="mt-3 text-sm leading-7 text-black/[0.62]">{feature.description}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Agent fleet</p>
          <p className="mt-3 font-display text-4xl">{snapshot.overview.total_agents}</p>
          <p className="mt-2 text-sm text-black/[0.6]">Operators available to the supervisor.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Active today</p>
          <p className="mt-3 font-display text-4xl">{snapshot.overview.active_agents_24h}</p>
          <p className="mt-2 text-sm text-black/[0.6]">Specialists with recent live work.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Tool calls</p>
          <p className="mt-3 font-display text-4xl">{snapshot.overview.total_tool_calls}</p>
          <p className="mt-2 text-sm text-black/[0.6]">Observable actions across the fleet.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Confidence</p>
          <p className="mt-3 font-display text-4xl">{(snapshot.overview.average_confidence * 100).toFixed(0)}%</p>
          <p className="mt-2 text-sm text-black/[0.6]">
            {busiestAgent ? `Busiest agent: ${busiestAgent.name}` : "No load signal yet."}
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="panel p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Badge>Specialists</Badge>
              <h2 className="mt-4 font-display text-4xl">Current operator roster</h2>
            </div>
            <button
              type="button"
              onClick={() => void refreshAgents()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/[0.68] transition hover:bg-black/[0.03] disabled:opacity-60"
            >
              {refreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>
          {refreshError ? <p className="mt-4 text-sm text-red-700">{refreshError}</p> : null}
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {snapshot.agents.map((agent) => (
              <article key={agent.key} className="rounded-[24px] border border-black/10 bg-white/80 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-medium text-black/[0.82]">{agent.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-black/[0.44]">
                      {agent.fast_model}
                    </p>
                  </div>
                  <span className={cn("rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.16em]", healthTone(agent.health_state))}>
                    {agent.health_state}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-7 text-black/[0.62]">{compactSummary(agent)}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {agent.specialties.slice(0, 3).map((specialty) => (
                    <span key={`${agent.key}-${specialty}`} className="rounded-full border border-black/10 px-3 py-1.5 text-xs text-black/[0.56]">
                      {specialty}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.16em] text-black/[0.42]">
                  <span>{agent.tool_call_count} tools</span>
                  <span>{agent.active_thread_count} tasks</span>
                  <span>{(agent.average_confidence * 100).toFixed(0)}% confidence</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel p-6">
            <Badge>Live focus</Badge>
            <h2 className="mt-4 font-display text-4xl">What the supervisor is seeing</h2>
            <div className="mt-6 space-y-3">
              {snapshot.recent_activity.slice(0, 4).map((entry) => (
                <div key={entry.run_step_id} className="rounded-[22px] border border-black/10 bg-white/78 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-black/[0.82]">{entry.thread_title}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-black/[0.42]">
                        {entry.agent_name ?? "Agent"} · {formatRelativeTime(entry.created_at)}
                      </p>
                    </div>
                    <span className="rounded-full bg-black/[0.06] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-black/[0.52]">
                      {entry.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-black/[0.62]">
                    {entry.summary || entry.validation_summary || "No summary recorded yet."}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-6">
            <Badge>Better than a static catalog</Badge>
            <div className="mt-4 space-y-4 text-sm leading-8 text-black/[0.62]">
              <p>
                This surface opens like a product landing page, but it still stays connected to the real monitoring data underneath.
              </p>
              <p>
                You can move from here into chat, automations, or the deeper ops monitor without losing the sense of what each specialist is doing.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={withWorkspacePath("/app/chat", snapshot.workspace_id)}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/[0.72] transition hover:bg-black/[0.03]"
              >
                <Bot className="h-4 w-4" />
                Open task workspace
              </Link>
              <Link
                href={withWorkspacePath("/app/monitor", snapshot.workspace_id)}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/[0.72] transition hover:bg-black/[0.03]"
              >
                <BrainCircuit className="h-4 w-4" />
                Open deeper monitor
              </Link>
              <Link
                href={withWorkspacePath("/app/plugins", snapshot.workspace_id)}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/[0.72] transition hover:bg-black/[0.03]"
              >
                <Workflow className="h-4 w-4" />
                Manage plugins
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
