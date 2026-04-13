"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { EnterpriseAdminData, EnterpriseAuditBrowseData, EnterpriseMember, EnterprisePolicyPayload } from "@/lib/types";

type PolicyForm = {
  sso_enforced: boolean;
  password_login_allowed: boolean;
  preferred_provider: string;
  allowed_sso_providers: string[];
  domain_allowlist: string;
  invite_policy: string;
  default_role: string;
  project_quota: string;
  thread_quota: string;
  document_quota: string;
  artifact_quota: string;
  automation_quota: string;
  monthly_cost_cap_usd: string;
  monthly_token_cap: string;
  soft_enforcement: boolean;
  billing_alert_thresholds: string;
};

type MemberDrafts = Record<string, { role: string; status: string }>;

const INPUTS: Array<[keyof Pick<PolicyForm, "project_quota" | "thread_quota" | "document_quota" | "artifact_quota" | "automation_quota" | "monthly_cost_cap_usd" | "monthly_token_cap">, string]> = [
  ["project_quota", "Project quota"],
  ["thread_quota", "Task quota"],
  ["document_quota", "Document quota"],
  ["artifact_quota", "Artifact quota"],
  ["automation_quota", "Automation quota"],
  ["monthly_cost_cap_usd", "Monthly cost cap (USD)"],
  ["monthly_token_cap", "Monthly token cap"],
];

function fmtDate(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function pct(value: number) {
  return `${(Math.min(Math.max(value, 0), 1) * 100).toFixed(1)}%`;
}

function usd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function numbers(value: string) {
  return value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0);
}

function formFrom(enterprise: EnterpriseAdminData | null): PolicyForm {
  return {
    sso_enforced: enterprise?.sso.enforced ?? false,
    password_login_allowed: enterprise?.sso.password_login_allowed ?? true,
    preferred_provider: enterprise?.sso.preferred_provider ?? "",
    allowed_sso_providers: enterprise?.sso.allowed_providers ?? [],
    domain_allowlist: (enterprise?.sso.domain_allowlist ?? []).join(", "),
    invite_policy: enterprise?.rbac.invite_policy ?? "admin_only",
    default_role: enterprise?.rbac.default_role ?? "member",
    project_quota: String(enterprise?.quotas.policy.projects ?? 50),
    thread_quota: String(enterprise?.quotas.policy.threads ?? 500),
    document_quota: String(enterprise?.quotas.policy.documents ?? 1000),
    artifact_quota: String(enterprise?.quotas.policy.artifacts ?? 2500),
    automation_quota: String(enterprise?.quotas.policy.automations ?? 200),
    monthly_cost_cap_usd: String(enterprise?.quotas.policy.monthly_cost_cap_usd ?? 2500),
    monthly_token_cap: String(enterprise?.quotas.policy.monthly_token_cap ?? 20_000_000),
    soft_enforcement: enterprise?.quotas.policy.soft_enforcement ?? true,
    billing_alert_thresholds: (enterprise?.quotas.policy.billing_alert_thresholds ?? [0.5, 0.8, 1]).join(", "),
  };
}

function draftsFrom(enterprise: EnterpriseAdminData | null): MemberDrafts {
  const drafts: MemberDrafts = {};
  for (const member of enterprise?.rbac.members ?? []) drafts[member.membership_id] = { role: member.workspace_role, status: member.status };
  return drafts;
}

