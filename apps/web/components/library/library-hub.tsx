"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  BookOpen,
  Boxes,
  FolderKanban,
  Pin,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { LibraryDashboard, LibraryItem, LibraryItemUpdatePayload } from "@/lib/types";
import { withWorkspacePath } from "@/lib/workspace";

type Props = {
  workspaceId: string;
  dashboard: LibraryDashboard;
  initialSelectedItemId?: string | null;
  initialCollection?: string | null;
};

function formatCollectionLabel(value: string) {
  return value
    .split(" ")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function splitInput(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildItemPath(workspaceId: string, item: LibraryItem) {
  if (item.item_type === "document") {
    return withWorkspacePath("/app/knowledge", workspaceId, {
      document: item.document_id ?? item.id,
    });
  }
  return withWorkspacePath("/app/artifacts", workspaceId, {
    artifact: item.artifact_id ?? item.id,
  });
}

function summarizeCollections(items: LibraryItem[]) {
  const collectionMap = new Map<
    string,
    {
      item_count: number;
      document_count: number;
      artifact_count: number;
      pinned_count: number;
      reusable_count: number;
      recent_titles: string[];
    }
  >();

  for (const item of items) {
    for (const collection of item.collections) {
      const current = collectionMap.get(collection) ?? {
        item_count: 0,
        document_count: 0,
        artifact_count: 0,
        pinned_count: 0,
        reusable_count: 0,
        recent_titles: [],
      };
      current.item_count += 1;
      current.document_count += item.item_type === "document" ? 1 : 0;
      current.artifact_count += item.item_type === "artifact" ? 1 : 0;
      current.pinned_count += item.pinned ? 1 : 0;
      current.reusable_count += item.reusable ? 1 : 0;
      if (current.recent_titles.length < 4) {
        current.recent_titles.push(item.title);
      }
      collectionMap.set(collection, current);
    }
  }

  return [...collectionMap.entries()]
    .map(([name, summary]) => ({ name, ...summary }))
    .sort((left, right) => right.item_count - left.item_count || left.name.localeCompare(right.name));
}

function summarizeTopTags(items: LibraryItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));
}

