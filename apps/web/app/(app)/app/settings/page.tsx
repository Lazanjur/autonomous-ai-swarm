import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { getCurrentSession, getOpsDashboard, hasSessionCookie } from "@/lib/api";

export default async function SettingsPage() {
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

  const workspaceId = session.workspaces[0].workspace_id;
  const ops = await getOpsDashboard(workspaceId);

  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <div className="panel p-6">
        <Badge>Workspace Identity</Badge>
        <h1 className="mt-4 font-display text-4xl">Session and workspace posture.</h1>
        <div className="mt-6 space-y-3 text-sm text-black/70">
          <div className="rounded-[22px] bg-white/75 p-4">User: {session.user.full_name}</div>
          <div className="rounded-[22px] bg-white/75 p-4">Email: {session.user.email}</div>
          <div className="rounded-[22px] bg-white/75 p-4">
            Workspace: {session.workspaces[0].workspace_name}
          </div>
          <div className="rounded-[22px] bg-white/75 p-4">
            Role: {session.workspaces[0].role}
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
    </section>
  );
}