export function EnterpriseAdminConsole({
  initialEnterprise,
  initialAudit,
  workspaceId,
}: {
  initialEnterprise: EnterpriseAdminData | null;
  initialAudit: EnterpriseAuditBrowseData | null;
  workspaceId: string;
}) {
  const [enterprise, setEnterprise] = useState(initialEnterprise);
  const [audit, setAudit] = useState(initialAudit);
  const [policy, setPolicy] = useState(() => formFrom(initialEnterprise));
  const [drafts, setDrafts] = useState(() => draftsFrom(initialEnterprise));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingMember, setSavingMember] = useState<string | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditAction, setAuditAction] = useState("");
  const [auditResource, setAuditResource] = useState("");
  const [auditLimit, setAuditLimit] = useState("40");

  const members = useMemo(
    () => enterprise?.rbac.members ?? [],
    [enterprise?.rbac.members]
  );
  const changedMembers = useMemo(() => members.filter((member) => {
    const draft = drafts[member.membership_id];
    return draft && (draft.role !== member.workspace_role || draft.status !== member.status);
  }).length, [drafts, members]);
  const maxDailyCost = useMemo(() => Math.max(1, ...(enterprise?.billing.by_day.map((item) => item.cost_usd) ?? [0])), [enterprise]);
  const auditItems = audit?.items ?? enterprise?.audit.recent_items ?? [];

  function applyEnterprise(next: EnterpriseAdminData) {
    setEnterprise(next);
    setPolicy(formFrom(next));
    setDrafts(draftsFrom(next));
  }

  async function savePolicies() {
    setSaving(true); setError(null); setNotice(null);
    try {
      const payload: EnterprisePolicyPayload = {
        sso_enforced: policy.sso_enforced,
        password_login_allowed: policy.password_login_allowed,
        preferred_provider: policy.preferred_provider || null,
        allowed_sso_providers: policy.allowed_sso_providers,
        domain_allowlist: policy.domain_allowlist.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
        invite_policy: policy.invite_policy,
        default_role: policy.default_role,
        project_quota: Number(policy.project_quota),
        thread_quota: Number(policy.thread_quota),
        document_quota: Number(policy.document_quota),
        artifact_quota: Number(policy.artifact_quota),
        automation_quota: Number(policy.automation_quota),
        monthly_cost_cap_usd: Number(policy.monthly_cost_cap_usd),
        monthly_token_cap: Number(policy.monthly_token_cap),
        soft_enforcement: policy.soft_enforcement,
        billing_alert_thresholds: numbers(policy.billing_alert_thresholds),
      };
      const response = await fetch(`/api/admin/enterprise?workspace_id=${workspaceId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = (await response.json().catch(() => ({ detail: "Enterprise policy update failed." }))) as EnterpriseAdminData & { detail?: string };
      if (!response.ok) return void setError(data.detail ?? "Enterprise policy update failed.");
      applyEnterprise(data);
      setNotice("Enterprise policy updated.");
    } catch {
      setError("Enterprise policy service is unavailable.");
    } finally {
      setSaving(false);
    }
  }

  async function saveMember(member: EnterpriseMember) {
    const draft = drafts[member.membership_id];
    if (!draft) return;
    setSavingMember(member.membership_id); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/admin/memberships/${member.membership_id}?workspace_id=${workspaceId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const data = (await response.json().catch(() => ({ detail: "Workspace membership update failed." }))) as EnterpriseAdminData & { detail?: string };
      if (!response.ok) return void setError(data.detail ?? "Workspace membership update failed.");
      applyEnterprise(data);
      setNotice(`Updated ${member.full_name}.`);
    } catch {
      setError("Workspace membership service is unavailable.");
    } finally {
      setSavingMember(null);
    }
  }

  async function refreshAudit() {
    setLoadingAudit(true); setError(null); setNotice(null);
    try {
      const query = new URLSearchParams({ workspace_id: workspaceId, limit: auditLimit || "40" });
      if (auditAction.trim()) query.set("action", auditAction.trim());
      if (auditResource.trim()) query.set("resource_type", auditResource.trim());
      const response = await fetch(`/api/admin/audit?${query.toString()}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({ detail: "Audit browse failed." }))) as EnterpriseAuditBrowseData & { detail?: string };
      if (!response.ok) return void setError(data.detail ?? "Audit browse failed.");
      setAudit(data);
      setNotice("Audit browser refreshed.");
    } catch {
      setError("Audit browser is unavailable.");
    } finally {
      setLoadingAudit(false);
    }
  }

  if (!enterprise) return null;

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge>Enterprise Controls</Badge>
            <h2 className="mt-4 font-display text-3xl">SSO, RBAC, quotas, billing, and audit in one place.</h2>
            <p className="mt-3 max-w-3xl text-sm leading-8 text-black/[0.66]">Control workforce sign-in, manage member roles, and watch spend before the workspace hits hard limits.</p>
          </div>
          <div className="rounded-[22px] bg-white/70 px-4 py-3 text-right text-sm text-black/[0.64]"><div>{enterprise.workspace.name}</div><div className="mt-1">{enterprise.workspace.slug}</div></div>
        </div>
        {notice ? <p className="mt-4 text-sm text-emerald-700">{notice}</p> : null}
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="panel p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-display text-2xl">Identity and policy posture</h3><p className="mt-1 text-sm text-black/[0.58]">Configure SSO expectations, invite policy, and workspace quotas.</p></div><button type="button" onClick={() => void savePolicies()} disabled={saving} className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-white disabled:opacity-60">{saving ? "Saving..." : "Save enterprise policy"}</button></div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-black/10 bg-white/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-black/[0.42]">SSO posture</p>
              <div className="mt-4 space-y-4">
                <label className="flex items-center justify-between gap-4 text-sm text-black/[0.7]"><span>Enforce SSO</span><input type="checkbox" checked={policy.sso_enforced} onChange={(event) => setPolicy((current) => ({ ...current, sso_enforced: event.target.checked }))} /></label>
                <label className="flex items-center justify-between gap-4 text-sm text-black/[0.7]"><span>Allow password fallback</span><input type="checkbox" checked={policy.password_login_allowed} onChange={(event) => setPolicy((current) => ({ ...current, password_login_allowed: event.target.checked }))} /></label>
                <select value={policy.preferred_provider} onChange={(event) => setPolicy((current) => ({ ...current, preferred_provider: event.target.value }))} className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none"><option value="">No preferred provider</option>{enterprise.sso.providers.map((provider) => <option key={provider.key} value={provider.key}>{provider.label}</option>)}</select>
                <div className="flex flex-wrap gap-2">{enterprise.sso.providers.map((provider) => { const active = policy.allowed_sso_providers.includes(provider.key); return <button key={provider.key} type="button" onClick={() => setPolicy((current) => ({ ...current, allowed_sso_providers: active ? current.allowed_sso_providers.filter((item) => item !== provider.key) : [...current.allowed_sso_providers, provider.key] }))} className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.14em] ${active ? "border-transparent bg-ink text-white" : "border-black/10 bg-white text-black/[0.65]"}`}>{provider.label}</button>; })}</div>
                <input value={policy.domain_allowlist} onChange={(event) => setPolicy((current) => ({ ...current, domain_allowlist: event.target.value }))} placeholder="Domain allowlist" className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none" />
              </div>
            </div>
            <div className="rounded-[24px] border border-black/10 bg-white/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-black/[0.42]">Provider readiness</p>
              <div className="mt-4 space-y-3">{enterprise.sso.providers.map((provider) => <div key={provider.key} className="rounded-[18px] border border-black/10 bg-sand/35 p-4"><div className="flex flex-wrap items-center gap-2"><Badge>{provider.label}</Badge><Badge>{provider.configured ? "configured" : "missing config"}</Badge>{provider.enabled ? <Badge>enabled</Badge> : null}{provider.preferred ? <Badge>preferred</Badge> : null}</div><p className="mt-3 text-sm leading-7 text-black/[0.66]">{provider.detail}</p></div>)}</div>
            </div>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-black/10 bg-white/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-black/[0.42]">RBAC defaults</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <select value={policy.default_role} onChange={(event) => setPolicy((current) => ({ ...current, default_role: event.target.value }))} className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none"><option value="viewer">Viewer default</option><option value="member">Member default</option><option value="admin">Admin default</option></select>
                <select value={policy.invite_policy} onChange={(event) => setPolicy((current) => ({ ...current, invite_policy: event.target.value }))} className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none"><option value="owner_only">Owner only</option><option value="admin_only">Admin only</option><option value="member_self_serve">Member self-serve</option></select>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">{enterprise.rbac.role_matrix.map((role) => <span key={role.role} className="rounded-full bg-sand px-3 py-2 text-xs text-black/[0.64]">{role.label} · {role.capabilities.length} capabilities</span>)}</div>
            </div>
            <div className="rounded-[24px] border border-black/10 bg-white/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-black/[0.42]">Quota and billing controls</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">{INPUTS.map(([key, label]) => <label key={key} className="space-y-2 text-sm text-black/[0.72]"><span className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">{label}</span><input value={policy[key]} onChange={(event) => setPolicy((current) => ({ ...current, [key]: event.target.value }))} className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 outline-none" /></label>)}</div>
              <input value={policy.billing_alert_thresholds} onChange={(event) => setPolicy((current) => ({ ...current, billing_alert_thresholds: event.target.value }))} placeholder="Billing alert thresholds" className="mt-4 w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none" />
              <label className="mt-4 flex items-center justify-between gap-4 text-sm text-black/[0.7]"><span>Soft enforcement before blocking</span><input type="checkbox" checked={policy.soft_enforcement} onChange={(event) => setPolicy((current) => ({ ...current, soft_enforcement: event.target.checked }))} /></label>
            </div>
          </div>
        </div>

        <div className="panel p-6">
          <h3 className="font-display text-2xl">Billing and usage controls</h3>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-[20px] border border-black/10 bg-white/75 p-4"><p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Monthly cost</p><p className="mt-3 font-display text-3xl">{usd(enterprise.billing.current_cost_usd)}</p><p className="mt-2 text-sm text-black/[0.58]">{pct(enterprise.billing.cost_utilization)} of {usd(enterprise.billing.monthly_cost_cap_usd)}</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-black/[0.06]"><div className="h-full rounded-full bg-ink" style={{ width: pct(enterprise.billing.cost_utilization) }} /></div></div>
            <div className="rounded-[20px] border border-black/10 bg-white/75 p-4"><p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Monthly tokens</p><p className="mt-3 font-display text-3xl">{enterprise.billing.total_tokens.toLocaleString()}</p><p className="mt-2 text-sm text-black/[0.58]">{pct(enterprise.billing.token_utilization)} of {enterprise.billing.monthly_token_cap.toLocaleString()}</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-black/[0.06]"><div className="h-full rounded-full bg-ink" style={{ width: pct(enterprise.billing.token_utilization) }} /></div></div>
          </div>
          <div className="mt-5 rounded-[20px] border border-black/10 bg-white/75 p-4"><p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">30-day cost curve</p><div className="mt-4 flex min-h-[140px] items-end gap-2">{enterprise.billing.by_day.length > 0 ? enterprise.billing.by_day.map((day) => <div key={day.day} className="flex min-w-0 flex-1 flex-col items-center gap-2"><div className="w-full rounded-t-[10px] bg-ink/85" style={{ height: `${Math.max(10, (day.cost_usd / maxDailyCost) * 110)}px` }} title={`${day.day}: ${usd(day.cost_usd)}`} /><span className="text-[10px] uppercase tracking-[0.12em] text-black/[0.42]">{new Date(day.day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>) : <p className="text-sm text-black/[0.55]">No usage has been recorded yet.</p>}</div></div>
          <div className="mt-5 rounded-[20px] border border-black/10 bg-white/75 p-4"><p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Quota pressure</p><div className="mt-4 space-y-4">{["projects", "threads", "documents", "artifacts", "automations"].map((key) => <div key={key}><div className="flex items-center justify-between gap-3 text-sm text-black/[0.68]"><span>{key}</span><span>{enterprise.quotas.usage[key as keyof typeof enterprise.quotas.usage]} / {enterprise.quotas.policy[key as keyof typeof enterprise.quotas.policy]}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-black/[0.06]"><div className="h-full rounded-full bg-ink" style={{ width: pct(enterprise.quotas.utilization[key] ?? 0) }} /></div></div>)}</div></div>
          <div className="mt-5 rounded-[20px] border border-black/10 bg-white/75 p-4"><p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Top models</p><div className="mt-4 space-y-3">{enterprise.billing.top_models.length > 0 ? enterprise.billing.top_models.map((model) => <div key={`${model.provider_name}-${model.model_name}`} className="rounded-[18px] border border-black/10 bg-sand/35 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-black/[0.78]">{model.model_name}</p><p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/[0.45]">{model.provider_name}</p></div><Badge>{usd(model.cost_usd)}</Badge></div></div>) : <p className="text-sm text-black/[0.55]">No model usage has been captured yet.</p>}</div></div>
        </div>
      </div>

      <div className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><Badge>RBAC</Badge><h3 className="mt-4 font-display text-2xl">Workspace membership and role controls</h3><p className="mt-2 text-sm leading-7 text-black/[0.6]">Promote, constrain, or disable members from the same admin surface.</p></div>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-black/[0.45]"><span className="rounded-full bg-black/[0.05] px-3 py-2">{enterprise.rbac.membership_count} members</span><span className="rounded-full bg-black/[0.05] px-3 py-2">{enterprise.rbac.pending_memberships} pending</span><span className="rounded-full bg-black/[0.05] px-3 py-2">{changedMembers} unsaved edits</span></div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">{members.map((member) => { const draft = drafts[member.membership_id] ?? { role: member.workspace_role, status: member.status }; const dirty = draft.role !== member.workspace_role || draft.status !== member.status; return <div key={member.membership_id} className="rounded-[24px] border border-black/10 bg-white/75 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-base font-medium text-black/[0.82]">{member.full_name}</p><Badge>{member.workspace_role}</Badge><Badge>{member.global_role}</Badge>{member.session_active ? <Badge>active session</Badge> : null}</div><p className="mt-2 text-sm text-black/[0.6]">{member.email}</p><p className="mt-2 text-xs uppercase tracking-[0.14em] text-black/[0.45]">Joined {fmtDate(member.joined_at)} / Last login {fmtDate(member.last_login_at)}</p></div><span className="rounded-full bg-black/[0.05] px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-black/[0.5]">{member.active_session_count} sessions</span></div><div className="mt-4 grid gap-4 md:grid-cols-2"><select value={draft.role} onChange={(event) => setDrafts((current) => ({ ...current, [member.membership_id]: { ...draft, role: event.target.value } }))} className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none"><option value="viewer">Viewer</option><option value="member">Member</option><option value="admin">Admin</option><option value="owner">Owner</option></select><select value={draft.status} onChange={(event) => setDrafts((current) => ({ ...current, [member.membership_id]: { ...draft, status: event.target.value } }))} className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none"><option value="active">Active</option><option value="pending">Pending</option><option value="disabled">Disabled</option></select></div><div className="mt-4 flex items-center justify-between gap-3"><p className="text-sm text-black/[0.55]">{dirty ? "This member has unsaved changes." : "No unsaved membership changes."}</p><button type="button" onClick={() => void saveMember(member)} disabled={!dirty || savingMember === member.membership_id} className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-50">{savingMember === member.membership_id ? "Saving..." : "Save member"}</button></div></div>; })}</div>
      </div>

      <div className="panel p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><Badge>Audit Browser</Badge><h3 className="mt-4 font-display text-2xl">Trace policy changes, approvals, and runtime administration.</h3><p className="mt-2 text-sm leading-7 text-black/[0.6]">Filter by action or resource type, then inspect the structured payload captured in the audit stream.</p></div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_auto]"><input value={auditAction} onChange={(event) => setAuditAction(event.target.value)} placeholder="Filter action" className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none" /><input value={auditResource} onChange={(event) => setAuditResource(event.target.value)} placeholder="Filter resource type" className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none" /><input value={auditLimit} onChange={(event) => setAuditLimit(event.target.value)} placeholder="40" className="rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none" /><button type="button" onClick={() => void refreshAudit()} disabled={loadingAudit} className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-white disabled:opacity-60">{loadingAudit ? "Loading..." : "Refresh audit"}</button></div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <div className="rounded-[24px] border border-black/10 bg-white/75 p-4"><p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Action hot spots</p><div className="mt-4 flex flex-wrap gap-2">{Object.entries(audit?.action_counts ?? {}).length > 0 ? Object.entries(audit?.action_counts ?? {}).map(([action, count]) => <span key={action} className="rounded-full bg-sand px-3 py-2 text-xs text-black/[0.64]">{action} · {count}</span>) : <span className="text-sm text-black/[0.55]">No audit action counts yet.</span>}</div></div>
            <div className="rounded-[24px] border border-black/10 bg-white/75 p-4"><p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Resource hot spots</p><div className="mt-4 flex flex-wrap gap-2">{Object.entries(audit?.resource_counts ?? {}).length > 0 ? Object.entries(audit?.resource_counts ?? {}).map(([resourceType, count]) => <span key={resourceType} className="rounded-full bg-sand px-3 py-2 text-xs text-black/[0.64]">{resourceType} · {count}</span>) : <span className="text-sm text-black/[0.55]">No audit resource counts yet.</span>}</div></div>
          </div>
          <div className="space-y-3">{auditItems.length > 0 ? auditItems.map((item) => <div key={item.id} className="rounded-[24px] border border-black/10 bg-white/75 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><Badge>{item.action}</Badge><Badge>{item.resource_type}</Badge></div><p className="mt-3 text-sm font-medium text-black/[0.76]">{item.actor_name ?? item.actor_email ?? "System actor"}</p><p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/[0.45]">{fmtDate(item.created_at)} / {item.resource_id}</p></div><span className="rounded-full bg-black/[0.05] px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-black/[0.5]">{item.actor_id ? "user event" : "system event"}</span></div><pre className="mt-4 overflow-x-auto rounded-[18px] border border-black/10 bg-sand/40 p-4 text-xs leading-6 text-black/[0.68]">{JSON.stringify(item.details, null, 2)}</pre></div>) : <div className="rounded-[24px] border border-dashed border-black/10 bg-white/75 px-4 py-5 text-sm text-black/[0.55]">No audit entries are available for the current filter set.</div>}</div>
        </div>
      </div>
    </section>
  );
}
