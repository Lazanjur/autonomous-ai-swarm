import Link from "next/link";
import {
  BadgeCheck,
  Cable,
  Clock3,
  PlugZap,
  ShieldCheck,
  Sparkles
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { IntegrationsStatusData, TaskTemplate } from "@/lib/types";
import { withWorkspacePath } from "@/lib/workspace";

function capabilitySummary(template: TaskTemplate) {
  if (template.capabilities.length > 0) {
    return template.capabilities.join(" · ");
  }
  return template.tags.join(" · ");
}

export function PluginsHub({
  workspaceId,
  integrations,
  templates
}: {
  workspaceId: string;
  integrations: IntegrationsStatusData | null;
  templates: TaskTemplate[];
}) {
  const providers = integrations?.providers ?? [];

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <Badge>Plugins</Badge>
        <h1 className="mt-4 font-display text-5xl">Connectors and capability packs that extend the workspace.</h1>
        <p className="mt-4 max-w-3xl text-base leading-8 text-black/[0.62]">
          This page turns the existing integration and template layer into a clear product surface. Use it to see which connectors are ready, which ones still need configuration, and which reusable task packs are already installed.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={withWorkspacePath("/app/chat", workspaceId)}
            className="rounded-full bg-black px-4 py-2 text-sm text-white transition hover:bg-black/90"
          >
            Open task workspace
          </Link>
          <Link
            href={withWorkspacePath("/app/settings", workspaceId)}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/[0.72] transition hover:bg-black/[0.03]"
          >
            Open settings
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Connectors</p>
          <p className="mt-3 font-display text-4xl">{providers.length}</p>
          <p className="mt-2 text-sm text-black/[0.6]">Visible delivery and system integrations.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Configured</p>
          <p className="mt-3 font-display text-4xl">{providers.filter((provider) => provider.configured).length}</p>
          <p className="mt-2 text-sm text-black/[0.6]">Providers ready for live work.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Task packs</p>
          <p className="mt-3 font-display text-4xl">{templates.length}</p>
          <p className="mt-2 text-sm text-black/[0.6]">Reusable guided workflows already installed.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Approval gates</p>
          <p className="mt-3 font-display text-4xl">{providers.filter((provider) => provider.uses_approval_gate).length}</p>
          <p className="mt-2 text-sm text-black/[0.6]">Connectors that require explicit live approval.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="panel p-6">
          <div className="flex items-center gap-3">
            <PlugZap className="h-5 w-5" />
            <h2 className="font-display text-4xl">Connector registry</h2>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {providers.length > 0 ? (
              providers.map((provider) => (
                <article key={provider.key} className="rounded-[24px] border border-black/10 bg-white/80 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-medium capitalize text-black/[0.82]">{provider.key}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-black/[0.44]">
                        {provider.provider}
                      </p>
                    </div>
                    <span className="rounded-full bg-black/[0.06] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-black/[0.55]">
                      {provider.configured ? "ready" : "setup needed"}
                    </span>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-black/[0.62]">{provider.detail}</p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-black/[0.44]">
                    <span className="rounded-full border border-black/10 px-3 py-1.5">
                      {provider.live_delivery_supported ? "live delivery" : "status only"}
                    </span>
                    <span className="rounded-full border border-black/10 px-3 py-1.5">
                      {provider.uses_approval_gate ? "approval gated" : "direct use"}
                    </span>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-[24px] border border-dashed border-black/10 bg-white/75 px-5 py-6 text-sm leading-7 text-black/[0.6] md:col-span-2">
                Connector status is unavailable right now, but the page is ready to surface integrations once the backend reports them.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel p-6">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5" />
              <h2 className="font-display text-4xl">Installed capability packs</h2>
            </div>
            <div className="mt-6 space-y-4">
              {templates.length > 0 ? (
                templates.map((template) => (
                  <article key={template.key} className="rounded-[24px] border border-black/10 bg-white/80 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-medium text-black/[0.82]">{template.name}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-black/[0.44]">
                          {template.category} pack
                        </p>
                      </div>
                      {template.requires_approval ? (
                        <span className="rounded-full bg-black/[0.06] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-black/[0.55]">
                          approval
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-4 text-sm leading-7 text-black/[0.62]">{template.summary}</p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-black/[0.44]">
                      <span className="rounded-full border border-black/10 px-3 py-1.5">
                        {capabilitySummary(template)}
                      </span>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-black/10 bg-white/75 px-5 py-6 text-sm leading-7 text-black/[0.6]">
                  No capability packs are registered for this workspace yet.
                </div>
              )}
            </div>
          </div>

          <div className="panel p-6">
            <div className="flex items-center gap-3">
              <Cable className="h-5 w-5" />
              <h2 className="font-display text-4xl">Why this matters</h2>
            </div>
            <div className="mt-5 space-y-4 text-sm leading-8 text-black/[0.62]">
              <p className="inline-flex items-start gap-3">
                <BadgeCheck className="mt-1 h-4 w-4 shrink-0" />
                The sidebar now points to a real plugin surface instead of making connectors feel hidden.
              </p>
              <p className="inline-flex items-start gap-3">
                <Clock3 className="mt-1 h-4 w-4 shrink-0" />
                Connector choices in the project modal can now align a project with the systems it depends on.
              </p>
              <p className="inline-flex items-start gap-3">
                <ShieldCheck className="mt-1 h-4 w-4 shrink-0" />
                Approval-gated integrations stay visible, so operators can see which systems are safe to automate directly.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
