import { Badge } from "@/components/ui/badge";

const sections = [
  "Supervisor-led orchestration with fast and slow model routing",
  "RAG ingestion, chunking, provenance tracking, and workspace retrieval",
  "Tool governance for web search, sandboxed execution, and browser planning",
  "Enterprise surfaces for chats, automations, knowledge, monitoring, and settings"
];

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <div className="panel p-8">
        <Badge>Documentation</Badge>
        <h1 className="mt-4 font-display text-6xl">Platform architecture at a glance.</h1>
        <div className="mt-8 grid gap-4">
          {sections.map((section) => (
            <div key={section} className="rounded-[24px] border border-black/10 bg-white/80 p-5 text-sm leading-7 text-black/[0.72]">
              {section}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
