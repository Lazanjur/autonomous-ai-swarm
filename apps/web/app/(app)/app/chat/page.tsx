import { ChatWorkspace } from "@/components/app-shell/chat-workspace";
import { getChatWorkspace, getCurrentSession, hasSessionCookie } from "@/lib/api";
import { redirect } from "next/navigation";

export default async function ChatPage({
  searchParams
}: {
  searchParams?: Promise<{ thread?: string }>;
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
  const workspaceId = session.workspaces[0].workspace_id;
  const data = await getChatWorkspace(workspaceId, params?.thread ?? null);
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
  return <ChatWorkspace data={data} />;
}
