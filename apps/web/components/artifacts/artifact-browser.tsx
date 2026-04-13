import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { Artifact, ArtifactPreview, KnowledgeDocument } from "@/lib/types";
import { withWorkspacePath } from "@/lib/workspace";

type Props = {
  workspaceId: string;
  artifacts: Artifact[];
  documents: KnowledgeDocument[];
  preview: ArtifactPreview | null;
  selectedArtifactId: string | null;
  query: string;
};

function formatBytes(value: number | null | undefined) {
  if (!value || value <= 0) {
    return "Unknown size";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Unknown date";
  }
  return new Date(value).toLocaleString();
}

function formatLabel(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  return value
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}

function artifactFormatLabel(artifact: Artifact) {
  const metadataFormat = artifact.metadata?.["format"];
  if (typeof metadataFormat === "string" && metadataFormat.trim()) {
    return formatLabel(metadataFormat);
  }
  const extension = artifact.title.split(".").pop()?.toLowerCase();
  return extension ? extension.toUpperCase() : "File";
}

function buildArtifactHref(workspaceId: string, artifactId: string, query: string) {
  return withWorkspacePath("/app/artifacts", workspaceId, {
    artifact: artifactId,
    q: query || null,
  });
}

function buildDocumentHref(workspaceId: string, documentId: string | null) {
  if (!documentId) {
    return null;
  }
  return withWorkspacePath("/app/knowledge", workspaceId, {
    document: documentId,
  });
}

function artifactDownloadHref(artifactId: string) {
  return `/api/artifacts/${artifactId}/download`;
}

