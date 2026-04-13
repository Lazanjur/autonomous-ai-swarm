import { redirect } from "next/navigation";

import { OverviewPanel } from "@/components/app-shell/overview";
import {
  getChatWorkspace,
  getCurrentSession,
  hasSessionCookie,
  getOpsDashboard,
  getWorkspaceAutomations,
  getWorkspaceKnowledgeHealth
} from "@/lib/api";
import { resolveActiveWorkspace } from "@/lib/workspace";

export default async function AppHomePage({
  searchParams
}: {
  searchParams?: Promise<{ workspace?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session?.workspaces?.length) {
    if (await hasSessionCookie()) {
      return (
        <section className="panel p-6">
          <h1 className="font-display text-5xl">Workspace overview is unavailable.</h1>
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
  const [runtime, health, automations, ops] = await Promise.all([
    getChatWorkspace(workspaceId),
    getWorkspaceKnowledgeHealth(workspaceId),
    getWorkspaceAutomations(workspaceId),
    getOpsDashboard(workspaceId)
  ]);

  return (
    <OverviewPanel
      workspaceId={workspaceId}
      threadCount={runtime?.threads.length ?? 0}
      runCount={runtime?.runs.length ?? 0}
      knowledgeChunks={health?.total_chunks ?? 0}
      automationCount={automations?.length ?? 0}
      approvalCount={ops?.approvals.pending_items ?? 0}
      latestRunSummary={runtime?.runs[0]?.summary ?? null}
      latestAlertMessage={ops?.audit.recent_alerts[0]?.message ?? null}
      systemStatus={
        ops
          ? {
              modelsConfigured: ops.health.models_configured,
              databaseOk: ops.health.database_ok,
              budgetUtilization: ops.budget.utilization
            }
          : null
      }
    />
  );
}
