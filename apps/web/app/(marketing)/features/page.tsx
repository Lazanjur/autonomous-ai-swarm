import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const blocks = [
  {
    title: "Supervisor-led execution",
    copy:
      "A routing supervisor plans work, selects specialist agents, escalates when confidence is weak, and synthesizes a final response."
  },
  {
    title: "Knowledge and retrieval",
    copy:
      "Upload source files, embed chunks, run hybrid retrieval, inspect observability, and ground outputs with traceable context."
  },
  {
    title: "Tooling depth",
    copy:
      "Browser automation, sandboxed Python execution, spreadsheet exports, notification outboxes, and durable job queues are built in."
  },
  {
    title: "Enterprise controls",
    copy:
      "Sessions, RBAC, approvals, audit logging, rate limits, usage accounting, and budget-aware provider routing support production teams."
  }
];

export default function FeaturesPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-16">
      <div className="panel p-8">
        <Badge>Features</Badge>
        <h1 className="mt-4 font-display text-6xl">A complete AI operations stack, not a single chat box.</h1>
        <p className="mt-4 max-w-3xl text-sm leading-8 text-black/[0.65]">
          The platform combines orchestration, retrieval, tools, execution, governance, and a polished workspace shell into one cohesive system.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {blocks.map((block) => (
            <div key={block.title} className="rounded-[28px] border border-black/10 bg-white/80 p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">{block.title}</p>
              <p className="mt-4 text-sm leading-7 text-black/72">{block.copy}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap gap-4">
          <Button href="/signin">Enter App</Button>
          <Button href="/docs" variant="secondary">
            Read Architecture
          </Button>
        </div>
      </div>
    </main>
  );
}