function tablePreview(columns: string[], rows: string[][]) {
  if (columns.length === 0) {
    return (
      <div className="rounded-[22px] border border-dashed border-black/10 bg-white/70 px-5 py-6 text-sm text-black/[0.58]">
        No tabular cells were available in the preview window.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[22px] border border-black/10 bg-white/85">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-black/[0.03] text-black/[0.56]">
          <tr>
            {columns.map((column, index) => (
              <th key={`${column}-${index}`} className="px-4 py-3 font-medium">
                {column || `Column ${index + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`} className="border-t border-black/10 align-top">
              {columns.map((_, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`} className="px-4 py-3 text-black/[0.72]">
                  {row[cellIndex] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function metadataPreview(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata ?? {});
  if (entries.length === 0) {
    return null;
  }

  return (
    <details className="rounded-[22px] border border-black/10 bg-white/80 p-4">
      <summary className="cursor-pointer text-sm font-medium text-black/[0.74]">
        Artifact metadata
      </summary>
      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-black/[0.66]">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </details>
  );
}

function renderPreview(preview: ArtifactPreview, artifact: Artifact) {
  const downloadHref = artifactDownloadHref(artifact.id);

  if (preview.preview_kind === "image") {
    return (
      <div className="overflow-hidden rounded-[24px] border border-black/10 bg-white/80 p-3">
        <Image
          src={downloadHref}
          alt={artifact.title}
          width={1600}
          height={900}
          unoptimized
          className="max-h-[720px] w-full rounded-[18px] object-contain"
        />
      </div>
    );
  }

  if (preview.preview_kind === "video") {
    return (
      <div className="rounded-[24px] border border-black/10 bg-white/80 p-4">
        <video controls className="max-h-[720px] w-full rounded-[18px]" src={downloadHref} />
      </div>
    );
  }

  if (preview.preview_kind === "audio") {
    return (
      <div className="rounded-[24px] border border-black/10 bg-white/80 p-6">
        <audio controls className="w-full" src={downloadHref} />
      </div>
    );
  }

  if (preview.preview_kind === "pdf") {
    return (
      <div className="space-y-4">
        <div className="overflow-hidden rounded-[24px] border border-black/10 bg-white/80">
          <iframe
            src={downloadHref}
            title={artifact.title}
            sandbox="allow-same-origin"
            className="h-[760px] w-full bg-white"
          />
        </div>
        {preview.page_summaries.length > 0 ? (
          <section className="rounded-[24px] border border-black/10 bg-white/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium text-black/[0.82]">Page summaries</h3>
              <Badge>{preview.page_summaries.length} pages</Badge>
            </div>
            <div className="mt-4 space-y-3">
              {preview.page_summaries.map((summary, index) => (
                <div
                  key={`page-summary-${index}`}
                  className="rounded-[18px] border border-black/10 bg-sand/55 px-4 py-4 text-sm leading-7 text-black/[0.68]"
                >
                  {summary}
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  if (preview.preview_kind === "html") {
    return (
      <div className="space-y-4">
        <div className="overflow-hidden rounded-[24px] border border-black/10 bg-white/80">
          <iframe
            src={downloadHref}
            title={artifact.title}
            sandbox="allow-same-origin"
            className="h-[760px] w-full bg-white"
          />
        </div>
        {preview.text_content ? (
          <section className="rounded-[24px] border border-black/10 bg-white/80 p-5">
            <h3 className="font-medium text-black/[0.82]">Source excerpt</h3>
            <pre className="mt-4 overflow-x-auto whitespace-pre-wrap text-sm leading-7 text-black/[0.72]">
              {preview.text_content}
            </pre>
          </section>
        ) : null}
      </div>
    );
  }

  if (preview.preview_kind === "csv" && preview.table) {
    return tablePreview(preview.table.columns, preview.table.rows);
  }

  if (preview.preview_kind === "spreadsheet") {
    return (
      <div className="space-y-5">
        {preview.sheets.map((sheet) => (
          <section key={sheet.name} className="rounded-[24px] border border-black/10 bg-white/80 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="font-medium text-black/[0.82]">{sheet.name}</h3>
              <Badge>{sheet.rows.length} preview rows</Badge>
            </div>
            {tablePreview(sheet.columns, sheet.rows)}
          </section>
        ))}
        {preview.sheets.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-black/10 bg-white/70 px-5 py-6 text-sm text-black/[0.62]">
            No readable workbook sheets were available in the preview window.
          </div>
        ) : null}
      </div>
    );
  }

  if (preview.preview_kind === "presentation") {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {preview.slides.map((slide) => (
          <section key={slide.slide_number} className="rounded-[24px] border border-black/10 bg-white/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium text-black/[0.82]">Slide {slide.slide_number}</h3>
              {slide.title ? <Badge>{slide.title}</Badge> : null}
            </div>
            <div className="mt-4 space-y-3">
              {slide.bullets.length > 0 ? (
                slide.bullets.map((bullet, index) => (
                  <p
                    key={`slide-${slide.slide_number}-${index}`}
                    className="rounded-[18px] bg-sand/55 px-4 py-3 text-sm leading-7 text-black/[0.68]"
                  >
                    {bullet}
                  </p>
                ))
              ) : (
                <p className="text-sm text-black/[0.58]">
                  No readable bullet text was extracted from this slide.
                </p>
              )}
            </div>
          </section>
        ))}
        {preview.slides.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-black/10 bg-white/70 px-5 py-6 text-sm text-black/[0.62]">
            No readable slide text was available in the preview window.
          </div>
        ) : null}
      </div>
    );
  }

  if (preview.text_content) {
    return (
      <div className="rounded-[24px] border border-black/10 bg-white/80 p-5">
        <pre className="overflow-x-auto whitespace-pre-wrap text-sm leading-7 text-black/[0.72]">
          {preview.text_content}
        </pre>
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-dashed border-black/10 bg-white/70 px-5 py-6 text-sm leading-7 text-black/[0.62]">
      No inline preview is available for this artifact type yet. Use the download action to inspect
      the file directly.
    </div>
  );
}

export function ArtifactBrowser({
  workspaceId,
  artifacts,
  documents,
  preview,
  selectedArtifactId,
  query,
}: Props) {
  const normalizedQuery = query.trim().toLowerCase();
  const documentTitles = new Map(documents.map((document) => [document.id, document.title]));
  const visibleArtifacts = normalizedQuery
    ? artifacts.filter((artifact) =>
        [artifact.title, artifact.kind, artifact.storage_key]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : artifacts;
  const byKind = visibleArtifacts.reduce<Record<string, number>>((acc, artifact) => {
    acc[artifact.kind] = (acc[artifact.kind] ?? 0) + 1;
    return acc;
  }, {});
  const selectedArtifact =
    visibleArtifacts.find((artifact) => artifact.id === selectedArtifactId) ??
    visibleArtifacts[0] ??
    null;
  const linkedDocumentTitle =
    selectedArtifact?.document_id ? documentTitles.get(selectedArtifact.document_id) : null;
  const linkedDocumentHref = buildDocumentHref(workspaceId, selectedArtifact?.document_id ?? null);

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <Badge>Artifacts</Badge>
        <h1 className="mt-4 font-display text-5xl">Generated files, exports, and rich in-app previews.</h1>
        <p className="mt-4 max-w-3xl text-base text-black/62">
          Browse deliverables like a real workspace library: inspect documents, spreadsheet tabs,
          presentation slides, media, PDFs, and generated outputs without leaving the app.
        </p>
        {query ? (
          <p className="mt-4 text-sm uppercase tracking-[0.16em] text-black/48">
            Filtered by search: {query}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Artifacts</p>
          <p className="mt-3 font-display text-4xl">{visibleArtifacts.length}</p>
          <p className="mt-2 text-sm text-black/60">Persisted files and exports in this workspace.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Documents</p>
          <p className="mt-3 font-display text-4xl">{documents.length}</p>
          <p className="mt-2 text-sm text-black/60">Knowledge sources linked into artifact output.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Kinds</p>
          <p className="mt-3 font-display text-4xl">{Object.keys(byKind).length}</p>
          <p className="mt-2 text-sm text-black/60">Distinct artifact categories available for preview.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Selection</p>
          <p className="mt-3 font-display text-2xl">
            {selectedArtifact?.title ?? "None selected"}
          </p>
          <p className="mt-2 text-sm text-black/60">
            Choose any artifact on the left to open its inline viewer.
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <div className="panel p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="font-display text-3xl">Artifact Library</h2>
            <Badge>{visibleArtifacts.length}</Badge>
          </div>
          <div className="space-y-4">
            {visibleArtifacts.map((artifact) => {
              const isActive = artifact.id === selectedArtifact?.id;
              return (
                <Link
                  key={artifact.id}
                  href={buildArtifactHref(workspaceId, artifact.id, query)}
                  className={
                    isActive
                      ? "block rounded-[22px] border border-ink bg-white p-4 shadow-[0_20px_60px_rgba(15,23,42,0.12)]"
                      : "block rounded-[22px] border border-black/10 bg-white/75 p-4 transition hover:bg-white"
                  }
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-black/[0.78]">{artifact.title}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/[0.45]">
                        {artifact.kind}
                      </p>
                    </div>
                    <Badge>{artifactFormatLabel(artifact)}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-black/[0.6]">
                    {artifact.document_id
                      ? `Linked document: ${documentTitles.get(artifact.document_id) ?? artifact.document_id}`
                      : "Run-level artifact"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.45]">
                    <span>{formatDate(artifact.created_at)}</span>
                    {typeof artifact.metadata?.["format"] === "string" ? (
                      <span className="rounded-full border border-black/10 px-3 py-1">
                        {String(artifact.metadata["format"])}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 break-all text-xs text-black/[0.45]">{artifact.storage_key}</p>
                </Link>
              );
            })}
            {visibleArtifacts.length === 0 ? (
              <p className="text-sm text-black/50">
                {query
                  ? "No artifacts matched the current search."
                  : "No artifacts are available yet for this workspace."}
              </p>
            ) : null}
          </div>
        </div>

        <div className="panel p-6">
          {selectedArtifact ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-4xl">{selectedArtifact.title}</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-8 text-black/[0.64]">
                    {linkedDocumentTitle
                      ? `Linked document: ${linkedDocumentTitle}`
                      : "This artifact was generated during a task run or export workflow."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {linkedDocumentHref ? (
                    <Link
                      href={linkedDocumentHref}
                      className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/[0.72] transition hover:bg-black/[0.03]"
                    >
                      Open source document
                    </Link>
                  ) : null}
                  <a
                    href={artifactDownloadHref(selectedArtifact.id)}
                    className="rounded-full bg-ink px-4 py-2 text-sm text-white transition hover:bg-ink/90"
                  >
                    Download
                  </a>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[20px] border border-black/10 bg-sand/60 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-black/[0.45]">Kind</p>
                  <p className="mt-2 text-sm font-medium text-black/[0.78]">{selectedArtifact.kind}</p>
                </div>
                <div className="rounded-[20px] border border-black/10 bg-sand/60 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-black/[0.45]">Preview mode</p>
                  <p className="mt-2 text-sm font-medium text-black/[0.78]">
                    {formatLabel(preview?.preview_kind ?? "unavailable")}
                  </p>
                </div>
                <div className="rounded-[20px] border border-black/10 bg-sand/60 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-black/[0.45]">File size</p>
                  <p className="mt-2 text-sm font-medium text-black/[0.78]">
                    {formatBytes(preview?.size_bytes)}
                  </p>
                </div>
                <div className="rounded-[20px] border border-black/10 bg-sand/60 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-black/[0.45]">Created</p>
                  <p className="mt-2 text-sm font-medium text-black/[0.78]">
                    {formatDate(selectedArtifact.created_at)}
                  </p>
                </div>
              </div>

              {preview?.warnings.length ? (
                <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                  {preview.warnings.join(" ")}
                </div>
              ) : null}

              {preview ? (
                renderPreview(preview, selectedArtifact)
              ) : (
                <div className="rounded-[24px] border border-dashed border-black/10 bg-white/70 px-5 py-6 text-sm leading-7 text-black/[0.62]">
                  The preview service could not load this artifact right now. The file is still
                  available through the download action.
                </div>
              )}

              {preview ? metadataPreview(preview.metadata) : metadataPreview(selectedArtifact.metadata)}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-black/10 bg-white/70 px-5 py-6 text-sm leading-7 text-black/[0.62]">
              Select an artifact to open its inline preview.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
