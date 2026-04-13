import Link from "next/link";

import { EnterpriseAdminConsole } from "@/components/admin/enterprise-admin-console";
import { Badge } from "@/components/ui/badge";
import {
  getAdminAudit,
  getAdminSearch,
  getCurrentSession,
  getEnterpriseAdmin,
  getOpsDashboard,
  hasSessionCookie,
} from "@/lib/api";
import type { AdminSearchResult } from "@/lib/types";
import { resolveActiveWorkspace, withWorkspacePath } from "@/lib/workspace";

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

function buildAdminResultHref(result: AdminSearchResult, query: string) {
  switch (result.kind) {
    case "project":
      return withWorkspacePath("/app/chat", result.workspace_id, {
        project: result.project_id
      });
    case "task": {
      return withWorkspacePath("/app/chat", result.workspace_id, {
        project: result.project_id,
        thread: result.thread_id
      });
    }
    case "document": {
      return withWorkspacePath("/app/knowledge", result.workspace_id, {
        q: query,
        document: result.document_id
      });
    }
    case "artifact": {
      return withWorkspacePath("/app/artifacts", result.workspace_id, {
        q: query,
        artifact: result.artifact_id
      });
    }
    default:
      return withWorkspacePath("/app/admin", result.workspace_id, {
        q: query
      });
  }
}

function resultActionLabel(result: AdminSearchResult, activeWorkspaceId: string | null) {
  if (result.workspace_id !== activeWorkspaceId) {
    return "Open in workspace";
  }
  switch (result.kind) {
    case "project":
      return "Open project";
    case "task":
      return "Open task";
    case "document":
      return "Open document";
    case "artifact":
      return "Open artifact";
    default:
      return "Open";
  }
}

