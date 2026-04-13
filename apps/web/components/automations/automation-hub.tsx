"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing,
  LoaderCircle,
  MonitorSmartphone,
  PauseCircle,
  Play,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  TimerReset,
  XCircle
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  Automation,
  AutomationDashboard,
  AutomationExecution,
  AutomationNotification,
  AutomationRuntimeEvent,
  TaskTemplate
} from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

type Props = {
  workspaceId: string;
  automations: Automation[];
  initialDashboard: AutomationDashboard | null;
  taskTemplates: TaskTemplate[];
};

const NOTIFY_ON_OPTIONS = [
  ["failed", "Failures"],
  ["completed", "Completed runs"],
  ["retry_scheduled", "Scheduled retries"],
  ["approval_requested", "Approval gates"],
  ["rejected", "Rejected runs"]
] as const;

function statusTone(status: string) {
  if (status === "active" || status === "completed") return "bg-pine text-white border-transparent";
  if (status === "paused" || status === "awaiting_approval" || status === "retry_scheduled") return "bg-ink text-white border-transparent";
  if (status === "failed" || status === "rejected") return "bg-red-700 text-white border-transparent";
  if (status === "running" || status === "queued") return "bg-black text-white border-transparent";
  return "bg-white/70 text-black/70";
}

function formatAbsoluteTime(timestamp?: string | null) {
  if (!timestamp) return "Unavailable";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function readEvents(execution: AutomationExecution): AutomationRuntimeEvent[] {
  const raw = execution.metadata?.events;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const record = asRecord(entry);
      if (!record || typeof record.timestamp !== "string" || typeof record.type !== "string") return null;
      return {
        timestamp: record.timestamp,
        type: record.type,
        level: typeof record.level === "string" ? record.level : "info",
        message: typeof record.message === "string" ? record.message : "",
        data: asRecord(record.data) ?? {}
      } satisfies AutomationRuntimeEvent;
    })
    .filter(isDefined);
}

function readNotifications(execution: AutomationExecution): AutomationNotification[] {
  const raw = execution.metadata?.notifications;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const record = asRecord(entry);
      if (!record || typeof record.channel !== "string" || typeof record.event !== "string") return null;
      return {
        channel: record.channel,
        target: typeof record.target === "string" ? record.target : null,
        event: record.event,
        status: typeof record.status === "string" ? record.status : "unknown",
        storage_key: typeof record.storage_key === "string" ? record.storage_key : null,
        response_status: typeof record.response_status === "number" ? record.response_status : null,
        detail: typeof record.detail === "string" ? record.detail : null,
        timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString()
      } satisfies AutomationNotification;
    })
    .filter(isDefined);
}

function metricCard(label: string, value: string, detail: string) {
  return (
    <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
      <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">{label}</p>
      <p className="mt-3 font-display text-3xl text-black">{value}</p>
      <p className="mt-2 text-xs leading-6 text-black/[0.55]">{detail}</p>
    </div>
  );
}

