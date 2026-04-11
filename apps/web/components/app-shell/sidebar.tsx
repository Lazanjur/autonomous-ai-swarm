"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BookOpen,
  Bot,
  Boxes,
  FolderKanban,
  Settings2,
  ShieldCheck,
  TimerReset
} from "lucide-react";
import type { AuthProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

const items = [
  { href: "/app", label: "Overview", icon: FolderKanban },
  { href: "/app/chat", label: "Chat", icon: Bot },
  { href: "/app/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/app/artifacts", label: "Artifacts", icon: Boxes },
  { href: "/app/automations", label: "Automations", icon: TimerReset },
  { href: "/app/monitor", label: "Monitor", icon: Activity },
  { href: "/app/admin", label: "Admin", icon: ShieldCheck },
  { href: "/app/settings", label: "Settings", icon: Settings2 }
];

export function AppSidebar({ session }: { session: AuthProfile }) {
  const pathname = usePathname();
  const router = useRouter();
  const primaryWorkspace = session.workspaces[0];

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/signin");
    router.refresh();
  }

  return (
    <aside className="panel flex h-full flex-col gap-5 p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Workspace</p>
        <h2 className="mt-2 font-display text-3xl">{primaryWorkspace?.workspace_name ?? "Workspace"}</h2>
        <p className="mt-2 text-sm leading-7 text-black/[0.65]">
          Enterprise swarm operations for research, software, and automation.
        </p>
        <div className="mt-4 rounded-2xl bg-white/70 px-4 py-3 text-sm text-black/[0.68]">
          <div className="font-medium">{session.user.full_name}</div>
          <div className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">
            {primaryWorkspace?.role ?? session.user.role}
          </div>
        </div>
      </div>

      <nav className="space-y-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition",
                active ? "bg-ink text-white" : "bg-white/[0.55] text-black/70 hover:bg-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={signOut}
        className="mt-auto rounded-2xl border border-black/10 bg-white/75 px-4 py-3 text-left text-sm text-black/[0.7] transition hover:bg-white"
      >
        Sign out
      </button>
    </aside>
  );
}
