import { ChatWorkspace } from "@/components/app-shell/chat-workspace";
import {
  getChatAgents,
  getChatWorkbenchFile,
  getChatWorkbenchTree,
  getChatWorkspace,
  getCurrentSession,
  getTaskTemplates,
  hasSessionCookie
} from "@/lib/api";
import { resolveActiveWorkspace } from "@/lib/workspace";
import { redirect } from "next/navigation";

export default async function ChatPage({
  searchParams
}: {
  searchParams?: Promise<{ workspace?: string; thread?: string; project?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session?.workspaces?.length) {
    if (await hasSessionCookie()) {
      return (
        <section className="panel p-6">
          <h1 className="font-display text-5xl">Chat runtime is unavailable.</h1>
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
  const data = await getChatWorkspace(
    workspaceId,
    params?.thread ?? null,
    params?.project ?? null
  );
  if (!data) {
    return (
      <section className="panel p-6">
        <h1 className="font-display text-5xl">Chat runtime is unavailable.</h1>
        <p className="mt-4 max-w-2xl text-sm leading-8 text-black/[0.66]">
          The workspace session is valid, but the backend chat runtime could not be reached. Bring the API back up and reload this page.
        </p>
      </section>
    );
  }

  const workbenchTree = await getChatWorkbenchTree(workspaceId, ".");
  const preferredFile = workbenchTree?.entries.find((entry) =>
    ["README.md", "todo.md", "package.json", "apps/web/package.json"].includes(entry.relative_path)
  ) ?? workbenchTree?.entries.find((entry) => entry.kind === "file");
  const workbenchFile = preferredFile
    ? await getChatWorkbenchFile(workspaceId, preferredFile.relative_path)
    : null;
  const templateCatalog = await getTaskTemplates(workspaceId);
  const chatAgents = await getChatAgents(workspaceId);

  return (
    <ChatWorkspace
      data={data}
      initialWorkbenchTree={workbenchTree}
      initialWorkbenchFile={workbenchFile}
      taskTemplates={templateCatalog?.templates ?? []}
      chatAgents={chatAgents ?? undefined}
    />
  );
}
