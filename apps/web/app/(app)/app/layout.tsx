import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-shell/sidebar";
import { getCurrentSession, getTaskRail } from "@/lib/api";

export default async function AppLayout({
  children
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const cookieName = process.env.SESSION_COOKIE_NAME ?? "swarm_session_token";
  if (!cookieStore.get(cookieName)) {
    redirect("/signin");
  }

  const session = await getCurrentSession();
  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[1600px] items-center justify-center px-4 py-10 lg:px-6">
        <section className="panel max-w-3xl p-8">
          <h1 className="font-display text-5xl">Workspace services are unavailable.</h1>
          <p className="mt-4 text-sm leading-8 text-black/[0.66]">
            A session cookie is present, but the authenticated profile could not be loaded from the backend. Bring the API back up and reload this workspace.
          </p>
        </section>
      </main>
    );
  }

  const initialTaskRailWorkspaceId =
    session.workspaces.length === 1 ? session.workspaces[0]?.workspace_id : null;
  const taskRail = initialTaskRailWorkspaceId ? await getTaskRail(initialTaskRailWorkspaceId) : null;

  return (
    <main className="mx-auto max-w-[1820px] px-3 py-3 lg:px-5 lg:py-5">
      <div className="app-shell-frame p-3 lg:p-4">
        <div className="app-shell-grid grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="xl:sticky xl:top-5 xl:self-start">
            <AppSidebar session={session} taskRail={taskRail} />
          </div>
          <div className="shell-main p-2 lg:p-3">{children}</div>
        </div>
      </div>
    </main>
  );
}
