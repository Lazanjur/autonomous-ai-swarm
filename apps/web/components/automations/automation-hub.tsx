"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Play, PauseCircle, RotateCw, TimerReset } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Automation, AutomationDashboard } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

type Props = {
  workspaceId: string;
  automations: Automation[];
  initialDashboard: AutomationDashboard | null;
};

function statusTone(status: string) {
  if (status === "active" || status === "completed") {
    return "bg-pine text-white border-transparent";
  }
  if (status === "paused" || status === "awaiting_approval") {
    return "bg-ink text-white border-transparent";
  }
  if (status === "failed") {
    return "bg-red-700 text-white border-transparent";
  }
  return "bg-white/70 text-black/70";
}

export function AutomationHub({ workspaceId, automations, initialDashboard }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(automations);
  const [dashboard, setDashboard] = useState<AutomationDashboard | null>(initialDashboard);
  const [selectedId, setSelectedId] = useState<string | null>(initialDashboard?.automation.id ?? automations[0]?.id ?? null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );

  async function loadDashboard(automationId: string) {
    setBusyAction(`load-${automationId}`);
    setError(null);
    try {
      const response = await fetch(`/api/automations/${automationId}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({ detail: "Automation fetch failed." }))) as
        | AutomationDashboard
        | { detail?: string };
      if (!response.ok || "detail" in payload) {
        setError(("detail" in payload && payload.detail) || "Automation fetch failed.");
        return;
      }
      setDashboard(payload);
      setItems((current) =>
        current.map((item) => (item.id === payload.automation.id ? payload.automation : item))
      );
      setSelectedId(automationId);
    } catch {
      setError("Automation fetch is unavailable.");
    } finally {
      setBusyAction(null);
    }
  }

  async function createAutomation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      workspace_id: workspaceId,
      name: String(formData.get("name") || ""),
      description: String(formData.get("description") || ""),
      schedule: String(formData.get("schedule") || ""),
      prompt: String(formData.get("prompt") || ""),
      timezone: String(formData.get("timezone") || "UTC"),
      use_retrieval: formData.get("use_retrieval") === "on",
      requires_approval: formData.get("requires_approval") === "on",
      retry_limit: Number(formData.get("retry_limit") || 2),
      timeout_seconds: Number(formData.get("timeout_seconds") || 900),
      notify_channels: String(formData.get("notify_channels") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      steps: String(formData.get("steps") || "")
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)
    };

    setBusyAction("create");
    setError(null);
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const created = (await response.json().catch(() => ({ detail: "Automation creation failed." }))) as
        | Automation
        | { detail?: string };
      if (!response.ok || "detail" in created) {
        setError(("detail" in created && created.detail) || "Automation creation failed.");
        return;
      }
      setItems((current) => [created as Automation, ...current]);
      form.reset();
      await loadDashboard((created as Automation).id);
      router.refresh();
    } catch {
      setError("Automation creation is unavailable.");
    } finally {
      setBusyAction(null);
    }
  }

  async function updateStatus(status: "active" | "paused") {
    if (!selected) {
      return;
    }
    setBusyAction(`status-${selected.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/automations/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const updated = (await response.json().catch(() => ({ detail: "Automation update failed." }))) as
        | Automation
        | { detail?: string };
      if (!response.ok || "detail" in updated) {
        setError(("detail" in updated && updated.detail) || "Automation update failed.");
        return;
      }
      setItems((current) => current.map((item) => (item.id === selected.id ? (updated as Automation) : item)));
      await loadDashboard(selected.id);
      router.refresh();
    } catch {
      setError("Automation update is unavailable.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runAutomation(force: boolean) {
    if (!selected) {
      return;
    }
    setBusyAction(`run-${selected.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/automations/${selected.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual", force })
      });
      const payload = await response.json().catch(() => ({ detail: "Run failed." }));
      if (!response.ok) {
        setError(payload.detail ?? "Run failed.");
        return;
      }
      await loadDashboard(selected.id);
      router.refresh();
    } catch {
      setError("Automation execution is unavailable.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[0.42fr_0.58fr]">
      <div className="space-y-6">
        <div className="panel p-6">
          <Badge>Automations</Badge>
          <h1 className="mt-4 font-display text-5xl">Recurring AI workflows.</h1>
          <p className="mt-3 text-sm leading-8 text-black/[0.66]">
            Schedule autonomous runs, route them into persistent threads, and inspect execution
            history with retries and approval-aware states.
          </p>
          {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        </div>

        <form className="panel p-6 space-y-4" onSubmit={createAutomation}>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Create Automation</p>
            <p className="mt-2 text-sm text-black/[0.66]">
              Schedule format examples: `daily@08:00`, `weekdays@07:30`, `weekly:mon,fri@09:15`, `hourly@15`.
            </p>
          </div>
          <input className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="name" placeholder="Automation name" />
          <textarea className="min-h-[90px] w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="description" placeholder="What this workflow is responsible for" />
          <input className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="schedule" placeholder="daily@08:00" />
          <input className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="timezone" defaultValue="UTC" placeholder="Timezone" />
          <textarea className="min-h-[120px] w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="prompt" placeholder="Prompt the supervisor should execute each run" />
          <textarea className="min-h-[90px] w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="steps" placeholder="Optional checklist steps, one per line" />
          <input className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="notify_channels" placeholder="Optional notify channels, comma separated" />
          <div className="grid gap-3 md:grid-cols-2">
            <input className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="retry_limit" type="number" min="0" max="5" defaultValue="2" />
            <input className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="timeout_seconds" type="number" min="60" max="7200" defaultValue="900" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm">
              <input type="checkbox" name="use_retrieval" defaultChecked />
              Use retrieval
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm">
              <input type="checkbox" name="requires_approval" />
              Require approval for scheduled runs
            </label>
          </div>
          <button type="submit" disabled={busyAction === "create"} className="w-full rounded-full bg-ink px-5 py-3 text-sm text-white disabled:opacity-60">
            {busyAction === "create" ? "Creating..." : "Create Automation"}
          </button>
        </form>
      </div>

      <div className="space-y-6">
        <div className="panel p-6">
          <div className="flex items-center gap-3">
            <TimerReset className="h-5 w-5" />
            <h2 className="font-display text-3xl">Automation Fleet</h2>
          </div>
          <div className="mt-6 space-y-4">
            {items.length === 0 && (
              <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 text-sm text-black/[0.68]">
                No automations yet. Create one to start the scheduler loop and execution history.
              </div>
            )}
            {items.map((automation) => (
              <button
                key={automation.id}
                type="button"
                onClick={() => loadDashboard(automation.id)}
                className={`w-full rounded-[24px] border p-5 text-left ${selectedId === automation.id ? "border-transparent bg-ink text-white" : "border-black/10 bg-white/75"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium">{automation.name}</h3>
                    <p className={`mt-2 text-xs uppercase tracking-[0.16em] ${selectedId === automation.id ? "text-white/70" : "text-black/[0.45]"}`}>
                      {automation.schedule}
                    </p>
                  </div>
                  <Badge className={statusTone(automation.status)}>{automation.status}</Badge>
                </div>
                <p className={`mt-3 text-sm leading-7 ${selectedId === automation.id ? "text-white/80" : "text-black/[0.68]"}`}>
                  {automation.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        {dashboard && selected && (
          <div className="panel p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Selected Automation</p>
                <h2 className="mt-2 font-display text-3xl">{dashboard.automation.name}</h2>
                <p className="mt-3 text-sm leading-7 text-black/[0.66]">{dashboard.automation.description}</p>
              </div>
              <Badge className={statusTone(dashboard.automation.status)}>{dashboard.automation.status}</Badge>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
                <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Schedule</p>
                <p className="mt-3 text-sm leading-7 text-black/[0.68]">{dashboard.schedule_summary}</p>
              </div>
              <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
                <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Next Run</p>
                <p className="mt-3 text-sm leading-7 text-black/[0.68]">
                  {dashboard.automation.next_run_at ? formatRelativeTime(dashboard.automation.next_run_at) : "Not scheduled"}
                </p>
              </div>
              <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
                <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Last Run</p>
                <p className="mt-3 text-sm leading-7 text-black/[0.68]">
                  {dashboard.automation.last_run_at ? formatRelativeTime(dashboard.automation.last_run_at) : "Never"}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => runAutomation(dashboard.pending_approval)}
                disabled={busyAction === `run-${selected.id}`}
                className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm text-white disabled:opacity-60"
              >
                {busyAction === `run-${selected.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {dashboard.pending_approval ? "Approve And Run" : "Run Now"}
              </button>
              {dashboard.automation.status === "paused" ? (
                <button type="button" onClick={() => updateStatus("active")} disabled={busyAction === `status-${selected.id}`} className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-3 text-sm disabled:opacity-60">
                  <RotateCw className="h-4 w-4" />
                  Resume
                </button>
              ) : (
                <button type="button" onClick={() => updateStatus("paused")} disabled={busyAction === `status-${selected.id}`} className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-3 text-sm disabled:opacity-60">
                  <PauseCircle className="h-4 w-4" />
                  Pause
                </button>
              )}
            </div>

            <div className="mt-6 rounded-[24px] border border-black/10 bg-sand/60 p-5">
              <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Runtime Definition</p>
              <p className="mt-3 text-sm leading-7 text-black/[0.66]">
                Retrieval: {String(Boolean(dashboard.automation.definition.use_retrieval))} / Approval: {String(Boolean(dashboard.automation.definition.requires_approval))} / Retry limit: {String(dashboard.automation.definition.retry_limit ?? 0)}
              </p>
              <p className="mt-3 text-sm leading-7 text-black/[0.66]">
                {String(dashboard.automation.definition.prompt ?? "")}
              </p>
            </div>

            <div className="mt-6">
              <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Recent Executions</p>
              <div className="mt-4 space-y-3">
                {dashboard.recent_executions.length === 0 && (
                  <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 text-sm text-black/[0.68]">
                    No executions yet.
                  </div>
                )}
                {dashboard.recent_executions.map((execution) => (
                  <div key={execution.id} className="rounded-[24px] border border-black/10 bg-white/75 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{execution.trigger} attempt {execution.attempt}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                          {execution.started_at ? formatRelativeTime(execution.started_at) : "Pending"}
                        </p>
                      </div>
                      <Badge className={statusTone(execution.status)}>{execution.status}</Badge>
                    </div>
                    {execution.result_summary && (
                      <p className="mt-3 text-sm leading-7 text-black/[0.68]">{execution.result_summary}</p>
                    )}
                    {execution.error_message && (
                      <p className="mt-3 text-sm leading-7 text-red-700">{execution.error_message}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