export function AutomationHub({ workspaceId, automations, initialDashboard, taskTemplates }: Props) {
  const router = useRouter();
  const createFormRef = useRef<HTMLFormElement | null>(null);
  const [items, setItems] = useState(automations);
  const [dashboard, setDashboard] = useState<AutomationDashboard | null>(initialDashboard);
  const [selectedId, setSelectedId] = useState<string | null>(initialDashboard?.automation.id ?? automations[0]?.id ?? null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(null);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const selectedAutomationTemplate = useMemo(() => {
    const templateKey = dashboard?.automation.definition.template_key;
    if (!templateKey) {
      return null;
    }
    return taskTemplates.find((template) => template.key === templateKey) ?? null;
  }, [dashboard, taskTemplates]);

  function setTextField(form: HTMLFormElement, name: string, value: string) {
    const field = form.elements.namedItem(name);
    if (!field) return;
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement ||
      field instanceof HTMLSelectElement
    ) {
      field.value = value;
    }
  }

  function setCheckboxField(form: HTMLFormElement, name: string, checked: boolean) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement) {
      field.checked = checked;
    }
  }

  function setNotifyOnFields(form: HTMLFormElement, values: string[]) {
    const normalized = new Set(values);
    Array.from(form.querySelectorAll<HTMLInputElement>('input[name="notify_on"]')).forEach((input) => {
      input.checked = normalized.has(input.value);
    });
  }

  function applyTemplate(template: TaskTemplate) {
    const form = createFormRef.current;
    if (!form) {
      return;
    }
    const defaults = template.automation_defaults;
    setSelectedTemplateKey(template.key);
    setTemplateNotice(`Loaded ${template.name}. You can still edit any field before creating the automation.`);
    setTextField(form, "name", defaults.name);
    setTextField(form, "description", defaults.description);
    setTextField(form, "schedule", defaults.schedule_hint);
    setTextField(form, "timezone", defaults.timezone);
    setTextField(form, "prompt", defaults.prompt);
    setTextField(form, "steps", defaults.steps.join("\n"));
    setTextField(form, "retry_limit", String(defaults.retry_limit));
    setTextField(form, "timeout_seconds", String(defaults.timeout_seconds));
    setCheckboxField(form, "use_retrieval", defaults.use_retrieval);
    setCheckboxField(form, "requires_approval", defaults.requires_approval);
    setNotifyOnFields(form, defaults.notify_on);
  }

  async function loadDashboard(automationId: string) {
    setBusyAction(`load-${automationId}`);
    setError(null);
    try {
      const response = await fetch(`/api/automations/${automationId}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({ detail: "Automation fetch failed." }))) as AutomationDashboard | { detail?: string };
      if (!response.ok || !("automation" in payload)) {
        setError(("detail" in payload && payload.detail) || "Automation fetch failed.");
        return;
      }
      const dashboardPayload = payload;
      setDashboard(dashboardPayload);
      setItems((current) =>
        current.map((item) => (item.id === dashboardPayload.automation.id ? dashboardPayload.automation : item))
      );
      setSelectedId(automationId);
      setDecisionNote("");
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
      template_key: String(formData.get("template_key") || "").trim() || null,
      timezone: String(formData.get("timezone") || "UTC"),
      use_retrieval: formData.get("use_retrieval") === "on",
      requires_approval: formData.get("requires_approval") === "on",
      retry_limit: Number(formData.get("retry_limit") || 2),
      timeout_seconds: Number(formData.get("timeout_seconds") || 900),
      notify_channels: String(formData.get("notify_channels") || "").split(",").map((value) => value.trim()).filter(Boolean),
      notify_on: formData.getAll("notify_on").map((value) => String(value).trim()).filter(Boolean),
      steps: String(formData.get("steps") || "").split("\n").map((value) => value.trim()).filter(Boolean)
    };

    setBusyAction("create");
    setError(null);
    try {
      const response = await fetch("/api/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const created = (await response.json().catch(() => ({ detail: "Automation creation failed." }))) as Automation | { detail?: string };
      if (!response.ok || "detail" in created) {
        setError(("detail" in created && created.detail) || "Automation creation failed.");
        return;
      }
      setItems((current) => [created as Automation, ...current]);
      form.reset();
      setSelectedTemplateKey(null);
      setTemplateNotice(null);
      await loadDashboard((created as Automation).id);
      router.refresh();
    } catch {
      setError("Automation creation is unavailable.");
    } finally {
      setBusyAction(null);
    }
  }

  async function patchAutomation(body: Record<string, unknown>, actionKey: string, path = "") {
    if (!selected) return;
    setBusyAction(`${actionKey}-${selected.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/automations/${selected.id}${path}`, {
        method: path ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({ detail: "Automation request failed." }));
      if (!response.ok) {
        setError(payload.detail ?? "Automation request failed.");
        return;
      }
      await loadDashboard(selected.id);
      router.refresh();
    } catch {
      setError("Automation service is unavailable.");
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
          <p className="mt-3 text-sm leading-8 text-black/[0.66]">Operate scheduled runs with retries, approval gates, notification rules, and a live execution trail.</p>
          {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
        </div>

        <div className="panel space-y-4 p-6">
          <div className="flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4" />
            <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Workflow templates</p>
          </div>
          <p className="text-sm leading-7 text-black/[0.64]">
            Start from reusable browser and computer workflows so recurring runs feel like products, not blank prompts.
          </p>
          <div className="grid gap-3">
            {taskTemplates.map((template) => (
              <button
                key={template.key}
                type="button"
                onClick={() => applyTemplate(template)}
                className={cn(
                  "rounded-[24px] border px-4 py-4 text-left transition",
                  selectedTemplateKey === template.key
                    ? "border-transparent bg-ink text-white"
                    : "border-black/10 bg-white/75 hover:bg-sand/40"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={selectedTemplateKey === template.key ? "bg-white/15 text-white border-white/10" : "border-black/10 bg-sand/65 text-black"}>
                        {template.category}
                      </Badge>
                      {template.requires_approval && (
                        <Badge className={selectedTemplateKey === template.key ? "bg-white/15 text-white border-white/10" : "border-black/10 bg-amber-100 text-amber-900"}>
                          approval
                        </Badge>
                      )}
                    </div>
                    <p className="mt-3 font-medium">{template.name}</p>
                    <p className={cn("mt-2 text-sm leading-7", selectedTemplateKey === template.key ? "text-white/78" : "text-black/[0.66]")}>
                      {template.summary}
                    </p>
                  </div>
                  <span className={cn("text-xs uppercase tracking-[0.16em]", selectedTemplateKey === template.key ? "text-white/65" : "text-black/[0.46]")}>
                    {template.automation_defaults.schedule_hint}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {template.capabilities.slice(0, 3).map((capability) => (
                    <span
                      key={`${template.key}-${capability}`}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.12em]",
                        selectedTemplateKey === template.key
                          ? "bg-white/12 text-white/78"
                          : "bg-black/[0.04] text-black/[0.55]"
                      )}
                    >
                      {capability}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
          {templateNotice ? <p className="text-sm text-emerald-700">{templateNotice}</p> : null}
        </div>

        <form ref={createFormRef} className="panel space-y-4 p-6" onSubmit={createAutomation}>
          <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Create Automation</p>
          <input type="hidden" name="template_key" value={selectedTemplateKey ?? ""} />
          <input className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="name" placeholder="Automation name" />
          <textarea className="min-h-[90px] w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="description" placeholder="What this workflow is responsible for" />
          <input className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="schedule" placeholder="daily@08:00" />
          <input className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="timezone" defaultValue="UTC" placeholder="Timezone" />
          <textarea className="min-h-[120px] w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="prompt" placeholder="Prompt the supervisor should execute each run" />
          <textarea className="min-h-[90px] w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="steps" placeholder="Optional checklist steps, one per line" />
          <input className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="notify_channels" placeholder="email:ops@example.com, slack:#ops, webhook:https://..." />
          <div className="grid gap-3 md:grid-cols-2">
            <input className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="retry_limit" type="number" min="0" max="5" defaultValue="2" />
            <input className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none" name="timeout_seconds" type="number" min="60" max="7200" defaultValue="900" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm"><input type="checkbox" name="use_retrieval" defaultChecked />Use retrieval</label>
            <label className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm"><input type="checkbox" name="requires_approval" />Require approval for scheduled runs</label>
          </div>
          <div className="rounded-[24px] border border-black/10 bg-white/75 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Notify On</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {NOTIFY_ON_OPTIONS.map(([value, label], index) => (
                <label key={value} className="flex items-center gap-3 rounded-2xl border border-black/10 bg-sand/60 px-4 py-3 text-sm">
                  <input type="checkbox" name="notify_on" value={value} defaultChecked={index === 0} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" disabled={busyAction === "create"} className="w-full rounded-full bg-ink px-5 py-3 text-sm text-white disabled:opacity-60">{busyAction === "create" ? "Creating..." : "Create Automation"}</button>
        </form>
      </div>

      <div className="space-y-6">
        <div className="panel p-6">
          <div className="flex items-center gap-3"><TimerReset className="h-5 w-5" /><h2 className="font-display text-3xl">Automation Fleet</h2></div>
          <div className="mt-6 space-y-4">
            {items.length === 0 ? <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 text-sm text-black/[0.68]">No automations yet.</div> : null}
            {items.map((automation) => (
              <button key={automation.id} type="button" onClick={() => loadDashboard(automation.id)} className={cn("w-full rounded-[24px] border p-5 text-left", selectedId === automation.id ? "border-transparent bg-ink text-white" : "border-black/10 bg-white/75")}>
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="font-medium">{automation.name}</h3><p className={cn("mt-2 text-xs uppercase tracking-[0.16em]", selectedId === automation.id ? "text-white/70" : "text-black/[0.45]")}>{automation.schedule}</p></div>
                  <Badge className={statusTone(automation.status)}>{automation.status}</Badge>
                </div>
                <p className={cn("mt-3 text-sm leading-7", selectedId === automation.id ? "text-white/80" : "text-black/[0.68]")}>{automation.description}</p>
              </button>
            ))}
          </div>
        </div>

        {dashboard && selected ? (
          <div className="panel p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Selected Automation</p><h2 className="mt-2 font-display text-3xl">{dashboard.automation.name}</h2><p className="mt-3 text-sm leading-7 text-black/[0.66]">{dashboard.automation.description}</p></div>
              <Badge className={statusTone(dashboard.automation.status)}>{dashboard.automation.status}</Badge>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metricCard("Queue", dashboard.runtime.queue_status, `Scheduler ${dashboard.runtime.scheduler_enabled ? "enabled" : "disabled"} / poll ${dashboard.runtime.poll_interval_seconds}s`)}
              {metricCard("Active", String(dashboard.runtime.active_execution_count), `${dashboard.runtime.retry_scheduled_count} retry slot(s)`)}
              {metricCard("Approvals", String(dashboard.runtime.awaiting_approval_count), dashboard.runtime.approval?.requested_at ? `Requested ${formatRelativeTime(dashboard.runtime.approval.requested_at)}` : "No pending approval")}
              {metricCard("24h", `${dashboard.runtime.completed_executions_24h}/${dashboard.runtime.failed_executions_24h}`, "Completed / failed")}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={() => patchAutomation({ trigger: "manual", force: false }, "run", "/run")} disabled={busyAction === `run-${selected.id}` || dashboard.automation.status === "awaiting_approval"} className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm text-white disabled:opacity-60">
                {busyAction === `run-${selected.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Run Now
              </button>
              {dashboard.automation.status === "paused" ? (
                <button type="button" onClick={() => patchAutomation({ status: "active" }, "status")} disabled={busyAction === `status-${selected.id}`} className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-3 text-sm disabled:opacity-60"><RotateCw className="h-4 w-4" />Resume</button>
              ) : (
                <button type="button" onClick={() => patchAutomation({ status: "paused" }, "status")} disabled={busyAction === `status-${selected.id}`} className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-3 text-sm disabled:opacity-60"><PauseCircle className="h-4 w-4" />Pause</button>
              )}
            </div>

            {(dashboard.pending_approval || dashboard.runtime.approval?.state === "awaiting_approval") ? (
              <div className="mt-6 rounded-[28px] border border-amber-300 bg-amber-50/80 p-5">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-1 h-5 w-5 text-amber-700" />
                  <div className="flex-1">
                    <p className="text-xs uppercase tracking-[0.16em] text-amber-800">Approval Gate</p>
                    <p className="mt-2 text-sm leading-7 text-amber-900">A scheduled run is waiting for a human decision before it returns to the worker queue.</p>
                    <textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} className="mt-4 min-h-[90px] w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm outline-none" placeholder="Optional approval note" />
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button type="button" onClick={() => patchAutomation({ decision_note: decisionNote || null }, "approve", "/approve")} disabled={busyAction === `approve-${selected.id}`} className="inline-flex items-center gap-2 rounded-full bg-pine px-4 py-3 text-sm text-white disabled:opacity-60">
                        {busyAction === `approve-${selected.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Approve And Continue
                      </button>
                      <button type="button" onClick={() => patchAutomation({ decision_note: decisionNote || null }, "reject", "/reject")} disabled={busyAction === `reject-${selected.id}`} className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-4 py-3 text-sm text-amber-900 disabled:opacity-60">
                        {busyAction === `reject-${selected.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}Reject Run
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <div className="rounded-[24px] border border-black/10 bg-sand/60 p-5">
                <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Runtime Definition</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedAutomationTemplate && (
                    <Badge className="border-black/10 bg-white text-black">Template {selectedAutomationTemplate.name}</Badge>
                  )}
                  <Badge className="border-black/10 bg-white text-black">Timezone {dashboard.automation.definition.timezone ?? "UTC"}</Badge>
                  <Badge className="border-black/10 bg-white text-black">Retry limit {dashboard.automation.definition.retry_limit ?? 0}</Badge>
                  <Badge className="border-black/10 bg-white text-black">Timeout {dashboard.automation.definition.timeout_seconds ?? 900}s</Badge>
                  <Badge className="border-black/10 bg-white text-black">Retrieval {String(Boolean(dashboard.automation.definition.use_retrieval))}</Badge>
                  <Badge className="border-black/10 bg-white text-black">Approval {String(Boolean(dashboard.automation.definition.requires_approval))}</Badge>
                </div>
                <p className="mt-4 text-sm leading-7 text-black/[0.68]">{dashboard.automation.definition.prompt ?? ""}</p>
                {dashboard.automation.definition.steps?.length ? <div className="mt-4 text-sm text-black/[0.68]">{dashboard.automation.definition.steps.join(" / ")}</div> : null}
              </div>

              <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
                <div className="flex items-center gap-2"><BellRing className="h-4 w-4" /><p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Notifications</p></div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(dashboard.automation.definition.notify_on?.length ? dashboard.automation.definition.notify_on : ["failed"]).map((item) => <Badge key={item} className="border-black/10 bg-sand/60 text-black">{item}</Badge>)}
                </div>
                <div className="mt-4 space-y-2 text-sm text-black/[0.68]">
                  {dashboard.automation.definition.notify_channels?.length ? dashboard.automation.definition.notify_channels.map((channel) => <div key={channel} className="rounded-2xl border border-black/10 bg-sand/60 px-4 py-3">{channel}</div>) : <div className="rounded-2xl border border-dashed border-black/10 bg-sand/40 px-4 py-3 text-black/[0.55]">No delivery targets configured yet.</div>}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Recent Executions</p>
              <div className="mt-4 space-y-4">
                {dashboard.recent_executions.length === 0 ? <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 text-sm text-black/[0.68]">No executions yet.</div> : null}
                {dashboard.recent_executions.map((execution) => {
                  const events = readEvents(execution);
                  const notifications = readNotifications(execution);
                  const retry = asRecord(execution.metadata?.retry_state);
                  const approval = asRecord(execution.metadata?.approval);
                  return (
                    <div key={execution.id} className="rounded-[28px] border border-black/10 bg-white/75 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{execution.trigger} attempt {execution.attempt}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/[0.5]">{execution.started_at ? `${formatRelativeTime(execution.started_at)} / ${formatAbsoluteTime(execution.started_at)}` : "Pending"}</p>
                        </div>
                        <Badge className={statusTone(execution.status)}>{execution.status}</Badge>
                      </div>
                      {execution.result_summary ? <p className="mt-3 text-sm leading-7 text-black/[0.68]">{execution.result_summary}</p> : null}
                      {execution.error_message ? <p className="mt-3 text-sm leading-7 text-red-700">{execution.error_message}</p> : null}
                      <div className="mt-4 grid gap-4 xl:grid-cols-2">
                        <div className="space-y-3">
                          {approval?.state && approval.state !== "not_required" ? <div className="rounded-2xl border border-black/10 bg-sand/60 p-4 text-sm text-black/[0.68]"><span className="font-medium capitalize text-black">Approval:</span> {String(approval.state)}{approval.decision_note ? ` / ${String(approval.decision_note)}` : ""}</div> : null}
                          {retry ? <div className="rounded-2xl border border-black/10 bg-sand/60 p-4 text-sm text-black/[0.68]"><span className="font-medium text-black">Retry:</span> used {String(retry.attempts_used ?? 0)} / limit {String(retry.retry_limit ?? 0)}{retry.next_retry_at ? ` / next ${formatAbsoluteTime(String(retry.next_retry_at))}` : ""}{retry.last_error ? ` / ${String(retry.last_error)}` : ""}</div> : null}
                          <div className="rounded-2xl border border-black/10 bg-sand/60 p-4">
                            <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Notifications</p>
                            <div className="mt-3 space-y-2">{notifications.length ? notifications.map((notification, index) => <div key={`${execution.id}-notification-${index}`} className="rounded-2xl border border-black/10 bg-white/80 p-3 text-sm text-black/[0.68]"><span className="font-medium capitalize text-black">{notification.channel}</span> / {notification.status}{notification.target ? ` / ${notification.target}` : ""}</div>) : <p className="text-sm text-black/[0.55]">No notifications queued.</p>}</div>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-black/10 bg-sand/60 p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Timeline</p>
                          <div className="mt-3 space-y-2">{events.length ? events.map((entry, index) => <div key={`${execution.id}-event-${index}`} className="rounded-2xl border border-black/10 bg-white/80 p-3"><p className="text-sm font-medium text-black">{entry.message}</p><p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/[0.5]">{entry.type} / {formatAbsoluteTime(entry.timestamp)}</p></div>) : <p className="text-sm text-black/[0.55]">No timeline events yet.</p>}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
