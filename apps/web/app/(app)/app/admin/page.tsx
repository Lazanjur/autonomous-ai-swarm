import { Badge } from "@/components/ui/badge";
import { getCurrentSession, getOpsDashboard, hasSessionCookie } from "@/lib/api";

function StatCard({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[24px] border border-black/10 bg-white/70 p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-black/45">{label}</p>
      <p className="mt-3 font-display text-4xl text-black">{value}</p>
      <p className="mt-2 text-sm text-black/60">{detail}</p>
    </div>
  );
}

export default async function AdminPage() {
  const session = await getCurrentSession();
  const workspaceId = session?.workspaces[0]?.workspace_id ?? null;
  const dashboard = await getOpsDashboard(workspaceId);

  if (!workspaceId && (await hasSessionCookie())) {
    return (
      <section className="panel p-6">
        <Badge>Admin Ops</Badge>
        <h1 className="mt-4 font-display text-5xl">Enterprise posture is unavailable.</h1>
        <p className="mt-4 max-w-2xl text-base text-black/62">
          The session cookie is present, but the authenticated workspace profile could not be loaded from the backend.
        </p>
      </section>
    );
  }

  if (!dashboard) {
    return (
      <section className="panel p-6">
        <Badge>Admin Ops</Badge>
        <h1 className="mt-4 font-display text-5xl">Enterprise posture is unavailable.</h1>
        <p className="mt-4 max-w-2xl text-base text-black/62">
          This view requires an owner or workspace admin session and a reachable API.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <Badge>Admin Ops</Badge>
        <h1 className="mt-4 font-display text-5xl">Enterprise guardrails and runtime posture.</h1>
        <p className="mt-4 max-w-3xl text-base text-black/62">
          Real-time request protection, provider spend controls, approvals pressure, and recent operational alerts.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Requests"
          value={dashboard.request_metrics.total_requests.toLocaleString()}
          detail={`${dashboard.request_metrics.rate_limited_requests} rate-limited in the current process window.`}
        />
        <StatCard
          label="Spend 24h"
          value={`$${dashboard.provider_usage.total_cost_usd_24h.toFixed(4)}`}
          detail={`Budget utilization ${(dashboard.budget.utilization * 100).toFixed(1)}% of $${dashboard.budget.cap_usd.toFixed(2)}.`}
        />
        <StatCard
          label="Approvals"
          value={dashboard.approvals.pending_items.toLocaleString()}
          detail={`${dashboard.approvals.blocked_actions} blocked sensitive actions captured recently.`}
        />
        <StatCard
          label="Health"
          value={dashboard.health.status}
          detail={`DB ${dashboard.health.database_ok ? "ok" : "degraded"}, models ${dashboard.health.models_configured ? "configured" : "offline"}.`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
        <div className="panel overflow-hidden p-0">
          <div className="border-b border-black/10 px-6 py-5">
            <h2 className="font-display text-2xl">Provider usage</h2>
            <p className="mt-1 text-sm text-black/58">24-hour token and cost profile by model.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-black/[0.03] text-black/52">
                <tr>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Requests</th>
                  <th className="px-4 py-3 font-medium">Tokens</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.provider_usage.by_model.map((row) => (
                  <tr key={`${row.provider_name}-${row.model_name}`} className="border-t border-black/10">
                    <td className="px-4 py-4 text-black/74">{row.model_name}</td>
                    <td className="px-4 py-4 text-black/60">{row.provider_name}</td>
                    <td className="px-4 py-4 text-black/60">{row.request_count}</td>
                    <td className="px-4 py-4 text-black/60">
                      {(row.prompt_tokens + row.completion_tokens).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-black/74">${row.estimated_cost.toFixed(4)}</td>
                  </tr>
                ))}
                {dashboard.provider_usage.by_model.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-black/50">
                      No usage events recorded yet for this scope.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel p-6">
            <h2 className="font-display text-2xl">Guardrails</h2>
            <div className="mt-5 space-y-4 text-sm text-black/65">
              <div className="flex items-center justify-between rounded-[18px] border border-black/10 px-4 py-3">
                <span>Rate limiting</span>
                <span>{dashboard.health.rate_limiting_enabled ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex items-center justify-between rounded-[18px] border border-black/10 px-4 py-3">
                <span>Provider budget</span>
                <span>{dashboard.health.provider_budget_enforced ? "Enforced" : "Observe only"}</span>
              </div>
              <div className="flex items-center justify-between rounded-[18px] border border-black/10 px-4 py-3">
                <span>Active automations</span>
                <span>{dashboard.automations.active_automations}</span>
              </div>
              <div className="flex items-center justify-between rounded-[18px] border border-black/10 px-4 py-3">
                <span>Awaiting approval</span>
                <span>{dashboard.automations.awaiting_approval}</span>
              </div>
            </div>
          </div>

          <div className="panel p-6">
            <h2 className="font-display text-2xl">Recent alerts</h2>
            <div className="mt-5 space-y-3">
              {dashboard.audit.recent_alerts.slice(0, 5).map((alert) => (
                <div key={`${alert.code}-${alert.timestamp}`} className="rounded-[18px] border border-black/10 px-4 py-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-black/72">{alert.code}</span>
                    <span className="text-black/45">{new Date(alert.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="mt-2 text-sm text-black/58">{alert.message}</p>
                </div>
              ))}
              {dashboard.audit.recent_alerts.length === 0 ? (
                <p className="text-sm text-black/50">No recent alerts recorded.</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
