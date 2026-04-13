import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { getCurrentSession, getIntegrationStatus, getOpsDashboard, hasSessionCookie } from "@/lib/api";
import { resolveActiveWorkspace } from "@/lib/workspace";

export default async function SettingsPage({
  searchParams
}: {
  searchParams?: Promise<{ workspace?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session?.workspaces?.length) {
    if (await hasSessionCookie()) {
      return (
        <section className="panel p-6">
          <Badge>Settings</Badge>
          <h1 className="mt-4 font-display text-5xl">Settings are unavailable.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-8 text-black/[0.66]">
            The session cookie is present, but the authenticated workspace profile could not be loaded from the backend.
          </p>
        </section>
      );
    }
    redirect("/signin");
  }

  const params = searchParams ? await searchParams : undefined;
  const activeWorkspace = resolveActiveWorkspace(session, params?.workspace);
  const workspace = activeWorkspace ?? session.workspaces[0];
  const workspaceId = workspace.workspace_id;
  const ops = await getOpsDashboard(workspaceId);
  const integrations = await getIntegrationStatus(workspaceId);

  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <div className="panel p-6">
        <Badge>Workspace Identity</Badge>
        <h1 className="mt-4 font-display text-4xl">Session and workspace posture.</h1>
        <div className="mt-6 space-y-3 text-sm text-black/70">
          <div className="rounded-[22px] bg-white/75 p-4">User: {session.user.full_name}</div>
          <div className="rounded-[22px] bg-white/75 p-4">Email: {session.user.email}</div>
          <div className="rounded-[22px] bg-white/75 p-4">
            Workspace: {workspace.workspace_name}
          </div>
          <div className="rounded-[22px] bg-white/75 p-4">
            Role: {workspace.role}
          </div>
        </div>
      </div>

      <div className="panel p-6">
        <Badge>Governance</Badge>
        <h2 className="mt-4 font-display text-4xl">Live control state.</h2>
        <div className="mt-6 space-y-3 text-sm text-black/70">
          <div className="rounded-[22px] bg-white/75 p-4">
            Models configured: {ops?.health.models_configured ? "Yes" : "No"}
          </div>
          <div className="rounded-[22px] bg-white/75 p-4">
            Database posture: {ops?.health.database_ok ? "Healthy" : "Unavailable or degraded"}
          </div>
          <div className="rounded-[22px] bg-white/75 p-4">
            Rate limiting: {ops?.health.rate_limiting_enabled ? "Enabled" : "Disabled"}
          </div>
          <div className="rounded-[22px] bg-white/75 p-4">
            Provider budget: {ops?.health.provider_budget_enforced ? "Enforced" : "Observe only"}
          </div>
          <div className="rounded-[22px] bg-white/75 p-4">
            Pending approvals: {ops?.approvals.pending_items ?? 0}
          </div>
          <div className="rounded-[22px] bg-white/75 p-4">
            Budget utilization: {ops ? `${(ops.budget.utilization * 100).toFixed(1)}%` : "Unavailable"}
          </div>
        </div>
      </div>

      <div className="panel p-6 xl:col-span-2">
        <Badge>External Integrations</Badge>
        <h2 className="mt-4 font-display text-4xl">Delivery and connector posture.</h2>
        <p className="mt-3 max-w-3xl text-sm leading-8 text-black/[0.66]">
          Email, Slack, webhooks, calendars, and generic external REST calls all run through the same
          approval-aware integration layer.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {(integrations?.providers ?? []).map((provider) => (
            <div key={provider.key} className="rounded-[22px] bg-white/75 p-4 text-sm text-black/70">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium capitalize text-black">{provider.key}</span>
                <span>{provider.configured ? "Ready" : "Not configured"}</span>
              </div>
              <div className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.45]">
                {provider.provider}
              </div>
              <p className="mt-3 leading-7">{provider.detail}</p>
              <p className="mt-3 text-xs text-black/[0.5]">
                Approval gate: {provider.uses_approval_gate ? "required for live delivery" : "not required"}
              </p>
            </div>
          ))}
          {!integrations?.providers?.length && (
            <div className="rounded-[22px] bg-white/75 p-4 text-sm text-black/70 md:col-span-2 xl:col-span-5">
              Integration posture is unavailable for the current role or the backend did not return integration status.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