export default async function AdminPage({
  searchParams
}: {
  searchParams?: Promise<{ q?: string; workspace?: string }>;
}) {
  const session = await getCurrentSession();
  const params = searchParams ? await searchParams : undefined;

  if (!session?.workspaces?.length) {
    if (await hasSessionCookie()) {
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
    return (
      <section className="panel p-6">
        <Badge>Admin Ops</Badge>
        <h1 className="mt-4 font-display text-5xl">Enterprise posture is unavailable.</h1>
        <p className="mt-4 max-w-2xl text-base text-black/62">
          Sign in with an owner or workspace admin account to inspect the admin console.
        </p>
      </section>
    );
  }

  const primaryWorkspaceId = session.workspaces[0].workspace_id;
  const isOwner = session.user.role === "owner";
  const normalizedQuery = (params?.q ?? "").trim();
  const activeWorkspace = resolveActiveWorkspace(session, params?.workspace);
  const requestedWorkspace = params?.workspace ?? activeWorkspace?.workspace_id ?? primaryWorkspaceId;
  const accessibleWorkspaceIds = new Set(session.workspaces.map((workspace) => workspace.workspace_id));
  const globalScopeRequested = isOwner && requestedWorkspace === "global";
  const selectedWorkspaceId = globalScopeRequested
    ? null
    : accessibleWorkspaceIds.has(requestedWorkspace)
      ? requestedWorkspace
      : activeWorkspace?.workspace_id ?? primaryWorkspaceId;
  const enterpriseWorkspaceId = selectedWorkspaceId ?? activeWorkspace?.workspace_id ?? primaryWorkspaceId;

  const [dashboard, adminSearch, enterpriseAdmin, enterpriseAudit] = await Promise.all([
    getOpsDashboard(selectedWorkspaceId),
    normalizedQuery.length >= 2 ? getAdminSearch(normalizedQuery, selectedWorkspaceId) : Promise.resolve(null),
    getEnterpriseAdmin(enterpriseWorkspaceId),
    getAdminAudit(enterpriseWorkspaceId, { limit: 40 })
  ]);

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

  const resultsByWorkspace = new Map<string, AdminSearchResult[]>();
  for (const result of adminSearch?.results ?? []) {
    const key = result.workspace_id;
    if (!resultsByWorkspace.has(key)) {
      resultsByWorkspace.set(key, []);
    }
    resultsByWorkspace.get(key)?.push(result);
  }

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <Badge>Admin Ops</Badge>
        <h1 className="mt-4 font-display text-5xl">Enterprise guardrails, posture, and cross-workspace search.</h1>
        <p className="mt-4 max-w-3xl text-base text-black/62">
          Real-time operational telemetry plus a separate admin search layer for projects, tasks, documents, and artifacts.
        </p>
      </div>

      {enterpriseAdmin ? (
        <EnterpriseAdminConsole
          initialEnterprise={enterpriseAdmin}
          initialAudit={enterpriseAudit}
          workspaceId={enterpriseWorkspaceId}
        />
      ) : (
        <div className="panel p-6">
          <Badge>Enterprise Controls</Badge>
          <h2 className="mt-4 font-display text-3xl">Workspace enterprise controls are currently unavailable.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-8 text-black/[0.66]">
            The workspace admin APIs could not be loaded for this workspace scope. The ops/search surface is still available, but enterprise controls need a reachable backend and workspace admin access.
          </p>
        </div>
      )}

      <div className="panel p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <Badge>Admin Search</Badge>
            <h2 className="mt-4 font-display text-3xl">Search across workspace memory and deliverables.</h2>
            <p className="mt-3 max-w-3xl text-sm leading-8 text-black/[0.66]">
              Use the admin layer to search across projects, task history, indexed knowledge, and generated artifacts.
            </p>
            {globalScopeRequested ? (
              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.44]">
                Enterprise controls remain scoped to {session.workspaces.find((workspace) => workspace.workspace_id === enterpriseWorkspaceId)?.workspace_name ?? "the active workspace"} while search is running globally.
              </p>
            ) : null}
          </div>
          <form className="grid gap-3 md:grid-cols-[1.8fr_1fr_auto] xl:min-w-[720px]" method="GET">
            <input
              name="q"
              defaultValue={normalizedQuery}
              placeholder="Search projects, tasks, documents, and artifacts"
              className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
            />
            <select
              name="workspace"
              defaultValue={globalScopeRequested ? "global" : (selectedWorkspaceId ?? primaryWorkspaceId)}
              className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
            >
              {isOwner ? <option value="global">Global across accessible workspaces</option> : null}
              {session.workspaces.map((workspace) => (
                <option key={workspace.workspace_id} value={workspace.workspace_id}>
                  {workspace.workspace_name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-white transition hover:bg-ink/90"
            >
              Search
            </button>
          </form>
        </div>

        {normalizedQuery.length > 0 && normalizedQuery.length < 2 ? (
          <div className="mt-5 rounded-[24px] border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-black/[0.6]">
            Type at least 2 characters to run admin search.
          </div>
        ) : null}

        {adminSearch ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Matches"
              value={adminSearch.total_results.toLocaleString()}
              detail={`${adminSearch.workspace_count} workspace scopes searched.`}
            />
            <StatCard
              label="Projects"
              value={String(adminSearch.result_counts.project ?? 0)}
              detail="Initiatives and project-level metadata."
            />
            <StatCard
              label="Tasks"
              value={String(adminSearch.result_counts.task ?? 0)}
              detail="Task history, conversations, and run output."
            />
            <StatCard
              label="Documents"
              value={String(adminSearch.result_counts.document ?? 0)}
              detail="Indexed sources from the knowledge layer."
            />
            <StatCard
              label="Artifacts"
              value={String(adminSearch.result_counts.artifact ?? 0)}
              detail="Generated files, exports, and captured outputs."
            />
          </div>
        ) : null}
      </div>

      {adminSearch ? (
        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
          <div className="panel p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl">Admin search results</h2>
                <p className="mt-1 text-sm text-black/58">
                  {adminSearch.scope === "global"
                    ? "Showing owner-level search results across accessible workspaces."
                    : "Showing search results inside the selected workspace scope."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-black/[0.45]">
                <span className="rounded-full bg-black/[0.05] px-3 py-2">{adminSearch.scope}</span>
                <span className="rounded-full bg-black/[0.05] px-3 py-2">{adminSearch.total_results} matches</span>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              {resultsByWorkspace.size > 0 ? (
                [...resultsByWorkspace.entries()].map(([workspaceId, results]) => (
                  <div key={workspaceId} className="rounded-[24px] border border-black/10 bg-white/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-black/[0.82]">{results[0].workspace_name}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-black/[0.44]">
                          {results.length} matches / {results[0].workspace_slug}
                        </p>
                      </div>
                      {workspaceId !== selectedWorkspaceId ? (
                        <Link
                          href={withWorkspacePath("/app/admin", workspaceId, {
                            q: normalizedQuery || null
                          })}
                          className="rounded-full bg-sand/70 px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-black/[0.62] transition hover:bg-sand"
                        >
                          Focus workspace
                        </Link>
                      ) : (
                        <span className="rounded-full bg-black/[0.05] px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-black/[0.52]">
                          Current workspace
                        </span>
                      )}
                    </div>

                    <div className="mt-4 space-y-3">
                      {results.map((result) => (
                        <div key={`${result.kind}-${result.workspace_id}-${result.title}-${result.score}`} className="rounded-[20px] border border-black/10 bg-white/80 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge>{result.kind}</Badge>
                                {result.status ? <Badge>{result.status}</Badge> : null}
                                {result.project_name ? <Badge>{result.project_name}</Badge> : null}
                              </div>
                              <h3 className="mt-3 text-base font-medium text-black/[0.82]">{result.title}</h3>
                              {result.subtitle ? (
                                <p className="mt-2 text-sm leading-7 text-black/[0.66]">{result.subtitle}</p>
                              ) : null}
                            </div>
                            <div className="text-right text-xs uppercase tracking-[0.16em] text-black/[0.45]">
                              <div>Score {result.score.toFixed(1)}</div>
                              <div className="mt-2">
                                {result.updated_at ?? result.created_at
                                  ? new Date(result.updated_at ?? result.created_at ?? "").toLocaleString()
                                  : "No timestamp"}
                              </div>
                            </div>
                          </div>

                          {result.highlight ? (
                            <p className="mt-4 rounded-[18px] border border-black/10 bg-sand/65 px-4 py-3 text-sm leading-7 text-black/[0.7]">
                              {result.highlight}
                            </p>
                          ) : null}

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.45]">
                              {result.matched_by.map((source) => (
                                <span key={`${result.title}-${source}`} className="rounded-full bg-black/[0.05] px-2 py-1">
                                  {source.replaceAll("_", " ")}
                                </span>
                              ))}
                            </div>
                            <Link
                              href={buildAdminResultHref(result, normalizedQuery)}
                              className="rounded-full bg-ink px-4 py-2 text-sm text-white transition hover:bg-ink/90"
                            >
                              {resultActionLabel(result, selectedWorkspaceId)}
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-black/10 bg-white/70 px-4 py-4 text-sm text-black/[0.6]">
                  No admin search matches found for this scope.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
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
      ) : (
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
      )}
    </section>
  );
}
