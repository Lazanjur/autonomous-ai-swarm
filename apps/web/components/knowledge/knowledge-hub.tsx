"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  FileSearch,
  FileText,
  FolderUp,
  ScrollText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  Artifact,
  KnowledgeHealth,
  KnowledgeDocument,
  KnowledgeSearchObservability,
  KnowledgeSearchResponse,
  KnowledgeSearchResult
} from "@/lib/types";

type Props = {
  workspaceId: string;
  documents: KnowledgeDocument[];
  artifacts: Artifact[];
  health: KnowledgeHealth;
  initialQuery?: string;
  highlightedDocumentId?: string | null;
};

function formatLabel(value: string) {
  return value
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatMetrics(values: Record<string, number>) {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return "none";
  }

  return entries.map(([key, value]) => `${formatLabel(key)} ${value}`).join(" / ");
}

function formatFilters(values: Record<string, unknown>) {
  const entries = Object.entries(values).filter(([, value]) => {
    if (value === null || value === undefined || value === "") {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return true;
  });
  if (entries.length === 0) {
    return "No extra filters";
  }
  return entries
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${formatLabel(key)} ${value.join(", ")}`;
      }
      return `${formatLabel(key)} ${String(value)}`;
    })
    .join(" / ");
}

function formatRatio(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function KnowledgeHub({
  workspaceId,
  documents,
  artifacts,
  health,
  initialQuery = "",
  highlightedDocumentId = null
}: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [searchSourceType, setSearchSourceType] = useState("all");
  const [searchTags, setSearchTags] = useState("");
  const [searchMinTrust, setSearchMinTrust] = useState("0");
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [searchObservability, setSearchObservability] =
    useState<KnowledgeSearchObservability | null>(null);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploading(true);
    setError(null);
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ detail: "Upload failed." }));
        setError(data.detail ?? "Upload failed.");
        setUploading(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Upload service is unavailable.");
    } finally {
      setUploading(false);
    }
  }

  async function createExport(documentId: string, format: "markdown" | "txt" | "json") {
    setExportingId(documentId);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/artifacts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ format, include_metadata: true })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ detail: "Artifact generation failed." }));
        setError(data.detail ?? "Artifact generation failed.");
        setExportingId(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Artifact generation service is unavailable.");
    } finally {
      setExportingId(null);
    }
  }

  const executeSearch = useCallback(async (nextQuery: string) => {
    const normalized = nextQuery.trim();
    if (!normalized) {
      setSearchResults([]);
      setSearchObservability(null);
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        workspace_id: workspaceId,
        query: normalized
      });
      if (searchSourceType !== "all") {
        params.set("source_types", searchSourceType);
      }
      if (searchTags.trim()) {
        params.set("tags", searchTags.trim());
      }
      if (Number(searchMinTrust) > 0) {
        params.set("min_trust_score", searchMinTrust);
      }
      if (includeDuplicates) {
        params.set("include_duplicates", "true");
      }
      const response = await fetch(`/api/documents/search?${params.toString()}`);
      const data = (await response.json().catch(() => ({
        results: [],
        detail: "Search failed."
      }))) as Partial<KnowledgeSearchResponse> & { detail?: string };
      if (!response.ok) {
        setError(data.detail ?? "Search failed.");
        setSearchResults([]);
        setSearchObservability(null);
        setSearching(false);
        return;
      }
      setSearchResults(data.results ?? []);
      setSearchObservability(data.observability ?? null);
    } catch {
      setError("Search service is unavailable.");
      setSearchResults([]);
      setSearchObservability(null);
    } finally {
      setSearching(false);
    }
  }, [includeDuplicates, searchMinTrust, searchSourceType, searchTags, workspaceId]);

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await executeSearch(query);
  }

  useEffect(() => {
    if (!initialQuery.trim()) {
      return;
    }
    void executeSearch(initialQuery);
  }, [executeSearch, initialQuery]);

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <Badge>Knowledge Base</Badge>
        <div className="mt-4 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="font-display text-5xl">Retrieval-ready workspace memory.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-8 text-black/[0.66]">
              Upload source files, deduplicate repeated knowledge, rank results with trust and
              freshness signals, and inspect the health of your indexed workspace memory.
            </p>
          </div>

          <form
            className="rounded-[28px] border border-black/10 bg-white/75 p-4"
            onSubmit={handleUpload}
          >
            <input type="hidden" name="workspace_id" value={workspaceId} />
            <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
              <input
                className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
                name="tags"
                placeholder="tags (comma separated)"
              />
              <select
                className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
                name="duplicate_strategy"
                defaultValue="mark_duplicate"
              >
                <option value="mark_duplicate">Mark duplicates, skip indexing</option>
                <option value="allow">Allow duplicate indexing</option>
              </select>
            </div>
            <div className="mt-3">
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-black/20 bg-sand/70 px-4 py-3 text-sm text-black/[0.7]">
                <FolderUp className="h-4 w-4" />
                Choose files
                <input className="hidden" type="file" name="files" multiple />
              </label>
            </div>
            <button
              type="submit"
              disabled={uploading}
              className="mt-3 w-full rounded-full bg-ink px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {uploading ? "Uploading..." : "Upload Into Knowledge Base"}
            </button>
          </form>
        </div>

        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[24px] border border-black/10 bg-white/70 p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Index Coverage</p>
            <p className="mt-3 font-display text-3xl">{formatRatio(health.embedding_coverage)}</p>
            <p className="mt-2 text-sm text-black/[0.68]">
              {health.embedded_chunks} embedded chunks across {health.total_chunks} indexed chunks
            </p>
          </div>
          <div className="rounded-[24px] border border-black/10 bg-white/70 p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Document Integrity</p>
            <p className="mt-3 font-display text-3xl">{health.indexed_documents}</p>
            <p className="mt-2 text-sm text-black/[0.68]">
              indexed / {health.duplicate_documents} duplicate-marked / {health.total_documents} total
            </p>
          </div>
          <div className="rounded-[24px] border border-black/10 bg-white/70 p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Average Trust</p>
            <p className="mt-3 font-display text-3xl">{formatRatio(health.average_trust_score)}</p>
            <p className="mt-2 text-sm text-black/[0.68]">
              {formatMetrics(health.source_type_breakdown)}
            </p>
          </div>
          <div className="rounded-[24px] border border-black/10 bg-white/70 p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Knowledge Hygiene</p>
            <p className="mt-3 font-display text-3xl">{health.duplicate_groups}</p>
            <p className="mt-2 text-sm text-black/[0.68]">
              duplicate groups / {health.untagged_documents} untagged documents
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.62fr_0.38fr]">
        <div className="panel p-6">
          <div className="flex items-center gap-3">
            <ScrollText className="h-5 w-5" />
            <h2 className="font-display text-3xl">Documents</h2>
          </div>
          <div className="mt-6 space-y-4">
            {documents.length === 0 && (
              <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 text-sm text-black/[0.68]">
                No uploaded documents yet. Use the upload form to seed the knowledge base.
              </div>
            )}
            {documents.map((document) => (
              <div
                key={document.id}
                className={
                  document.id === highlightedDocumentId
                    ? "rounded-[24px] border border-ink bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.12)]"
                    : "rounded-[24px] border border-black/10 bg-white/75 p-5"
                }
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-medium">{document.title}</h3>
                    <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.45]">
                      {document.source_type} - {document.mime_type ?? "unknown mime"}
                    </p>
                  </div>
                  <Badge>{document.id === highlightedDocumentId ? "Focused" : document.status}</Badge>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-[18px] border border-black/10 bg-sand/60 p-4 text-sm text-black/[0.7]">
                    trust {(Number(document.metadata?.trust_score ?? 0) * 100).toFixed(0)}%
                  </div>
                  <div className="rounded-[18px] border border-black/10 bg-sand/60 p-4 text-sm text-black/[0.7]">
                    chunks {String(document.metadata?.chunk_count ?? 0)}
                  </div>
                  <div className="rounded-[18px] border border-black/10 bg-sand/60 p-4 text-sm text-black/[0.7]">
                    deduped {String(document.metadata?.deduplicated_chunk_count ?? 0)}
                  </div>
                </div>
                <p className="mt-3 max-h-28 overflow-hidden text-sm leading-7 text-black/[0.7]">
                  {document.content_text}
                </p>
                {Array.isArray(document.metadata?.tags) && document.metadata.tags.length > 0 && (
                  <p className="mt-3 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                    tags: {document.metadata.tags.map(String).join(", ")}
                  </p>
                )}
                {Boolean(document.metadata?.duplicate_of_document_id) && (
                  <p className="mt-3 text-xs uppercase tracking-[0.14em] text-red-700">
                    duplicate of {String(document.metadata.duplicate_of_document_id)}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={exportingId === document.id}
                    onClick={() => createExport(document.id, "markdown")}
                    className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                  >
                    {exportingId === document.id ? "Generating..." : "Export Markdown"}
                  </button>
                  <button
                    type="button"
                    disabled={exportingId === document.id}
                    onClick={() => createExport(document.id, "json")}
                    className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm"
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    disabled={exportingId === document.id}
                    onClick={() => createExport(document.id, "txt")}
                    className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm"
                  >
                    Export TXT
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel p-6">
            <div className="flex items-center gap-3">
              <FileSearch className="h-5 w-5" />
              <h2 className="font-display text-3xl">Hybrid Search</h2>
            </div>
            <form className="mt-6 space-y-4" onSubmit={runSearch}>
              <input
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by meaning and keyword overlap"
              />
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
                  value={searchSourceType}
                  onChange={(event) => setSearchSourceType(event.target.value)}
                >
                  <option value="all">All source types</option>
                  <option value="upload">Uploads</option>
                  <option value="text">Text</option>
                  <option value="url">URLs</option>
                </select>
                <input
                  className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
                  value={searchTags}
                  onChange={(event) => setSearchTags(event.target.value)}
                  placeholder="required tags (comma separated)"
                />
                <select
                  className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
                  value={searchMinTrust}
                  onChange={(event) => setSearchMinTrust(event.target.value)}
                >
                  <option value="0">Any trust level</option>
                  <option value="0.6">Trust 60%+</option>
                  <option value="0.75">Trust 75%+</option>
                  <option value="0.9">Trust 90%+</option>
                </select>
                <label className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-black/[0.7]">
                  <input
                    type="checkbox"
                    checked={includeDuplicates}
                    onChange={(event) => setIncludeDuplicates(event.target.checked)}
                  />
                  Include duplicate-marked documents
                </label>
              </div>
              <button
                type="submit"
                disabled={searching}
                className="w-full rounded-full bg-ink px-4 py-3 text-sm text-white disabled:opacity-60"
              >
                {searching ? "Searching..." : "Run Hybrid Search"}
              </button>
            </form>
            {searchObservability && (
              <div className="mt-5 rounded-[24px] border border-black/10 bg-sand/70 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">
                      Retrieval Observability
                    </p>
                    <h3 className="mt-2 font-medium">{formatLabel(searchObservability.path_used)}</h3>
                    <p className="mt-2 text-sm leading-7 text-black/[0.68]">
                      {searchObservability.reason}
                    </p>
                  </div>
                  <Badge>
                    {searchObservability.fallback_triggered ? "Fallback Used" : "Primary Path"}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-[18px] border border-black/10 bg-white/75 p-4 text-sm text-black/[0.7]">
                    Attempted paths:{" "}
                    {searchObservability.attempted_paths.map(formatLabel).join(" / ") || "None"}
                  </div>
                  <div className="rounded-[18px] border border-black/10 bg-white/75 p-4 text-sm text-black/[0.7]">
                    Embedding:{" "}
                    {searchObservability.query_embedding_available
                      ? `${searchObservability.query_embedding_provider ?? "unknown"} (${searchObservability.query_embedding_dimensions ?? 0} dims)`
                      : "Unavailable"}
                    {searchObservability.query_embedding_fallback ? " / fallback provider" : ""}
                  </div>
                  <div className="rounded-[18px] border border-black/10 bg-white/75 p-4 text-sm text-black/[0.7]">
                    Candidates: {formatMetrics(searchObservability.candidate_counts)} / limit{" "}
                    {searchObservability.candidate_limit} / returned {searchObservability.returned_count}
                  </div>
                  <div className="rounded-[18px] border border-black/10 bg-white/75 p-4 text-sm text-black/[0.7]">
                    Weights: keyword {searchObservability.weights.keyword} / vector{" "}
                    {searchObservability.weights.vector} / trust {searchObservability.weights.trust} /
                    freshness {searchObservability.weights.freshness}
                  </div>
                </div>
                <div className="mt-3 rounded-[18px] border border-black/10 bg-white/75 p-4 text-sm text-black/[0.7]">
                  Filters: {formatFilters(searchObservability.filters_applied)}
                </div>
                <p className="mt-3 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                  rerank strategy: {formatLabel(searchObservability.rerank_strategy)} / per-document cap{" "}
                  {searchObservability.max_chunks_per_document}
                </p>
                {searchObservability.fallback_reason && (
                  <p className="mt-4 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                    fallback reason: {searchObservability.fallback_reason}
                  </p>
                )}
                {searchObservability.signals_considered.length > 0 && (
                  <p className="mt-3 text-sm leading-7 text-black/[0.68]">
                    Signals:{" "}
                    {searchObservability.signals_considered.map(formatLabel).join(" / ")}
                  </p>
                )}
                {searchObservability.notes.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {searchObservability.notes.map((note) => (
                      <p key={note} className="text-sm leading-7 text-black/[0.68]">
                        {note}
                      </p>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                  timings: {formatMetrics(searchObservability.timings_ms)} ms
                </p>
              </div>
            )}
            <div className="mt-5 space-y-3">
              {searchResults.length === 0 && query.trim() !== "" && !searching && (
                <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 text-sm text-black/[0.68]">
                  No ranked matches found for this query.
                </div>
              )}
              {searchResults.map((result) => (
                <div key={result.chunk_id} className="rounded-[24px] border border-black/10 bg-white/75 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{result.document_title}</h3>
                      <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.45]">
                        score {result.score} / base {result.base_score} / keyword {result.keyword_score} /
                        vector {result.vector_score}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {result.is_duplicate && <Badge className="bg-red-700 text-white">Duplicate</Badge>}
                      <Badge>{result.source_type}</Badge>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-[18px] border border-black/10 bg-sand/60 p-4 text-sm text-black/[0.7]">
                      trust {(result.trust_score * 100).toFixed(0)}%
                    </div>
                    <div className="rounded-[18px] border border-black/10 bg-sand/60 p-4 text-sm text-black/[0.7]">
                      freshness {(result.freshness_score * 100).toFixed(0)}%
                    </div>
                    <div className="rounded-[18px] border border-black/10 bg-sand/60 p-4 text-sm text-black/[0.7]">
                      chunk {result.chunk_index + 1}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-black/[0.7]">{result.content}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                    <span>{new Date(result.document_created_at).toLocaleDateString()}</span>
                    {result.source_uri && <span>{result.source_uri}</span>}
                    {result.duplicate_of_document_id && <span>duplicate of {result.duplicate_of_document_id}</span>}
                  </div>
                  {result.overlap_terms.length > 0 && (
                    <p className="mt-3 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                      overlap: {result.overlap_terms.join(", ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-6">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5" />
              <h2 className="font-display text-3xl">Artifacts</h2>
            </div>
            <div className="mt-6 space-y-4">
              {artifacts.length === 0 && (
                <div className="rounded-[24px] border border-black/10 bg-white/75 p-5 text-sm text-black/[0.68]">
                  Generated exports and source-file artifacts will appear here.
                </div>
              )}
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="rounded-[24px] border border-black/10 bg-white/75 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{artifact.title}</h3>
                      <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.45]">
                        {artifact.kind}
                      </p>
                    </div>
                    <a
                      className="inline-flex items-center gap-2 rounded-full bg-pine px-4 py-2 text-sm text-white"
                      href={`/api/artifacts/${artifact.id}/download`}
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </a>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-black/[0.7]">
                    {artifact.metadata?.format
                      ? `Format: ${String(artifact.metadata.format)}`
                      : "Original uploaded file"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
