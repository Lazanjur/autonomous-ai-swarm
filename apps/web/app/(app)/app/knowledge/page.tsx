import { redirect } from "next/navigation";
import { KnowledgeHub } from "@/components/knowledge/knowledge-hub";
import { Badge } from "@/components/ui/badge";
import {
  getCurrentSession,
  hasSessionCookie,
  getWorkspaceArtifacts,
  getWorkspaceDocuments,
  getWorkspaceKnowledgeHealth
} from "@/lib/api";
import { resolveActiveWorkspace } from "@/lib/workspace";

export default async function KnowledgePage({
  searchParams
}: {
  searchParams?: Promise<{ workspace?: string; q?: string; document?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session || session.workspaces.length === 0) {
    if (await hasSessionCookie()) {
      return (
        <section className="panel p-6">
          <Badge>Knowledge Base</Badge>
          <h1 className="mt-4 font-display text-5xl">Knowledge services are unavailable.</h1>
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
  const [documents, artifacts, health] = await Promise.all([
    getWorkspaceDocuments(workspaceId),
    getWorkspaceArtifacts(workspaceId),
    getWorkspaceKnowledgeHealth(workspaceId)
  ]);

  if (!documents || !artifacts || !health) {
    return (
      <section className="panel p-6">
        <Badge>Knowledge Base</Badge>
        <h1 className="mt-4 font-display text-5xl">Knowledge services are unavailable.</h1>
        <p className="mt-4 max-w-2xl text-sm leading-8 text-black/[0.66]">
          The workspace is authenticated, but document, artifact, or retrieval health data could not be loaded from the backend.
        </p>
      </section>
    );
  }

  return (
    <KnowledgeHub
      workspaceId={workspaceId}
      documents={documents}
      artifacts={artifacts}
      health={health}
      initialQuery={params?.q ?? ""}
      highlightedDocumentId={params?.document ?? null}
    />
  );
}
