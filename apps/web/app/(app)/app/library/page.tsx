import { redirect } from "next/navigation";
import { LibraryHub } from "@/components/library/library-hub";
import { Badge } from "@/components/ui/badge";
import {
  getCurrentSession,
  getLibraryDashboard,
  hasSessionCookie,
} from "@/lib/api";
import { resolveActiveWorkspace } from "@/lib/workspace";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams?: Promise<{ workspace?: string; item?: string; collection?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session || session.workspaces.length === 0) {
    if (await hasSessionCookie()) {
      return (
        <section className="panel p-6">
          <Badge>Library</Badge>
          <h1 className="mt-4 font-display text-5xl">Library services are unavailable.</h1>
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
  const dashboard = await getLibraryDashboard(workspaceId);

  if (!dashboard) {
    return (
      <section className="panel p-6">
        <Badge>Library</Badge>
        <h1 className="mt-4 font-display text-5xl">Library services are unavailable.</h1>
        <p className="mt-4 max-w-2xl text-sm leading-8 text-black/[0.66]">
          The workspace is authenticated, but curated library data could not be loaded from the backend.
        </p>
      </section>
    );
  }

  return (
    <LibraryHub
      workspaceId={workspaceId}
      dashboard={dashboard}
      initialSelectedItemId={params?.item ?? null}
      initialCollection={params?.collection ?? null}
    />
  );
}
