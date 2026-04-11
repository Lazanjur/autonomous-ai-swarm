import { Badge } from "@/components/ui/badge";
import {
  getCurrentSession,
  getWorkspaceArtifacts,
  getWorkspaceDocuments,
  hasSessionCookie
} from "@/lib/api";

export default async function ArtifactsPage() {
  const session = await getCurrentSession();
  const workspaceId = session?.workspaces[0]?.workspace_id;

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
    getWorkspaceDocuments(workspaceId)
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
  const documentTitles = new Map(documents.map((document) => [document.id, document.title]));
  const byKind = artifacts.reduce<Record<string, number>>((acc, artifact) => {
    acc[artifact.kind] = (acc[artifact.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <Badge>Artifacts</Badge>
        <h1 className="mt-4 font-display text-5xl">Generated files, exports, and source artifacts.</h1>
        <p className="mt-4 max-w-3xl text-base text-black/62">
          This workspace-level view separates downloadable outputs from the knowledge page so teams can browse deliverables directly.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Artifacts</p>
          <p className="mt-3 font-display text-4xl">{artifacts.length}</p>
          <p className="mt-2 text-sm text-black/60">Total persisted files and exports.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Documents</p>
          <p className="mt-3 font-display text-4xl">{documents.length}</p>
          <p className="mt-2 text-sm text-black/60">Knowledge sources represented by artifacts.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Kinds</p>
          <p className="mt-3 font-display text-4xl">{Object.keys(byKind).length}</p>
          <p className="mt-2 text-sm text-black/60">Distinct artifact categories in the workspace.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="panel p-6">
          <h2 className="font-display text-3xl">Distribution</h2>
          <div className="mt-5 space-y-3">
            {Object.entries(byKind).map(([kind, count]) => (
              <div key={kind} className="flex items-center justify-between rounded-[20px] border border-black/10 bg-white/75 px-4 py-3 text-sm text-black/68">
                <span className="font-medium text-black/76">{kind}</span>
                <span>{count}</span>
              </div>
            ))}
            {Object.keys(byKind).length === 0 ? (
              <p className="text-sm text-black/50">No artifacts have been generated yet.</p>
            ) : null}
          </div>
        </div>

        <div className="panel p-6">
          <h2 className="font-display text-3xl">Artifact Library</h2>
          <div className="mt-5 space-y-4">
            {artifacts.map((artifact) => (
              <div key={artifact.id} className="rounded-[22px] border border-black/10 bg-white/75 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-black/78">{artifact.title}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/45">{artifact.kind}</p>
                  </div>
                  <a
                    href={`/api/artifacts/${artifact.id}/download`}
                    className="rounded-full bg-ink px-4 py-2 text-sm text-white transition hover:bg-ink/90"
                  >
                    Download
                  </a>
                </div>
                <p className="mt-3 text-sm text-black/60">
                  {artifact.document_id
                    ? `Linked document: ${documentTitles.get(artifact.document_id) ?? artifact.document_id}`
                    : "Run-level artifact"}
                </p>
                <p className="mt-2 break-all text-xs text-black/45">{artifact.storage_key}</p>
              </div>
            ))}
            {artifacts.length === 0 ? (
              <p className="text-sm text-black/50">No artifacts are available yet for this workspace.</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
