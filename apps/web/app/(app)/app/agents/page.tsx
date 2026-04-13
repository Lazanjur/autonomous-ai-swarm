import { redirect } from "next/navigation";
import { AgentsHub } from "@/components/agents/agents-hub";
import { Badge } from "@/components/ui/badge";
import { getChatAgents, getCurrentSession, hasSessionCookie } from "@/lib/api";
import { resolveActiveWorkspace } from "@/lib/workspace";

export default async function AgentsPage({
  searchParams
}: {
  searchParams?: Promise<{ workspace?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session || session.workspaces.length === 0) {
    if (await hasSessionCookie()) {
      return (
        <section className="panel p-6">
          <Badge>Agents</Badge>
          <h1 className="mt-4 font-display text-5xl">Agent services are unavailable.</h1>
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
  const data = await getChatAgents(workspaceId);
  if (!data) {
    return (
      <section className="panel p-6">
        <Badge>Agents</Badge>
        <h1 className="mt-4 font-display text-5xl">Agent services are unavailable.</h1>
        <p className="mt-4 max-w-2xl text-sm leading-8 text-black/[0.66]">
          The workspace is authenticated, but the agent catalog and activity surface could not be loaded from the backend.
        </p>
      </section>
    );
  }

  return <AgentsHub data={data} />;
}
