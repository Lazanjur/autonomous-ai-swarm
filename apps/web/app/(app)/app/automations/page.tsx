import { redirect } from "next/navigation";

import { AutomationHub } from "@/components/automations/automation-hub";
import {
  getAutomationDashboard,
  getCurrentSession,
  getTaskTemplates,
  getWorkspaceAutomations,
  hasSessionCookie
} from "@/lib/api";
import { resolveActiveWorkspace } from "@/lib/workspace";

export default async function AutomationsPage({
  searchParams
}: {
  searchParams?: Promise<{ workspace?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session?.workspaces?.length) {
    if (await hasSessionCookie()) {
      return (
        <section className="panel p-6">
          <h1 className="font-display text-5xl">Automation services are unavailable.</h1>
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
  const automations = await getWorkspaceAutomations(workspaceId);
  if (!automations) {
    return (
      <section className="panel p-6">
        <h1 className="font-display text-5xl">Automation services are unavailable.</h1>
        <p className="mt-4 max-w-2xl text-sm leading-8 text-black/[0.66]">
          The workspace is authenticated, but automation records could not be loaded from the backend.
        </p>
      </section>
    );
  }
  const initialDashboard = automations[0] ? await getAutomationDashboard(automations[0].id) : null;
  const templateCatalog = await getTaskTemplates(workspaceId);

  return (
    <AutomationHub
      workspaceId={workspaceId}
      automations={automations}
      initialDashboard={initialDashboard}
      taskTemplates={templateCatalog?.templates ?? []}
    />
  );
}
