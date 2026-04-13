import { ArtifactBrowser } from "@/components/artifacts/artifact-browser";
import { Badge } from "@/components/ui/badge";
import {
  getArtifactPreview,
  getCurrentSession,
  getWorkspaceArtifacts,
  getWorkspaceDocuments,
  hasSessionCookie,
} from "@/lib/api";
import { resolveActiveWorkspace } from "@/lib/workspace";

export default async function ArtifactsPage({
  searchParams,
}: {
  searchParams?: Promise<{ workspace?: string; q?: string; artifact?: string }>;
}) {
  const session = await getCurrentSession();
  const params = searchParams ? await searchParams : undefined;
  const activeWorkspace = resolveActiveWorkspace(session ?? undefined, params?.workspace);
  const workspaceId = activeWorkspace?.workspace_id ?? session?.workspaces[0]?.workspace_id;

  if (!workspaceId) {
    if (await hasSessionCookie()) {
      return (
        <section className="panel p-6">
          <Badge>Artifacts</Badge>
          <h1 className="mt-4 font-display text-5xl">Artifact services are unavailable.</h1>
          <p className="mt-4 max-w-2xl text-base text-black/62">
            The session cookie is present, but the authenticated workspace profile could not be loaded from the backend.
          </p>
        </section>
      );
    }
    return (
      <section className="panel p-6">
        <Badge>Artifacts</Badge>
        <h1 className="mt-4 font-display text-5xl">Workspace artifacts are unavailable.</h1>
        <p className="mt-4 max-w-2xl text-base text-black/62">
          Sign in to browse generated reports, uploaded source files, exports, and downloadable outputs.
        </p>
      </section>
    );
  }

  const [artifacts, documents] = await Promise.all([
    getWorkspaceArtifacts(workspaceId),
    getWorkspaceDocuments(workspaceId),
  ]);
  if (!artifacts || !documents) {
    return (
      <section className="panel p-6">
        <Badge>Artifacts</Badge>
        <h1 className="mt-4 font-display text-5xl">Artifact services are unavailable.</h1>
        <p className="mt-4 max-w-2xl text-base text-black/62">
          The workspace is authenticated, but artifact or document data could not be loaded from the backend.
        </p>
      </section>
    );
  }

  const query = (params?.q ?? "").trim();
  const normalizedQuery = query.toLowerCase();
  const highlightedArtifactId = params?.artifact ?? null;
  const visibleArtifacts = normalizedQuery
    ? artifacts.filter((artifact) =>
        [artifact.title, artifact.kind, artifact.storage_key]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : artifacts;
  const selectedArtifactId =
    visibleArtifacts.find((artifact) => artifact.id === highlightedArtifactId)?.id ??
    visibleArtifacts[0]?.id ??
    null;
  const preview = selectedArtifactId ? await getArtifactPreview(selectedArtifactId) : null;

  return (
    <ArtifactBrowser
      workspaceId={workspaceId}
      artifacts={artifacts}
      documents={documents}
      preview={preview}
      selectedArtifactId={selectedArtifactId}
      query={query}
    />
  );
}
