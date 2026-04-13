import { ArrowRight, Bot, Clock3, DatabaseZap, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withWorkspacePath } from "@/lib/workspace";

type Props = {
  workspaceId?: string | null;
  threadCount: number;
  runCount: number;
  knowledgeChunks: number;
  automationCount: number;
  approvalCount: number;
  latestRunSummary: string | null;
  latestAlertMessage: string | null;
  systemStatus: {
    modelsConfigured: boolean;
    databaseOk: boolean;
    budgetUtilization: number;
  } | null;
};

export function OverviewPanel({
  workspaceId,
  threadCount,
  runCount,
  knowledgeChunks,
  automationCount,
  approvalCount,
  latestRunSummary,
  latestAlertMessage,
  systemStatus
}: Props) {
  const cards = [
    {
      title: "Threads",
      value: String(threadCount),
      detail: `${runCount} persisted runs tracked in the selected workspace`
    },
    {
      title: "Knowledge Chunks",
      value: knowledgeChunks.toLocaleString(),
      detail: "Workspace retrieval context ready for grounded reasoning"
    },
    {
      title: "Automations",
      value: String(automationCount),
      detail: `${approvalCount} workflows currently awaiting approval`
    }
  ];

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <Badge>Executive Overview</Badge>
        <div className="mt-4 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-5xl leading-tight">Operational AI for high-stakes work.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-8 text-black/[0.65]">
              Orchestrate long-running, multi-step initiatives across strategy, software,
              intelligence, and automation from one enterprise-grade workspace.
            </p>
          </div>
          <Button href={withWorkspacePath("/app/chat", workspaceId)} className="gap-2 self-start">
            Open Chat Workspace
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {cards.map((card) => (
          <div key={card.title} className="panel p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">{card.title}</p>
            <p className="mt-3 font-display text-5xl">{card.value}</p>
            <p className="mt-3 text-sm leading-7 text-black/70">{card.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.6fr_0.4fr]">
        <div className="panel p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-pine p-3 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-3xl">Supervisor Activity</h2>
              <p className="text-sm text-black/60">Recent orchestration, retrieval, and approval posture.</p>
            </div>
          </div>
          <div className="mt-6 space-y-4">
            {[
              {
                icon: Bot,
                title: "Latest run summary",
                detail: latestRunSummary ?? "No recent run summary is available yet."
              },
              {
                icon: DatabaseZap,
                title: "Knowledge status",
                detail:
                  knowledgeChunks > 0
                    ? `${knowledgeChunks.toLocaleString()} chunks are ready for retrieval-backed reasoning.`
                    : "Knowledge ingestion has not produced indexed chunks yet."
              },
              {
                icon: Clock3,
                title: "Operational alerting",
                detail: latestAlertMessage ?? "No active alerts are currently recorded."
              }
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-[24px] border border-black/10 bg-white/75 p-5">
                  <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-ink p-3 text-white">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-medium">{item.title}</h3>
                      <p className="mt-2 text-sm leading-7 text-black/[0.65]">{item.detail}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel p-6">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">System posture</p>
          <div className="mt-6 space-y-4 text-sm text-black/70">
            <div className="rounded-[22px] bg-white/80 p-4">
              Models configured: {systemStatus?.modelsConfigured ? "Yes" : "No"}
            </div>
            <div className="rounded-[22px] bg-white/80 p-4">
              Database health: {systemStatus?.databaseOk ? "Healthy" : "Unavailable or degraded"}
            </div>
            <div className="rounded-[22px] bg-white/80 p-4">
              Budget utilization:{" "}
              {systemStatus ? `${(systemStatus.budgetUtilization * 100).toFixed(1)}%` : "Unavailable"}
            </div>
            <div className="rounded-[22px] bg-white/80 p-4">
              Enterprise shell for chats, knowledge, artifacts, automations, monitor, admin, and settings
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
