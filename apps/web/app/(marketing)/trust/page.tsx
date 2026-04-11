import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const controls = [
  "Workspace-scoped access control with role-aware routing",
  "Audit logging across runs, automations, and tool execution",
  "Approval-aware browser interaction and external delivery",
  "Rate limiting, request IDs, provider usage accounting, and spend caps",
  "Sandboxed execution boundaries and policy-aware tool surfaces"
];

export default function TrustPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-16">
      <div className="panel p-8">
        <Badge>Trust</Badge>
        <h1 className="mt-4 font-display text-6xl">Built for organizations that need control, not just output.</h1>
        <p className="mt-4 max-w-3xl text-sm leading-8 text-black/[0.65]">
          The platform is structured around approvals, auditability, scoped access, and observable execution so teams can move quickly without surrendering governance.
        </p>
        <div className="mt-10 grid gap-4">
          {controls.map((control) => (
            <div key={control} className="rounded-[24px] border border-black/10 bg-white/80 p-5 text-sm leading-7 text-black/[0.72]">
              {control}
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap gap-4">
          <Button href="/pricing">View Plans</Button>
          <Button href="/docs" variant="secondary">
            Review Architecture
          </Button>
        </div>
      </div>
    </main>
  );
}