export function LibraryHub({
  workspaceId,
  dashboard,
  initialSelectedItemId = null,
  initialCollection = null,
}: Props) {
  const [items, setItems] = useState(dashboard.items);
  const [search, setSearch] = useState("");
  const [selectedCollection, setSelectedCollection] = useState(initialCollection ?? "");
  const [selectedTag, setSelectedTag] = useState("");
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [showReusableOnly, setShowReusableOnly] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(initialSelectedItemId ?? dashboard.items[0]?.id ?? null);
  const [draftNote, setDraftNote] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftCollections, setDraftCollections] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (selectedCollection && !item.collections.includes(selectedCollection)) {
          return false;
        }
        if (selectedTag && !item.tags.includes(selectedTag)) {
          return false;
        }
        if (showPinnedOnly && !item.pinned) {
          return false;
        }
        if (showReusableOnly && !item.reusable) {
          return false;
        }
        if (!normalizedSearch) {
          return true;
        }
        return [
          item.title,
          item.subtitle ?? "",
          item.preview_text ?? "",
          item.note ?? "",
          item.kind,
          item.status,
          item.tags.join(" "),
          item.collections.join(" "),
          item.linked_document_title ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      }),
    [items, normalizedSearch, selectedCollection, selectedTag, showPinnedOnly, showReusableOnly]
  );
  const filteredSignature = filteredItems.map((item) => item.id).join("|");

  const selectedItem = useMemo(
    () =>
      filteredItems.find((item) => item.id === selectedItemId) ??
      items.find((item) => item.id === selectedItemId) ??
      filteredItems[0] ??
      null,
    [filteredItems, items, selectedItemId]
  );
  const firstFilteredItemId = filteredItems[0]?.id ?? null;
  const hasSelectedItem = selectedItem !== null;
  const selectedItemIdValue = selectedItem?.id ?? null;
  const selectedItemNote = selectedItem?.note ?? "";
  const selectedItemTagsText = selectedItem?.tags.join(", ") ?? "";
  const selectedItemCollectionsText = selectedItem?.collections.join(", ") ?? "";
  const selectedItemTagSignature = selectedItem?.tags.join("|") ?? "";
  const selectedItemCollectionSignature = selectedItem?.collections.join("|") ?? "";
  const selectedItemIsInFiltered = selectedItem
    ? filteredItems.some((item) => item.id === selectedItem.id)
    : false;

  useEffect(() => {
    if (!hasSelectedItem) {
      if (firstFilteredItemId) {
        setSelectedItemId(firstFilteredItemId);
      }
      return;
    }
    setDraftNote(selectedItemNote);
    setDraftTags(selectedItemTagsText);
    setDraftCollections(selectedItemCollectionsText);
  }, [firstFilteredItemId, hasSelectedItem, selectedItemCollectionSignature, selectedItemIdValue, selectedItemNote, selectedItemTagSignature, selectedItemCollectionsText, selectedItemTagsText]);

  useEffect(() => {
    if (!hasSelectedItem && firstFilteredItemId) {
      setSelectedItemId(firstFilteredItemId);
      return;
    }
    if (hasSelectedItem && !selectedItemIsInFiltered && firstFilteredItemId) {
      setSelectedItemId(firstFilteredItemId);
    }
  }, [filteredSignature, firstFilteredItemId, hasSelectedItem, selectedItemIdValue, selectedItemIsInFiltered]);

  async function updateItem(item: LibraryItem, payload: LibraryItemUpdatePayload) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/library/${item.item_type}/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({ detail: "Library update failed." }))) as
        | LibraryItem
        | { detail?: string };
      if (!response.ok || !("id" in data)) {
        setError(("detail" in data && data.detail) || "Library update failed.");
        setSaving(false);
        return;
      }
      setItems((currentItems) =>
        currentItems.map((currentItem) => (currentItem.id === data.id ? data : currentItem))
      );
      setSelectedItemId(data.id);
    } catch {
      setError("Library service is unavailable.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (!selectedItem) {
      return;
    }
    await updateItem(selectedItem, {
      note: draftNote,
      tags: splitInput(draftTags),
      collections: splitInput(draftCollections),
    });
  }

  async function togglePinned() {
    if (!selectedItem) {
      return;
    }
    await updateItem(selectedItem, { pinned: !selectedItem.pinned });
  }

  async function toggleReusable() {
    if (!selectedItem) {
      return;
    }
    await updateItem(selectedItem, { reusable: !selectedItem.reusable });
  }

  const collections = summarizeCollections(items);
  const topTags = summarizeTopTags(items);
  const curatedItems = items.filter(
    (item) => item.pinned || item.reusable || item.collections.length > 0 || Boolean(item.note)
  );

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <Badge>Library</Badge>
        <h1 className="mt-4 font-display text-5xl">Curated workspace memory and reusable deliverables.</h1>
        <p className="mt-4 max-w-3xl text-base text-black/62">
          Turn raw uploads and generated outputs into a managed library: organize them into collections,
          pin canonical assets, add operating notes, and keep reusable knowledge easy to rediscover.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={withWorkspacePath("/app/knowledge", workspaceId)}
            className="rounded-full bg-ink px-4 py-2 text-sm text-white transition hover:bg-ink/90"
          >
            Open Knowledge Ops
          </Link>
          <Link
            href={withWorkspacePath("/app/artifacts", workspaceId)}
            className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm text-black/72 transition hover:bg-white"
          >
            Open Deliverables
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Library Items</p>
          <p className="mt-3 font-display text-4xl">{dashboard.stats.total_items}</p>
          <p className="mt-2 text-sm text-black/60">Unified document and artifact inventory.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Curated Picks</p>
          <p className="mt-3 font-display text-4xl">{curatedItems.length}</p>
          <p className="mt-2 text-sm text-black/60">Pinned, reusable, or annotated library assets.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Collections</p>
          <p className="mt-3 font-display text-4xl">{collections.length}</p>
          <p className="mt-2 text-sm text-black/60">Named shelves for curated assets and source sets.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Reusable Assets</p>
          <p className="mt-3 font-display text-4xl">{items.filter((item) => item.reusable).length}</p>
          <p className="mt-2 text-sm text-black/60">Items explicitly marked as reusable building blocks.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.34fr_0.72fr_0.94fr]">
        <div className="space-y-6">
          <div className="panel p-6">
            <div className="flex items-center gap-3">
              <FolderKanban className="h-5 w-5" />
              <h2 className="font-display text-3xl">Collections</h2>
            </div>
            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={() => setSelectedCollection("")}
                className={
                  selectedCollection === ""
                    ? "w-full rounded-[20px] border border-ink bg-white px-4 py-3 text-left text-sm shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
                    : "w-full rounded-[20px] border border-black/10 bg-white/75 px-4 py-3 text-left text-sm"
                }
              >
                All collections
              </button>
              {collections.map((collection) => (
                <button
                  key={collection.name}
                  type="button"
                  onClick={() => setSelectedCollection(collection.name)}
                  className={
                    selectedCollection === collection.name
                      ? "w-full rounded-[20px] border border-ink bg-white px-4 py-3 text-left shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
                      : "w-full rounded-[20px] border border-black/10 bg-white/75 px-4 py-3 text-left"
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-black/78">
                        {formatCollectionLabel(collection.name)}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-black/45">
                        {collection.item_count} items / {collection.document_count} documents / {collection.artifact_count} artifacts
                      </p>
                    </div>
                    {collection.pinned_count > 0 ? <Badge>{collection.pinned_count} pinned</Badge> : null}
                  </div>
                </button>
              ))}
              {collections.length === 0 ? (
                <p className="text-sm text-black/50">
                  Collections will appear as soon as you start curating library items.
                </p>
              ) : null}
            </div>
          </div>

          <div className="panel p-6">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5" />
              <h2 className="font-display text-3xl">Top Tags</h2>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedTag("")}
                className={
                  selectedTag === ""
                    ? "rounded-full border border-ink bg-white px-3 py-2 text-xs uppercase tracking-[0.14em]"
                    : "rounded-full border border-black/10 bg-white/75 px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/58"
                }
              >
                All tags
              </button>
              {topTags.map((tag) => (
                <button
                  key={tag.tag}
                  type="button"
                  onClick={() => setSelectedTag(tag.tag)}
                  className={
                    selectedTag === tag.tag
                      ? "rounded-full border border-ink bg-white px-3 py-2 text-xs uppercase tracking-[0.14em]"
                      : "rounded-full border border-black/10 bg-white/75 px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/58"
                  }
                >
                  {tag.tag} / {tag.count}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="panel p-6">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5" />
            <h2 className="font-display text-3xl">Library Explorer</h2>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search titles, notes, tags, and collections"
              className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowPinnedOnly((current) => !current)}
                className={
                  showPinnedOnly
                    ? "rounded-full bg-ink px-4 py-2 text-sm text-white"
                    : "rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/72"
                }
              >
                Pinned only
              </button>
              <button
                type="button"
                onClick={() => setShowReusableOnly((current) => !current)}
                className={
                  showReusableOnly
                    ? "rounded-full bg-ink px-4 py-2 text-sm text-white"
                    : "rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/72"
                }
              >
                Reusable only
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {filteredItems.map((item) => {
              const isSelected = item.id === selectedItem?.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedItemId(item.id)}
                  className={
                    isSelected
                      ? "w-full rounded-[24px] border border-ink bg-white p-5 text-left shadow-[0_20px_60px_rgba(15,23,42,0.10)]"
                      : "w-full rounded-[24px] border border-black/10 bg-white/75 p-5 text-left transition hover:bg-white"
                  }
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-black/80">{item.title}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.14em] text-black/45">
                        {item.item_type} / {item.kind} / {item.status}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.pinned ? <Badge>Pinned</Badge> : null}
                      {item.reusable ? <Badge>Reusable</Badge> : null}
                    </div>
                  </div>
                  {item.preview_text ? (
                    <p className="mt-3 text-sm leading-7 text-black/66">{item.preview_text}</p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/48">
                    {item.collections.slice(0, 3).map((collection) => (
                      <span key={collection} className="rounded-full border border-black/10 px-3 py-1">
                        {collection}
                      </span>
                    ))}
                    {item.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="rounded-full border border-black/10 px-3 py-1">
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
            {filteredItems.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-black/10 bg-white/70 px-5 py-6 text-sm leading-7 text-black/62">
                No library items match the current filters.
              </div>
            ) : null}
          </div>
        </div>

        <div className="panel p-6">
          {selectedItem ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-4xl">{selectedItem.title}</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-8 text-black/64">
                    {selectedItem.subtitle || selectedItem.preview_text || "Curate this item with notes, collections, and reusable flags."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={buildItemPath(workspaceId, selectedItem)}
                    className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/72 transition hover:bg-black/[0.03]"
                  >
                    Open item
                  </Link>
                  {selectedItem.linked_document_id ? (
                    <Link
                      href={withWorkspacePath("/app/knowledge", workspaceId, { document: selectedItem.linked_document_id })}
                      className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/72 transition hover:bg-black/[0.03]"
                    >
                      Open source
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[20px] border border-black/10 bg-sand/60 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-black/45">Type</p>
                  <p className="mt-2 text-sm font-medium text-black/78">{selectedItem.item_type}</p>
                </div>
                <div className="rounded-[20px] border border-black/10 bg-sand/60 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-black/45">Kind</p>
                  <p className="mt-2 text-sm font-medium text-black/78">{selectedItem.kind}</p>
                </div>
                <div className="rounded-[20px] border border-black/10 bg-sand/60 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-black/45">Updated</p>
                  <p className="mt-2 text-sm font-medium text-black/78">{formatDate(selectedItem.updated_at)}</p>
                </div>
                <div className="rounded-[20px] border border-black/10 bg-sand/60 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-black/45">Status</p>
                  <p className="mt-2 text-sm font-medium text-black/78">{selectedItem.status}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={togglePinned}
                  disabled={saving}
                  className={
                    selectedItem.pinned
                      ? "inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                      : "inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/72 disabled:opacity-60"
                  }
                >
                  <Pin className="h-4 w-4" />
                  {selectedItem.pinned ? "Pinned" : "Pin item"}
                </button>
                <button
                  type="button"
                  onClick={toggleReusable}
                  disabled={saving}
                  className={
                    selectedItem.reusable
                      ? "inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                      : "inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/72 disabled:opacity-60"
                  }
                >
                  <Bookmark className="h-4 w-4" />
                  {selectedItem.reusable ? "Reusable" : "Mark reusable"}
                </button>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-[24px] border border-black/10 bg-white/80 p-5">
                  <div className="flex items-center gap-3">
                    <Boxes className="h-5 w-5" />
                    <h3 className="font-medium text-black/80">Collections</h3>
                  </div>
                  <input
                    value={draftCollections}
                    onChange={(event) => setDraftCollections(event.target.value)}
                    placeholder="board room, q2 pack, sales playbook"
                    className="mt-4 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
                  />
                  <p className="mt-3 text-sm leading-7 text-black/60">
                    Use collections to create curated shelves that mix source documents and generated outputs.
                  </p>
                </div>

                <div className="rounded-[24px] border border-black/10 bg-white/80 p-5">
                  <div className="flex items-center gap-3">
                    <Sparkles className="h-5 w-5" />
                    <h3 className="font-medium text-black/80">Tags</h3>
                  </div>
                  <input
                    value={draftTags}
                    onChange={(event) => setDraftTags(event.target.value)}
                    placeholder="finance, launch, canonical"
                    className="mt-4 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
                  />
                  <p className="mt-3 text-sm leading-7 text-black/60">
                    Tags make the library searchable across knowledge, artifacts, and future reusable workflows.
                  </p>
                </div>
              </div>

              <div className="rounded-[24px] border border-black/10 bg-white/80 p-5">
                <div className="flex items-center gap-3">
                  <RefreshCw className="h-5 w-5" />
                  <h3 className="font-medium text-black/80">Operator Note</h3>
                </div>
                <textarea
                  value={draftNote}
                  onChange={(event) => setDraftNote(event.target.value)}
                  rows={6}
                  placeholder="Why this item matters, when to reuse it, and what to avoid."
                  className="mt-4 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={saving}
                    className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Save curation"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftNote(selectedItem.note ?? "");
                      setDraftTags(selectedItem.tags.join(", "));
                      setDraftCollections(selectedItem.collections.join(", "));
                    }}
                    disabled={saving}
                    className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/72 disabled:opacity-60"
                  >
                    Reset draft
                  </button>
                </div>
                {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
              </div>

              <div className="rounded-[24px] border border-black/10 bg-white/80 p-5">
                <h3 className="font-medium text-black/80">Current curation state</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedItem.collections.map((collection) => (
                    <span key={collection} className="rounded-full border border-black/10 px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/58">
                      {collection}
                    </span>
                  ))}
                  {selectedItem.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-black/10 px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/58">
                      {tag}
                    </span>
                  ))}
                  {selectedItem.collections.length === 0 && selectedItem.tags.length === 0 ? (
                    <p className="text-sm text-black/50">
                      This item has not been curated yet. Add collections or tags to make it easier to reuse.
                    </p>
                  ) : null}
                </div>
                {selectedItem.note ? (
                  <p className="mt-4 rounded-[18px] bg-sand/55 px-4 py-4 text-sm leading-7 text-black/68">
                    {selectedItem.note}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-black/10 bg-white/70 px-5 py-6 text-sm leading-7 text-black/62">
              Select a library item to inspect and curate it.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
