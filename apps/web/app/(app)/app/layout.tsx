import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-shell/sidebar";
import { getCurrentSession } from "@/lib/api";

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

  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] gap-6 px-4 py-4 lg:px-6">
      <div className="w-full max-w-[300px]">
        <AppSidebar session={session} />
      </div>
      <div className="flex-1">{children}</div>
    </main>
  );
}
