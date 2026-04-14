import { redirect } from "next/navigation";

import { PluginsHub } from "@/components/plugins/plugins-hub";
import { Badge } from "@/components/ui/badge";
import {
  getCurrentSession,
  getIntegrationStatus,
  getTaskTemplates,
  hasSessionCookie
} from "@/lib/api";
import { resolveActiveWorkspace } from "@/lib/workspace";

export default async function PluginsPage({
  searchParams
}: {
  searchParams?: Promise<{ workspace?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session?.workspaces?.length) {
    if (await hasSessionCookie()) {
      return (
        <section className="panel p-6">
          <Badge>Plugins</Badge>
          <h1 className="mt-4 font-display text-5xl">Plugin services are unavailable.</h1>
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
  const [integrations, templates] = await Promise.all([
    getIntegrationStatus(workspaceId),
    getTaskTemplates(workspaceId)
  ]);

  return (
    <PluginsHub
      workspaceId={workspaceId}
      integrations={integrations}
      templates={templates?.templates ?? []}
    />
  );
}
