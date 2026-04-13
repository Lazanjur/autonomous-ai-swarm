"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  History,
  Layers3,
  LoaderCircle,
  Link2,
  MessageSquareMore,
  Mic,
  MonitorSmartphone,
  Paperclip,
  Pause,
  Play,
  RefreshCw,
  Save,
  SendHorizontal,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  ChatRun,
  ChatRunRequestPayload,
  DocumentUploadResponse,
  KnowledgeDocument,
  ChatWorkbenchDiffData,
  ChatTodoSyncResponse,
  ChatWorkbenchFileSaveResponse,
  ChatThreadCreatePayload,
  ChatWorkbenchFileData,
  ChatWorkbenchRepoData,
  ChatWorkbenchTreeData,
  ChatWorkspaceData,
  ComputerSession,
  LivePlanStep,
  LiveRunEvent,
  LiveRunStepState,
  Message,
  RunStepRecord,
  SharedMemory,
  TaskTemplate,
  Thread,
  WorkbenchTreeEntry,
  ToolArtifactRef,
  ToolCallRecord
} from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { withWorkspacePath } from "@/lib/workspace";

type OperatorTab =
  | "code"
  | "computer"
  | "browser"
  | "terminal"
  | "files"
  | "preview"
  | "timeline"
  | "artifacts";
type HeaderPanel = "share" | "settings" | null;
type WorkbenchViewMode = "edit" | "local-diff" | "repo-diff";
type TerminalStreamMode = "combined" | "stdout" | "stderr";
type ArtifactPreviewMode = "image" | "frame" | "none";
type OperatingFlowStageStatus = "idle" | "active" | "complete";

type WorkbenchEditorState = {
  file: ChatWorkbenchFileData;
  originalContent: string;
  draftContent: string;
  savedAt?: string | null;
};

type OperatorTimelineEntry = {
  id: string;
  created_at: string;
  kind: "tool" | "session" | "artifact";
  title: string;
  status: string;
  summary?: string;
  agent_name?: string;
  tool?: string;
  session_kind?: "browser" | "terminal";
  artifact?: ToolArtifactRef;
  meta?: string[];
};

type TaskChecklistItem = {
  id: string;
  step_index: number;
  title: string;
  status: string;
  completed: boolean;
  summary: string;
  agent_name?: string;
  execution_mode?: string;
  dependencies: string[];
};

type SharedMemorySection = {
  key: string;
  label: string;
  items: string[];
};

type ApprovalRequest = {
  id: string;
  kind: "browser_interaction" | "external_delivery";
  title: string;
  reason: string;
  approvalPrompt: string;
  created_at: string;
  tool: string;
  channel?: string;
  targetLabel?: string;
  detailLines: string[];
};

type ApprovalResolution = {
  approval_id: string;
  status: "approved" | "rejected" | "deferred";
  kind: string;
  title?: string;
  resolved_at: string;
};

type WorkbenchFileActivity = {
  id: string;
  created_at: string;
  status: string;
  operation: string;
  summary: string;
  relative_path?: string | null;
  directory_path?: string | null;
  target_kind: "file" | "dir" | "workspace";
  entry_paths: string[];
  agent_key?: string;
  agent_name?: string;
  step_index?: number;
};

type ComposerAttachmentKind = "document" | "artifact" | "url" | "workbench_file";

type ComposerAttachment = {
  id: string;
  kind: ComposerAttachmentKind;
  label: string;
  description: string;
  document_id?: string | null;
  artifact_id?: string | null;
  source_uri?: string | null;
  relative_path?: string | null;
  storage_key?: string | null;
  mime_type?: string | null;
  created_at?: string | null;
};

type ComposerShortcut = {
  key: string;
  label: string;
  description: string;
  operatorTab: OperatorTab;
  promptHint: string;
  retrieval?: boolean;
  modelProfile?: string | null;
};

type BrowserSpeechRecognitionResultLike = {
  transcript: string;
  isFinal: boolean;
};

type BrowserSpeechRecognitionEventLike = {
  results: BrowserSpeechRecognitionResultLike[][];
};

type BrowserSpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: BrowserSpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognitionLike;

const MODEL_PROFILE_OPTIONS = [
  {
    value: "qwen3.5-flash",
    label: "Qwen3.5 Flash",
    description: "Fast default task profile"
  },
  {
    value: "qwen3.6-plus",
    label: "Qwen3.6 Plus",
    description: "Deeper research and synthesis"
  },
  {
    value: "qwen3-max",
    label: "Qwen3 Max",
    description: "Highest reasoning budget"
  },
  {
    value: "qwen3-coder-plus",
    label: "Qwen3 Coder Plus",
    description: "Code-heavy implementation focus"
  }
] as const;

const COMPOSER_SHORTCUTS: ComposerShortcut[] = [
  {
    key: "research",
    label: "Research",
    description: "Bias this run toward source-finding, comparison, and synthesis.",
    operatorTab: "browser",
    promptHint: "Research this thoroughly, compare sources, and return a grounded summary with citations.",
    retrieval: true,
    modelProfile: "qwen3.6-plus"
  },
  {
    key: "browser",
    label: "Browser",
    description: "Favor live browsing and web interaction planning.",
    operatorTab: "browser",
    promptHint: "Use browser workflows where helpful and report each meaningful interaction.",
    retrieval: true
  },
  {
    key: "code",
    label: "Code",
    description: "Favor implementation, debugging, and repo-aware editing.",
    operatorTab: "code",
    promptHint: "Treat this as a coding task: inspect files, edit carefully, and explain the result.",
    modelProfile: "qwen3-coder-plus"
  },
  {
    key: "analysis",
    label: "Analyze",
    description: "Favor structured reasoning, diagnostics, and decision support.",
    operatorTab: "timeline",
    promptHint: "Analyze the inputs step by step, surface tradeoffs, and conclude with a recommendation.",
    retrieval: true,
    modelProfile: "qwen3-max"
  },
  {
    key: "artifact",
    label: "Deliverable",
    description: "Aim for polished outputs like docs, exports, or previews.",
    operatorTab: "preview",
    promptHint: "Create a polished deliverable and keep outputs organized as reusable artifacts."
  },
  {
    key: "automation",
    label: "Automate",
    description: "Favor workflow design, repeatability, and operator handoff.",
    operatorTab: "computer",
    promptHint: "Design or execute this as a repeatable workflow with clear checkpoints and outputs."
  }
] as const;

const OPERATOR_TAB_OPTIONS: Array<{
  key: OperatorTab;
  label: string;
  icon: typeof Code2;
}> = [
  { key: "code", label: "Code", icon: Code2 },
  { key: "computer", label: "Overview", icon: MonitorSmartphone },
  { key: "browser", label: "Browser", icon: Globe },
  { key: "terminal", label: "Terminal", icon: TerminalSquare },
  { key: "files", label: "Files", icon: FolderTree },
  { key: "preview", label: "Preview", icon: Layers3 },
  { key: "timeline", label: "Timeline", icon: History },
  { key: "artifacts", label: "Artifacts", icon: Boxes }
];

const DEFAULT_WORKSPACE_SPLIT = 51;
const MIN_WORKSPACE_SPLIT = 46;
const MAX_WORKSPACE_SPLIT = 66;
const WORKSPACE_LAYOUT_STORAGE_KEY = "swarm.workspace.layout.v2";
const CITATION_REFERENCE_PATTERN = /\[(S\d+)\]/g;

function statusLabel(status: string) {
  return status.replaceAll(".", " ").replaceAll("_", " ");
}

function statusBadgeClass(status: string) {
  if (status === "completed") {
    return "bg-pine text-white border-transparent";
  }
  if (status === "running" || status === "escalating") {
    return "bg-ink text-white border-transparent";
  }
  if (status === "failed") {
    return "bg-red-700 text-white border-transparent";
  }
  if (status === "approval_required") {
    return "bg-amber-600 text-white border-transparent";
  }
  return "bg-white/75 text-black/70";
}

function formatToolName(name: string) {
  return name.replaceAll("_", " ");
}

function formatMessageHoverTime(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function attachmentKindLabel(kind: ComposerAttachmentKind) {
  if (kind === "document") {
    return "document";
  }
  if (kind === "artifact") {
    return "artifact";
  }
  if (kind === "workbench_file") {
    return "workspace file";
  }
  return "source url";
}

function buildComposerContextPayload(
  attachments: ComposerAttachment[],
  shortcuts: ComposerShortcut[],
  voiceUsed: boolean,
  voiceEngine: string | null
) {
  return {
    attachments: attachments.map((attachment) => ({
      kind: attachment.kind,
      label: attachment.label,
      description: attachment.description,
      document_id: attachment.document_id ?? null,
      artifact_id: attachment.artifact_id ?? null,
      source_uri: attachment.source_uri ?? null,
      relative_path: attachment.relative_path ?? null,
      storage_key: attachment.storage_key ?? null,
      mime_type: attachment.mime_type ?? null,
      created_at: attachment.created_at ?? null
    })),
    shortcuts: shortcuts.map((shortcut) => ({
      key: shortcut.key,
      label: shortcut.label,
      operator_tab: shortcut.operatorTab,
      retrieval: shortcut.retrieval ?? null,
      model_profile: shortcut.modelProfile ?? null
    })),
    voice: {
      used: voiceUsed,
      engine: voiceEngine
    }
  };
}

function buildRunMessageFromComposer(
  baseMessage: string,
  attachments: ComposerAttachment[],
  shortcuts: ComposerShortcut[],
  voiceUsed: boolean
) {
  const sections: string[] = [];

  if (shortcuts.length > 0) {
    sections.push(
      [
        "Execution preferences for this run:",
        ...shortcuts.map(
          (shortcut) => `- ${shortcut.label}: ${shortcut.description} ${shortcut.promptHint}`.trim()
        )
      ].join("\n")
    );
  }

  if (attachments.length > 0) {
    sections.push(
      [
        "Attached context to use during this run:",
        ...attachments.map((attachment) => {
          const reference =
            attachment.source_uri ??
            attachment.relative_path ??
            attachment.document_id ??
            attachment.artifact_id ??
            attachment.storage_key ??
            attachment.description;
          return `- ${attachmentKindLabel(attachment.kind)}: ${attachment.label}${reference ? ` (${reference})` : ""}`;
        })
      ].join("\n")
    );
  }

  if (voiceUsed) {
    sections.push("Input note: part of this prompt was captured via voice dictation, so preserve intent even if wording is slightly conversational.");
  }

  return sections.length > 0
    ? `${baseMessage.trim()}\n\n${sections.join("\n\n")}`
    : baseMessage.trim();
}

function templateCategoryIcon(category: TaskTemplate["category"]) {
  return category === "browser" ? Globe : MonitorSmartphone;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item));
}

function compactText(value: string | null | undefined, limit = 220) {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

function extractCitationReferenceIds(content: string) {
  return Array.from(new Set(Array.from(content.matchAll(CITATION_REFERENCE_PATTERN), (match) => match[1])));
}

function citationHref(workspaceId: string, citation: Message["citations"][number]) {
  if (citation.url) {
    return citation.url;
  }
  if (citation.document_id) {
    return withWorkspacePath("/app/knowledge", workspaceId, {
      document: citation.document_id
    });
  }
  return null;
}

function renderMessageContent(
  content: string,
  citationLookup: Map<string, Message["citations"][number]>
) {
  const paragraphs = content.split(/\n{2,}/).filter((paragraph) => paragraph.trim().length > 0);
  const blocks = paragraphs.length > 0 ? paragraphs : [content];
  return blocks.map((paragraph, paragraphIndex) => {
    const segments = paragraph.split(CITATION_REFERENCE_PATTERN);
    return (
      <p key={`paragraph-${paragraphIndex}`} className="text-sm leading-8 text-black/75">
        {segments.map((segment, segmentIndex) => {
          const citation = citationLookup.get(segment);
          if (citation) {
            return (
              <span
                key={`citation-ref-${paragraphIndex}-${segmentIndex}`}
                title={citation.title}
                className="mx-1 inline-flex rounded-full border border-black/10 bg-sand/75 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-black/65"
              >
                [{segment}]
              </span>
            );
          }
          return <span key={`text-${paragraphIndex}-${segmentIndex}`}>{segment}</span>;
        })}
      </p>
    );
  });
}

function toSharedMemory(value: unknown): SharedMemory | null {
  if (!isRecord(value)) {
    return null;
  }
  const list = (input: unknown) =>
    Array.isArray(input)
      ? input.map((item) => compactText(String(item), 220)).filter(Boolean)
      : [];
  const agentMemory = Array.isArray(value.agent_memory)
    ? value.agent_memory
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .map((item) => ({
          agent: String(item.agent ?? item.agent_name ?? "Agent"),
          summary: compactText(String(item.summary ?? item.content ?? ""), 220),
          confidence:
            typeof item.confidence === "number"
              ? item.confidence
              : typeof item.confidence === "string"
                ? Number(item.confidence)
                : undefined
        }))
        .filter((item) => item.summary)
    : [];
  return {
    summary:
      typeof value.summary === "string" && value.summary.trim()
        ? compactText(value.summary, 320)
        : null,
    findings: list(value.findings),
    risks: list(value.risks),
    open_questions: list(value.open_questions),
    recent_requests: list(value.recent_requests),
    recent_summaries: list(value.recent_summaries),
    focus_areas: list(value.focus_areas),
    agent_memory: agentMemory,
    run_count:
      typeof value.run_count === "number"
        ? value.run_count
        : typeof value.run_count === "string"
          ? Number(value.run_count)
          : 0,
    last_updated_at: typeof value.last_updated_at === "string" ? value.last_updated_at : null,
    source_run_id: typeof value.source_run_id === "string" ? value.source_run_id : null,
    source_thread_id: typeof value.source_thread_id === "string" ? value.source_thread_id : null
  };
}

function buildSharedMemorySections(memory: SharedMemory | null | undefined): SharedMemorySection[] {
  if (!memory) {
    return [];
  }
  return [
    { key: "focus", label: "Focus", items: memory.focus_areas.slice(0, 3) },
    { key: "findings", label: "Findings", items: memory.findings.slice(0, 3) },
    { key: "risks", label: "Risks", items: memory.risks.slice(0, 3) },
    { key: "questions", label: "Open questions", items: memory.open_questions.slice(0, 3) },
    { key: "requests", label: "Recent requests", items: memory.recent_requests.slice(0, 2) },
    { key: "summaries", label: "Recent summaries", items: memory.recent_summaries.slice(0, 2) }
  ].filter((section) => section.items.length > 0);
}

function toApprovalResolutions(value: unknown): ApprovalResolution[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item): ApprovalResolution => ({
      approval_id: String(item.approval_id ?? ""),
      status:
        item.status === "approved"
          ? "approved"
          : item.status === "deferred"
            ? "deferred"
            : "rejected",
      kind: String(item.kind ?? "approval"),
      title: typeof item.title === "string" ? item.title : undefined,
      resolved_at:
        typeof item.resolved_at === "string" ? item.resolved_at : new Date().toISOString()
    }))
    .filter((item) => Boolean(item.approval_id));
}

function approvalRequestId(
  kind: "browser_interaction" | "external_delivery",
  options: {
    runId?: string | null;
    stepIndex?: number | null;
    target?: string | null;
    reason?: string | null;
    channel?: string | null;
  }
) {
  return approvalFingerprint(
    kind,
    options.runId,
    options.stepIndex,
    options.channel,
    options.target,
    options.reason
  );
}

function approvalRequestFromToolCall(
  toolCall: ToolCallRecord,
  runStepById: Map<string, RunStepRecord>
): ApprovalRequest | null {
  const payload = isRecord(toolCall.output_payload) ? toolCall.output_payload : null;
  if (!payload) {
    return null;
  }
  const runStep = runStepById.get(toolCall.run_step_id);
  const runId = runStep?.run_id ?? null;
  const stepIndex = typeof runStep?.step_index === "number" ? runStep.step_index : null;

  if (
    toolCall.tool_name === "notification_dispatch" &&
    String(payload.status ?? "") === "approval_required"
  ) {
    const channel = typeof payload.channel === "string" ? payload.channel : "notification";
    const target =
      typeof payload.url === "string"
        ? payload.url
        : typeof payload.to === "string"
          ? payload.to
          : channel;
    const reason =
      typeof payload.reason === "string" && payload.reason
        ? payload.reason
        : "Live external delivery is blocked until a human explicitly approves it.";
    return {
      id: approvalRequestId("external_delivery", {
        runId,
        stepIndex,
        channel,
        target,
        reason
      }),
      kind: "external_delivery",
      title: `Approve ${channel} delivery`,
      reason,
      approvalPrompt: `Approved. Proceed with the pending ${channel} delivery for ${target} now.`,
      created_at: toolCall.created_at,
      tool: toolCall.tool_name,
      channel,
      targetLabel: target,
      detailLines: [
        `Channel: ${channel}`,
        target ? `Target: ${target}` : "",
        "The agent prepared the delivery and is waiting for approval to send it live."
      ].filter(Boolean)
    };
  }

  if (toolCall.tool_name === "browser_automation") {
    const skippedActions = Array.isArray(payload.skipped_actions) ? payload.skipped_actions : [];
    const warnings = Array.isArray(payload.warnings) ? payload.warnings.map(String) : [];
    const blockedByApproval =
      skippedActions.length > 0 &&
      warnings.some((warning) => /approval/i.test(warning));
    if (blockedByApproval) {
      const targetUrl =
        typeof payload.final_url === "string"
          ? payload.final_url
          : typeof payload.target_url === "string"
            ? payload.target_url
            : "the current page";
      const reason =
        warnings.find((warning) => /approval/i.test(warning)) ??
        "Interactive browser actions require an explicit human approval step.";
      return {
        id: approvalRequestId("browser_interaction", {
          runId,
          stepIndex,
          target: targetUrl,
          reason
        }),
        kind: "browser_interaction",
        title: "Approve browser interaction",
        reason,
        approvalPrompt: `Approved. Continue with the pending browser interaction actions for ${targetUrl} now.`,
        created_at: toolCall.created_at,
        tool: toolCall.tool_name,
        targetLabel: targetUrl,
        detailLines: [
          `Target: ${targetUrl}`,
          `${skippedActions.length} browser action${skippedActions.length === 1 ? "" : "s"} waiting for approval.`,
          "The agent captured the page safely, but did not click or fill anything yet."
        ]
      };
    }
  }

  return null;
}

function approvalRequestFromStream(event: string, data: Record<string, unknown>): ApprovalRequest | null {
  if (!(event === "tool.output" || event === "tool.completed")) {
    return null;
  }
  const tool = typeof data.tool === "string" ? data.tool : "";
  const result = isRecord(data.result) ? data.result : null;
  if (!tool || !result) {
    return null;
  }
  const now = new Date().toISOString();
  const runId = typeof data.run_id === "string" ? data.run_id : null;
  const stepIndex =
    typeof data.step_index === "number"
      ? data.step_index
      : typeof data.step_index === "string" && data.step_index.trim()
        ? Number(data.step_index)
        : null;

  if (tool === "notification_dispatch" && String(result.status ?? "") === "approval_required") {
    const channel = typeof result.channel === "string" ? result.channel : "notification";
    const target =
      typeof result.url === "string"
        ? result.url
        : typeof result.to === "string"
          ? result.to
          : channel;
    const reason =
      typeof result.reason === "string" && result.reason
        ? result.reason
        : "Live external delivery is blocked until a human explicitly approves it.";
    return {
      id: approvalRequestId("external_delivery", {
        runId,
        stepIndex: Number.isFinite(stepIndex) ? stepIndex : null,
        channel,
        target,
        reason
      }),
      kind: "external_delivery",
      title: `Approve ${channel} delivery`,
      reason,
      approvalPrompt: `Approved. Proceed with the pending ${channel} delivery for ${target} now.`,
      created_at: now,
      tool,
      channel,
      targetLabel: target,
      detailLines: [
        `Channel: ${channel}`,
        target ? `Target: ${target}` : "",
        "The agent prepared the delivery and is waiting for approval to send it live."
      ].filter(Boolean)
    };
  }

  if (tool === "browser_automation") {
    const skippedActions = Array.isArray(result.skipped_actions) ? result.skipped_actions : [];
    const warnings = Array.isArray(result.warnings) ? result.warnings.map(String) : [];
    if (skippedActions.length > 0 && warnings.some((warning) => /approval/i.test(warning))) {
      const targetUrl =
        typeof result.final_url === "string"
          ? result.final_url
          : typeof result.target_url === "string"
            ? result.target_url
            : "the current page";
      const reason =
        warnings.find((warning) => /approval/i.test(warning)) ??
        "Interactive browser actions require an explicit human approval step.";
      return {
        id: approvalRequestId("browser_interaction", {
          runId,
          stepIndex: Number.isFinite(stepIndex) ? stepIndex : null,
          target: targetUrl,
          reason
        }),
        kind: "browser_interaction",
        title: "Approve browser interaction",
        reason,
        approvalPrompt: `Approved. Continue with the pending browser interaction actions for ${targetUrl} now.`,
        created_at: now,
        tool,
        targetLabel: targetUrl,
        detailLines: [
          `Target: ${targetUrl}`,
          `${skippedActions.length} browser action${skippedActions.length === 1 ? "" : "s"} waiting for approval.`,
          "The agent captured the page safely, but did not click or fill anything yet."
        ]
      };
    }
  }

  return null;
}

function mergeApprovalRequests(current: ApprovalRequest[], next: ApprovalRequest): ApprovalRequest[] {
  const existingIndex = current.findIndex((item) => item.id === next.id);
  if (existingIndex === -1) {
    return [next, ...current].slice(0, 12);
  }
  const updated = [...current];
  updated[existingIndex] = {
    ...updated[existingIndex],
    ...next,
    id: updated[existingIndex].id
  };
  return updated;
}

function approvalFingerprint(...parts: Array<string | number | null | undefined>) {
  return parts
    .map((part) =>
      String(part ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter(Boolean)
    .join(":");
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function dedupeArtifacts(artifacts: ToolArtifactRef[]) {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.storage_key)) {
      return false;
    }
    seen.add(artifact.storage_key);
    return true;
  });
}

function toToolArtifacts(value: unknown): ToolArtifactRef[] {
  const collected: ToolArtifactRef[] = [];

  const appendArtifact = (artifact: unknown) => {
    if (!isRecord(artifact)) {
      return;
    }
    const storageKey = artifact.storage_key;
    if (typeof storageKey !== "string" || !storageKey) {
      return;
    }
    collected.push({
      storage_key: storageKey,
      path: typeof artifact.path === "string" ? artifact.path : undefined,
      content_type: typeof artifact.content_type === "string" ? artifact.content_type : undefined,
      relative_path: typeof artifact.relative_path === "string" ? artifact.relative_path : undefined,
      size_bytes:
        typeof artifact.size_bytes === "number"
          ? artifact.size_bytes
          : typeof artifact.size_bytes === "string"
            ? Number(artifact.size_bytes)
            : undefined,
      title: typeof artifact.title === "string" ? artifact.title : undefined
    });
  };

  if (Array.isArray(value)) {
    value.forEach(appendArtifact);
  } else if (isRecord(value)) {
    Object.values(value).forEach(appendArtifact);
  }

  return dedupeArtifacts(collected);
}

function artifactLabel(artifact: ToolArtifactRef) {
  return artifact.title ?? artifact.relative_path ?? artifact.storage_key.split("/").pop() ?? "artifact";
}

function toolArtifactHref(workspaceId: string, artifact: ToolArtifactRef) {
  const query = new URLSearchParams({
    workspace_id: workspaceId,
    storage_key: artifact.storage_key
  });
  const filename = artifactLabel(artifact);
  if (filename) {
    query.set("filename", filename);
  }
  return `/api/chat/tool-artifacts/download?${query.toString()}`;
}

function toolArtifactPreviewHref(workspaceId: string, artifact: ToolArtifactRef) {
  const query = new URLSearchParams({
    workspace_id: workspaceId,
    storage_key: artifact.storage_key
  });
  return `/api/chat/tool-artifacts/preview?${query.toString()}`;
}

function artifactFileName(artifact: ToolArtifactRef) {
  return artifact.relative_path ?? artifact.path ?? artifact.storage_key.split("/").pop() ?? artifact.storage_key;
}

function artifactExtension(artifact: ToolArtifactRef) {
  const match = artifactFileName(artifact).match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

function artifactPreviewMode(artifact: ToolArtifactRef): ArtifactPreviewMode {
  const contentType = artifact.content_type?.toLowerCase() ?? "";
  const extension = artifactExtension(artifact);
  if (
    contentType.startsWith("image/") ||
    (extension !== null && ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(extension))
  ) {
    return "image";
  }
  if (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/pdf" ||
    contentType === "application/xhtml+xml" ||
    contentType.includes("html") ||
    (extension !== null && ["html", "htm", "txt", "md", "mdx", "json", "pdf", "svg"].includes(extension))
  ) {
    return "frame";
  }
  return "none";
}

function isPreviewableArtifact(artifact: ToolArtifactRef) {
  return artifactPreviewMode(artifact) !== "none";
}

function previewableArtifacts(artifacts: ToolArtifactRef[]) {
  return dedupeArtifacts(artifacts).filter(isPreviewableArtifact);
}

function sessionLabel(session: ComputerSession, fallbackLabel: string) {
  if (session.session_kind === "browser") {
    return (
      session.page_title ||
      session.final_url ||
      session.target_url ||
      fallbackLabel
    );
  }
  const command = (session.command ?? []).join(" ").trim();
  return command || fallbackLabel;
}

function browserScreenshotArtifact(session: ComputerSession | null) {
  if (!session) {
    return null;
  }
  return (
    session.artifacts?.find((artifact) => artifactPreviewMode(artifact) === "image") ?? null
  );
}

function browserHtmlArtifact(session: ComputerSession | null) {
  if (!session) {
    return null;
  }
  return (
    session.artifacts?.find((artifact) => {
      const contentType = artifact.content_type?.toLowerCase() ?? "";
      const extension = artifactExtension(artifact);
      return contentType.includes("html") || extension === "html" || extension === "htm";
    }) ?? null
  );
}

function formatMetricValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function sessionMetricEntries(metrics: Record<string, unknown> | undefined) {
  if (!metrics) {
    return [];
  }
  return Object.entries(metrics)
    .filter(([, value]) => value !== null && value !== undefined && String(value) !== "")
    .slice(0, 8)
    .map(([key, value]) => ({
      key,
      label: formatToolName(key),
      value: formatMetricValue(value)
    }));
}

function terminalOutputForMode(session: ComputerSession | null, mode: TerminalStreamMode) {
  if (!session) {
    return "";
  }
  const stdout = session.stdout ?? "";
  const stderr = session.stderr ?? "";
  if (mode === "stdout") {
    return stdout;
  }
  if (mode === "stderr") {
    return stderr;
  }
  if (stdout && stderr) {
    return `$ stdout\n${stdout}\n\n$ stderr\n${stderr}`;
  }
  return stdout || stderr;
}

function workbenchActivityLabel(activity: WorkbenchFileActivity) {
  if (activity.operation === "read_text") {
    return "focused";
  }
  if (activity.operation === "write_text" || activity.operation === "write_json") {
    return "updated";
  }
  if (activity.operation === "list_files") {
    return "listed";
  }
  return "active";
}

function workbenchActivityTone(activity: WorkbenchFileActivity) {
  if (activity.operation === "write_text" || activity.operation === "write_json") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (activity.operation === "read_text") {
    return "border-sky-200 bg-sky-50 text-sky-900";
  }
  if (activity.operation === "list_files") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-black/10 bg-white/75 text-black/[0.68]";
}

function workbenchActivityFromEvent(event: string, data: Record<string, unknown>): WorkbenchFileActivity | null {
  if (event === "workspace.activity") {
    const now = new Date().toISOString();
    return {
      id: `workspace-activity-${now}-${Math.random()}`,
      created_at: now,
      status: typeof data.status === "string" ? data.status : "completed",
      operation: typeof data.operation === "string" ? data.operation : "execute",
      summary:
        typeof data.summary === "string" && data.summary
          ? data.summary
          : "Workspace activity updated.",
      relative_path: typeof data.relative_path === "string" ? data.relative_path : null,
      directory_path: typeof data.directory_path === "string" ? data.directory_path : null,
      target_kind:
        data.target_kind === "file" || data.target_kind === "dir" ? data.target_kind : "workspace",
      entry_paths: Array.isArray(data.entry_paths) ? data.entry_paths.map(String) : [],
      agent_key: typeof data.agent_key === "string" ? data.agent_key : undefined,
      agent_name: typeof data.agent_name === "string" ? data.agent_name : undefined,
      step_index: typeof data.step_index === "number" ? data.step_index : undefined
    };
  }

  if ((event === "tool.output" || event === "tool.completed") && data.tool === "workspace_files" && isRecord(data.result)) {
    const result = data.result;
    const now = new Date().toISOString();
    const operation = typeof result.operation === "string" ? result.operation : "execute";
    const relativePath = typeof result.relative_path === "string" ? result.relative_path : null;
    const entryPaths = Array.isArray(result.entries)
      ? result.entries
          .filter((entry): entry is Record<string, unknown> => isRecord(entry))
          .map((entry) => entry.relative_path)
          .filter((value): value is string => typeof value === "string")
          .slice(0, 12)
      : [];
    const directoryPath =
      operation === "list_files"
        ? relativePath ?? "."
        : relativePath
          ? relativePath.split("/").slice(0, -1).join("/") || "."
          : null;
    return {
      id: `workspace-activity-${now}-${Math.random()}`,
      created_at: now,
      status: typeof data.status === "string" ? data.status : "completed",
      operation,
      summary:
        typeof data.summary === "string" && data.summary
          ? data.summary
          : typeof data.output_preview === "string" && data.output_preview
            ? data.output_preview
            : "Workspace activity updated.",
      relative_path: relativePath,
      directory_path: directoryPath,
      target_kind: operation === "list_files" ? "dir" : relativePath ? "file" : "workspace",
      entry_paths: entryPaths,
      agent_key: typeof data.agent_key === "string" ? data.agent_key : undefined,
      agent_name: typeof data.agent_name === "string" ? data.agent_name : undefined,
      step_index: typeof data.step_index === "number" ? data.step_index : undefined
    };
  }

  return null;
}

function mergeWorkbenchActivities(
  current: WorkbenchFileActivity[],
  next: WorkbenchFileActivity
) {
  const dedupeKey = [
    next.operation,
    next.relative_path ?? "",
    next.directory_path ?? "",
    next.summary,
    next.agent_key ?? "",
    String(next.step_index ?? "")
  ].join("::");

  const filtered = current.filter((item) => {
    const itemKey = [
      item.operation,
      item.relative_path ?? "",
      item.directory_path ?? "",
      item.summary,
      item.agent_key ?? "",
      String(item.step_index ?? "")
    ].join("::");
    return itemKey !== dedupeKey;
  });
  return [next, ...filtered].slice(0, 18);
}

function mergeArtifacts(current: ToolArtifactRef[], next: ToolArtifactRef[]) {
  return dedupeArtifacts([...next, ...current]);
}

function extractArtifactsFromToolResult(value: unknown): ToolArtifactRef[] {
  if (!isRecord(value)) {
    return [];
  }
  return dedupeArtifacts([
    ...toToolArtifacts(value.artifacts),
    ...toToolArtifacts(value.artifact),
    ...toToolArtifacts(value.outbox),
    ...(isRecord(value.audit) ? toToolArtifacts(value.audit.artifacts) : [])
  ]);
}

function normalizeLinks(value: unknown): { text: string; url: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      if (typeof item.url !== "string") {
        return null;
      }
      return {
        text: typeof item.text === "string" ? item.text : item.url,
        url: item.url
      };
    })
    .filter((item): item is { text: string; url: string } => Boolean(item));
}

function normalizeActions(
  value: unknown
): { kind: string; selector: string; value?: string | null; status?: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      if (typeof item.kind !== "string" || typeof item.selector !== "string") {
        return null;
      }
      return {
        kind: item.kind,
        selector: item.selector,
        value: typeof item.value === "string" ? item.value : null,
        status: typeof item.status === "string" ? item.status : undefined
      };
    })
    .filter(isDefined);
}

async function consumeEventStream(
  response: Response,
  onEvent: (event: LiveRunEvent) => void
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming response body is unavailable.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      let event = "message";
      const dataLines: string[] = [];

      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }

      if (!dataLines.length) {
        continue;
      }

      onEvent({
        event,
        data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>
      });
    }
  }
}

function upsertThread(threads: Thread[], thread: Thread) {
  const existing = threads.find((item) => item.id === thread.id);
  if (!existing) {
    return [thread, ...threads];
  }

  return threads
    .map((item) => (item.id === thread.id ? { ...item, ...thread } : item))
    .sort((left, right) => {
      const leftAt = left.last_activity_at ?? left.updated_at;
      const rightAt = right.last_activity_at ?? right.updated_at;
      return rightAt.localeCompare(leftAt);
    });
}

function upsertLiveStep(steps: LiveRunStepState[], next: LiveRunStepState) {
  const existing = steps.find((step) => step.step_index === next.step_index);
  if (!existing) {
    return [...steps, next].sort(
      (left, right) => left.batch_index - right.batch_index || left.step_index - right.step_index
    );
  }

  return steps
    .map((step) =>
      step.step_index === next.step_index
        ? {
            ...step,
            ...next,
            dependencies: next.dependencies.length ? next.dependencies : step.dependencies
          }
        : step
    )
    .sort((left, right) => left.batch_index - right.batch_index || left.step_index - right.step_index);
}

function provisionalThread(workspaceId: string, title: string, projectId?: string | null): Thread {
  const now = new Date().toISOString();
  return {
    id: `local-thread-${Date.now()}`,
    workspace_id: workspaceId,
    project_id: projectId ?? null,
    title,
    status: "active",
    metadata: {},
    created_at: now,
    updated_at: now,
    message_count: 0,
    run_count: 0,
    last_message_preview: null,
    last_activity_at: now
  };
}

function buildBrowserSessionFromToolCall(toolCall: ToolCallRecord): ComputerSession | null {
  const payload = toolCall.output_payload;
  if (!isRecord(payload) || String(payload.tool ?? toolCall.tool_name) !== "browser_automation") {
    return null;
  }

  return {
    session_id: `persisted-browser-${toolCall.id}`,
    session_kind: "browser",
    tool: "browser_automation",
    status: String(payload.status ?? toolCall.status),
    created_at: toolCall.created_at,
    updated_at: toolCall.created_at,
    target_url: typeof payload.target_url === "string" ? payload.target_url : null,
    final_url: typeof payload.final_url === "string" ? payload.final_url : null,
    page_title: typeof payload.page_title === "string" ? payload.page_title : null,
    action_mode: typeof payload.action_mode === "string" ? payload.action_mode : null,
    executed_actions: normalizeActions(payload.executed_actions),
    skipped_actions: normalizeActions(payload.skipped_actions),
    headings: toStringArray(payload.headings),
    links: normalizeLinks(payload.links),
    extracted_text: typeof payload.extracted_text === "string" ? payload.extracted_text : null,
    warnings: toStringArray(payload.warnings),
    artifacts: extractArtifactsFromToolResult(payload),
    metrics: isRecord(payload.metrics) ? payload.metrics : undefined
  };
}

function buildTerminalSessionFromToolCall(toolCall: ToolCallRecord): ComputerSession | null {
  const payload = toolCall.output_payload;
  if (!isRecord(payload) || String(payload.tool ?? toolCall.tool_name) !== "python_sandbox") {
    return null;
  }

  return {
    session_id: `persisted-terminal-${toolCall.id}`,
    session_kind: "terminal",
    tool: "python_sandbox",
    status: String(payload.status ?? toolCall.status),
    created_at: toolCall.created_at,
    updated_at: toolCall.created_at,
    command: toStringArray(payload.command),
    stdout: typeof payload.stdout === "string" ? payload.stdout : null,
    stderr: typeof payload.stderr === "string" ? payload.stderr : null,
    returncode:
      typeof payload.returncode === "number"
        ? payload.returncode
        : typeof payload.returncode === "string"
          ? Number(payload.returncode)
          : null,
    timed_out: Boolean(payload.timed_out),
    artifacts: extractArtifactsFromToolResult(payload)
  };
}

function persistedTimelineEntry(toolCall: ToolCallRecord, stepById: Map<string, RunStepRecord>): OperatorTimelineEntry {
  const step = stepById.get(toolCall.run_step_id);
  const payload = toolCall.output_payload;
  const title = step
    ? `${step.agent_name} used ${formatToolName(toolCall.tool_name)}`
    : `Tool call: ${formatToolName(toolCall.tool_name)}`;
  let summary = `${formatToolName(toolCall.tool_name)} ${toolCall.status}`;

  if (isRecord(payload)) {
    if (toolCall.tool_name === "browser_automation") {
      summary = compactText(
        typeof payload.final_url === "string"
          ? payload.final_url
          : typeof payload.target_url === "string"
            ? payload.target_url
            : "Browser session captured."
      );
    } else if (toolCall.tool_name === "python_sandbox") {
      summary = compactText(
        typeof payload.stdout === "string"
          ? payload.stdout
          : typeof payload.stderr === "string"
            ? payload.stderr
            : summary
      );
    } else if (typeof payload.operation === "string") {
      summary = `${formatToolName(String(payload.operation))} ${toolCall.status}`;
    }
  }

  return {
    id: `persisted-tool-${toolCall.id}`,
    created_at: toolCall.created_at,
    kind: "tool",
    title,
    status: toolCall.status,
    summary,
    tool: toolCall.tool_name,
    agent_name: step?.agent_name,
    meta: [
      step ? `step ${step.step_index + 1}` : "persisted",
      step?.status ? statusLabel(step.status) : "completed"
    ]
  };
}

function sessionFromEventData(data: Record<string, unknown>): ComputerSession | null {
  const sessionKind = data.session_kind;
  const sessionId = data.session_id;
  if ((sessionKind !== "browser" && sessionKind !== "terminal") || typeof sessionId !== "string") {
    return null;
  }
  const now = new Date().toISOString();
  return {
    session_id: sessionId,
    session_kind: sessionKind,
    tool: typeof data.tool === "string" ? data.tool : "tool",
    status: typeof data.status === "string" ? data.status : "running",
    agent_key: typeof data.agent_key === "string" ? data.agent_key : undefined,
    agent_name: typeof data.agent_name === "string" ? data.agent_name : undefined,
    step_index: typeof data.step_index === "number" ? data.step_index : undefined,
    batch_index: typeof data.batch_index === "number" ? data.batch_index : undefined,
    created_at: now,
    updated_at: now,
    target_url: typeof data.target_url === "string" ? data.target_url : null,
    final_url: typeof data.final_url === "string" ? data.final_url : null,
    page_title: typeof data.page_title === "string" ? data.page_title : null,
    action_mode: typeof data.action_mode === "string" ? data.action_mode : null,
    executed_actions: normalizeActions(data.executed_actions),
    skipped_actions: normalizeActions(data.skipped_actions),
    headings: toStringArray(data.headings),
    links: normalizeLinks(data.links),
    extracted_text: typeof data.extracted_text === "string" ? data.extracted_text : null,
    warnings: toStringArray(data.warnings),
    artifacts: toToolArtifacts(data.artifacts),
    metrics: isRecord(data.metrics) ? data.metrics : undefined,
    command: toStringArray(data.command),
    stdout: typeof data.stdout === "string" ? data.stdout : null,
    stderr: typeof data.stderr === "string" ? data.stderr : null,
    stdout_delta: typeof data.stdout_delta === "string" ? data.stdout_delta : null,
    stderr_delta: typeof data.stderr_delta === "string" ? data.stderr_delta : null,
    phase: typeof data.phase === "string" ? data.phase : null,
    stream: typeof data.stream === "string" ? data.stream : null,
    returncode:
      typeof data.returncode === "number"
        ? data.returncode
        : typeof data.returncode === "string"
          ? Number(data.returncode)
          : null,
    timed_out: Boolean(data.timed_out)
  };
}

function upsertSessionState(
  sessions: Record<string, ComputerSession>,
  next: ComputerSession
) {
  const existing = sessions[next.session_id];
  if (!existing) {
    return {
      ...sessions,
      [next.session_id]: {
        ...next,
        stdout: next.stdout ?? next.stdout_delta ?? null,
        stderr: next.stderr ?? next.stderr_delta ?? null
      }
    };
  }
  const mergedStdout = next.stdout_delta
    ? `${existing.stdout ?? ""}${next.stdout_delta}`
    : next.stdout ?? existing.stdout;
  const mergedStderr = next.stderr_delta
    ? `${existing.stderr ?? ""}${next.stderr_delta}`
    : next.stderr ?? existing.stderr;
  return {
    ...sessions,
    [next.session_id]: {
      ...existing,
      ...next,
      created_at: existing.created_at,
      updated_at: next.updated_at,
      executed_actions:
        (next.executed_actions?.length ?? 0) > 0
          ? next.executed_actions
          : existing.executed_actions,
      skipped_actions:
        (next.skipped_actions?.length ?? 0) > 0
          ? next.skipped_actions
          : existing.skipped_actions,
      headings: (next.headings?.length ?? 0) > 0 ? next.headings : existing.headings,
      links: (next.links?.length ?? 0) > 0 ? next.links : existing.links,
      extracted_text: next.extracted_text || existing.extracted_text,
      warnings: [...new Set([...(existing.warnings ?? []), ...(next.warnings ?? [])])],
      artifacts: mergeArtifacts(existing.artifacts ?? [], next.artifacts ?? []),
      command: (next.command?.length ?? 0) > 0 ? next.command : existing.command,
      stdout: mergedStdout,
      stderr: mergedStderr,
      returncode: next.returncode ?? existing.returncode,
      timed_out: next.timed_out ?? existing.timed_out
    }
  };
}

function timelineEntryFromStream(event: string, data: Record<string, unknown>): OperatorTimelineEntry | null {
  const now = new Date().toISOString();
  if (event === "tool.started") {
    return {
      id: `tool-started-${now}-${Math.random()}`,
      created_at: now,
      kind: "tool",
      title: `${typeof data.agent_name === "string" ? data.agent_name : "Agent"} started ${formatToolName(String(data.tool ?? "tool"))}`,
      status: String(data.status ?? "running"),
      tool: String(data.tool ?? "tool")
    };
  }
  if (event === "tool.completed") {
    return {
      id: `tool-completed-${now}-${Math.random()}`,
      created_at: now,
      kind: "tool",
      title: `${typeof data.agent_name === "string" ? data.agent_name : "Agent"} completed ${formatToolName(String(data.tool ?? "tool"))}`,
      status: String(data.status ?? "completed"),
      tool: String(data.tool ?? "tool"),
      summary: typeof data.summary === "string" ? data.summary : undefined
    };
  }
  if (event === "tool.output") {
    return {
      id: `tool-output-${now}-${Math.random()}`,
      created_at: now,
      kind: "tool",
      title: `${typeof data.agent_name === "string" ? data.agent_name : "Agent"} streamed ${formatToolName(String(data.tool ?? "tool"))} output`,
      status: String(data.status ?? "completed"),
      tool: String(data.tool ?? "tool"),
      summary:
        typeof data.output_preview === "string"
          ? data.output_preview
          : typeof data.summary === "string"
            ? data.summary
            : undefined
    };
  }
  if (event === "artifact.created") {
    const artifacts = toToolArtifacts(data.artifact);
    const artifact = artifacts[0];
    if (!artifact) {
      return null;
    }
    return {
      id: `artifact-${artifact.storage_key}`,
      created_at: now,
      kind: "artifact",
      title: artifactLabel(artifact),
      status: String(data.status ?? "completed"),
      artifact,
      tool: typeof data.tool === "string" ? data.tool : undefined,
      summary: `${formatToolName(String(data.tool ?? "tool"))} produced a new artifact.`
    };
  }
  if (event === "browser.snapshot") {
    return {
      id: `browser-snapshot-${String(data.session_id ?? now)}-${Math.random()}`,
      created_at: now,
      kind: "session",
      title:
        typeof data.page_title === "string" && data.page_title
          ? data.page_title
          : "Browser snapshot",
      status: String(data.status ?? "running"),
      tool: typeof data.tool === "string" ? data.tool : "browser_automation",
      session_kind: "browser",
      summary:
        typeof data.final_url === "string"
          ? data.final_url
          : typeof data.target_url === "string"
            ? data.target_url
            : typeof data.extracted_text === "string"
              ? compactText(data.extracted_text, 120)
              : undefined
    };
  }
  if (event === "workspace.activity") {
    const relativePath = typeof data.relative_path === "string" ? data.relative_path : null;
    const directoryPath = typeof data.directory_path === "string" ? data.directory_path : null;
    return {
      id: `workspace-activity-${now}-${Math.random()}`,
      created_at: now,
      kind: "tool",
      title:
        typeof data.agent_name === "string"
          ? `${data.agent_name} ${formatToolName(String(data.operation ?? "workspace activity"))}`
          : `Workspace ${formatToolName(String(data.operation ?? "activity"))}`,
      status: String(data.status ?? "completed"),
      tool: "workspace_files",
      summary:
        typeof data.summary === "string"
          ? data.summary
          : relativePath || directoryPath || undefined,
      meta: [
        relativePath ?? directoryPath ?? "workspace",
        typeof data.target_kind === "string" ? data.target_kind : "workspace"
      ]
    };
  }
  if (event === "terminal.stdout" || event === "terminal.stderr") {
    return null;
  }
  if (
    event === "computer.session.started" ||
    event === "computer.session.completed" ||
    event === "computer.session.failed"
  ) {
    return {
      id: `session-${String(data.session_id ?? now)}-${event}`,
      created_at: now,
      kind: "session",
      title:
        data.session_kind === "terminal"
          ? "Terminal session"
          : typeof data.page_title === "string" && data.page_title
            ? data.page_title
            : "Browser session",
      status: String(data.status ?? "running"),
      tool: typeof data.tool === "string" ? data.tool : undefined,
      session_kind: data.session_kind === "terminal" ? "terminal" : "browser",
      summary:
        typeof data.final_url === "string"
          ? data.final_url
          : typeof data.target_url === "string"
            ? data.target_url
            : typeof data.stdout === "string" && data.stdout
              ? compactText(data.stdout, 120)
              : undefined
    };
  }
  if (event === "computer.session.updated") {
    if (
      data.session_kind === "terminal" &&
      (typeof data.stdout_delta === "string" || typeof data.stderr_delta === "string")
    ) {
      return null;
    }
    const phase = typeof data.phase === "string" ? data.phase : "updated";
    const action = isRecord(data.executed_action) ? data.executed_action : null;
    return {
      id: `session-update-${now}-${Math.random()}`,
      created_at: now,
      kind: "session",
      title:
        action && typeof action.kind === "string"
          ? `${formatToolName(action.kind)} ${typeof action.selector === "string" ? action.selector : ""}`.trim()
          : `Computer ${phase}`,
      status: String(data.status ?? "running"),
      tool: typeof data.tool === "string" ? data.tool : undefined,
      session_kind: data.session_kind === "terminal" ? "terminal" : "browser",
      summary:
        typeof data.final_url === "string"
          ? data.final_url
          : typeof data.target_url === "string"
            ? data.target_url
            : undefined
    };
  }
  return null;
}

function sessionSort(left: ComputerSession, right: ComputerSession) {
  return right.updated_at.localeCompare(left.updated_at);
}

function timelineSort(left: OperatorTimelineEntry, right: OperatorTimelineEntry) {
  return right.created_at.localeCompare(left.created_at);
}

function workbenchDownloadHref(workspaceId: string, relativePath: string) {
  const query = new URLSearchParams({
    workspace_id: workspaceId,
    relative_path: relativePath
  });
  return `/api/chat/workbench/download?${query.toString()}`;
}

function formatBytes(sizeBytes: number | null | undefined) {
  if (!sizeBytes || Number.isNaN(sizeBytes)) {
    return "Unknown size";
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeWorkbenchFilePayload(
  payload: Partial<ChatWorkbenchFileData>,
  workspaceId: string,
  fallbackRelativePath: string,
  fallbackRootLabel = "Workspace"
): ChatWorkbenchFileData {
  return {
    workspace_id: String(payload.workspace_id ?? workspaceId),
    root_label: String(payload.root_label ?? fallbackRootLabel),
    relative_path: String(payload.relative_path ?? fallbackRelativePath),
    name: String(payload.name ?? fallbackRelativePath.split("/").pop() ?? fallbackRelativePath),
    extension: typeof payload.extension === "string" ? payload.extension : null,
    size_bytes: Number(payload.size_bytes ?? 0),
    truncated: Boolean(payload.truncated),
    content: String(payload.content ?? "")
  };
}

function workbenchStatusTone(status: string | null | undefined) {
  if (status === "modified") {
    return "bg-amber-100 text-amber-900";
  }
  if (status === "added" || status === "untracked") {
    return "bg-emerald-100 text-emerald-900";
  }
  if (status === "deleted") {
    return "bg-red-100 text-red-900";
  }
  if (status === "renamed") {
    return "bg-sky-100 text-sky-900";
  }
  return "bg-black/[0.05] text-black/[0.62]";
}

function preferredWorkbenchFile(entries: WorkbenchTreeEntry[]) {
  const preferred = ["README.md", "todo.md", "package.json", "pnpm-lock.yaml", "Makefile"];
  return (
    entries.find((entry) => entry.kind === "file" && preferred.includes(entry.relative_path)) ??
    entries.find((entry) => entry.kind === "file") ??
    null
  );
}

function isChecklistCapableFile(relativePath: string | null | undefined) {
  if (!relativePath) {
    return false;
  }
  return /\.(md|mdx|txt)$/i.test(relativePath);
}

function isTodoCandidateFile(relativePath: string | null | undefined) {
  if (!relativePath || !isChecklistCapableFile(relativePath)) {
    return false;
  }
  return /(^|\/)(todo|tasks?|checklist|plan)([-_.].+)?\.(md|mdx|txt)$/i.test(relativePath);
}

function parentRelativePath(relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return ".";
  }
  return segments.slice(0, -1).join("/");
}

function checklistToneClass(status: string) {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (status === "running" || status === "escalating") {
    return "border-sky-200 bg-sky-50 text-sky-900";
  }
  if (status === "failed") {
    return "border-red-200 bg-red-50 text-red-900";
  }
  return "border-black/10 bg-white/75 text-black/70";
}

function checklistDotClass(status: string) {
  if (status === "completed") {
    return "bg-emerald-600";
  }
  if (status === "running" || status === "escalating") {
    return "bg-sky-600";
  }
  if (status === "failed") {
    return "bg-red-700";
  }
  return "bg-black/20";
}

function buildTaskChecklistItems(
  plan: LivePlanStep[],
  liveSteps: LiveRunStepState[],
  runSteps: RunStepRecord[],
  latestRunId?: string | null
) {
  const liveByIndex = new Map(liveSteps.map((step) => [step.step_index, step]));
  const persistedByIndex = new Map<number, RunStepRecord>();
  for (const step of runSteps) {
    if (latestRunId && step.run_id !== latestRunId) {
      continue;
    }
    if (!persistedByIndex.has(step.step_index)) {
      persistedByIndex.set(step.step_index, step);
    }
  }

  if (plan.length > 0) {
    return plan.map<TaskChecklistItem>((item, index) => {
      const stepIndex = item.plan_index ?? index;
      const live = liveByIndex.get(stepIndex);
      const persisted = persistedByIndex.get(stepIndex);
      const outputPayload =
        persisted && isRecord(persisted.output_payload) ? persisted.output_payload : {};
      const validation =
        isRecord(outputPayload.validation) ? outputPayload.validation : null;
      const status = live?.status ?? persisted?.status ?? "queued";
      const summary = compactText(
        live?.summary ??
          live?.validation_summary ??
          (typeof outputPayload.content === "string"
            ? outputPayload.content
            : typeof outputPayload.summary === "string"
              ? outputPayload.summary
              : validation && typeof validation.summary === "string"
                ? validation.summary
                : item.reason || item.expected_output || item.objective || ""),
        220
      );

      return {
        id: `${item.key}-${stepIndex}`,
        step_index: stepIndex,
        title: item.objective || item.expected_output || item.key || `Step ${stepIndex + 1}`,
        status,
        completed: status === "completed",
        summary,
        agent_name: live?.agent_name ?? persisted?.agent_name ?? item.key,
        execution_mode:
          live?.execution_mode ||
          (typeof outputPayload.execution_mode === "string" ? outputPayload.execution_mode : "") ||
          item.execution_mode,
        dependencies:
          live?.dependencies.length
            ? live.dependencies
            : Array.isArray(outputPayload.dependencies)
              ? outputPayload.dependencies.map(String)
              : item.dependencies ?? []
      };
    });
  }

  return runSteps
    .filter((step) => !latestRunId || step.run_id === latestRunId)
    .sort((left, right) => left.step_index - right.step_index)
    .map<TaskChecklistItem>((step) => {
      const outputPayload = isRecord(step.output_payload) ? step.output_payload : {};
      const validation = isRecord(outputPayload.validation) ? outputPayload.validation : null;
      return {
        id: `${step.run_id}-${step.step_index}`,
        step_index: step.step_index,
        title:
          (typeof outputPayload.expected_output === "string" && outputPayload.expected_output) ||
          step.agent_name ||
          `Step ${step.step_index + 1}`,
        status: step.status,
        completed: step.status === "completed",
        summary: compactText(
          typeof outputPayload.content === "string"
            ? outputPayload.content
            : typeof outputPayload.summary === "string"
              ? outputPayload.summary
              : validation && typeof validation.summary === "string"
                ? validation.summary
                : "",
          220
        ),
        agent_name: step.agent_name,
        execution_mode:
          typeof outputPayload.execution_mode === "string" ? outputPayload.execution_mode : undefined,
        dependencies: Array.isArray(outputPayload.dependencies)
          ? outputPayload.dependencies.map(String)
          : []
      };
    });
}

function buildWorkbenchTreeFromToolResult(
  result: Record<string, unknown>,
  workspaceId: string
): ChatWorkbenchTreeData | null {
  if (String(result.operation ?? "") !== "list_files" || !Array.isArray(result.entries)) {
    return null;
  }

  const path = typeof result.relative_path === "string" && result.relative_path ? result.relative_path : ".";
  const normalizedPath = path === "" ? "." : path;
  const entries = result.entries
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.relative_path !== "string" || typeof entry.name !== "string") {
        return null;
      }
      return {
        name: entry.name,
        relative_path: entry.relative_path,
        kind: entry.kind === "dir" ? "dir" : "file",
        extension: typeof entry.extension === "string" ? entry.extension : null,
        size_bytes:
          typeof entry.size_bytes === "number"
            ? entry.size_bytes
            : typeof entry.size_bytes === "string"
              ? Number(entry.size_bytes)
              : null
      } satisfies WorkbenchTreeEntry;
    })
    .filter(isDefined)
    .sort((left, right) => Number(left.kind !== "dir") - Number(right.kind !== "dir") || left.name.localeCompare(right.name));

  const parentRelativePath =
    normalizedPath === "." ? null : normalizedPath.split("/").slice(0, -1).join("/") || ".";

  return {
    workspace_id: workspaceId,
    root_label: "Workspace",
    relative_path: normalizedPath,
    parent_relative_path: parentRelativePath,
    entries
  };
}

function buildWorkbenchFileFromToolResult(
  result: Record<string, unknown>,
  workspaceId: string
): ChatWorkbenchFileData | null {
  if (String(result.operation ?? "") !== "read_text" || typeof result.relative_path !== "string") {
    return null;
  }

  return {
    workspace_id: workspaceId,
    root_label: "Workspace",
    relative_path: result.relative_path,
    name: typeof result.name === "string" ? result.name : result.relative_path.split("/").pop() ?? result.relative_path,
    extension: typeof result.extension === "string" ? result.extension : null,
    size_bytes:
      typeof result.size_bytes === "number"
        ? result.size_bytes
        : typeof result.size_bytes === "string"
          ? Number(result.size_bytes)
          : 0,
    truncated: Boolean(result.truncated),
    content: typeof result.content === "string" ? result.content : ""
  };
}

export function ChatWorkspace({
  data,
  initialWorkbenchTree,
  initialWorkbenchFile,
  taskTemplates = []
}: {
  data: ChatWorkspaceData;
  initialWorkbenchTree?: ChatWorkbenchTreeData | null;
  initialWorkbenchFile?: ChatWorkbenchFileData | null;
  taskTemplates?: TaskTemplate[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [threads, setThreads] = useState(data.threads);
  const [selectedProject, setSelectedProject] = useState(data.selected_project ?? null);
  const [taskMemory, setTaskMemory] = useState<SharedMemory | null>(data.task_memory ?? null);
  const [projectMemory, setProjectMemory] = useState<SharedMemory | null>(data.project_memory ?? null);
  const [liveApprovalRequests, setLiveApprovalRequests] = useState<ApprovalRequest[]>([]);
  const [messages, setMessages] = useState(data.messages);
  const [runs, setRuns] = useState(data.runs);
  const [runSteps, setRunSteps] = useState(data.run_steps ?? []);
  const [toolCalls, setToolCalls] = useState(data.tool_calls ?? []);
  const [draft, setDraft] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [selectedComposerShortcutKeys, setSelectedComposerShortcutKeys] = useState<string[]>([]);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composerUploading, setComposerUploading] = useState(false);
  const [urlAttachmentDraft, setUrlAttachmentDraft] = useState("");
  const [showComposerAttachments, setShowComposerAttachments] = useState(false);
  const [showComposerShortcuts, setShowComposerShortcuts] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceInterimTranscript, setVoiceInterimTranscript] = useState("");
  const [voiceCapturedInDraft, setVoiceCapturedInDraft] = useState(false);
  const [voiceEngine, setVoiceEngine] = useState<string | null>(null);
  const [selectedTaskTemplateKey, setSelectedTaskTemplateKey] = useState<string | null>(() => {
    const selectedThread =
      data.threads.find((thread) => thread.id === data.selected_thread_id) ?? data.threads[0] ?? null;
    const metadata = isRecord(selectedThread?.metadata) ? selectedThread.metadata : {};
    return typeof metadata.selected_template_key === "string" ? metadata.selected_template_key : null;
  });
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [livePlan, setLivePlan] = useState<LivePlanStep[]>([]);
  const [executionBatches, setExecutionBatches] = useState<string[][]>([]);
  const [liveSteps, setLiveSteps] = useState<LiveRunStepState[]>([]);
  const [activeBatchIndex, setActiveBatchIndex] = useState<number | null>(null);
  const [operatorTab, setOperatorTab] = useState<OperatorTab>("computer");
  const [liveTimeline, setLiveTimeline] = useState<OperatorTimelineEntry[]>([]);
  const [liveSessions, setLiveSessions] = useState<Record<string, ComputerSession>>({});
  const [liveArtifacts, setLiveArtifacts] = useState<ToolArtifactRef[]>([]);
  const [liveWorkbenchActivities, setLiveWorkbenchActivities] = useState<WorkbenchFileActivity[]>([]);
  const [selectedBrowserSessionId, setSelectedBrowserSessionId] = useState<string | null>(null);
  const [selectedTerminalSessionId, setSelectedTerminalSessionId] = useState<string | null>(null);
  const [selectedPreviewStorageKey, setSelectedPreviewStorageKey] = useState<string | null>(null);
  const [terminalStreamMode, setTerminalStreamMode] = useState<TerminalStreamMode>("combined");
  const [terminalFollowOutput, setTerminalFollowOutput] = useState(true);
  const [computerNotice, setComputerNotice] = useState<string | null>(null);
  const [computerError, setComputerError] = useState<string | null>(null);
  const [workbenchTree, setWorkbenchTree] = useState<Record<string, ChatWorkbenchTreeData>>(() =>
    initialWorkbenchTree ? { [initialWorkbenchTree.relative_path]: initialWorkbenchTree } : {}
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>(() => ({
    [initialWorkbenchTree?.relative_path ?? "."]: true
  }));
  const [workbenchEditors, setWorkbenchEditors] = useState<Record<string, WorkbenchEditorState>>(() =>
    initialWorkbenchFile
      ? {
          [initialWorkbenchFile.relative_path]: {
            file: initialWorkbenchFile,
            originalContent: initialWorkbenchFile.content,
            draftContent: initialWorkbenchFile.content,
            savedAt: null
          }
        }
      : {}
  );
  const [workbenchTabPaths, setWorkbenchTabPaths] = useState<string[]>(() =>
    initialWorkbenchFile ? [initialWorkbenchFile.relative_path] : []
  );
  const [selectedWorkbenchPath, setSelectedWorkbenchPath] = useState<string | null>(
    initialWorkbenchFile?.relative_path ?? null
  );
  const [workbenchLoadingPath, setWorkbenchLoadingPath] = useState<string | null>(null);
  const [workbenchError, setWorkbenchError] = useState<string | null>(null);
  const [workbenchSavePath, setWorkbenchSavePath] = useState<string | null>(null);
  const [workbenchNotice, setWorkbenchNotice] = useState<string | null>(null);
  const [workbenchViewMode, setWorkbenchViewMode] = useState<WorkbenchViewMode>("edit");
  const [repoState, setRepoState] = useState<ChatWorkbenchRepoData | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoDiff, setRepoDiff] = useState<ChatWorkbenchDiffData | null>(null);
  const [repoDiffLoadingPath, setRepoDiffLoadingPath] = useState<string | null>(null);
  const [todoSyncPath, setTodoSyncPath] = useState<string>("todo.md");
  const [todoSyncing, setTodoSyncing] = useState(false);
  const [todoSyncError, setTodoSyncError] = useState<string | null>(null);
  const [todoSyncNotice, setTodoSyncNotice] = useState<string | null>(null);
  const [headerPanel, setHeaderPanel] = useState<HeaderPanel>(null);
  const [headerActionLoading, setHeaderActionLoading] = useState<string | null>(null);
  const [approvalActionLoading, setApprovalActionLoading] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [headerNotice, setHeaderNotice] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [threadStatusDraft, setThreadStatusDraft] = useState("active");
  const [isDesktopWorkspace, setIsDesktopWorkspace] = useState(false);
  const [workspacePaneWidth, setWorkspacePaneWidth] = useState(DEFAULT_WORKSPACE_SPLIT);
  const [workspacePaneCollapsed, setWorkspacePaneCollapsed] = useState(false);
  const [operatorPaneCollapsed, setOperatorPaneCollapsed] = useState(false);
  const [workbenchExpanded, setWorkbenchExpanded] = useState(false);
  const [isResizingWorkspace, setIsResizingWorkspace] = useState(false);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(
    data.selected_thread_id ?? data.threads[0]?.id ?? null
  );
  const workspaceShellRef = useRef<HTMLElement | null>(null);
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const copiedMessageTimeoutRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognitionLike | null>(null);
  const autoCreateMarker = useRef<string | null>(null);
  const terminalOutputRef = useRef<HTMLDivElement | null>(null);
  const repoRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createThreadActionRef = useRef<(() => Promise<void>) | null>(null);
  const fetchWorkbenchDirectoryRef = useRef<((relativePath?: string, options?: { force?: boolean }) => Promise<ChatWorkbenchTreeData | null>) | null>(null);
  const fetchWorkbenchRepoStateRef = useRef<((options?: { force?: boolean }) => Promise<ChatWorkbenchRepoData | null>) | null>(null);
  const openWorkbenchFileRef = useRef<((relativePath: string) => Promise<void>) | null>(null);
  const searchParamKey = searchParams.toString();
  const wantsNewTask = searchParams.get("new") === "1";
  const workspaceId = data.workspace_id;
  const currentProjectId = searchParams.get("project");
  const prefersReducedMotion = useReducedMotion();

  const displayedPlan = useMemo(() => {
    if (livePlan.length > 0) {
      return livePlan;
    }
    return ((runs[0]?.plan ?? []) as LivePlanStep[]) ?? [];
  }, [livePlan, runs]);

  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const latestRun = runs[0] ?? null;
  const activeThread = useMemo(() => {
    if (currentThreadId) {
      return threads.find((thread) => thread.id === currentThreadId) ?? null;
    }
    if (currentProjectId) {
      return null;
    }
    return threads[0] ?? null;
  }, [currentProjectId, currentThreadId, threads]);
  const activeThreadMetadata = isRecord(activeThread?.metadata) ? activeThread.metadata : {};
  const activeThreadTitle = activeThread?.title ?? "";
  const activeThreadStatus = activeThread?.status ?? "active";
  const activeThreadSelectedTemplateKey =
    typeof activeThreadMetadata.selected_template_key === "string"
      ? activeThreadMetadata.selected_template_key
      : null;
  const approvalResolutions = useMemo(
    () => toApprovalResolutions(activeThreadMetadata.approval_resolutions),
    [activeThreadMetadata.approval_resolutions]
  );
  const approvalResolutionMap = useMemo(
    () => new Map(approvalResolutions.map((item) => [item.approval_id, item])),
    [approvalResolutions]
  );
  const activeTaskMemory = useMemo(
    () => taskMemory ?? toSharedMemory(activeThreadMetadata.shared_memory),
    [activeThreadMetadata.shared_memory, taskMemory]
  );
  const activeProjectMemory = useMemo(() => {
    if (projectMemory) {
      return projectMemory;
    }
    const selectedProjectMetadata = isRecord(selectedProject?.metadata) ? selectedProject.metadata : {};
    return toSharedMemory(selectedProjectMetadata.shared_memory);
  }, [projectMemory, selectedProject]);
  const sharedTaskMemorySections = useMemo(
    () => buildSharedMemorySections(activeTaskMemory),
    [activeTaskMemory]
  );
  const sharedProjectMemorySections = useMemo(
    () => buildSharedMemorySections(activeProjectMemory),
    [activeProjectMemory]
  );
  const selectedModelProfile =
    typeof activeThreadMetadata.model_profile === "string"
      ? activeThreadMetadata.model_profile
      : MODEL_PROFILE_OPTIONS[0].value;
  const selectedTaskTemplate = useMemo(
    () => taskTemplates.find((template) => template.key === selectedTaskTemplateKey) ?? null,
    [selectedTaskTemplateKey, taskTemplates]
  );
  const selectedComposerShortcuts = useMemo(
    () =>
      selectedComposerShortcutKeys
        .map((key) => COMPOSER_SHORTCUTS.find((shortcut) => shortcut.key === key) ?? null)
        .filter((shortcut): shortcut is ComposerShortcut => Boolean(shortcut)),
    [selectedComposerShortcutKeys]
  );
  const collaboratorList = Array.isArray(activeThreadMetadata.collaborators)
    ? activeThreadMetadata.collaborators.map(String)
    : [];
  const publishState = Boolean(activeThreadMetadata.published);
  const shareEnabled = activeThreadMetadata.share_enabled !== false;
  const isTaskPaused = activeThread?.status === "paused";
  const stepsByAgent = useMemo(
    () => Object.fromEntries(liveSteps.map((step) => [step.agent_key, step])),
    [liveSteps]
  );
  const runStepById = useMemo(
    () => new Map(runSteps.map((step) => [step.id, step])),
    [runSteps]
  );

  const persistedSessions = useMemo(() => {
    const sessions: ComputerSession[] = [];
    for (const toolCall of toolCalls) {
      const browserSession = buildBrowserSessionFromToolCall(toolCall);
      if (browserSession) {
        sessions.push(browserSession);
      }
      const terminalSession = buildTerminalSessionFromToolCall(toolCall);
      if (terminalSession) {
        sessions.push(terminalSession);
      }
    }
    return sessions.sort(sessionSort);
  }, [toolCalls]);

  const persistedTimeline = useMemo(
    () => toolCalls.map((toolCall) => persistedTimelineEntry(toolCall, runStepById)).sort(timelineSort),
    [runStepById, toolCalls]
  );

  const persistedArtifacts = useMemo(
    () =>
      dedupeArtifacts(
        toolCalls.flatMap((toolCall) => extractArtifactsFromToolResult(toolCall.output_payload))
      ),
    [toolCalls]
  );
  const persistedApprovalRequests = useMemo(
    () =>
      toolCalls
        .map((toolCall) => approvalRequestFromToolCall(toolCall, runStepById))
        .filter((item): item is ApprovalRequest => Boolean(item)),
    [runStepById, toolCalls]
  );
  const pendingApprovalRequests = useMemo(() => {
    const merged = [...liveApprovalRequests, ...persistedApprovalRequests];
    const deduped: ApprovalRequest[] = [];
    for (const request of merged) {
      const resolved = approvalResolutionMap.get(request.id);
      if (resolved && resolved.status === "approved") {
        continue;
      }
      if (deduped.some((item) => item.id === request.id)) {
        continue;
      }
      deduped.push(request);
    }
    return deduped.slice(0, 6);
  }, [approvalResolutionMap, liveApprovalRequests, persistedApprovalRequests]);

  const mergedTimeline = useMemo(
    () => [...liveTimeline, ...persistedTimeline].sort(timelineSort),
    [liveTimeline, persistedTimeline]
  );

  const mergedArtifacts = useMemo(
    () => dedupeArtifacts([...liveArtifacts, ...persistedArtifacts]),
    [liveArtifacts, persistedArtifacts]
  );

  const activeSessions = useMemo(
    () => Object.values(liveSessions).sort(sessionSort),
    [liveSessions]
  );

  const computerSessions = useMemo(() => {
    const merged = [...activeSessions];
    for (const persisted of persistedSessions) {
      const alreadyCovered = merged.some(
        (session) => session.session_kind === persisted.session_kind && session.status === "running"
      );
      if (!alreadyCovered) {
        merged.push(persisted);
      }
    }
    return merged.sort(sessionSort);
  }, [activeSessions, persistedSessions]);

  const browserSessions = useMemo(
    () => computerSessions.filter((session) => session.session_kind === "browser"),
    [computerSessions]
  );
  const terminalSessions = useMemo(
    () => computerSessions.filter((session) => session.session_kind === "terminal"),
    [computerSessions]
  );
  const browserSession = useMemo(
    () =>
      browserSessions.find((session) => session.session_id === selectedBrowserSessionId) ??
      browserSessions[0] ??
      null,
    [browserSessions, selectedBrowserSessionId]
  );
  const terminalSession = useMemo(
    () =>
      terminalSessions.find((session) => session.session_id === selectedTerminalSessionId) ??
      terminalSessions[0] ??
      null,
    [selectedTerminalSessionId, terminalSessions]
  );
  const browserMetrics = useMemo(
    () => sessionMetricEntries(browserSession?.metrics),
    [browserSession?.metrics]
  );
  const terminalOutput = useMemo(
    () => terminalOutputForMode(terminalSession, terminalStreamMode),
    [terminalSession, terminalStreamMode]
  );
  const terminalArtifacts = useMemo(
    () => terminalSession?.artifacts ?? [],
    [terminalSession?.artifacts]
  );
  const browserArtifacts = useMemo(
    () => browserSession?.artifacts ?? [],
    [browserSession?.artifacts]
  );
  const selectedBrowserScreenshot = browserScreenshotArtifact(browserSession);
  const selectedBrowserHtml = browserHtmlArtifact(browserSession);
  const previewArtifacts = useMemo(
    () =>
      previewableArtifacts([
        ...browserArtifacts,
        ...terminalArtifacts,
        ...mergedArtifacts
      ]),
    [browserArtifacts, mergedArtifacts, terminalArtifacts]
  );
  const selectedPreviewArtifact =
    previewArtifacts.find((artifact) => artifact.storage_key === selectedPreviewStorageKey) ??
    previewArtifacts[0] ??
    null;
  const selectedPreviewMode = selectedPreviewArtifact ? artifactPreviewMode(selectedPreviewArtifact) : "none";
  const showComputerOverview = operatorTab === "computer";
  const showBrowserMode = operatorTab === "computer" || operatorTab === "browser";
  const showTerminalMode = operatorTab === "computer" || operatorTab === "terminal";
  const showFilesMode = operatorTab === "computer" || operatorTab === "files";
  const showPreviewMode = operatorTab === "computer" || operatorTab === "preview";
  const rootWorkbenchTree = workbenchTree["."] ?? initialWorkbenchTree ?? null;
  const selectedWorkbenchEditor = selectedWorkbenchPath
    ? workbenchEditors[selectedWorkbenchPath] ?? null
    : null;
  const selectedWorkbenchFile = selectedWorkbenchEditor?.file ?? null;
  const selectedWorkbenchDraft = selectedWorkbenchEditor?.draftContent ?? "";
  const selectedWorkbenchDirty = Boolean(
    selectedWorkbenchEditor &&
      selectedWorkbenchEditor.draftContent !== selectedWorkbenchEditor.originalContent
  );
  const openWorkbenchTabs = workbenchTabPaths
    .map((path) => workbenchEditors[path]?.file)
    .filter((file): file is ChatWorkbenchFileData => Boolean(file));
  const selectedRepoFileState =
    selectedWorkbenchPath && repoState
      ? repoState.changed_files.find((item) => item.relative_path === selectedWorkbenchPath) ?? null
      : null;
  const currentWorkbenchDirectory =
    (selectedWorkbenchPath
      ? workbenchTree[selectedWorkbenchPath.split("/").slice(0, -1).join("/") || "."]
      : null) ?? rootWorkbenchTree;
  const workbenchActivityByPath = useMemo(() => {
    const map = new Map<string, WorkbenchFileActivity>();
    for (const activity of liveWorkbenchActivities) {
      if (activity.relative_path && !map.has(activity.relative_path)) {
        map.set(activity.relative_path, activity);
      }
    }
    return map;
  }, [liveWorkbenchActivities]);
  const checklistItems = useMemo(
    () => buildTaskChecklistItems(displayedPlan, liveSteps, runSteps, latestRun?.id),
    [displayedPlan, latestRun?.id, liveSteps, runSteps]
  );
  const completedChecklistCount = checklistItems.filter((item) => item.completed).length;
  const checklistCompletionRatio =
    checklistItems.length > 0 ? completedChecklistCount / checklistItems.length : 0;
  const todoFileOptions = useMemo(() => {
    const candidates = new Set<string>();
    const addCandidate = (relativePath: string | null | undefined) => {
      if (!relativePath || !isChecklistCapableFile(relativePath)) {
        return;
      }
      candidates.add(relativePath);
    };

    if (selectedWorkbenchFile?.relative_path) {
      addCandidate(selectedWorkbenchFile.relative_path);
    }

    for (const tree of Object.values(workbenchTree)) {
      for (const entry of tree.entries) {
        if (entry.kind !== "file") {
          continue;
        }
        if (isTodoCandidateFile(entry.relative_path)) {
          addCandidate(entry.relative_path);
        }
      }
    }

    addCandidate("todo.md");
    return [...candidates];
  }, [selectedWorkbenchFile?.relative_path, workbenchTree]);
  const todoFileKnownExists = useMemo(() => {
    if (selectedWorkbenchFile?.relative_path === todoSyncPath) {
      return true;
    }
    return Object.values(workbenchTree).some((tree) =>
      tree.entries.some((entry) => entry.kind === "file" && entry.relative_path === todoSyncPath)
    );
  }, [selectedWorkbenchFile?.relative_path, todoSyncPath, workbenchTree]);
  const workspaceColumns = useMemo(() => {
    if (workbenchExpanded || !isDesktopWorkspace) {
      return "minmax(0,1fr)";
    }
    if (workspacePaneCollapsed) {
      return "88px 16px minmax(0,1fr)";
    }
    if (operatorPaneCollapsed) {
      return "minmax(0,1fr) 16px 88px";
    }
    return `calc(${workspacePaneWidth}% - 8px) 16px calc(${100 - workspacePaneWidth}% - 8px)`;
  }, [isDesktopWorkspace, operatorPaneCollapsed, workbenchExpanded, workspacePaneCollapsed, workspacePaneWidth]);
  const workspaceShellStyle = useMemo(
    () =>
      ({
        "--workspace-columns": workspaceColumns
      }) as CSSProperties,
    [workspaceColumns]
  );
  const runningComputerSessionCount = useMemo(
    () => computerSessions.filter((session) => session.status === "running").length,
    [computerSessions]
  );
  const deliverableCount = previewArtifacts.length > 0 ? previewArtifacts.length : mergedArtifacts.length;
  const activeChecklistItem =
    checklistItems.find((item) => ["running", "active", "in_progress"].includes(item.status)) ??
    checklistItems.find((item) => !item.completed) ??
    null;
  const workflowRecommendedTab: OperatorTab = selectedPreviewArtifact
    ? "preview"
    : browserSession
      ? "browser"
      : terminalSession
        ? "terminal"
        : liveWorkbenchActivities.length > 0
          ? "files"
          : "computer";
  const workflowRecommendedTabLabel =
    OPERATOR_TAB_OPTIONS.find((tab) => tab.key === workflowRecommendedTab)?.label ?? "Overview";
  const workflowFocusTitle =
    activeChecklistItem?.title ??
    activeThread?.title ??
    (currentProjectId ? "Project queue waiting for a task" : "Ready for the next task");
  const workflowFocusSummary = activeChecklistItem?.summary
    ? activeChecklistItem.summary
    : pendingApprovalRequests.length > 0
      ? `${pendingApprovalRequests.length} approval gate${pendingApprovalRequests.length === 1 ? "" : "s"} are waiting before the next action cycle.`
      : runningComputerSessionCount > 0
        ? `${runningComputerSessionCount} live computer session${runningComputerSessionCount === 1 ? "" : "s"} are currently carrying the task forward.`
        : deliverableCount > 0
          ? `${deliverableCount} deliverable${deliverableCount === 1 ? "" : "s"} are ready to inspect in the operator pane.`
          : "The workspace is synced and ready for the next orchestration cycle.";
  const workflowStateChips = [
    activeThread ? `${activeThread.run_count ?? 0} runs` : null,
    activeThread ? `${activeThread.message_count ?? 0} messages` : null,
    activeChecklistItem ? `step ${activeChecklistItem.step_index + 1}` : null,
    pendingApprovalRequests.length > 0
      ? `${pendingApprovalRequests.length} approval${pendingApprovalRequests.length === 1 ? "" : "s"}`
      : null,
    runningComputerSessionCount > 0
      ? `${runningComputerSessionCount} live session${runningComputerSessionCount === 1 ? "" : "s"}`
      : null,
    deliverableCount > 0 ? `${deliverableCount} output${deliverableCount === 1 ? "" : "s"}` : null
  ].filter((value): value is string => Boolean(value));
  const operatingFlowStages = useMemo(
    () =>
      [
        {
          key: "plan",
          label: "Plan",
          caption:
            checklistItems.length > 0
              ? `${completedChecklistCount}/${checklistItems.length} checklist items grounded`
              : running || displayedPlan.length > 0
                ? "Supervisor plan is forming"
                : "Waiting for the next orchestration plan",
          value:
            checklistItems.length > 0
              ? `${completedChecklistCount}/${checklistItems.length}`
              : displayedPlan.length > 0
                ? `${displayedPlan.length} steps`
                : "Idle",
          status:
            checklistItems.length > 0
              ? completedChecklistCount === checklistItems.length
                ? "complete"
                : "active"
              : running || displayedPlan.length > 0
                ? "active"
                : "idle",
          tab: "computer" as OperatorTab
        },
        {
          key: "execute",
          label: "Execute",
          caption:
            runningComputerSessionCount > 0
              ? `${runningComputerSessionCount} live computer session${runningComputerSessionCount === 1 ? "" : "s"}`
              : computerSessions.length > 0
                ? `${computerSessions.length} persisted computer session${computerSessions.length === 1 ? "" : "s"}`
                : running
                  ? "Agent tools are warming up"
                  : "No active computer activity yet",
          value:
            runningComputerSessionCount > 0
              ? `${runningComputerSessionCount} live`
              : computerSessions.length > 0
                ? `${computerSessions.length} tracked`
                : "Idle",
          status:
            runningComputerSessionCount > 0
              ? "active"
              : computerSessions.length > 0 || mergedTimeline.length > 0
                ? "complete"
                : running
                  ? "active"
                  : "idle",
          tab: "computer" as OperatorTab
        },
        {
          key: "deliver",
          label: "Deliver",
          caption:
            deliverableCount > 0
              ? `${deliverableCount} deliverable${deliverableCount === 1 ? "" : "s"} ready to inspect`
              : latestAssistant
                ? "Synthesis is available and waiting for outputs"
                : "Generated outputs will land here",
          value:
            deliverableCount > 0
              ? `${deliverableCount} ready`
              : latestAssistant
                ? "Answer ready"
                : "Idle",
          status:
            deliverableCount > 0
              ? selectedPreviewArtifact
                ? "active"
                : "complete"
              : latestAssistant
                ? "complete"
                : "idle",
          tab: deliverableCount > 0 ? "preview" : "artifacts"
        }
      ] satisfies Array<{
        key: string;
        label: string;
        caption: string;
        value: string;
        status: OperatingFlowStageStatus;
        tab: OperatorTab;
      }>,
    [
      checklistItems.length,
      completedChecklistCount,
      running,
      displayedPlan.length,
      runningComputerSessionCount,
      computerSessions.length,
      mergedTimeline.length,
      deliverableCount,
      latestAssistant,
      selectedPreviewArtifact
    ]
  );

  function toggleWorkspacePaneCollapsed() {
    setWorkspacePaneCollapsed((current) => {
      const next = !current;
      if (next) {
        setOperatorPaneCollapsed(false);
        setIsResizingWorkspace(false);
      }
      return next;
    });
  }

  function toggleOperatorPaneCollapsed() {
    setOperatorPaneCollapsed((current) => {
      const next = !current;
      if (next) {
        setWorkspacePaneCollapsed(false);
        setIsResizingWorkspace(false);
      }
      return next;
    });
  }

  function toggleWorkbenchExpanded() {
    setWorkbenchExpanded((current) => {
      const next = !current;
      if (next) {
        setWorkspacePaneCollapsed(false);
        setOperatorPaneCollapsed(false);
        setIsResizingWorkspace(false);
      }
      return next;
    });
  }

  function startWorkspaceResize(event: ReactMouseEvent<HTMLButtonElement>) {
    if (!isDesktopWorkspace || workspacePaneCollapsed || operatorPaneCollapsed || workbenchExpanded) {
      return;
    }
    event.preventDefault();
    setIsResizingWorkspace(true);
  }

  function syncThreadInUrl(threadId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    if (threadId) {
      params.set("thread", threadId);
    } else {
      params.delete("thread");
    }
    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(href, { scroll: false });
  }

  function upsertWorkbenchEditor(
    file: ChatWorkbenchFileData,
    options?: { activate?: boolean; preserveDraft?: boolean; savedAt?: string | null }
  ) {
    const preserveDraft = options?.preserveDraft ?? false;
    setWorkbenchEditors((current) => {
      const existing = current[file.relative_path];
      const nextDraft =
        preserveDraft && existing ? existing.draftContent : file.content;
      return {
        ...current,
        [file.relative_path]: {
          file,
          originalContent: file.content,
          draftContent: nextDraft,
          savedAt: options?.savedAt ?? existing?.savedAt ?? null
        }
      };
    });
    setWorkbenchTabPaths((current) =>
      current.includes(file.relative_path) ? current : [...current, file.relative_path]
    );
    if (options?.activate !== false) {
      setSelectedWorkbenchPath(file.relative_path);
    }
  }

  function closeWorkbenchTab(relativePath: string) {
    setWorkbenchTabPaths((current) => {
      const next = current.filter((path) => path !== relativePath);
      if (selectedWorkbenchPath === relativePath) {
        const fallbackPath = next[next.length - 1] ?? null;
        setSelectedWorkbenchPath(fallbackPath);
      }
      return next;
    });
  }

  function updateWorkbenchDraft(relativePath: string, nextDraft: string) {
    setWorkbenchEditors((current) => {
      const existing = current[relativePath];
      if (!existing) {
        return current;
      }
      return {
        ...current,
        [relativePath]: {
          ...existing,
          draftContent: nextDraft
        }
      };
    });
  }

  function discardWorkbenchChanges(relativePath: string) {
    setWorkbenchEditors((current) => {
      const existing = current[relativePath];
      if (!existing) {
        return current;
      }
      return {
        ...current,
        [relativePath]: {
          ...existing,
          draftContent: existing.originalContent
        }
      };
    });
    setWorkbenchNotice("Unsaved edits were reverted to the last saved version.");
    setWorkbenchError(null);
    setWorkbenchViewMode("edit");
  }

  async function fetchWorkbenchDirectory(relativePath = ".", { force = false } = {}) {
    if (!force && workbenchTree[relativePath]) {
      return workbenchTree[relativePath];
    }
    setWorkbenchLoadingPath(relativePath);
    try {
      const query = new URLSearchParams({
        workspace_id: data.workspace_id,
        relative_path: relativePath
      });
      const response = await fetch(`/api/chat/workbench/tree?${query.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => ({
        detail: "Workbench tree is unavailable."
      }))) as Partial<ChatWorkbenchTreeData> & { detail?: string };
      if (!response.ok) {
        setWorkbenchError(payload.detail ?? "Workbench tree is unavailable.");
        return null;
      }
      const nextTree: ChatWorkbenchTreeData = {
        workspace_id: String(payload.workspace_id ?? data.workspace_id),
        root_label: String(payload.root_label ?? rootWorkbenchTree?.root_label ?? "Workspace"),
        relative_path: String(payload.relative_path ?? relativePath),
        parent_relative_path:
          typeof payload.parent_relative_path === "string" ? payload.parent_relative_path : null,
        entries: Array.isArray(payload.entries) ? (payload.entries as WorkbenchTreeEntry[]) : []
      };
      setWorkbenchTree((current) => ({
        ...current,
        [nextTree.relative_path]: nextTree
      }));
      setWorkbenchError(null);
      return nextTree;
    } catch {
      setWorkbenchError("Workbench tree service is unavailable.");
      return null;
    } finally {
      setWorkbenchLoadingPath((current) => (current === relativePath ? null : current));
    }
  }

  async function openWorkbenchFile(relativePath: string) {
    setWorkbenchLoadingPath(relativePath);
    try {
      const query = new URLSearchParams({
        workspace_id: data.workspace_id,
        relative_path: relativePath,
        max_chars: "24000"
      });
      const response = await fetch(`/api/chat/workbench/file?${query.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => ({
        detail: "Workbench file is unavailable."
      }))) as Partial<ChatWorkbenchFileData> & { detail?: string };
      if (!response.ok) {
        setWorkbenchError(payload.detail ?? "Workbench file is unavailable.");
        return;
      }
      const nextFile = normalizeWorkbenchFilePayload(
        payload,
        data.workspace_id,
        relativePath,
        rootWorkbenchTree?.root_label ?? "Workspace"
      );
      upsertWorkbenchEditor(nextFile, { activate: true });
      setOperatorTab("code");
      setWorkbenchError(null);
      setWorkbenchNotice(null);
    } catch {
      setWorkbenchError("Workbench file service is unavailable.");
    } finally {
      setWorkbenchLoadingPath((current) => (current === relativePath ? null : current));
    }
  }

  async function toggleWorkbenchDirectory(relativePath: string) {
    const nextExpanded = !expandedDirectories[relativePath];
    setExpandedDirectories((current) => ({
      ...current,
      [relativePath]: nextExpanded
    }));
    if (nextExpanded) {
      await fetchWorkbenchDirectory(relativePath);
    }
  }

  async function copyWorkbenchContent() {
    if (!selectedWorkbenchFile || !selectedWorkbenchDraft) {
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedWorkbenchDraft);
    } catch {
      setWorkbenchError("Clipboard access is unavailable for this browser session.");
    }
  }

  async function copyTerminalOutput(mode: TerminalStreamMode = terminalStreamMode) {
    const content = terminalOutputForMode(terminalSession, mode);
    if (!content.trim()) {
      setComputerNotice("There is no terminal output to copy yet.");
      setComputerError(null);
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      setComputerNotice(`Copied ${mode === "combined" ? "combined terminal output" : `${mode} output`} to the clipboard.`);
      setComputerError(null);
    } catch {
      setComputerError("Clipboard access is unavailable for this browser session.");
    }
  }

  function jumpTerminalToLatest() {
    if (!terminalOutputRef.current) {
      return;
    }
    terminalOutputRef.current.scrollTo({
      top: terminalOutputRef.current.scrollHeight,
      behavior: "smooth"
    });
  }

  async function fetchWorkbenchRepoState({ force = false } = {}) {
    if (repoState && !force) {
      return repoState;
    }
    setRepoLoading(true);
    try {
      const query = new URLSearchParams({ workspace_id: data.workspace_id });
      const response = await fetch(`/api/chat/workbench/repo?${query.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => ({
        detail: "Workbench repository metadata is unavailable."
      }))) as Partial<ChatWorkbenchRepoData> & { detail?: string };
      if (!response.ok) {
        setWorkbenchError(payload.detail ?? "Workbench repository metadata is unavailable.");
        return null;
      }
      const nextRepoState: ChatWorkbenchRepoData = {
        workspace_id: String(payload.workspace_id ?? data.workspace_id),
        is_repo: Boolean(payload.is_repo),
        root_label: String(payload.root_label ?? rootWorkbenchTree?.root_label ?? "Workspace"),
        branch: typeof payload.branch === "string" ? payload.branch : null,
        head: typeof payload.head === "string" ? payload.head : null,
        dirty: Boolean(payload.dirty),
        summary: typeof payload.summary === "string" ? payload.summary : null,
        changed_files: Array.isArray(payload.changed_files) ? payload.changed_files : [],
        staged_count: Number(payload.staged_count ?? 0),
        unstaged_count: Number(payload.unstaged_count ?? 0),
        untracked_count: Number(payload.untracked_count ?? 0)
      };
      setRepoState(nextRepoState);
      setWorkbenchError(null);
      return nextRepoState;
    } catch {
      setWorkbenchError("Workbench repository metadata is unavailable.");
      return null;
    } finally {
      setRepoLoading(false);
    }
  }

  function scheduleWorkbenchRepoRefresh() {
    if (repoRefreshTimeoutRef.current) {
      clearTimeout(repoRefreshTimeoutRef.current);
    }
    repoRefreshTimeoutRef.current = setTimeout(() => {
      void fetchWorkbenchRepoState({ force: true });
    }, 350);
  }

  function recordWorkbenchActivity(
    activity: WorkbenchFileActivity,
    result?: Record<string, unknown>
  ) {
    setLiveWorkbenchActivities((current) => mergeWorkbenchActivities(current, activity));

    if (activity.directory_path) {
      setExpandedDirectories((current) => ({
        ...current,
        [activity.directory_path ?? "."]: true
      }));
    }

    if (activity.operation === "read_text" && result) {
      const filePayload = buildWorkbenchFileFromToolResult(result, workspaceId);
      if (filePayload) {
        upsertWorkbenchEditor(filePayload, { activate: true, preserveDraft: true });
        return;
      }
    }

    if ((activity.operation === "write_text" || activity.operation === "write_json") && activity.relative_path) {
      void openWorkbenchFile(activity.relative_path);
      scheduleWorkbenchRepoRefresh();
      setWorkbenchNotice(
        `${activity.agent_name ?? "Coding agent"} updated ${activity.relative_path}.`
      );
      return;
    }

    if (activity.operation === "list_files" && activity.directory_path) {
      void fetchWorkbenchDirectory(activity.directory_path, { force: true });
    }
  }

  async function loadWorkbenchRepoDiff(relativePath: string) {
    setRepoDiffLoadingPath(relativePath);
    try {
      const query = new URLSearchParams({
        workspace_id: data.workspace_id,
        relative_path: relativePath,
        max_chars: "40000"
      });
      const response = await fetch(`/api/chat/workbench/diff?${query.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => ({
        detail: "Workbench diff is unavailable."
      }))) as Partial<ChatWorkbenchDiffData> & { detail?: string };
      if (!response.ok) {
        setWorkbenchError(payload.detail ?? "Workbench diff is unavailable.");
        return null;
      }
      const nextDiff: ChatWorkbenchDiffData = {
        workspace_id: String(payload.workspace_id ?? data.workspace_id),
        relative_path: String(payload.relative_path ?? relativePath),
        compare_target: String(payload.compare_target ?? "HEAD"),
        has_changes: Boolean(payload.has_changes),
        status: typeof payload.status === "string" ? payload.status : null,
        diff: String(payload.diff ?? ""),
        truncated: Boolean(payload.truncated),
        note: typeof payload.note === "string" ? payload.note : null
      };
      setRepoDiff(nextDiff);
      setWorkbenchError(null);
      return nextDiff;
    } catch {
      setWorkbenchError("Workbench diff is unavailable.");
      return null;
    } finally {
      setRepoDiffLoadingPath((current) => (current === relativePath ? null : current));
    }
  }

  async function saveWorkbenchFile() {
    if (!selectedWorkbenchFile || !selectedWorkbenchPath) {
      return;
    }
    setWorkbenchSavePath(selectedWorkbenchPath);
    setWorkbenchError(null);
    setWorkbenchNotice(null);
    try {
      const response = await fetch("/api/chat/workbench/file", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspace_id: data.workspace_id,
          relative_path: selectedWorkbenchPath,
          content: selectedWorkbenchDraft,
          create_if_missing: false
        })
      });
      const payload = (await response.json().catch(() => ({
        detail: "Workbench save failed."
      }))) as Partial<ChatWorkbenchFileSaveResponse> & { detail?: string };
      if (!response.ok || !payload.file) {
        setWorkbenchError(payload.detail ?? "Workbench save failed.");
        return;
      }
      const savedFile = normalizeWorkbenchFilePayload(
        payload.file,
        data.workspace_id,
        selectedWorkbenchPath,
        rootWorkbenchTree?.root_label ?? "Workspace"
      );
      upsertWorkbenchEditor(savedFile, {
        activate: true,
        savedAt: typeof payload.saved_at === "string" ? payload.saved_at : new Date().toISOString()
      });
      await fetchWorkbenchDirectory(parentRelativePath(savedFile.relative_path), { force: true });
      if (parentRelativePath(savedFile.relative_path) !== ".") {
        await fetchWorkbenchDirectory(".", { force: true });
      }
      await fetchWorkbenchRepoState({ force: true });
      if (workbenchViewMode === "repo-diff") {
        await loadWorkbenchRepoDiff(savedFile.relative_path);
      }
      setWorkbenchNotice(`Saved ${savedFile.relative_path}.`);
    } catch {
      setWorkbenchError("Workbench save service is unavailable.");
    } finally {
      setWorkbenchSavePath((current) => (current === selectedWorkbenchPath ? null : current));
    }
  }

  async function refreshWorkspace(threadId?: string | null) {
    const query = new URLSearchParams({ workspace_id: data.workspace_id });
    if (threadId) {
      query.set("thread_id", threadId);
    } else if (currentProjectId) {
      query.set("project_id", currentProjectId);
    }

    setLoadingThread(true);
    try {
      const response = await fetch(`/api/chat/workspace?${query.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => ({
        detail: "Workspace refresh failed."
      }))) as Partial<ChatWorkspaceData> & { detail?: string };
      if (!response.ok) {
        setError(payload.detail ?? "Workspace refresh failed.");
        setLoadingThread(false);
        return;
      }
      setThreads(payload.threads ?? []);
      setSelectedProject(payload.selected_project ?? null);
      setTaskMemory(payload.task_memory ?? null);
      setProjectMemory(payload.project_memory ?? null);
      setMessages(payload.messages ?? []);
      setRuns(payload.runs ?? []);
      setRunSteps(payload.run_steps ?? []);
      setToolCalls(payload.tool_calls ?? []);
      const selectedThreadId = payload.selected_thread_id ?? threadId ?? null;
      setCurrentThreadId(selectedThreadId);
      syncThreadInUrl(selectedThreadId);
      setError(null);
    } catch {
      setError("Workspace refresh is unavailable.");
    } finally {
      setLoadingThread(false);
    }
  }

  async function syncChecklistToTodo() {
    if (!activeThread?.id || checklistItems.length === 0 || todoSyncing) {
      return;
    }

    setTodoSyncing(true);
    setTodoSyncError(null);
    setTodoSyncNotice(null);

    try {
      const response = await fetch("/api/chat/todo-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspace_id: data.workspace_id,
          thread_id: activeThread.id,
          relative_path: todoSyncPath,
          heading: activeThread.title
        })
      });
      const payload = (await response.json().catch(() => ({
        detail: "Checklist sync failed."
      }))) as Partial<ChatTodoSyncResponse> & { detail?: string };
      if (!response.ok || !payload.file) {
        setTodoSyncError(payload.detail ?? "Checklist sync failed.");
        return;
      }

      const syncedFile: ChatWorkbenchFileData = {
        workspace_id: String(payload.file.workspace_id ?? data.workspace_id),
        root_label: String(payload.file.root_label ?? rootWorkbenchTree?.root_label ?? "workspace"),
        relative_path: String(payload.file.relative_path ?? todoSyncPath),
        name: String(payload.file.name ?? todoSyncPath.split("/").pop() ?? "todo.md"),
        extension: payload.file.extension ?? null,
        size_bytes: Number(payload.file.size_bytes ?? 0),
        truncated: Boolean(payload.file.truncated),
        content: String(payload.file.content ?? "")
      };
      upsertWorkbenchEditor(syncedFile, { activate: true });
      setOperatorTab("code");
      setTodoSyncPath(syncedFile.relative_path);
      await fetchWorkbenchDirectory(parentRelativePath(syncedFile.relative_path), { force: true });
      if (parentRelativePath(syncedFile.relative_path) !== ".") {
        await fetchWorkbenchDirectory(".", { force: true });
      }
      setTodoSyncNotice(
        `${Number(payload.completed_items ?? 0)} of ${Number(payload.total_items ?? checklistItems.length)} checklist items synced to ${syncedFile.relative_path}.`
      );
    } catch {
      setTodoSyncError("Checklist sync is unavailable right now.");
    } finally {
      setTodoSyncing(false);
    }
  }

  async function updateActiveThread(payload: {
    title?: string | null;
    status?: string | null;
    metadata_updates?: Record<string, unknown>;
  }) {
    if (!activeThread?.id) {
      return null;
    }

    const response = await fetch(`/api/chat/threads/${activeThread.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = (await response.json().catch(() => ({
      detail: "Thread update failed."
    }))) as Partial<Thread> & { detail?: string };
    if (!response.ok) {
      throw new Error(data.detail ?? "Thread update failed.");
    }

    const nextThread: Thread = {
      id: String(data.id ?? activeThread.id),
      workspace_id: String(data.workspace_id ?? activeThread.workspace_id),
      project_id:
        typeof data.project_id === "string" ? data.project_id : activeThread.project_id ?? null,
      title: String(data.title ?? activeThread.title),
      status: String(data.status ?? activeThread.status),
      metadata:
        data.metadata && isRecord(data.metadata)
          ? data.metadata
          : activeThread.metadata ?? {},
      created_at: String(data.created_at ?? activeThread.created_at),
      updated_at: String(data.updated_at ?? new Date().toISOString()),
      message_count: activeThread.message_count ?? 0,
      run_count: activeThread.run_count ?? 0,
      last_message_preview: activeThread.last_message_preview ?? null,
      last_activity_at: String(data.updated_at ?? activeThread.last_activity_at ?? new Date().toISOString())
    };

    setThreads((current) => upsertThread(current, nextThread));
    return nextThread;
  }

  async function setTaskStatus(nextStatus: "active" | "paused") {
    if (!activeThread?.id || activeThread.status === nextStatus) {
      return;
    }
    setHeaderActionLoading(nextStatus);
    setHeaderError(null);
    setHeaderNotice(null);
    try {
      await updateActiveThread({
        status: nextStatus,
        metadata_updates: {
          ...activeThreadMetadata,
          paused_at: nextStatus === "paused" ? new Date().toISOString() : null,
          resumed_at: nextStatus === "active" ? new Date().toISOString() : null
        }
      });
      setHeaderNotice(
        nextStatus === "paused"
          ? "Task paused. New runs and approval follow-ups are blocked until you resume it."
          : "Task resumed. The workspace is ready for new runs again."
      );
    } catch (statusError) {
      setHeaderError(statusError instanceof Error ? statusError.message : "Task status update failed.");
    } finally {
      setHeaderActionLoading(null);
    }
  }

  async function approvePendingRequest(request: ApprovalRequest) {
    if (!activeThread?.id) {
      return;
    }
    if (isTaskPaused) {
      setError("This task is paused. Resume it before approving and continuing.");
      return;
    }
    setApprovalActionLoading(request.id);
    setHeaderError(null);
    setHeaderNotice(null);
    try {
      const nextResolutions = [
        ...approvalResolutions.filter((item) => item.approval_id !== request.id),
        {
          approval_id: request.id,
          status: "approved" as const,
          kind: request.kind,
          title: request.title,
          resolved_at: new Date().toISOString()
  }
];

      await updateActiveThread({
        metadata_updates: {
          ...activeThreadMetadata,
          approval_resolutions: nextResolutions
        }
      });
      setLiveApprovalRequests((current) => current.filter((item) => item.id !== request.id));
      setHeaderNotice(`${request.title} approved. Continuing the task with your authorization.`);
      await submitRunMessage(request.approvalPrompt);
    } catch (approvalError) {
      setHeaderError(approvalError instanceof Error ? approvalError.message : "Approval failed.");
    } finally {
      setApprovalActionLoading(null);
    }
  }

  async function deferPendingRequest(request: ApprovalRequest) {
    if (!activeThread?.id) {
      return;
    }
    setApprovalActionLoading(request.id);
    setHeaderError(null);
    setHeaderNotice(null);
    try {
      const nextResolutions = [
        ...approvalResolutions.filter((item) => item.approval_id !== request.id),
        {
          approval_id: request.id,
          status: "deferred" as const,
          kind: request.kind,
          title: request.title,
          resolved_at: new Date().toISOString()
        }
      ];
      await updateActiveThread({
        metadata_updates: {
          ...activeThreadMetadata,
          approval_resolutions: nextResolutions
        }
      });
      setHeaderNotice(`${request.title} remains blocked and can be approved later from this task.`);
    } catch (approvalError) {
      setHeaderError(approvalError instanceof Error ? approvalError.message : "Approval update failed.");
    } finally {
      setApprovalActionLoading(null);
    }
  }

  async function handleModelProfileChange(nextProfile: string) {
    if (!activeThread?.id || nextProfile === selectedModelProfile) {
      return;
    }
    setHeaderActionLoading("model");
    setHeaderError(null);
    setHeaderNotice(null);
    try {
      await updateActiveThread({
        metadata_updates: {
          ...activeThreadMetadata,
          model_profile: nextProfile
        }
      });
      const profileLabel =
        MODEL_PROFILE_OPTIONS.find((option) => option.value === nextProfile)?.label ?? nextProfile;
      setHeaderNotice(`Model profile updated to ${profileLabel}.`);
    } catch (updateError) {
      setHeaderError(updateError instanceof Error ? updateError.message : "Model profile update failed.");
    } finally {
      setHeaderActionLoading(null);
    }
  }

  async function copyTaskShareLink() {
    if (!activeThread?.id) {
      return;
    }
    const href = `${window.location.origin}${withWorkspacePath("/app/chat", data.workspace_id, {
      project: activeThread.project_id,
      thread: activeThread.id
    })}`;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      setHeaderError("Clipboard access is unavailable for this browser session.");
      return;
    }

    if (!shareEnabled) {
      try {
        await updateActiveThread({
          metadata_updates: {
            ...activeThreadMetadata,
            share_enabled: true
          }
        });
      } catch (shareError) {
        setHeaderError(shareError instanceof Error ? shareError.message : "Share state update failed.");
        return;
      }
    }

    setHeaderNotice("Task link copied to clipboard.");
  }

  async function copyMessageContent(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      if (copiedMessageTimeoutRef.current) {
        window.clearTimeout(copiedMessageTimeoutRef.current);
      }
      copiedMessageTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1800);
    } catch {
      setComposerError("Clipboard access is unavailable for this browser session.");
    }
  }

  async function togglePublishState() {
    if (!activeThread?.id) {
      return;
    }
    setHeaderActionLoading("publish");
    setHeaderError(null);
    setHeaderNotice(null);
    try {
      await updateActiveThread({
        metadata_updates: {
          ...activeThreadMetadata,
          published: !publishState,
          published_at: !publishState ? new Date().toISOString() : null
        }
      });
      setHeaderNotice(!publishState ? "Task marked as published." : "Task publication has been revoked.");
    } catch (publishError) {
      setHeaderError(publishError instanceof Error ? publishError.message : "Publish update failed.");
    } finally {
      setHeaderActionLoading(null);
    }
  }

  async function forkActiveThread() {
    if (!activeThread?.id) {
      return;
    }
    setHeaderActionLoading("fork");
    setHeaderError(null);
    setHeaderNotice(null);
    try {
      const response = await fetch(`/api/chat/threads/${activeThread.id}/fork`, {
        method: "POST"
      });
      const data = (await response.json().catch(() => ({
        detail: "Thread fork failed."
      }))) as Partial<Thread> & { detail?: string };
      if (!response.ok) {
        throw new Error(data.detail ?? "Thread fork failed.");
      }
      const forkedThreadId = String(data.id ?? "");
      if (!forkedThreadId) {
        throw new Error("Forked thread ID is missing.");
      }
      await refreshWorkspace(forkedThreadId);
      setHeaderNotice("Forked task created.");
    } catch (forkError) {
      setHeaderError(forkError instanceof Error ? forkError.message : "Thread fork failed.");
    } finally {
      setHeaderActionLoading(null);
    }
  }

  async function inviteCollaborator() {
    if (!activeThread?.id || !inviteEmail.trim()) {
      return;
    }
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    const nextCollaborators = Array.from(new Set([...collaboratorList, normalizedEmail]));
    setHeaderActionLoading("invite");
    setHeaderError(null);
    setHeaderNotice(null);
    try {
      await updateActiveThread({
        metadata_updates: {
          ...activeThreadMetadata,
          collaborators: nextCollaborators,
          share_enabled: true
        }
      });
      setInviteEmail("");
      setHeaderNotice(`Added ${normalizedEmail} to the task collaborator list.`);
    } catch (inviteError) {
      setHeaderError(inviteError instanceof Error ? inviteError.message : "Collaborator update failed.");
    } finally {
      setHeaderActionLoading(null);
    }
  }

  async function saveTaskSettings() {
    if (!activeThread?.id) {
      return;
    }
    setHeaderActionLoading("settings");
    setHeaderError(null);
    setHeaderNotice(null);
    try {
      await updateActiveThread({
        title: threadTitleDraft,
        status: threadStatusDraft,
        metadata_updates: {
          ...activeThreadMetadata,
          share_enabled: shareEnabled
        }
      });
      setHeaderNotice("Task settings saved.");
      setHeaderPanel(null);
    } catch (settingsError) {
      setHeaderError(settingsError instanceof Error ? settingsError.message : "Task settings update failed.");
    } finally {
      setHeaderActionLoading(null);
    }
  }

  createThreadActionRef.current = createThread;
  fetchWorkbenchDirectoryRef.current = fetchWorkbenchDirectory;
  fetchWorkbenchRepoStateRef.current = fetchWorkbenchRepoState;
  openWorkbenchFileRef.current = openWorkbenchFile;

  useEffect(() => {
    const marker = searchParamKey;
    if (!wantsNewTask || running || loadingThread) {
      return;
    }
    if (autoCreateMarker.current === marker) {
      return;
    }
    autoCreateMarker.current = marker;
    void createThreadActionRef.current?.();
  }, [loadingThread, running, searchParamKey, wantsNewTask]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1200px)");
    const syncDesktopMode = () => {
      setIsDesktopWorkspace(mediaQuery.matches);
      if (!mediaQuery.matches) {
        setIsResizingWorkspace(false);
      }
    };
    syncDesktopMode();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncDesktopMode);
      return () => mediaQuery.removeEventListener("change", syncDesktopMode);
    }
    mediaQuery.addListener(syncDesktopMode);
    return () => mediaQuery.removeListener(syncDesktopMode);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("workbench-focus-mode", workbenchExpanded);
    return () => {
      document.body.classList.remove("workbench-focus-mode");
    };
  }, [workbenchExpanded]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 48), 120);
    textarea.style.height = `${nextHeight}px`;
  }, [draft]);

  useEffect(() => {
    return () => {
      if (copiedMessageTimeoutRef.current) {
        window.clearTimeout(copiedMessageTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const browserWindow = window as typeof window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const SpeechRecognitionCtor =
      browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
    setVoiceSupported(Boolean(SpeechRecognitionCtor));
    setVoiceEngine(SpeechRecognitionCtor ? "browser-speech-recognition" : null);
    return () => {
      speechRecognitionRef.current?.stop();
      speechRecognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      const rawLayout = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
      if (!rawLayout) {
        return;
      }
      const parsed = JSON.parse(rawLayout) as {
        workspacePaneWidth?: number;
        workspacePaneCollapsed?: boolean;
        operatorPaneCollapsed?: boolean;
        workbenchExpanded?: boolean;
      };
      if (typeof parsed.workspacePaneWidth === "number") {
        setWorkspacePaneWidth(
          clampNumber(parsed.workspacePaneWidth, MIN_WORKSPACE_SPLIT, MAX_WORKSPACE_SPLIT)
        );
      }
      const nextWorkspaceCollapsed = Boolean(parsed.workspacePaneCollapsed);
      const nextOperatorCollapsed =
        nextWorkspaceCollapsed ? false : Boolean(parsed.operatorPaneCollapsed);
      const nextWorkbenchExpanded = Boolean(parsed.workbenchExpanded);
      setWorkspacePaneCollapsed(nextWorkbenchExpanded ? false : nextWorkspaceCollapsed);
      setOperatorPaneCollapsed(nextWorkbenchExpanded ? false : nextOperatorCollapsed);
      setWorkbenchExpanded(nextWorkbenchExpanded);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      WORKSPACE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        workspacePaneWidth,
        workspacePaneCollapsed,
        operatorPaneCollapsed,
        workbenchExpanded
      })
    );
  }, [operatorPaneCollapsed, workbenchExpanded, workspacePaneCollapsed, workspacePaneWidth]);

  useEffect(() => {
    if (
      !isDesktopWorkspace ||
      !isResizingWorkspace ||
      workspacePaneCollapsed ||
      operatorPaneCollapsed ||
      workbenchExpanded
    ) {
      return;
    }
    const handlePointerMove = (event: MouseEvent) => {
      const shell = workspaceShellRef.current;
      if (!shell) {
        return;
      }
      const bounds = shell.getBoundingClientRect();
      if (!bounds.width) {
        return;
      }
      const ratio = ((event.clientX - bounds.left) / bounds.width) * 100;
      setWorkspacePaneWidth(clampNumber(ratio, MIN_WORKSPACE_SPLIT, MAX_WORKSPACE_SPLIT));
    };
    const stopResizing = () => {
      setIsResizingWorkspace(false);
    };
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isDesktopWorkspace, isResizingWorkspace, operatorPaneCollapsed, workbenchExpanded, workspacePaneCollapsed]);

  useEffect(() => {
    if (!rootWorkbenchTree) {
      void fetchWorkbenchDirectoryRef.current?.(".");
    }
  }, [rootWorkbenchTree]);

  useEffect(() => {
    if (operatorTab !== "code") {
      return;
    }
    if (!repoState) {
      void fetchWorkbenchRepoStateRef.current?.();
    }
  }, [operatorTab, repoState]);

  useEffect(() => {
    if (selectedWorkbenchPath || !rootWorkbenchTree) {
      return;
    }
    const preferredFile = preferredWorkbenchFile(rootWorkbenchTree.entries);
    if (!preferredFile) {
      return;
    }
    void openWorkbenchFileRef.current?.(preferredFile.relative_path);
  }, [rootWorkbenchTree, selectedWorkbenchPath]);

  useEffect(() => {
    if (!todoFileOptions.length) {
      return;
    }
    setTodoSyncPath((current) => (todoFileOptions.includes(current) ? current : todoFileOptions[0]));
  }, [todoFileOptions]);

  useEffect(() => {
    if (!browserSessions.length) {
      setSelectedBrowserSessionId(null);
      return;
    }
    setSelectedBrowserSessionId((current) =>
      current && browserSessions.some((session) => session.session_id === current)
        ? current
        : browserSessions[0].session_id
    );
  }, [browserSessions]);

  useEffect(() => {
    if (!terminalSessions.length) {
      setSelectedTerminalSessionId(null);
      return;
    }
    setSelectedTerminalSessionId((current) =>
      current && terminalSessions.some((session) => session.session_id === current)
        ? current
        : terminalSessions[0].session_id
    );
  }, [terminalSessions]);

  useEffect(() => {
    if (!previewArtifacts.length) {
      setSelectedPreviewStorageKey(null);
      return;
    }
    setSelectedPreviewStorageKey((current) =>
      current && previewArtifacts.some((artifact) => artifact.storage_key === current)
        ? current
        : previewArtifacts[0].storage_key
    );
  }, [previewArtifacts]);

  useEffect(() => {
    if (!terminalFollowOutput || !terminalOutputRef.current) {
      return;
    }
    terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
  }, [terminalFollowOutput, terminalOutput, terminalSession?.status]);

  useEffect(() => {
    if (!selectedWorkbenchFile?.relative_path || !isTodoCandidateFile(selectedWorkbenchFile.relative_path)) {
      return;
    }
    setTodoSyncPath(selectedWorkbenchFile.relative_path);
  }, [selectedWorkbenchFile?.relative_path]);

  useEffect(() => {
    if (!draft.trim()) {
      setVoiceCapturedInDraft(false);
    }
  }, [draft]);

  useEffect(() => {
    setRepoDiff(null);
    setWorkbenchViewMode("edit");
    setWorkbenchError(null);
    setWorkbenchNotice(null);
  }, [selectedWorkbenchPath]);

  useEffect(() => {
    setTodoSyncError(null);
    setTodoSyncNotice(null);
    setComputerError(null);
    setComputerNotice(null);
    setComposerNotice(null);
    setComposerError(null);
    setComposerAttachments([]);
    setSelectedComposerShortcutKeys([]);
    setVoiceInterimTranscript("");
    setVoiceCapturedInDraft(false);
    setLiveWorkbenchActivities([]);
    setLiveApprovalRequests([]);
    setSelectedBrowserSessionId(null);
    setSelectedTerminalSessionId(null);
    setSelectedPreviewStorageKey(null);
  }, [currentThreadId]);

  useEffect(() => {
    return () => {
      if (repoRefreshTimeoutRef.current) {
        clearTimeout(repoRefreshTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setThreadTitleDraft(activeThreadTitle);
    setThreadStatusDraft(activeThreadStatus);
    setInviteEmail("");
    setSelectedTaskTemplateKey(activeThreadSelectedTemplateKey);
    setTemplateNotice(null);
    setHeaderError(null);
    setHeaderNotice(null);
    setHeaderPanel(null);
  }, [activeThread?.id, activeThreadSelectedTemplateKey, activeThreadStatus, activeThreadTitle]);

  async function createThread() {
    if (running) {
      return;
    }

    const previousThreadId = currentThreadId;
    const previousMessages = messages;
    const previousRuns = runs;
    const previousRunSteps = runSteps;
    const previousToolCalls = toolCalls;
    const previousLivePlan = livePlan;
    const previousExecutionBatches = executionBatches;
    const previousLiveSteps = liveSteps;
    const previousActiveBatchIndex = activeBatchIndex;
    const previousLiveTimeline = liveTimeline;
    const previousLiveSessions = liveSessions;
    const previousLiveArtifacts = liveArtifacts;
    const previousLiveWorkbenchActivities = liveWorkbenchActivities;
    const previousTaskMemory = taskMemory;
    const previousProjectMemory = projectMemory;

    const provisional = provisionalThread(
      data.workspace_id,
      selectedTaskTemplate?.chat_defaults.thread_title ?? "New thread",
      currentProjectId
    );
    setThreads((current) => upsertThread(current, provisional));
    setCurrentThreadId(provisional.id);
    setTaskMemory(null);
    setMessages([]);
    setRuns([]);
    setRunSteps([]);
    setToolCalls([]);
    setLivePlan([]);
    setExecutionBatches([]);
    setLiveSteps([]);
    setActiveBatchIndex(null);
    setLiveTimeline([]);
    setLiveSessions({});
    setLiveArtifacts([]);
    setLiveWorkbenchActivities([]);
    setError(null);

    try {
      const payload: ChatThreadCreatePayload = {
        workspace_id: data.workspace_id,
        project_id: currentProjectId,
        title: selectedTaskTemplate?.chat_defaults.thread_title ?? "New thread"
      };
      const response = await fetch("/api/chat/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const created = (await response.json().catch(() => ({
        detail: "Thread creation failed."
      }))) as Partial<Thread> & { detail?: string };
      if (!response.ok) {
        setError(created.detail ?? "Thread creation failed.");
        setThreads((current) => current.filter((item) => item.id !== provisional.id));
        setCurrentThreadId(previousThreadId);
        setMessages(previousMessages);
        setRuns(previousRuns);
        setRunSteps(previousRunSteps);
        setToolCalls(previousToolCalls);
        setLivePlan(previousLivePlan);
        setExecutionBatches(previousExecutionBatches);
        setLiveSteps(previousLiveSteps);
        setActiveBatchIndex(previousActiveBatchIndex);
        setLiveTimeline(previousLiveTimeline);
        setLiveSessions(previousLiveSessions);
        setLiveArtifacts(previousLiveArtifacts);
        setLiveWorkbenchActivities(previousLiveWorkbenchActivities);
        setTaskMemory(previousTaskMemory);
        setProjectMemory(previousProjectMemory);
        syncThreadInUrl(previousThreadId);
        return;
      }
      const nextThread: Thread = {
        id: String(created.id ?? provisional.id),
        workspace_id: String(created.workspace_id ?? data.workspace_id),
        project_id:
          typeof created.project_id === "string" ? created.project_id : provisional.project_id ?? null,
        title: String(created.title ?? "New thread"),
        status: String(created.status ?? "active"),
        metadata: created.metadata && isRecord(created.metadata) ? created.metadata : {},
        created_at: String(created.created_at ?? provisional.created_at),
        updated_at: String(created.updated_at ?? provisional.updated_at),
        message_count: 0,
        run_count: 0,
        last_message_preview: null,
        last_activity_at: String(created.updated_at ?? provisional.updated_at)
      };
      setThreads((current) => upsertThread(current.filter((item) => item.id !== provisional.id), nextThread));
      setCurrentThreadId(nextThread.id);
      await refreshWorkspace(nextThread.id);
    } catch {
      setError("Thread creation is unavailable.");
      setThreads((current) => current.filter((item) => item.id !== provisional.id));
      setCurrentThreadId(previousThreadId);
      setMessages(previousMessages);
      setRuns(previousRuns);
      setRunSteps(previousRunSteps);
      setToolCalls(previousToolCalls);
      setLivePlan(previousLivePlan);
      setExecutionBatches(previousExecutionBatches);
      setLiveSteps(previousLiveSteps);
      setActiveBatchIndex(previousActiveBatchIndex);
      setLiveTimeline(previousLiveTimeline);
      setLiveSessions(previousLiveSessions);
      setLiveArtifacts(previousLiveArtifacts);
      setLiveWorkbenchActivities(previousLiveWorkbenchActivities);
      setTaskMemory(previousTaskMemory);
      setProjectMemory(previousProjectMemory);
      syncThreadInUrl(previousThreadId);
    }
  }

  function applyTaskTemplate(template: TaskTemplate) {
    setSelectedTaskTemplateKey(template.key);
    setDraft(template.chat_defaults.prompt);
    setTemplateNotice(
      `${template.name} loaded. We prefilled the task brief and switched the operator pane toward the recommended workflow.`
    );
    setOperatorTab(template.recommended_operator_tab);
    setError(null);
  }

  function clearTaskTemplate() {
    setSelectedTaskTemplateKey(null);
    setTemplateNotice(null);
  }

  function toggleComposerShortcut(shortcut: ComposerShortcut) {
    const isEnabled = selectedComposerShortcutKeys.includes(shortcut.key);
    setSelectedComposerShortcutKeys((current) =>
      isEnabled ? current.filter((value) => value !== shortcut.key) : [...current, shortcut.key]
    );
    setComposerNotice(`${shortcut.label} shortcut ${isEnabled ? "removed" : "enabled"} for the next run.`);
    setComposerError(null);
    setOperatorTab(shortcut.operatorTab);
  }

  function removeComposerAttachment(attachmentId: string) {
    setComposerAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }

  function attachWorkbenchFile() {
    if (!selectedWorkbenchFile) {
      setComposerError("Open a workspace file first if you want to attach it to the next run.");
      return;
    }
    const nextAttachment: ComposerAttachment = {
      id: `workbench-${selectedWorkbenchFile.relative_path}`,
      kind: "workbench_file",
      label: selectedWorkbenchFile.name,
      description: "Workspace file attached from the live code workbench.",
      relative_path: selectedWorkbenchFile.relative_path,
      mime_type: selectedWorkbenchFile.extension ?? null
    };
    setComposerAttachments((current) => [
      nextAttachment,
      ...current.filter((attachment) => attachment.id !== nextAttachment.id)
    ]);
    setComposerNotice(`${selectedWorkbenchFile.relative_path} attached to the next run.`);
    setComposerError(null);
  }

  function attachRecentArtifact(artifact: ToolArtifactRef) {
    const nextAttachment: ComposerAttachment = {
      id: `artifact-${artifact.storage_key}`,
      kind: "artifact",
      label: artifactLabel(artifact),
      description: "Recent generated output attached from the operator canvas.",
      artifact_id: artifact.storage_key,
      storage_key: artifact.storage_key,
      mime_type: artifact.content_type ?? null
    };
    setComposerAttachments((current) => [
      nextAttachment,
      ...current.filter((attachment) => attachment.id !== nextAttachment.id)
    ]);
    setComposerNotice(`${artifactLabel(artifact)} attached to the next run.`);
    setComposerError(null);
  }

  function attachUrlReference() {
    const normalized = urlAttachmentDraft.trim();
    if (!normalized) {
      return;
    }
    try {
      const parsed = new URL(normalized);
      const nextAttachment: ComposerAttachment = {
        id: `url-${parsed.toString()}`,
        kind: "url",
        label: parsed.hostname,
        description: "Source URL attached from the composer.",
        source_uri: parsed.toString()
      };
      setComposerAttachments((current) => [
        nextAttachment,
        ...current.filter((attachment) => attachment.id !== nextAttachment.id)
      ]);
      setUrlAttachmentDraft("");
      setComposerNotice(`${parsed.toString()} attached as a source URL.`);
      setComposerError(null);
    } catch {
      setComposerError("Enter a valid URL before attaching it.");
    }
  }

  async function uploadComposerFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || composerUploading) {
      return;
    }
    setComposerUploading(true);
    setComposerError(null);
    setComposerNotice(null);

    try {
      const formData = new FormData();
      formData.append("workspace_id", data.workspace_id);
      formData.append("tags", currentProjectId ? "chat-composer,project" : "chat-composer");
      for (const file of Array.from(fileList)) {
        formData.append("files", file);
      }

      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json().catch(() => ({ detail: "Upload failed." }))) as
        | DocumentUploadResponse
        | { detail?: string };
      if (!response.ok || !("documents" in payload)) {
        setComposerError(("detail" in payload && payload.detail) || "Upload failed.");
        return;
      }

      const uploadedAttachments = payload.documents.map<ComposerAttachment>((document: KnowledgeDocument) => ({
        id: `document-${document.id}`,
        kind: "document",
        label: document.title,
        description: "Uploaded into workspace knowledge from the chat composer.",
        document_id: document.id,
        source_uri: document.source_uri,
        mime_type: document.mime_type,
        created_at: document.created_at
      }));

      setComposerAttachments((current) => {
        const deduped = current.filter(
          (attachment) => !uploadedAttachments.some((uploaded) => uploaded.id === attachment.id)
        );
        return [...uploadedAttachments, ...deduped];
      });
      setComposerNotice(
        `${uploadedAttachments.length} attachment${uploadedAttachments.length === 1 ? "" : "s"} uploaded into workspace knowledge and linked to the next run.`
      );
    } catch {
      setComposerError("Upload service is unavailable right now.");
    } finally {
      setComposerUploading(false);
      if (composerFileInputRef.current) {
        composerFileInputRef.current.value = "";
      }
    }
  }

  function toggleVoiceInput() {
    const browserWindow = window as typeof window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const SpeechRecognitionCtor =
      browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
    if (!SpeechRecognitionCtor) {
      setComposerError("Voice input is not supported in this browser.");
      return;
    }

    if (voiceListening) {
      speechRecognitionRef.current?.stop();
      setVoiceListening(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (const result of event.results) {
        for (const alternative of result) {
          if (alternative.isFinal) {
            finalTranscript += `${alternative.transcript} `;
          } else {
            interimTranscript += `${alternative.transcript} `;
          }
        }
      }
      if (finalTranscript.trim()) {
        setVoiceCapturedInDraft(true);
        setDraft((current) =>
          `${current.trim()}${current.trim() ? "\n" : ""}${finalTranscript.trim()}`.trim()
        );
      }
      setVoiceInterimTranscript(interimTranscript.trim());
    };
    recognition.onerror = (event) => {
      setComposerError(event.error ? `Voice input stopped: ${event.error}.` : "Voice input stopped unexpectedly.");
      setVoiceListening(false);
      setVoiceInterimTranscript("");
    };
    recognition.onend = () => {
      setVoiceListening(false);
      setVoiceInterimTranscript("");
    };
    speechRecognitionRef.current = recognition;
    setComposerError(null);
    setComposerNotice("Voice dictation started. Finalized transcript will be appended into the composer.");
    setVoiceListening(true);
    recognition.start();
  }

  async function submitRunMessage(messageInput: string) {
    const message = messageInput.trim();
    if (!message || running) {
      return;
    }
    if (isTaskPaused) {
      setError("This task is paused. Resume it before starting another run.");
      return;
    }

    let resolvedThreadId = currentThreadId;
    let resolvedRunId: string | null = null;
    const composerContext = buildComposerContextPayload(
      composerAttachments,
      selectedComposerShortcuts,
      voiceCapturedInDraft,
      voiceEngine
    );
    const finalMessage = buildRunMessageFromComposer(
      message,
      composerAttachments,
      selectedComposerShortcuts,
      voiceCapturedInDraft
    );

    const optimisticId = `local-user-${Date.now()}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      thread_id: resolvedThreadId ?? "pending-thread",
      run_id: null,
      role: "user",
      content: finalMessage,
      citations: [],
      metadata: composerContext,
      created_at: new Date().toISOString()
    };

    setMessages((current) => [...current, optimisticMessage]);
    setDraft("");
    setError(null);
    setComposerError(null);
    setComposerNotice(null);
    setTodoSyncError(null);
    setTodoSyncNotice(null);
    setRunning(true);
    speechRecognitionRef.current?.stop();
    setVoiceListening(false);
    setLivePlan([]);
    setExecutionBatches([]);
    setLiveSteps([]);
    setActiveBatchIndex(null);
    setLiveTimeline([]);
    setLiveSessions({});
    setLiveArtifacts([]);
    setLiveWorkbenchActivities([]);
    setComputerError(null);
    setComputerNotice(null);
    setOperatorTab(selectedTaskTemplate?.recommended_operator_tab ?? "computer");

    const payload: ChatRunRequestPayload = {
      workspace_id: data.workspace_id,
      thread_id: currentThreadId,
      project_id: currentProjectId,
      message: finalMessage,
      mode: "autonomous",
      use_retrieval:
        selectedTaskTemplate?.chat_defaults.use_retrieval ??
        (selectedComposerShortcuts.length > 0
          ? selectedComposerShortcuts.some((shortcut) => shortcut.retrieval !== false)
          : true),
      model_profile:
        selectedTaskTemplate?.chat_defaults.model_profile ??
        selectedComposerShortcuts.find((shortcut) => shortcut.modelProfile)?.modelProfile ??
        selectedModelProfile,
      template_key: selectedTaskTemplateKey,
      composer_context: composerContext
    };

    try {
      const response = await fetch("/api/chat/runs/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const failure = await response.json().catch(() => ({ detail: "Streaming failed." }));
        setError(failure.detail ?? "Streaming failed.");
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
        setRunning(false);
        return;
      }

      await consumeEventStream(response, (streamEvent) => {
        const { event, data } = streamEvent;

        const timelineEntry = timelineEntryFromStream(event, data);
        if (timelineEntry) {
          setLiveTimeline((current) => [timelineEntry, ...current].slice(0, 80));
        }

        const approvalRequest = approvalRequestFromStream(event, data);
        if (approvalRequest) {
          setLiveApprovalRequests((current) => mergeApprovalRequests(current, approvalRequest));
        }

        const workbenchActivity = workbenchActivityFromEvent(event, data);
        if (workbenchActivity) {
          recordWorkbenchActivity(workbenchActivity, isRecord(data.result) ? data.result : undefined);
        }

        if (event === "tool.completed" && data.tool === "workspace_files" && isRecord(data.result)) {
          const treePayload = buildWorkbenchTreeFromToolResult(data.result, workspaceId);
          if (treePayload) {
            setWorkbenchTree((current) => ({
              ...current,
              [treePayload.relative_path]: treePayload
            }));
            setExpandedDirectories((current) => ({
              ...current,
              [treePayload.relative_path]: true
            }));
          }

          const filePayload = buildWorkbenchFileFromToolResult(data.result, workspaceId);
          if (filePayload) {
            upsertWorkbenchEditor(filePayload, { activate: true, preserveDraft: true });
          }

          if (
            data.result.operation === "write_text" ||
            data.result.operation === "write_json"
          ) {
            scheduleWorkbenchRepoRefresh();
          }
        }

        if (event === "artifact.created") {
          const artifacts = toToolArtifacts(data.artifact);
          if (artifacts.length > 0) {
            setLiveArtifacts((current) => mergeArtifacts(current, artifacts));
          }
          return;
        }

        if (
          event === "computer.session.started" ||
          event === "computer.session.updated" ||
          event === "computer.session.completed" ||
          event === "computer.session.failed" ||
          event === "browser.snapshot" ||
          event === "terminal.stdout" ||
          event === "terminal.stderr"
        ) {
          const session = sessionFromEventData(data);
          if (session) {
            setLiveSessions((current) => upsertSessionState(current, session));
            if ((session.artifacts?.length ?? 0) > 0) {
              setLiveArtifacts((current) => mergeArtifacts(current, session.artifacts ?? []));
            }
          }
        }

        if (event === "thread") {
          const threadId = String(data.thread_id ?? resolvedThreadId ?? "pending-thread");
          resolvedThreadId = threadId;
          const nextThread: Thread = {
            id: threadId,
            workspace_id: String(data.workspace_id ?? ""),
            project_id: typeof data.project_id === "string" ? data.project_id : currentProjectId ?? null,
            title: String(data.title ?? message.slice(0, 70)),
            status: "active",
            metadata: composerContext,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 0,
            run_count: 0,
            last_message_preview: finalMessage,
            last_activity_at: new Date().toISOString()
          };
          setCurrentThreadId(threadId);
          syncThreadInUrl(threadId);
          setThreads((current) => upsertThread(current, nextThread));
          setTaskMemory(toSharedMemory(data.task_memory));
          setProjectMemory(toSharedMemory(data.project_memory));
          setMessages((current) =>
            current.map((item) => (item.id === optimisticId ? { ...item, thread_id: threadId } : item))
          );
          return;
        }

        if (event === "run.created") {
          resolvedRunId = String(data.run_id ?? "");
          const provisionalRun: ChatRun = {
            id: resolvedRunId,
            thread_id: String(data.thread_id ?? resolvedThreadId ?? ""),
            workspace_id: String(data.workspace_id ?? ""),
            status: String(data.status ?? "running"),
            supervisor_model: String(data.supervisor_model ?? selectedModelProfile),
            user_message: String(data.user_message ?? finalMessage),
            final_response: null,
            summary: null,
            plan: [],
            created_at: String(data.created_at ?? new Date().toISOString())
          };
          setRuns((current) => [provisionalRun, ...current.filter((item) => item.id !== provisionalRun.id)]);
          return;
        }

        if (event === "plan") {
          setLivePlan((data.plan as LivePlanStep[]) ?? []);
          if (resolvedRunId) {
            setRuns((current) =>
              current.map((run) =>
                run.id === resolvedRunId ? { ...run, plan: ((data.plan as ChatRun["plan"]) ?? []) } : run
              )
            );
          }
          return;
        }

        if (event === "batches") {
          setExecutionBatches((data.batches as string[][]) ?? []);
          return;
        }

        if (event === "batch.started") {
          setActiveBatchIndex(Number(data.batch_index ?? 0));
          return;
        }

        if (event === "batch.completed") {
          setActiveBatchIndex((current) =>
            current === Number(data.batch_index ?? -1) ? null : current
          );
          return;
        }

        if (event === "step.started") {
          setLiveSteps((current) =>
            upsertLiveStep(current, {
              step_index: Number(data.step_index ?? 0),
              batch_index: Number(data.batch_index ?? 0),
              agent_key: String(data.agent_key ?? ""),
              agent_name: String(data.agent_name ?? ""),
              status: String(data.status ?? "running"),
              objective: String(data.objective ?? ""),
              dependencies: ((data.dependencies as string[]) ?? []).map(String),
              execution_mode: String(data.execution_mode ?? "")
            })
          );
          return;
        }

        if (event === "step.escalated") {
          setLiveSteps((current) =>
            upsertLiveStep(current, {
              step_index: Number(data.step_index ?? 0),
              batch_index: Number(data.batch_index ?? 0),
              agent_key: String(data.agent_key ?? ""),
              agent_name: String(data.agent_name ?? ""),
              status: String(data.status ?? "escalating"),
              dependencies: [],
              validation_summary: String(
                ((data.validation as Record<string, unknown>)?.summary as string) ?? ""
              ),
              escalated: true
            })
          );
          return;
        }

        if (event === "step.completed") {
          setLiveSteps((current) =>
            upsertLiveStep(current, {
              step_index: Number(data.step_index ?? 0),
              batch_index: Number(data.batch_index ?? 0),
              agent_key: String(data.agent_key ?? ""),
              agent_name: String(data.agent_name ?? ""),
              status: String(data.status ?? "completed"),
              dependencies: ((data.dependencies as string[]) ?? []).map(String),
              execution_mode: String(data.execution_mode ?? ""),
              confidence: Number(data.confidence ?? 0),
              validation_summary: String(
                ((data.validation as Record<string, unknown>)?.summary as string) ?? ""
              ),
              summary: String(data.summary ?? ""),
              model: String(data.model ?? ""),
              provider: String(data.provider ?? ""),
              tools: (((data.tools as { tool: string; status: string }[]) ?? []) as {
                tool: string;
                status: string;
              }[])
            })
          );
          return;
        }

        if (event === "final") {
          const nextTaskMemory = toSharedMemory(data.task_memory);
          const nextProjectMemory = toSharedMemory(data.project_memory);
          if (nextTaskMemory) {
            setTaskMemory(nextTaskMemory);
          }
          if (nextProjectMemory) {
            setProjectMemory(nextProjectMemory);
          }
          const assistantMessage: Message = {
            id: `local-assistant-${Date.now()}`,
            thread_id: resolvedThreadId ?? "pending-thread",
            run_id: resolvedRunId,
            role: "assistant",
            content: String(data.response ?? ""),
            citations: ((data.citations as Message["citations"]) ?? []) as Message["citations"],
            metadata: {
              summary: String(data.summary ?? ""),
              execution_batches: data.execution_batches ?? [],
              scratchpad: data.scratchpad ?? {},
              task_memory: data.task_memory ?? null,
              project_memory: data.project_memory ?? null
            },
            created_at: new Date().toISOString()
          };
          setMessages((current) => [...current, assistantMessage]);
          if (resolvedRunId) {
            setRuns((current) =>
              current.map((run) =>
                run.id === resolvedRunId
                  ? {
                      ...run,
                      status: "completed",
                      final_response: assistantMessage.content,
                      summary: String(data.summary ?? "")
                    }
                  : run
              )
            );
          }
          return;
        }

        if (event === "run.persisted") {
          if (resolvedThreadId) {
            void refreshWorkspace(resolvedThreadId);
          }
          return;
        }

        if (event === "error") {
          setError(String(data.message ?? "Streaming failed."));
          if (resolvedRunId) {
            setRuns((current) =>
              current.map((run) =>
                run.id === resolvedRunId ? { ...run, status: "failed", summary: String(data.message ?? "") } : run
              )
            );
          }
          return;
        }

        if (event === "done") {
          setRunning(false);
          setActiveBatchIndex(null);
        }
      });
      setComposerAttachments([]);
      setSelectedComposerShortcutKeys([]);
      setVoiceInterimTranscript("");
      setVoiceCapturedInDraft(false);
    } catch {
      setError("Live run streaming is unavailable.");
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setRunning(false);
      setActiveBatchIndex(null);
    } finally {
      setRunning(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitRunMessage(draft);
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (running || isTaskPaused || !draft.trim()) {
      return;
    }
    void submitRunMessage(draft);
  }

  function renderWorkbenchDirectory(relativePath: string, depth = 0) {
    const directory = workbenchTree[relativePath];
    if (!directory) {
      return null;
    }

    return (
      <div className="space-y-1" key={`dir-${relativePath}`}>
        {directory.entries.map((entry) => {
          const isDirectory = entry.kind === "dir";
          const isExpanded = Boolean(expandedDirectories[entry.relative_path]);
          const isSelected = selectedWorkbenchPath === entry.relative_path;
          const editorState = !isDirectory ? workbenchEditors[entry.relative_path] : null;
          const isDirty = Boolean(
            editorState && editorState.draftContent !== editorState.originalContent
          );
          const repoFileState =
            !isDirectory
              ? repoState?.changed_files.find((item) => item.relative_path === entry.relative_path) ?? null
              : null;
          const directActivity = workbenchActivityByPath.get(entry.relative_path) ?? null;
          const nestedActivity = isDirectory
            ? liveWorkbenchActivities.find(
                (activity) =>
                  activity.directory_path === entry.relative_path ||
                  activity.relative_path === entry.relative_path ||
                  activity.entry_paths.some((path) => path.startsWith(`${entry.relative_path}/`)) ||
                  (activity.relative_path?.startsWith(`${entry.relative_path}/`) ?? false)
              ) ?? null
            : null;
          const activity = directActivity ?? nestedActivity;
          return (
            <div key={entry.relative_path}>
              <button
                type="button"
                onClick={() =>
                  isDirectory ? void toggleWorkbenchDirectory(entry.relative_path) : void openWorkbenchFile(entry.relative_path)
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm transition",
                  isSelected
                    ? "bg-ink text-white"
                    : "bg-white/60 text-black/[0.72] hover:bg-white",
                  activity && !isSelected && "ring-1 ring-black/10",
                  depth > 0 && "ml-4"
                )}
              >
                {isDirectory ? (
                  isExpanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )
                ) : (
                  <FileText className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{entry.name}</span>
                {!isDirectory && isDirty && (
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-amber-900">
                    dirty
                  </span>
                )}
                {!isDirectory && repoFileState && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.12em]",
                      workbenchStatusTone(repoFileState.status)
                    )}
                  >
                    {repoFileState.status}
                  </span>
                )}
                {activity && (
                  <span
                    className={cn(
                      "rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em]",
                      workbenchActivityTone(activity)
                    )}
                  >
                    {workbenchActivityLabel(activity)}
                  </span>
                )}
                {!isDirectory && entry.extension && (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.12em]",
                      isSelected ? "bg-white/15 text-white/80" : "bg-black/[0.05] text-black/[0.45]"
                    )}
                  >
                    {entry.extension.replace(".", "")}
                  </span>
                )}
              </button>
              {isDirectory && isExpanded && (
                <div className="mt-1">
                  {workbenchTree[entry.relative_path] ? (
                    renderWorkbenchDirectory(entry.relative_path, depth + 1)
                  ) : workbenchLoadingPath === entry.relative_path ? (
                    <div className="ml-6 rounded-2xl bg-white/70 px-3 py-2 text-xs text-black/[0.5]">
                      Loading directory...
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section
      ref={workspaceShellRef}
      className="grid grid-cols-1 gap-2 xl:h-full xl:min-h-0 xl:items-stretch xl:gap-0 xl:[grid-template-columns:var(--workspace-columns)]"
      style={workspaceShellStyle}
    >
      <div className={cn("min-w-0 min-h-0", workbenchExpanded && "hidden")}>
        {isDesktopWorkspace && workspacePaneCollapsed ? (
          <div className="surface-card-strong flex h-full min-h-[calc(100vh-13rem)] flex-col items-center justify-between px-3 py-5">
            <button
              type="button"
              onClick={toggleWorkspacePaneCollapsed}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.72] transition hover:bg-sand/60"
              aria-label="Expand chat workspace"
              title="Expand chat workspace"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-3 [writing-mode:vertical-rl]">
              <MessageSquareMore className="h-4 w-4 text-black/[0.5]" />
              <span className="text-xs uppercase tracking-[0.2em] text-black/[0.52]">
                Chat workspace
              </span>
            </div>
            <div className="text-center text-[11px] uppercase tracking-[0.16em] text-black/[0.42]">
              {messages.length} msgs
            </div>
          </div>
        ) : (
          <div className="surface-card-strong flex h-full min-h-0 flex-col p-4 lg:p-5">
        <div className="flex min-h-0 flex-1 flex-col">
        <motion.div layout className="operating-strip mb-4 px-4 py-3 xl:hidden">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div>
              <p className="surface-label">Task cockpit</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-black/[0.5]">
                <span className="rounded-full bg-black text-white px-3 py-1.5">
                  {activeThread ? "Active task" : currentProjectId ? "Project queue" : "Workspace ready"}
                </span>
                {activeThread && (
                  <span className="rounded-full bg-white/80 px-3 py-1.5">
                    {activeThread.title}
                  </span>
                )}
                {currentProjectId && (
                  <span className="rounded-full bg-white/70 px-3 py-1.5">
                    Project scoped
                  </span>
                )}
                {selectedTaskTemplate && (
                  <span className="rounded-full bg-white/70 px-3 py-1.5">
                    {selectedTaskTemplate.name}
                  </span>
                )}
                <span className="rounded-full bg-white/70 px-3 py-1.5">
                  {isTaskPaused ? "Paused" : running ? "Running live" : "Ready for next run"}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-black/[0.62]">
                Mobile and compact layouts keep a lighter task summary above the conversation.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <motion.div layout className="rounded-[20px] bg-white/76 px-3 py-3">
                <p className="surface-label">Checklist</p>
                <p className="mt-2 text-xl font-display text-black/[0.82]">
                  {completedChecklistCount}/{checklistItems.length}
                </p>
                <p className="mt-1 text-xs text-black/[0.6]">Plan progress</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.08]">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-ink via-pine to-sand"
                    animate={{ width: `${Math.max(checklistCompletionRatio * 100, checklistItems.length > 0 ? 8 : 0)}%` }}
                    transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 180, damping: 28 }}
                  />
                </div>
              </motion.div>
              <motion.div layout className="rounded-[20px] bg-white/72 px-3 py-3">
                <p className="surface-label">Approvals</p>
                <p className="mt-2 text-xl font-display text-black/[0.82]">
                  {pendingApprovalRequests.length}
                </p>
                <p className="mt-1 text-xs text-black/[0.6]">Human gates</p>
              </motion.div>
              <motion.div layout className="rounded-[20px] bg-white/72 px-3 py-3">
                <p className="surface-label">Computer Sessions</p>
                <p className="mt-2 text-xl font-display text-black/[0.82]">{computerSessions.length}</p>
                <p className="mt-1 text-xs text-black/[0.6]">Browser + terminal</p>
              </motion.div>
              <motion.div layout className="rounded-[20px] bg-white/76 px-3 py-3">
                <p className="surface-label">Outputs</p>
                <p className="mt-2 text-xl font-display text-black/[0.82]">{mergedArtifacts.length}</p>
                <p className="mt-1 text-xs text-black/[0.6]">Deliverables</p>
              </motion.div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
              {operatingFlowStages.map((stage, index) => {
                return (
                  <motion.button
                    key={stage.key}
                    layout
                    type="button"
                    onClick={() => setOperatorTab(stage.tab)}
                    className={cn(
                      "rounded-full border px-3 py-2 text-left text-xs uppercase tracking-[0.14em] transition",
                      stage.status === "complete"
                        ? "border-emerald-200 bg-emerald-50/75"
                        : stage.status === "active"
                          ? "border-ink/20 bg-white/88 shadow-[0_10px_24px_rgba(15,58,50,0.08)]"
                          : "border-black/10 bg-white/72"
                    )}
                    whileHover={prefersReducedMotion ? undefined : { y: -2 }}
                    transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 230, damping: 24 }}
                  >
                    <span className="text-black/[0.46]">{index + 1}.</span> {stage.label} {" "}
                    <span className="font-medium text-black/[0.78]">{stage.value}</span>
                  </motion.button>
                );
              })}
          </div>
        </motion.div>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/10 pb-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="surface-label">Chat</p>
              {running ? (
                <span className="rounded-full bg-black text-white px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]">
                  Live run
                </span>
              ) : activeThread ? (
                <span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-black/[0.46]">
                  {formatRelativeTime(activeThread.updated_at)}
                </span>
              ) : null}
            </div>
            <h1 className="font-display text-[1.55rem] leading-[1.04] text-black/[0.86] xl:text-[1.7rem]">
              {activeThread?.title ?? selectedProject?.name ?? "Swarm workspace"}
            </h1>
            <p className="max-w-[38rem] text-sm leading-6 text-black/[0.54]">
              {activeThread
                ? "Conversation stays centered here while the workbench handles execution on the right."
                : currentProjectId
                  ? "Choose a task from the rail or start a fresh thread."
                  : "Start a task from the rail and keep this column focused on chat."}
            </p>
          </div>
          <div className="flex max-w-[660px] flex-wrap items-center justify-end gap-1.5">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm text-black/[0.68]">
              <span className="text-[10px] uppercase tracking-[0.14em] text-black/[0.45]">Model</span>
              <div className="relative">
                <select
                  value={selectedModelProfile}
                  onChange={(event) => void handleModelProfileChange(event.target.value)}
                  disabled={!activeThread || headerActionLoading === "model"}
                  className="appearance-none bg-transparent pr-6 text-[13px] outline-none disabled:opacity-60"
                >
                  {MODEL_PROFILE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-black/[0.45]" />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setHeaderPanel((current) => (current === "share" ? null : "share"));
                setHeaderError(null);
                setHeaderNotice(null);
              }}
              disabled={!activeThread}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-[13px] text-black/[0.72] disabled:opacity-60"
            >
              <Copy className="h-3.5 w-3.5" />
              Share
            </button>
            <button
              type="button"
              onClick={() => {
                setHeaderPanel((current) => (current === "settings" ? null : "settings"));
                setHeaderError(null);
                setHeaderNotice(null);
              }}
              disabled={!activeThread}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-[13px] text-black/[0.72] disabled:opacity-60"
            >
              <Settings2 className="h-3.5 w-3.5" />
              More
            </button>
            <button
              type="button"
              className="rounded-full bg-ink px-3.5 py-2 text-[13px] text-white"
              onClick={createThread}
            >
              New
            </button>
            <button
              type="button"
              onClick={toggleWorkspacePaneCollapsed}
              className="hidden h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.72] transition hover:bg-sand/45 xl:inline-flex"
              aria-label="Collapse chat workspace"
              title="Collapse chat workspace"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
            </button>
          </div>
        </div>

        {(headerPanel || headerError || headerNotice) && (
          <div className="mt-3 rounded-[20px] border border-black/10 bg-white/75 p-3.5">
            {headerError && <p className="text-sm text-red-700">{headerError}</p>}
            {headerNotice && <p className="text-sm text-emerald-700">{headerNotice}</p>}

            {headerPanel === "share" && activeThread && (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-sm font-medium text-black/[0.82]">Share this task</p>
                  <p className="mt-1 text-sm leading-7 text-black/[0.62]">
                    Copy a direct workspace link to this task. This stays inside the authenticated app experience.
                  </p>
                </div>
                <div className="rounded-[20px] border border-black/10 bg-sand/45 px-4 py-3 text-sm text-black/[0.7]">
                  {withWorkspacePath("/app/chat", data.workspace_id, {
                    project: activeThread.project_id,
                    thread: activeThread.id
                  })}
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void copyTaskShareLink()}
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy task link
                  </button>
                  <span className="rounded-full bg-black/[0.04] px-3 py-2 text-sm text-black/[0.62]">
                    {shareEnabled ? "Share enabled" : "Share link has not been used yet"}
                  </span>
                </div>
              </div>
            )}

            {headerPanel === "settings" && activeThread && (
              <div className="mt-3 space-y-4">
                <div>
                  <p className="text-sm font-medium text-black/[0.82]">Task actions and settings</p>
                  <p className="mt-1 text-sm leading-7 text-black/[0.62]">
                    Keep the header quiet, then handle publish, duplicate, collaborator, and task state controls here.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => void togglePublishState()}
                    disabled={headerActionLoading === "publish"}
                    className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm text-black/[0.72] transition hover:bg-sand/35 disabled:opacity-60"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    {headerActionLoading === "publish" ? "Saving..." : publishState ? "Unpublish task" : "Publish task"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void forkActiveThread()}
                    disabled={headerActionLoading === "fork"}
                    className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm text-black/[0.72] transition hover:bg-sand/35 disabled:opacity-60"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {headerActionLoading === "fork" ? "Forking..." : "Duplicate thread"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void setTaskStatus(isTaskPaused ? "active" : "paused")}
                    disabled={headerActionLoading === "active" || headerActionLoading === "paused"}
                    className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm text-black/[0.72] transition hover:bg-sand/35 disabled:opacity-60"
                  >
                    {isTaskPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                    {isTaskPaused ? "Resume task" : "Pause task"}
                  </button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm text-black/[0.72]">
                    <span className="block text-xs uppercase tracking-[0.16em] text-black/[0.45]">Title</span>
                    <input
                      value={threadTitleDraft}
                      onChange={(event) => setThreadTitleDraft(event.target.value)}
                      className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 outline-none"
                    />
                  </label>
                  <label className="space-y-2 text-sm text-black/[0.72]">
                    <span className="block text-xs uppercase tracking-[0.16em] text-black/[0.45]">Status</span>
                    <select
                      value={threadStatusDraft}
                      onChange={(event) => setThreadStatusDraft(event.target.value)}
                      className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 outline-none"
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="archived">Archived</option>
                    </select>
                  </label>
                </div>
                <div className="space-y-3 rounded-[20px] border border-black/10 bg-sand/25 px-4 py-4">
                  <div>
                    <p className="text-sm font-medium text-black/[0.82]">Collaborators</p>
                    <p className="mt-1 text-sm leading-7 text-black/[0.62]">
                      Manage the people attached to this task without dedicating a permanent header button to it.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {collaboratorList.length > 0 ? (
                      collaboratorList.map((email) => (
                        <span key={email} className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-black/[0.7]">
                          {email}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-black/[0.55]">No collaborators attached yet.</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <input
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="colleague@example.com"
                      className="min-w-[260px] rounded-full border border-black/10 bg-white px-4 py-2 text-sm outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void inviteCollaborator()}
                      disabled={!inviteEmail.trim() || headerActionLoading === "invite"}
                      className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {headerActionLoading === "invite" ? "Adding..." : "Add collaborator"}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void saveTaskSettings()}
                    disabled={!threadTitleDraft.trim() || headerActionLoading === "settings"}
                    className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                  >
                    {headerActionLoading === "settings" ? "Saving..." : "Save settings"}
                  </button>
                  <span className="rounded-full bg-black/[0.04] px-3 py-2 text-sm text-black/[0.62]">
                    {publishState ? "Currently published" : "Currently private"}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="workflow-surface mt-4 xl:hidden">
          <div className="workflow-surface-header">
            <div>
              <p className="surface-label">Workflow Cockpit</p>
              <h2 className="mt-2 text-xl font-medium text-black/[0.82]">
                Current task, execution progress, and operator focus now move as one connected surface.
              </h2>
              <p className="mt-2 text-sm leading-7 text-black/[0.62]">
                Stay oriented here, then jump straight into the most useful operator view without mentally stitching separate panels together.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOperatorTab(workflowRecommendedTab)}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/85 px-4 py-2 text-sm text-black/[0.72] transition hover:bg-white"
            >
              <MonitorSmartphone className="h-4 w-4" />
              Focus {workflowRecommendedTabLabel}
            </button>
          </div>
          <div className="workflow-connector mt-4">
            <div className="workflow-connector-line" />
            <div className="workflow-connector-grid">
              <motion.div layout className="workflow-node workflow-node-accent">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-black/[0.42]">Current Task</p>
                    <h3 className="mt-2 text-lg font-medium text-black/[0.82]">
                      {activeThread?.title ??
                        (currentProjectId ? "No task selected in this project yet" : "Task selection is loading")}
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-black/[0.62]">
                      {activeThread
                        ? workflowFocusSummary
                        : currentProjectId
                          ? "This project does not have a selected task yet. Start a new task from the left rail to begin building run history."
                          : "Use the left rail to start a new task, search history, or switch between persisted task runs."}
                    </p>
                  </div>
                  {activeThread && (
                    <div className="rounded-[22px] bg-sand/70 px-4 py-3 text-sm text-black/[0.68]">
                      <div className="flex items-center justify-end gap-2">
                        <Badge className={statusBadgeClass(activeThread.status)}>
                          {statusLabel(activeThread.status)}
                        </Badge>
                        {pendingApprovalRequests.length > 0 && (
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-amber-900">
                            {pendingApprovalRequests.length} approval{pendingApprovalRequests.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                      <div className="mt-2">{activeThread.run_count ?? 0} runs</div>
                      <div className="mt-1">{activeThread.message_count ?? 0} messages</div>
                      <div className="mt-3 flex justify-end">
                        {isTaskPaused ? (
                          <button
                            type="button"
                            onClick={() => void setTaskStatus("active")}
                            disabled={headerActionLoading === "active"}
                            className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-2 text-xs text-white disabled:opacity-60"
                          >
                            <Play className="h-3.5 w-3.5" />
                            {headerActionLoading === "active" ? "Resuming..." : "Resume task"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void setTaskStatus("paused")}
                            disabled={headerActionLoading === "paused"}
                            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/85 px-3 py-2 text-xs text-black/[0.72] disabled:opacity-60"
                          >
                            <Pause className="h-3.5 w-3.5" />
                            {headerActionLoading === "paused"
                              ? "Pausing..."
                              : running
                                ? "Pause after this cycle"
                                : "Pause task"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {workflowStateChips.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {workflowStateChips.map((chip) => (
                      <span key={chip} className="workflow-chip">
                        {chip}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setOperatorTab(workflowRecommendedTab)}
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white"
                  >
                    <MonitorSmartphone className="h-4 w-4" />
                    Open {workflowRecommendedTabLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOperatorTab("timeline")}
                    className="rounded-full border border-black/10 bg-white/85 px-4 py-2 text-sm text-black/[0.72] transition hover:bg-white"
                  >
                    View live timeline
                  </button>
                </div>
              </motion.div>
              <motion.div layout className="workflow-node">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                      <FileText className="h-4 w-4" />
                      Task checklist
                    </div>
                    <p className="mt-2 text-sm leading-7 text-black/[0.62]">
                      The latest plan is tracked here inline, and completed items can be synced into a linked todo file for the coding workspace.
                    </p>
                  </div>
                  <div className="rounded-[22px] bg-sand/70 px-4 py-3 text-right text-sm text-black/[0.68]">
                    <div>
                      {completedChecklistCount} / {checklistItems.length || 0} completed
                    </div>
                    <div className="mt-1">
                      {running ? "Live plan in progress" : latestRun ? "From latest persisted run" : "Awaiting first run"}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <label className="text-xs uppercase tracking-[0.16em] text-black/[0.46]">
                    Linked file
                  </label>
                  <select
                    value={todoSyncPath}
                    onChange={(event) => setTodoSyncPath(event.target.value)}
                    className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-black/[0.72] outline-none"
                  >
                    {todoFileOptions.map((path) => (
                      <option key={path} value={path}>
                        {path}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void syncChecklistToTodo()}
                    disabled={!activeThread || checklistItems.length === 0 || todoSyncing}
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                  >
                    {todoSyncing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    {todoSyncing ? "Syncing..." : "Sync to todo file"}
                  </button>
                  {todoFileKnownExists && (
                    <button
                      type="button"
                      onClick={() => void openWorkbenchFile(todoSyncPath)}
                      className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/[0.72] transition hover:bg-sand/45"
                    >
                      Open linked file
                    </button>
                  )}
                </div>

                {todoSyncError && <p className="mt-3 text-sm text-red-700">{todoSyncError}</p>}
                {todoSyncNotice && <p className="mt-3 text-sm text-emerald-700">{todoSyncNotice}</p>}

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/[0.08]">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-ink via-pine to-sand"
                    animate={{ width: `${Math.max(checklistCompletionRatio * 100, checklistItems.length > 0 ? 10 : 0)}%` }}
                    transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 180, damping: 26 }}
                  />
                </div>

                <div className="mt-4 space-y-3">
                  {checklistItems.length === 0 ? (
                    <div className="rounded-[22px] border border-dashed border-black/10 bg-sand/35 px-4 py-4 text-sm text-black/[0.58]">
                      Start a run to generate a persisted checklist for this task. Once the supervisor creates a plan, we can sync it into a markdown todo workflow.
                    </div>
                  ) : (
                    checklistItems.map((item) => (
                      <motion.div
                        layout
                        key={item.id}
                        className={cn(
                          "rounded-[22px] border px-4 py-4 transition",
                          checklistToneClass(item.status)
                        )}
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 14, scale: 0.985 }}
                        animate={prefersReducedMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1, y: 0, scale: 1 }}
                        transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 26 }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <span className={cn("mt-1 h-2.5 w-2.5 rounded-full", checklistDotClass(item.status))} />
                            <div>
                              <p className="text-sm font-medium">{item.title}</p>
                              {item.summary && (
                                <p className="mt-2 text-sm leading-7 text-black/[0.72]">{item.summary}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <Badge className={statusBadgeClass(item.status)}>{statusLabel(item.status)}</Badge>
                            {activeChecklistItem?.id === item.id && (
                              <span className="workflow-chip">current focus</span>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.5]">
                          <span>step {item.step_index + 1}</span>
                          {item.agent_name && <span>{item.agent_name}</span>}
                          {item.execution_mode && <span>{item.execution_mode}</span>}
                          {item.dependencies.length > 0 && <span>depends on {item.dependencies.join(", ")}</span>}
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </motion.div>
            </div>
          </div>
        </div>

        {(isTaskPaused || pendingApprovalRequests.length > 0) && (
          <div className="mt-4 space-y-4 xl:hidden">
            {isTaskPaused && (
              <div className="rounded-[26px] border border-amber-200 bg-amber-50/90 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-950">
                      <Pause className="h-4 w-4" />
                      Task paused
                    </div>
                    <p className="mt-2 text-sm leading-7 text-amber-900/80">
                      This task is paused. New runs and approval follow-ups are blocked until you resume it. If a run was already in progress, pause will apply to the next action cycle rather than interrupting that live stream.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void setTaskStatus("active")}
                    disabled={headerActionLoading === "active"}
                    className="inline-flex items-center gap-2 rounded-full bg-amber-950 px-4 py-2 text-sm text-white disabled:opacity-60"
                  >
                    <Play className="h-4 w-4" />
                    {headerActionLoading === "active" ? "Resuming..." : "Resume task"}
                  </button>
                </div>
              </div>
            )}

            {pendingApprovalRequests.length > 0 && (
              <div className="rounded-[26px] border border-amber-200 bg-white/82 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                      <ShieldAlert className="h-4 w-4 text-amber-700" />
                      Pending approvals
                    </div>
                    <p className="mt-2 text-sm leading-7 text-black/[0.62]">
                      Sensitive actions are held here until a human explicitly approves or rejects them. Approving will record the decision on the task and continue with a follow-up run using your authorization.
                    </p>
                  </div>
                  <div className="rounded-[20px] bg-amber-50 px-4 py-3 text-right text-sm text-amber-900">
                    <div>{pendingApprovalRequests.length} action{pendingApprovalRequests.length === 1 ? "" : "s"} waiting</div>
                    <div className="mt-1">Human review required</div>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {pendingApprovalRequests.map((request) => (
                    <div key={request.id} className="rounded-[22px] border border-amber-200 bg-amber-50/55 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-black/[0.82]">{request.title}</p>
                          <p className="mt-2 text-sm leading-7 text-black/[0.68]">{request.reason}</p>
                        </div>
                        <Badge className="bg-amber-600 text-white border-transparent">approval required</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.46]">
                        <span>{formatToolName(request.tool)}</span>
                        {request.channel && <span>{request.channel}</span>}
                        {request.targetLabel && <span>{compactText(request.targetLabel, 48)}</span>}
                        <span>{formatRelativeTime(request.created_at)}</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {request.detailLines.map((line) => (
                          <p key={`${request.id}-${line}`} className="text-sm leading-6 text-black/[0.68]">
                            {line}
                          </p>
                        ))}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => void approvePendingRequest(request)}
                          disabled={approvalActionLoading === request.id || running || isTaskPaused}
                          className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          {approvalActionLoading === request.id ? "Approving..." : "Approve and continue"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deferPendingRequest(request)}
                          disabled={approvalActionLoading === request.id}
                          className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/85 px-4 py-2 text-sm text-black/[0.72] disabled:opacity-60"
                        >
                          <X className="h-4 w-4" />
                          Keep blocked
                        </button>
                        {isTaskPaused && (
                          <span className="rounded-full bg-black/[0.04] px-3 py-2 text-sm text-black/[0.58]">
                            Resume the task before approving and continuing.
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(activeTaskMemory || activeProjectMemory) && (
          <div className="mt-4 grid gap-4 xl:hidden xl:grid-cols-2">
            {activeTaskMemory && (
              <div className="rounded-[26px] border border-black/10 bg-white/78 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-black/[0.42]">Task memory</p>
                    <h3 className="mt-2 text-base font-medium text-black/[0.82]">
                      Shared context for this task
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-black/[0.62]">
                      This memory persists across runs on the selected task so the supervisor can reuse findings, risks, and recent requests instead of starting from zero every time.
                    </p>
                  </div>
                  <div className="rounded-[20px] bg-sand/65 px-4 py-3 text-right text-sm text-black/[0.68]">
                    <div>{activeTaskMemory.run_count} memory refreshes</div>
                    <div className="mt-1">
                      {activeTaskMemory.last_updated_at
                        ? formatRelativeTime(activeTaskMemory.last_updated_at)
                        : "Awaiting first persisted run"}
                    </div>
                  </div>
                </div>
                {activeTaskMemory.summary && (
                  <p className="mt-4 rounded-[20px] bg-sand/45 px-4 py-4 text-sm leading-7 text-black/[0.72]">
                    {activeTaskMemory.summary}
                  </p>
                )}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {sharedTaskMemorySections.length > 0 ? (
                    sharedTaskMemorySections.map((section) => (
                      <div key={section.key} className="rounded-[20px] border border-black/10 bg-sand/35 px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">{section.label}</p>
                        <div className="mt-3 space-y-2">
                          {section.items.map((item) => (
                            <p key={`${section.key}-${item}`} className="text-sm leading-6 text-black/[0.72]">
                              {item}
                            </p>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[20px] border border-dashed border-black/10 bg-sand/30 px-4 py-4 text-sm text-black/[0.58]">
                      This task has a memory envelope ready, but it has not accumulated enough completed work to surface durable context yet.
                    </div>
                  )}
                </div>
                {activeTaskMemory.agent_memory.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-black/[0.44]">Agent carry-forward</p>
                    <div className="mt-3 space-y-3">
                      {activeTaskMemory.agent_memory.slice(0, 3).map((entry) => (
                        <div key={`${entry.agent}-${entry.summary}`} className="rounded-[20px] bg-white/88 px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-black/[0.8]">{entry.agent}</p>
                            {typeof entry.confidence === "number" && (
                              <span className="text-xs uppercase tracking-[0.14em] text-black/[0.45]">
                                {Math.round(entry.confidence * 100)}% confidence
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm leading-7 text-black/[0.68]">{entry.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeProjectMemory && (
              <div className="rounded-[26px] border border-black/10 bg-white/78 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-black/[0.42]">Project memory</p>
                    <h3 className="mt-2 text-base font-medium text-black/[0.82]">
                      {selectedProject?.name ? `${selectedProject.name} context` : "Shared project context"}
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-black/[0.62]">
                      This layer carries longer-lived context across tasks inside the same project, which helps new tasks inherit goals, recurring risks, and established focus areas.
                    </p>
                  </div>
                  <div className="rounded-[20px] bg-sand/65 px-4 py-3 text-right text-sm text-black/[0.68]">
                    <div>{activeProjectMemory.run_count} project updates</div>
                    <div className="mt-1">
                      {activeProjectMemory.last_updated_at
                        ? formatRelativeTime(activeProjectMemory.last_updated_at)
                        : "Awaiting first project run"}
                    </div>
                  </div>
                </div>
                {activeProjectMemory.summary && (
                  <p className="mt-4 rounded-[20px] bg-sand/45 px-4 py-4 text-sm leading-7 text-black/[0.72]">
                    {activeProjectMemory.summary}
                  </p>
                )}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {sharedProjectMemorySections.length > 0 ? (
                    sharedProjectMemorySections.map((section) => (
                      <div key={section.key} className="rounded-[20px] border border-black/10 bg-sand/35 px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">{section.label}</p>
                        <div className="mt-3 space-y-2">
                          {section.items.map((item) => (
                            <p key={`${section.key}-${item}`} className="text-sm leading-6 text-black/[0.72]">
                              {item}
                            </p>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[20px] border border-dashed border-black/10 bg-sand/30 px-4 py-4 text-sm text-black/[0.58]">
                      This project memory is provisioned and will start surfacing carry-forward context as more task runs complete inside the project.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <div className="rounded-[16px] border border-black/[0.08] bg-black/[0.015] px-4 py-3 text-sm leading-6 text-black/[0.58]">
              {loadingThread
                ? "Loading thread history..."
                : activeThread
                  ? "This thread is empty. Start a run to create a persisted chat history."
                  : "No task is selected yet for this project. Start a new task from the left rail to open the conversation surface."}
            </div>
          )}
          {messages.map((message) => (
            (() => {
              const citationLookup = new Map(
                message.citations
                  .filter((citation) => typeof citation.reference_id === "string" && citation.reference_id.length > 0)
                  .map((citation) => [String(citation.reference_id), citation] as const)
              );
              const referencedCitationIds = extractCitationReferenceIds(message.content);
              const isUserMessage = message.role === "user";
              const messageTimestamp = formatMessageHoverTime(message.created_at);

              return (
                <article
                  key={message.id}
                  className={cn("group/message flex", isUserMessage ? "justify-end" : "justify-start")}
                >
                  <div className={cn("max-w-[min(42rem,100%)]", isUserMessage ? "items-end" : "items-start")}>
                    {isUserMessage ? (
                      <div className="inline-block rounded-[16px] border border-black/[0.05] bg-stone-100 px-3.5 py-2.5 text-[15px] leading-6 text-black/[0.82] shadow-[0_1px_6px_rgba(17,19,24,0.03)] md:text-[16px]">
                        <div className="space-y-2.5">{renderMessageContent(message.content, citationLookup)}</div>
                      </div>
                    ) : (
                      <div className="px-1 py-0.5">
                        <div className="space-y-3 text-[15px] leading-7 text-black/[0.8] md:text-[16px]">
                          {renderMessageContent(message.content, citationLookup)}
                        </div>

                        {message.citations.length > 0 && (
                          <div className="mt-3 rounded-[16px] border border-black/[0.08] bg-sand/18 p-3">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-black/[0.58]">
                                <Globe className="h-3.5 w-3.5" />
                                Sources
                              </div>
                              <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-black/[0.42]">
                                {referencedCitationIds.map((referenceId) => (
                                  <span key={`${message.id}-${referenceId}`} className="rounded-full bg-white/80 px-2 py-1">
                                    {referenceId}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-2.5">
                              {message.citations.map((citation, citationIndex) => {
                                const href = citationHref(data.workspace_id, citation);
                                const citationKey =
                                  citation.reference_id ??
                                  citation.document_id ??
                                  citation.chunk_id ??
                                  citation.relative_path ??
                                  citation.url ??
                                  `${message.id}-${citationIndex}`;
                                const cardClasses = cn(
                                  "block rounded-[14px] bg-white/88 px-3 py-2.5 text-sm transition",
                                  href ? "hover:bg-white" : ""
                                );
                                const cardContent = (
                                  <>
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                          {citation.reference_id && (
                                            <span className="rounded-full bg-black/[0.05] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-black/[0.55]">
                                              {citation.reference_id}
                                            </span>
                                          )}
                                          {citation.kind && (
                                            <span className="rounded-full bg-black/[0.05] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-black/[0.55]">
                                              {citation.kind.replaceAll("_", " ")}
                                            </span>
                                          )}
                                          {citation.source_type && (
                                            <span className="rounded-full bg-black/[0.05] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-black/[0.55]">
                                              {citation.source_type}
                                            </span>
                                          )}
                                        </div>
                                        <p className="mt-1.5 font-medium leading-6 text-black/[0.8]">{citation.title}</p>
                                        {(citation.source_uri || citation.relative_path || citation.agent) && (
                                          <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-black/[0.46]">
                                            {citation.source_uri ?? citation.relative_path ?? citation.agent}
                                          </p>
                                        )}
                                      </div>
                                      {href && <ArrowUpRight className="h-4 w-4 shrink-0 text-black/50" />}
                                    </div>
                                    {citation.excerpt && (
                                      <p className="mt-2 text-sm leading-6 text-black/[0.66]">
                                        {citation.excerpt}
                                      </p>
                                    )}
                                    {typeof citation.score === "number" && (
                                      <div className="mt-2 text-[10px] uppercase tracking-[0.16em] text-black/[0.44]">
                                        Retrieval score {citation.score.toFixed(3)}
                                      </div>
                                    )}
                                  </>
                                );

                                return href ? (
                                  <a
                                    key={citationKey}
                                    href={href}
                                    target={citation.url ? "_blank" : undefined}
                                    rel={citation.url ? "noreferrer" : undefined}
                                    className={cardClasses}
                                  >
                                    {cardContent}
                                  </a>
                                ) : (
                                  <div key={citationKey} className={cardClasses}>
                                    {cardContent}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div
                      className={cn(
                        "mt-1.5 flex items-center gap-2 text-[11px] text-black/[0.42] opacity-0 transition duration-150 group-hover/message:opacity-100",
                        isUserMessage ? "justify-end pr-1" : "justify-start pl-1"
                      )}
                    >
                      <span>{messageTimestamp}</span>
                      <button
                        type="button"
                        onClick={() => void copyMessageContent(message)}
                        className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white/78 px-2 py-1 text-[11px] text-black/[0.58] transition hover:bg-white"
                        aria-label={`Copy ${isUserMessage ? "your" : "assistant"} message`}
                        title="Copy message"
                      >
                        <Copy className="h-3 w-3" />
                        {copiedMessageId === message.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })()
          ))}
        </div>

        {taskTemplates.length > 0 && (
          <div className="mt-6 rounded-[26px] border border-black/10 bg-white/82 p-5 xl:hidden">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                  <Boxes className="h-4 w-4" />
                  Reusable task templates
                </div>
                <p className="mt-2 text-sm leading-7 text-black/[0.62]">
                  Launch browser and computer workflows from a productized starting point instead of typing the whole operating brief from scratch.
                </p>
              </div>
              {selectedTaskTemplate && (
                <div className="rounded-[22px] bg-sand/70 px-4 py-3 text-right text-sm text-black/[0.68]">
                  <div>{selectedTaskTemplate.name}</div>
                  <div className="mt-1">{selectedTaskTemplate.category} workflow active</div>
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {taskTemplates.map((template) => {
                const TemplateIcon = templateCategoryIcon(template.category);
                const isSelected = selectedTaskTemplateKey === template.key;
                return (
                  <button
                    key={template.key}
                    type="button"
                    onClick={() => applyTaskTemplate(template)}
                    className={cn(
                      "rounded-[24px] border px-4 py-4 text-left transition",
                      isSelected
                        ? "border-transparent bg-ink text-white"
                        : "border-black/10 bg-white/75 hover:bg-sand/45"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-full",
                            isSelected ? "bg-white/12 text-white" : "bg-sand/70 text-black/[0.72]"
                          )}
                        >
                          <TemplateIcon className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.14em]",
                                isSelected ? "bg-white/12 text-white/80" : "bg-black/[0.04] text-black/[0.52]"
                              )}
                            >
                              {template.category}
                            </span>
                            {template.requires_approval && (
                              <span
                                className={cn(
                                  "rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.14em]",
                                  isSelected ? "bg-white/12 text-white/80" : "bg-amber-100 text-amber-900"
                                )}
                              >
                                approval gate
                              </span>
                            )}
                          </div>
                          <p className="mt-3 text-sm font-medium">{template.name}</p>
                          <p className={cn("mt-2 text-sm leading-7", isSelected ? "text-white/78" : "text-black/[0.66]")}>
                            {template.summary}
                          </p>
                        </div>
                      </div>
                      {isSelected && <Badge className="bg-white/14 text-white border-white/10">active</Badge>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {template.capabilities.slice(0, 3).map((capability) => (
                        <span
                          key={`${template.key}-${capability}`}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.12em]",
                            isSelected ? "bg-white/12 text-white/78" : "bg-black/[0.04] text-black/[0.55]"
                          )}
                        >
                          {capability}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedTaskTemplate && (
              <div className="mt-4 rounded-[22px] border border-black/10 bg-sand/45 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-black/[0.8]">Loaded template brief</p>
                    <p className="mt-2 text-sm leading-7 text-black/[0.68]">
                      {selectedTaskTemplate.chat_defaults.prompt}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearTaskTemplate}
                    className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/[0.72] transition hover:bg-white"
                  >
                    Clear template
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.46]">
                  <span>{selectedTaskTemplate.recommended_operator_tab} focus</span>
                  <span>{selectedTaskTemplate.chat_defaults.use_retrieval ? "retrieval on" : "retrieval off"}</span>
                  {selectedTaskTemplate.chat_defaults.model_profile && (
                    <span>{selectedTaskTemplate.chat_defaults.model_profile}</span>
                  )}
                </div>
              </div>
            )}
            {templateNotice && <p className="mt-3 text-sm text-emerald-700">{templateNotice}</p>}
          </div>
        )}

        <form className="relative mt-4 shrink-0 border-t border-black/10 pt-4" onSubmit={handleSubmit}>
          <input
            ref={composerFileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void uploadComposerFiles(event.target.files)}
          />

          <AnimatePresence>
            {(showComposerAttachments || showComposerShortcuts) && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, y: 8 }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
                className="absolute bottom-full left-0 right-0 z-20 mb-3 space-y-3"
              >
                {showComposerAttachments && (
                  <div className="rounded-[24px] border border-black/10 bg-white/96 p-4 shadow-[0_18px_34px_rgba(30,25,18,0.08)] backdrop-blur-xl">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-black/[0.82]">Context</p>
                        <p className="mt-1 text-sm leading-6 text-black/[0.58]">
                          Attach files, URLs, current code, and recent outputs without taking height from the chat stream.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowComposerAttachments(false)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.62] transition hover:bg-sand/45"
                        aria-label="Close context panel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <input
                        value={urlAttachmentDraft}
                        onChange={(event) => setUrlAttachmentDraft(event.target.value)}
                        placeholder="https://example.com/source"
                        className="min-w-[240px] flex-1 rounded-full border border-black/10 bg-sand/20 px-4 py-2.5 text-sm outline-none"
                      />
                      <button
                        type="button"
                        onClick={attachUrlReference}
                        className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm text-black/[0.72] transition hover:bg-sand/45"
                      >
                        Attach URL
                      </button>
                      <button
                        type="button"
                        onClick={attachWorkbenchFile}
                        disabled={!selectedWorkbenchFile}
                        className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm text-black/[0.72] transition hover:bg-sand/45 disabled:opacity-60"
                      >
                        <Code2 className="h-4 w-4" />
                        Current file
                      </button>
                    </div>
                    {mergedArtifacts.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Recent outputs</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {mergedArtifacts.slice(0, 6).map((artifact) => (
                            <button
                              key={`composer-artifact-${artifact.storage_key}`}
                              type="button"
                              onClick={() => attachRecentArtifact(artifact)}
                              className="rounded-full border border-black/10 bg-sand/25 px-3 py-2 text-xs text-black/[0.7] transition hover:bg-sand/45"
                            >
                              {artifactLabel(artifact)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {showComposerShortcuts && (
                  <div className="rounded-[24px] border border-black/10 bg-white/96 p-4 shadow-[0_18px_34px_rgba(30,25,18,0.08)] backdrop-blur-xl">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-black/[0.82]">Tools</p>
                        <p className="mt-1 text-sm leading-6 text-black/[0.58]">
                          Lightweight presets that guide the next run without filling the chat column.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowComposerShortcuts(false)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.62] transition hover:bg-sand/45"
                        aria-label="Close tools panel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {COMPOSER_SHORTCUTS.map((shortcut) => {
                        const active = selectedComposerShortcutKeys.includes(shortcut.key);
                        return (
                          <button
                            key={shortcut.key}
                            type="button"
                            onClick={() => toggleComposerShortcut(shortcut)}
                            className={cn(
                              "rounded-full border px-3 py-2 text-xs uppercase tracking-[0.14em] transition",
                              active
                                ? "border-transparent bg-ink text-white"
                                : "border-black/10 bg-white text-black/[0.68] hover:bg-sand/45"
                            )}
                            title={shortcut.description}
                          >
                            {shortcut.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="rounded-[22px] border border-black/10 bg-white/96 px-3 py-3 shadow-[0_12px_28px_rgba(30,25,18,0.05)]">
            {isTaskPaused && (
              <div className="mb-3 rounded-[16px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                This task is paused. Resume it to send a new message or continue any pending approval flow.
              </div>
            )}

            {(voiceInterimTranscript || composerNotice || composerError) && (
              <div className="mb-3 space-y-2">
                {voiceInterimTranscript && (
                  <div className="rounded-[16px] border border-black/10 bg-sand/20 px-3 py-2 text-sm text-black/[0.72]">
                    <span className="mr-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.45]">Listening</span>
                    {voiceInterimTranscript}
                  </div>
                )}
                {composerNotice && <p className="text-sm text-emerald-700">{composerNotice}</p>}
                {composerError && <p className="text-sm text-red-700">{composerError}</p>}
              </div>
            )}

            <div className="flex items-end gap-3">
              <textarea
                ref={composerTextareaRef}
                rows={1}
                className="max-h-[120px] min-h-[48px] flex-1 resize-none bg-transparent px-1 py-3 text-[15px] leading-6 outline-none placeholder:text-black/[0.34]"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setComposerNotice(null);
                }}
                onKeyDown={handleComposerKeyDown}
                disabled={isTaskPaused}
                placeholder="Ask the supervisor to research, analyze, automate, code, or synthesize a complex task."
              />
              <button
                type="submit"
                disabled={running || !draft.trim() || isTaskPaused}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-white disabled:opacity-60"
                aria-label={running ? "Run in progress" : "Start run"}
                title={running ? "Run in progress" : "Start run"}
              >
                {running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-black/[0.06] pt-2.5">
              <button
                type="button"
                onClick={() => composerFileInputRef.current?.click()}
                disabled={composerUploading || isTaskPaused}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs text-black/[0.72] transition hover:bg-white disabled:opacity-60"
              >
                <Paperclip className="h-3.5 w-3.5" />
                {composerUploading ? "Uploading..." : "Attach"}
              </button>
              <button
                type="button"
                onClick={() => setShowComposerAttachments((current) => !current)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition",
                  showComposerAttachments
                    ? "border-transparent bg-ink text-white"
                    : "border-black/10 bg-white text-black/[0.72] hover:bg-white"
                )}
              >
                <Link2 className="h-3.5 w-3.5" />
                Context
              </button>
              <button
                type="button"
                onClick={toggleVoiceInput}
                disabled={!voiceSupported || isTaskPaused}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition disabled:opacity-60",
                  voiceListening
                    ? "border-transparent bg-ink text-white"
                    : "border-black/10 bg-white text-black/[0.72] hover:bg-white"
                )}
              >
                <Mic className="h-3.5 w-3.5" />
                {voiceListening ? "Stop" : "Voice"}
              </button>
              <button
                type="button"
                onClick={() => setShowComposerShortcuts((current) => !current)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition",
                  showComposerShortcuts
                    ? "border-transparent bg-ink text-white"
                    : "border-black/10 bg-white text-black/[0.72] hover:bg-white"
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Tools
              </button>
            </div>

            {(composerAttachments.length > 0 || selectedComposerShortcuts.length > 0 || voiceCapturedInDraft) && (
              <div className="mt-2 flex flex-wrap gap-2 border-t border-black/[0.06] pt-2.5">
                {composerAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-sand/20 px-3 py-1.5 text-xs text-black/[0.72]"
                  >
                    <span className="uppercase tracking-[0.14em] text-black/[0.45]">
                      {attachmentKindLabel(attachment.kind)}
                    </span>
                    <span className="max-w-[180px] truncate">{attachment.label}</span>
                    <button
                      type="button"
                      onClick={() => removeComposerAttachment(attachment.id)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/[0.06] text-black/[0.6]"
                      aria-label={`Remove ${attachment.label}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {selectedComposerShortcuts.map((shortcut) => (
                  <button
                    key={`composer-shortcut-chip-${shortcut.key}`}
                    type="button"
                    onClick={() => toggleComposerShortcut(shortcut)}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs text-black/[0.68] transition hover:bg-sand/45"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {shortcut.label}
                  </button>
                ))}
                {voiceCapturedInDraft && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs text-black/[0.68]">
                    <Mic className="h-3.5 w-3.5" />
                    Voice dictation used
                  </span>
                )}
              </div>
            )}
          </div>
          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        </form>
          </div>
          </div>
        )}
      </div>

      <div className={cn("hidden items-stretch justify-center xl:flex", workbenchExpanded && "xl:hidden")}>
        <button
          type="button"
          onMouseDown={startWorkspaceResize}
          onDoubleClick={() => {
            setWorkspacePaneWidth(DEFAULT_WORKSPACE_SPLIT);
            setWorkspacePaneCollapsed(false);
            setOperatorPaneCollapsed(false);
          }}
          disabled={!isDesktopWorkspace || workspacePaneCollapsed || operatorPaneCollapsed || workbenchExpanded}
          className={cn(
            "group flex w-4 cursor-col-resize items-center justify-center",
            (workspacePaneCollapsed || operatorPaneCollapsed || workbenchExpanded) && "cursor-default"
          )}
          aria-label="Resize workspace panes"
          title={
            workspacePaneCollapsed || operatorPaneCollapsed || workbenchExpanded
              ? "Expand both panes to resize"
              : "Drag to resize panes"
          }
        >
          <span
            className={cn(
              "flex h-full w-2 items-center justify-center rounded-full bg-black/[0.05] transition group-hover:bg-black/[0.09]",
              isResizingWorkspace && "bg-black/[0.12]"
            )}
          >
            <span className="h-12 w-[3px] rounded-full bg-black/[0.18]" />
          </span>
        </button>
      </div>

      <div className="min-w-0 min-h-0">
        {isDesktopWorkspace && operatorPaneCollapsed ? (
          <div className="surface-card-strong flex h-full min-h-[calc(100vh-13rem)] flex-col items-center justify-between px-3 py-5">
            <button
              type="button"
              onClick={toggleOperatorPaneCollapsed}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.72] transition hover:bg-sand/60"
              aria-label="Expand operator canvas"
              title="Expand operator canvas"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
            </button>
            <div className="flex items-center gap-3 [writing-mode:vertical-rl]">
              <MonitorSmartphone className="h-4 w-4 text-black/[0.5]" />
              <span className="text-xs uppercase tracking-[0.2em] text-black/[0.52]">
                Swarm computer
              </span>
            </div>
            <div className="text-center text-[11px] uppercase tracking-[0.16em] text-black/[0.42]">
              {computerSessions.length} live
            </div>
          </div>
        ) : (
      <aside className="flex h-full min-h-0 flex-col">
        <div className="surface-card-strong flex h-full min-h-0 flex-col overflow-hidden p-0">
          <div className="border-b border-black/10 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="surface-label">Workbench</p>
                <h2 className="font-display text-[2.15rem] leading-[0.96] text-black/[0.88]">Workbench</h2>
                <p className="text-base leading-7 text-black/[0.6]">
                  Browser, terminal, files, previews, and execution state stay here.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-black/[0.62]">
                  {browserSessions.length} browser
                </span>
                <span className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-black/[0.62]">
                  {terminalSessions.length} terminal
                </span>
                <button
                  type="button"
                  onClick={toggleWorkbenchExpanded}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3.5 py-2 text-sm text-black/[0.72] transition hover:bg-sand/45"
                  aria-label={workbenchExpanded ? "Exit workbench focus mode" : "Expand workbench"}
                  title={workbenchExpanded ? "Exit workbench focus mode" : "Expand workbench"}
                >
                  {workbenchExpanded ? <X className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                  {workbenchExpanded ? "Exit focus" : "Expand"}
                </button>
                <button
                  type="button"
                  onClick={toggleOperatorPaneCollapsed}
                  className="hidden h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-black/[0.72] transition hover:bg-sand/45 xl:inline-flex"
                  aria-label="Collapse operator canvas"
                  title="Collapse operator canvas"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {OPERATOR_TAB_OPTIONS.map((tab) => {
                const Icon = tab.icon;
                const active = operatorTab === tab.key;
                return (
                  <motion.button
                    layout
                    key={tab.key}
                    type="button"
                    onClick={() => setOperatorTab(tab.key as OperatorTab)}
                    className={cn(
                      "relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-black/10 px-3 py-2 text-xs uppercase tracking-[0.14em] transition",
                      active ? "text-white" : "bg-white/70 text-black/[0.7] hover:bg-white"
                    )}
                    whileHover={prefersReducedMotion ? undefined : { y: -1 }}
                    transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 250, damping: 24 }}
                  >
                    {active && (
                      <motion.span
                        layoutId={prefersReducedMotion ? undefined : "operator-tab-pill"}
                        className="absolute inset-0 rounded-full bg-ink"
                        transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 28 }}
                      />
                    )}
                    <span className="relative z-10 inline-flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={operatorTab}
                initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -14 }}
                transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 24 }}
                className="space-y-5"
              >
            {operatorTab === "code" && (
              <div className="space-y-5">
                <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="space-y-4">
                    <div className="rounded-[26px] border border-black/10 bg-white/80 p-4">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                            <FolderTree className="h-4 w-4" />
                            {rootWorkbenchTree?.root_label ?? "Workspace"}
                          </div>
                          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.46]">
                            {rootWorkbenchTree?.relative_path ?? "."}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void fetchWorkbenchDirectory(".", { force: true })}
                          className="rounded-full bg-sand/70 px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/[0.62] transition hover:bg-sand"
                        >
                          Refresh
                        </button>
                      </div>

                      {workbenchError && (
                        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                          {workbenchError}
                        </div>
                      )}

                      {rootWorkbenchTree ? (
                        <div className="space-y-2">
                          {workbenchLoadingPath === "." && !workbenchTree["."] ? (
                            <div className="rounded-2xl bg-sand/55 px-3 py-3 text-sm text-black/[0.58]">
                              Loading workspace tree...
                            </div>
                          ) : (
                            renderWorkbenchDirectory(".")
                          )}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-black/10 bg-sand/35 px-4 py-8 text-center text-sm text-black/[0.58]">
                          Workspace files will appear here when the workbench loads.
                        </div>
                      )}
                    </div>

                    <div className="rounded-[26px] border border-black/10 bg-white/80 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                        <Activity className="h-4 w-4" />
                        Agent file focus
                      </div>
                      <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.46]">
                        Live coding-agent browsing and edit tracking
                      </p>

                      <div className="mt-4 space-y-2">
                        {liveWorkbenchActivities.length > 0 ? (
                          liveWorkbenchActivities.slice(0, 6).map((activity) => (
                            <button
                              key={activity.id}
                              type="button"
                              onClick={() => {
                                if (activity.relative_path) {
                                  void openWorkbenchFile(activity.relative_path);
                                  return;
                                }
                                if (activity.directory_path) {
                                  void fetchWorkbenchDirectory(activity.directory_path, { force: true });
                                }
                              }}
                              className="w-full rounded-[18px] border border-black/10 bg-sand/45 px-4 py-3 text-left transition hover:bg-sand/65"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-black/[0.78]">
                                    {activity.relative_path ?? activity.directory_path ?? "workspace"}
                                  </p>
                                  <p className="mt-2 text-xs text-black/[0.54]">
                                    {activity.agent_name ?? "Coding agent"} {"|"} {formatRelativeTime(activity.created_at)}
                                  </p>
                                </div>
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em]",
                                    workbenchActivityTone(activity)
                                  )}
                                >
                                  {workbenchActivityLabel(activity)}
                                </span>
                              </div>
                              <p className="mt-3 text-sm leading-6 text-black/[0.66]">
                                {compactText(activity.summary, 130)}
                              </p>
                            </button>
                          ))
                        ) : (
                          <div className="rounded-2xl bg-sand/45 px-4 py-4 text-sm text-black/[0.58]">
                            When the coding agent browses or updates files, the workbench will surface that activity here and keep the relevant file close at hand.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[26px] border border-black/10 bg-white/80 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                            <GitBranch className="h-4 w-4" />
                            Repository
                          </div>
                          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.46]">
                            {repoState?.branch
                              ? `${repoState.branch}${repoState.head ? ` / ${repoState.head}` : ""}`
                              : "Waiting for repository metadata"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void fetchWorkbenchRepoState({ force: true })}
                          className="inline-flex items-center gap-2 rounded-full bg-sand/70 px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/[0.62]"
                        >
                          <RefreshCw className={cn("h-3.5 w-3.5", repoLoading && "animate-spin")} />
                          Refresh
                        </button>
                      </div>

                      {repoState ? (
                        <>
                          <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.48]">
                            <span className="rounded-full bg-black/[0.04] px-2 py-1">
                              {repoState.is_repo ? (repoState.dirty ? "Dirty working tree" : "Clean working tree") : "No git repository"}
                            </span>
                            <span className="rounded-full bg-black/[0.04] px-2 py-1">
                              {repoState.changed_files.length} changed files
                            </span>
                            <span className="rounded-full bg-black/[0.04] px-2 py-1">
                              {repoState.untracked_count} untracked
                            </span>
                          </div>
                          <div className="mt-4 space-y-2">
                            {repoState.changed_files.length > 0 ? (
                              repoState.changed_files.slice(0, 8).map((item) => (
                                <button
                                  key={item.relative_path}
                                  type="button"
                                  onClick={() => void openWorkbenchFile(item.relative_path)}
                                  className="flex w-full items-center justify-between gap-3 rounded-2xl bg-sand/45 px-3 py-2 text-left text-sm text-black/[0.72] transition hover:bg-sand/70"
                                >
                                  <span className="truncate">{item.display_path}</span>
                                  <span
                                    className={cn(
                                      "rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.12em]",
                                      workbenchStatusTone(item.status)
                                    )}
                                  >
                                    {item.status}
                                  </span>
                                </button>
                              ))
                            ) : (
                              <div className="rounded-2xl bg-sand/45 px-4 py-4 text-sm text-black/[0.58]">
                                {repoState.is_repo
                                  ? "No repository changes are currently detected."
                                  : "Git metadata is not available in this workspace runtime."}
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="mt-4 rounded-2xl bg-sand/45 px-4 py-4 text-sm text-black/[0.58]">
                          Loading repository metadata...
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[26px] border border-black/10 bg-white/82 p-4">
                    <div className="flex flex-wrap gap-2 border-b border-black/10 pb-4">
                      {openWorkbenchTabs.length > 0 ? (
                        openWorkbenchTabs.map((file) => {
                          const editorState = workbenchEditors[file.relative_path];
                          const isActive = selectedWorkbenchPath === file.relative_path;
                          const isDirty =
                            Boolean(editorState) &&
                            editorState.draftContent !== editorState.originalContent;
                          return (
                            <button
                              key={file.relative_path}
                              type="button"
                              onClick={() => setSelectedWorkbenchPath(file.relative_path)}
                              className={cn(
                                "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs uppercase tracking-[0.14em] transition",
                                isActive
                                  ? "border-transparent bg-ink text-white"
                                  : "border-black/10 bg-white text-black/[0.68] hover:bg-sand/45"
                              )}
                            >
                              <span className="max-w-[180px] truncate">{file.name}</span>
                              {isDirty && <span className="h-2 w-2 rounded-full bg-amber-400" />}
                              <span
                                onClick={(event) => {
                                  event.stopPropagation();
                                  closeWorkbenchTab(file.relative_path);
                                }}
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/10"
                              >
                                <X className="h-3 w-3" />
                              </span>
                            </button>
                          );
                        })
                      ) : (
                        <span className="rounded-full bg-black/[0.04] px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/[0.48]">
                          No files open
                        </span>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-b border-black/10 pb-4">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                          <Code2 className="h-4 w-4" />
                          {selectedWorkbenchFile?.name ?? "Select a file"}
                        </div>
                        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.46]">
                          {selectedWorkbenchFile?.relative_path ??
                            currentWorkbenchDirectory?.relative_path ??
                            "Workspace editor"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedWorkbenchFile && (
                          <>
                            <button
                              type="button"
                              onClick={() => void saveWorkbenchFile()}
                              disabled={!selectedWorkbenchDirty || workbenchSavePath === selectedWorkbenchPath}
                              className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-2 text-xs uppercase tracking-[0.14em] text-white disabled:opacity-60"
                            >
                              <Save className="h-3.5 w-3.5" />
                              {workbenchSavePath === selectedWorkbenchPath ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => selectedWorkbenchPath && discardWorkbenchChanges(selectedWorkbenchPath)}
                              disabled={!selectedWorkbenchDirty}
                              className="rounded-full bg-sand/70 px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/[0.64] disabled:opacity-60"
                            >
                              Discard
                            </button>
                            <button
                              type="button"
                              onClick={() => setWorkbenchViewMode("local-diff")}
                              className={cn(
                                "rounded-full px-3 py-2 text-xs uppercase tracking-[0.14em] transition",
                                workbenchViewMode === "local-diff"
                                  ? "bg-black text-white"
                                  : "bg-sand/70 text-black/[0.64] hover:bg-sand"
                              )}
                            >
                              Local diff
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setWorkbenchViewMode("repo-diff");
                                void loadWorkbenchRepoDiff(selectedWorkbenchFile.relative_path);
                              }}
                              className={cn(
                                "inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs uppercase tracking-[0.14em] transition",
                                workbenchViewMode === "repo-diff"
                                  ? "bg-black text-white"
                                  : "bg-sand/70 text-black/[0.64] hover:bg-sand"
                              )}
                            >
                              <GitBranch className="h-3.5 w-3.5" />
                              {repoDiffLoadingPath === selectedWorkbenchFile.relative_path ? "Loading..." : "Git diff"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setWorkbenchViewMode("edit")}
                              className={cn(
                                "rounded-full px-3 py-2 text-xs uppercase tracking-[0.14em] transition",
                                workbenchViewMode === "edit"
                                  ? "bg-black text-white"
                                  : "bg-sand/70 text-black/[0.64] hover:bg-sand"
                              )}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void copyWorkbenchContent()}
                              className="inline-flex items-center gap-2 rounded-full bg-sand/70 px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/[0.64] transition hover:bg-sand"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Copy
                            </button>
                            <a
                              href={workbenchDownloadHref(workspaceId, selectedWorkbenchFile.relative_path)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/[0.7] ring-1 ring-black/10"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Download
                            </a>
                          </>
                        )}
                      </div>
                    </div>

                    {workbenchNotice && (
                      <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        {workbenchNotice}
                      </div>
                    )}

                    {selectedWorkbenchFile ? (
                      <>
                        <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.45]">
                          <span className="rounded-full bg-black/[0.04] px-2 py-1">
                            {selectedWorkbenchFile.extension?.replace(".", "") || "text"}
                          </span>
                          <span className="rounded-full bg-black/[0.04] px-2 py-1">
                            {formatBytes(selectedWorkbenchFile.size_bytes)}
                          </span>
                          {selectedWorkbenchDirty && (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">unsaved changes</span>
                          )}
                          {selectedRepoFileState && (
                            <span
                              className={cn(
                                "rounded-full px-2 py-1",
                                workbenchStatusTone(selectedRepoFileState.status)
                              )}
                            >
                              repo: {selectedRepoFileState.status}
                            </span>
                          )}
                          {selectedWorkbenchFile.truncated && (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">truncated</span>
                          )}
                          {workbenchLoadingPath === selectedWorkbenchFile.relative_path && (
                            <span className="rounded-full bg-sand/70 px-2 py-1">refreshing</span>
                          )}
                        </div>

                        {workbenchViewMode === "edit" && (
                          <div className="mt-4 overflow-hidden rounded-[24px] border border-black/10 bg-[#101114]">
                            <div className="grid grid-cols-[56px_minmax(0,1fr)]">
                              <div className="max-h-[620px] overflow-hidden border-r border-white/8 bg-black/20 px-3 py-4 text-right font-mono text-xs leading-6 text-white/28">
                                {selectedWorkbenchDraft.split("\n").map((_, index) => (
                                  <div key={`${selectedWorkbenchFile.relative_path}-ln-${index}`}>{index + 1}</div>
                                ))}
                              </div>
                              <textarea
                                value={selectedWorkbenchDraft}
                                onChange={(event) =>
                                  updateWorkbenchDraft(selectedWorkbenchFile.relative_path, event.target.value)
                                }
                                spellCheck={false}
                                className="min-h-[620px] w-full resize-none bg-transparent px-4 py-4 font-mono text-xs leading-6 text-white/88 outline-none"
                              />
                            </div>
                          </div>
                        )}

                        {workbenchViewMode === "local-diff" && (
                          <div className="mt-4 grid gap-4 xl:grid-cols-2">
                            <div className="overflow-hidden rounded-[24px] border border-black/10 bg-white">
                              <div className="border-b border-black/10 px-4 py-3 text-xs uppercase tracking-[0.16em] text-black/[0.5]">
                                Last saved
                              </div>
                              <pre className="max-h-[620px] overflow-auto bg-[#101114] px-4 py-4 font-mono text-xs leading-6 text-white/78">
                                {selectedWorkbenchEditor?.originalContent || " "}
                              </pre>
                            </div>
                            <div className="overflow-hidden rounded-[24px] border border-black/10 bg-white">
                              <div className="border-b border-black/10 px-4 py-3 text-xs uppercase tracking-[0.16em] text-black/[0.5]">
                                Current draft
                              </div>
                              <pre className="max-h-[620px] overflow-auto bg-[#101114] px-4 py-4 font-mono text-xs leading-6 text-white/88">
                                {selectedWorkbenchDraft || " "}
                              </pre>
                            </div>
                          </div>
                        )}

                        {workbenchViewMode === "repo-diff" && (
                          <div className="mt-4 overflow-hidden rounded-[24px] border border-black/10 bg-[#101114]">
                            <div className="border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.16em] text-white/55">
                              Git comparison against {repoDiff?.compare_target ?? "HEAD"}
                            </div>
                            <div className="max-h-[620px] overflow-auto px-4 py-4 font-mono text-xs leading-6 text-white/82">
                              {repoDiff && repoDiff.relative_path === selectedWorkbenchFile.relative_path ? (
                                repoDiff.diff ? (
                                  <pre className="whitespace-pre-wrap">{repoDiff.diff}</pre>
                                ) : (
                                  <div className="space-y-2 text-white/65">
                                    <p>{repoDiff.note ?? "No repository diff is available for this file."}</p>
                                  </div>
                                )
                              ) : (
                                <p className="text-white/55">Load the repository diff for this file to inspect saved changes against HEAD.</p>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="mt-6 rounded-[24px] border border-dashed border-black/10 bg-sand/35 px-5 py-12 text-center text-sm text-black/[0.58]">
                        Choose a file from the workspace tree to inspect, edit, diff, and save it here. The coding agent will also keep this workbench in sync as it reads files.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {["computer", "browser", "terminal", "files", "preview"].includes(operatorTab) && (
              <div className="space-y-5">
                {(computerError || computerNotice) && (
                  <div
                    className={cn(
                      "rounded-[22px] border px-4 py-3 text-sm",
                      computerError
                        ? "border-red-200 bg-red-50 text-red-900"
                        : "border-emerald-200 bg-emerald-50 text-emerald-900"
                    )}
                  >
                    {computerError ?? computerNotice}
                  </div>
                )}

                {showComputerOverview && (
                  <div className="rounded-[28px] border border-black/10 bg-white/82 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                        <MonitorSmartphone className="h-4 w-4" />
                        Swarm Computer
                      </div>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-black/[0.62]">
                        Live browser playback, terminal activity, and generated app previews stay anchored here while the agents work.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="border-black/10 bg-white/80 text-black/[0.72]">
                        {browserSessions.length} browser session{browserSessions.length === 1 ? "" : "s"}
                      </Badge>
                      <Badge className="border-black/10 bg-white/80 text-black/[0.72]">
                        {terminalSessions.length} terminal session{terminalSessions.length === 1 ? "" : "s"}
                      </Badge>
                      <Badge className="border-black/10 bg-white/80 text-black/[0.72]">
                        {previewArtifacts.length} preview{previewArtifacts.length === 1 ? "" : "s"}
                      </Badge>
                      <Badge className="border-black/10 bg-white/80 text-black/[0.72]">
                        {computerSessions.filter((session) => session.status === "running").length} live
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[22px] bg-sand/55 px-4 py-4">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-black/[0.42]">Current browser</p>
                      <p className="mt-2 text-sm font-medium text-black/[0.8]">
                        {browserSession ? compactText(sessionLabel(browserSession, "Browser session"), 56) : "Idle"}
                      </p>
                      <p className="mt-2 text-xs text-black/[0.52]">
                        {browserSession ? formatRelativeTime(browserSession.updated_at) : "No browser activity yet"}
                      </p>
                    </div>
                    <div className="rounded-[22px] bg-sand/55 px-4 py-4">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-black/[0.42]">Current terminal</p>
                      <p className="mt-2 text-sm font-medium text-black/[0.8]">
                        {terminalSession ? compactText(sessionLabel(terminalSession, "Python sandbox"), 56) : "Idle"}
                      </p>
                      <p className="mt-2 text-xs text-black/[0.52]">
                        {terminalSession ? formatRelativeTime(terminalSession.updated_at) : "No code execution yet"}
                      </p>
                    </div>
                    <div className="rounded-[22px] bg-sand/55 px-4 py-4">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-black/[0.42]">Latest output</p>
                      <p className="mt-2 text-sm font-medium text-black/[0.8]">
                        {selectedPreviewArtifact ? artifactLabel(selectedPreviewArtifact) : "Waiting for generated previews"}
                      </p>
                      <p className="mt-2 text-xs text-black/[0.52]">
                        {selectedPreviewArtifact
                          ? `${selectedPreviewArtifact.content_type ?? "artifact"} - ${formatBytes(selectedPreviewArtifact.size_bytes)}`
                          : "Apps, docs, screenshots, and reports will render here"}
                      </p>
                    </div>
                    <div className="rounded-[22px] bg-sand/55 px-4 py-4">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-black/[0.42]">Task activity</p>
                      <p className="mt-2 text-sm font-medium text-black/[0.8]">
                        {mergedTimeline.length} event{mergedTimeline.length === 1 ? "" : "s"} tracked
                      </p>
                      <p className="mt-2 text-xs text-black/[0.52]">
                        {activeThread ? compactText(activeThread.title, 60) : "Select a task to monitor"}
                      </p>
                    </div>
                  </div>

                  {(isTaskPaused || pendingApprovalRequests.length > 0) && (
                    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                      {isTaskPaused && (
                        <div className="rounded-[22px] border border-amber-200 bg-amber-50/90 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-amber-900/72">Task state</p>
                              <p className="mt-2 text-sm font-medium text-amber-950">Task paused</p>
                              <p className="mt-2 text-sm leading-6 text-amber-900/80">
                                New runs are blocked until you resume this task.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void setTaskStatus("active")}
                              disabled={headerActionLoading === "active"}
                              className="inline-flex items-center gap-2 rounded-full bg-amber-950 px-3 py-2 text-xs uppercase tracking-[0.14em] text-white disabled:opacity-60"
                            >
                              <Play className="h-3.5 w-3.5" />
                              {headerActionLoading === "active" ? "Resuming..." : "Resume"}
                            </button>
                          </div>
                        </div>
                      )}

                      {pendingApprovalRequests.length > 0 && (
                        <div className="rounded-[22px] border border-amber-200 bg-white/86 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Pending approvals</p>
                              <p className="mt-2 text-sm font-medium text-black/[0.82]">
                                {pendingApprovalRequests.length} action{pendingApprovalRequests.length === 1 ? "" : "s"} waiting
                              </p>
                            </div>
                            <Badge className="bg-amber-600 text-white border-transparent">human review</Badge>
                          </div>
                          <div className="mt-3 space-y-2">
                            {pendingApprovalRequests.slice(0, 2).map((request) => (
                              <div key={request.id} className="rounded-[18px] border border-amber-200 bg-amber-50/55 p-3">
                                <p className="text-sm font-medium text-black/[0.82]">{request.title}</p>
                                <p className="mt-2 text-sm leading-6 text-black/[0.68]">
                                  {compactText(request.reason, 180)}
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void approvePendingRequest(request)}
                                    disabled={approvalActionLoading === request.id || running || isTaskPaused}
                                    className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-2 text-xs uppercase tracking-[0.14em] text-white disabled:opacity-60"
                                  >
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    {approvalActionLoading === request.id ? "Approving..." : "Approve"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deferPendingRequest(request)}
                                    disabled={approvalActionLoading === request.id}
                                    className="rounded-full border border-black/10 bg-white/85 px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/[0.72] disabled:opacity-60"
                                  >
                                    Keep blocked
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(activeTaskMemory || activeProjectMemory) && (
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {activeTaskMemory && (
                        <div className="rounded-[22px] border border-black/10 bg-white/76 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Task memory</p>
                              <p className="mt-2 text-sm font-medium text-black/[0.82]">Shared task context</p>
                            </div>
                            <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-black/[0.5]">
                              {activeTaskMemory.run_count} refreshes
                            </span>
                          </div>
                          {activeTaskMemory.summary && (
                            <p className="mt-3 text-sm leading-6 text-black/[0.68]">
                              {compactText(activeTaskMemory.summary, 220)}
                            </p>
                          )}
                        </div>
                      )}
                      {activeProjectMemory && (
                        <div className="rounded-[22px] border border-black/10 bg-white/76 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Project memory</p>
                              <p className="mt-2 text-sm font-medium text-black/[0.82]">
                                {selectedProject?.name ? `${selectedProject.name} context` : "Shared project context"}
                              </p>
                            </div>
                            <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-black/[0.5]">
                              {activeProjectMemory.run_count} updates
                            </span>
                          </div>
                          {activeProjectMemory.summary && (
                            <p className="mt-3 text-sm leading-6 text-black/[0.68]">
                              {compactText(activeProjectMemory.summary, 220)}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {taskTemplates.length > 0 && (
                    <div className="mt-4 rounded-[22px] border border-black/10 bg-white/76 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">Task templates</p>
                          <p className="mt-2 text-sm font-medium text-black/[0.82]">Launch a workflow preset</p>
                        </div>
                        {selectedTaskTemplate && (
                          <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-black/[0.5]">
                            {selectedTaskTemplate.name}
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {taskTemplates.slice(0, 6).map((template) => {
                          const isSelected = selectedTaskTemplateKey === template.key;
                          return (
                            <button
                              key={template.key}
                              type="button"
                              onClick={() => applyTaskTemplate(template)}
                              className={cn(
                                "rounded-full border px-3 py-2 text-xs uppercase tracking-[0.14em] transition",
                                isSelected
                                  ? "border-transparent bg-ink text-white"
                                  : "border-black/10 bg-white text-black/[0.68] hover:bg-sand/45"
                              )}
                            >
                              {template.name}
                            </button>
                          );
                        })}
                        {selectedTaskTemplate && (
                          <button
                            type="button"
                            onClick={clearTaskTemplate}
                            className="rounded-full border border-black/10 bg-white px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/[0.68] transition hover:bg-sand/45"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      {selectedTaskTemplate && (
                        <p className="mt-3 text-sm leading-6 text-black/[0.68]">
                          {selectedTaskTemplate.chat_defaults.prompt}
                        </p>
                      )}
                      {templateNotice && <p className="mt-3 text-sm text-emerald-700">{templateNotice}</p>}
                    </div>
                  )}
                  </div>
                )}

                {showBrowserMode &&
                  (browserSession ? (
                    <div className="rounded-[26px] border border-black/10 bg-white/80 p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                          <Globe className="h-4 w-4" />
                          {browserSession.page_title || "Browser session"}
                        </div>
                        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.46]">
                          {browserSession.final_url || browserSession.target_url || "Awaiting target"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={statusBadgeClass(browserSession.status)}>
                          {statusLabel(browserSession.status)}
                        </Badge>
                        {browserSession.final_url && (
                          <a
                            href={browserSession.final_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-3 py-2 text-xs font-medium text-black/[0.72] transition hover:bg-white"
                          >
                            Open page
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {selectedBrowserHtml && (
                          <a
                            href={toolArtifactPreviewHref(data.workspace_id, selectedBrowserHtml)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-3 py-2 text-xs font-medium text-black/[0.72] transition hover:bg-white"
                          >
                            Open HTML
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>

                    {browserSessions.length > 1 && (
                      <div className="mb-4 flex flex-wrap gap-2">
                        {browserSessions.map((session, index) => (
                          <button
                            key={session.session_id}
                            type="button"
                            onClick={() => setSelectedBrowserSessionId(session.session_id)}
                            className={cn(
                              "rounded-full border px-3 py-2 text-left text-xs transition",
                              browserSession.session_id === session.session_id
                                ? "border-ink bg-ink text-white"
                                : "border-black/10 bg-white/75 text-black/[0.7] hover:bg-white"
                            )}
                          >
                            <span className="block font-medium">
                              {compactText(sessionLabel(session, `Browser ${index + 1}`), 34)}
                            </span>
                            <span className="mt-1 block uppercase tracking-[0.14em] opacity-70">
                              {statusLabel(session.status)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedBrowserScreenshot ? (
                      <Image
                        src={toolArtifactPreviewHref(data.workspace_id, selectedBrowserScreenshot)}
                        alt={browserSession.page_title || "Browser capture"}
                        width={1600}
                        height={900}
                        unoptimized
                        className="h-auto w-full rounded-[22px] border border-black/10 bg-sand/60"
                      />
                    ) : selectedBrowserHtml ? (
                      <iframe
                        key={selectedBrowserHtml.storage_key}
                        src={toolArtifactPreviewHref(data.workspace_id, selectedBrowserHtml)}
                        title={artifactLabel(selectedBrowserHtml)}
                        className="h-[380px] w-full rounded-[22px] border border-black/10 bg-white"
                        sandbox="allow-same-origin allow-scripts"
                      />
                    ) : (
                      <div className="rounded-[22px] border border-dashed border-black/10 bg-sand/40 px-4 py-12 text-center text-sm text-black/[0.58]">
                        No screenshot or inline page preview is available for this browser session yet.
                      </div>
                    )}

                    {browserMetrics.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {browserMetrics.map((entry) => (
                          <span
                            key={`${browserSession.session_id}-${entry.key}`}
                            className="rounded-full bg-black/[0.04] px-3 py-1.5 text-xs text-black/[0.62]"
                          >
                            {entry.label}: {entry.value}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 grid gap-4 lg:grid-cols-[0.56fr_0.44fr]">
                      <div className="rounded-[22px] bg-sand/60 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-black/[0.44]">Page extract</p>
                        <p className="mt-3 text-sm leading-7 text-black/[0.74]">
                          {browserSession.extracted_text
                            ? compactText(browserSession.extracted_text, 520)
                            : "The browser session has not captured readable page text yet."}
                        </p>
                      </div>
                      <div className="space-y-4">
                        <div className="rounded-[22px] bg-white/75 p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-black/[0.44]">Actions</p>
                          <div className="mt-3 space-y-2 text-sm text-black/[0.72]">
                            {[...(browserSession.executed_actions ?? []), ...(browserSession.skipped_actions ?? [])].length > 0 ? (
                              <>
                                {(browserSession.executed_actions ?? []).map((action, index) => (
                                  <div
                                    key={`executed-${action.kind}-${action.selector}-${index}`}
                                    className="rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-3"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="font-medium text-emerald-900">
                                        {formatToolName(action.kind)}
                                      </span>
                                      <span className="text-[11px] uppercase tracking-[0.14em] text-emerald-800/70">
                                        {action.status ?? "executed"}
                                      </span>
                                    </div>
                                    <p className="mt-2 break-all text-xs text-emerald-900/80">{action.selector}</p>
                                  </div>
                                ))}
                                {(browserSession.skipped_actions ?? []).map((action, index) => (
                                  <div
                                    key={`skipped-${action.kind}-${action.selector}-${index}`}
                                    className="rounded-2xl border border-black/10 bg-sand/55 px-3 py-3"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="font-medium text-black/[0.72]">
                                        {formatToolName(action.kind)}
                                      </span>
                                      <span className="text-[11px] uppercase tracking-[0.14em] text-black/[0.46]">
                                        {action.status ?? "skipped"}
                                      </span>
                                    </div>
                                    <p className="mt-2 break-all text-xs text-black/[0.58]">{action.selector}</p>
                                  </div>
                                ))}
                              </>
                            ) : (
                              <div className="rounded-2xl bg-sand/55 px-3 py-2">
                                Read-only capture. No interactive browser actions executed.
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="rounded-[22px] bg-white/75 p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-black/[0.44]">Headings</p>
                          <div className="mt-3 space-y-2 text-sm text-black/[0.72]">
                            {browserSession.headings && browserSession.headings.length > 0 ? (
                              browserSession.headings.slice(0, 6).map((heading, index) => (
                                <div key={`${heading}-${index}`} className="rounded-2xl bg-sand/55 px-3 py-2">
                                  {heading}
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl bg-sand/55 px-3 py-2">No heading summary captured yet.</div>
                            )}
                          </div>
                        </div>
                        <div className="rounded-[22px] bg-white/75 p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-black/[0.44]">Links</p>
                          <div className="mt-3 space-y-2 text-sm text-black/[0.72]">
                            {browserSession.links && browserSession.links.length > 0 ? (
                              browserSession.links.slice(0, 5).map((link) => (
                                <a
                                  key={`${link.text}-${link.url}`}
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center justify-between gap-2 rounded-2xl bg-sand/55 px-3 py-2 transition hover:bg-sand/75"
                                >
                                  <span className="truncate">{link.text || link.url}</span>
                                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                                </a>
                              ))
                            ) : (
                              <div className="rounded-2xl bg-sand/55 px-3 py-2">No link summary captured yet.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {browserSession.warnings && browserSession.warnings.length > 0 && (
                      <div className="mt-4 rounded-[22px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        {browserSession.warnings.join(" ")}
                      </div>
                    )}
                    </div>
                  ) : (
                    <div className="rounded-[26px] border border-dashed border-black/10 bg-white/75 px-5 py-10 text-center text-sm text-black/[0.6]">
                      Browser work will appear here when a run opens pages, captures screenshots, or performs approved actions.
                    </div>
                  ))}

                {showTerminalMode &&
                  (terminalSession ? (
                    <div className="rounded-[26px] border border-black/10 bg-[#111111] p-4 text-white">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <TerminalSquare className="h-4 w-4" />
                          Terminal controls
                        </div>
                        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-white/45">
                          {(terminalSession.command ?? []).join(" ") || "Python sandbox"}
                        </p>
                      </div>
                      <Badge className={statusBadgeClass(terminalSession.status)}>
                        {statusLabel(terminalSession.status)}
                      </Badge>
                    </div>

                    {terminalSessions.length > 1 && (
                      <div className="mb-4 flex flex-wrap gap-2">
                        {terminalSessions.map((session, index) => (
                          <button
                            key={session.session_id}
                            type="button"
                            onClick={() => setSelectedTerminalSessionId(session.session_id)}
                            className={cn(
                              "rounded-full border px-3 py-2 text-left text-xs transition",
                              terminalSession.session_id === session.session_id
                                ? "border-white/15 bg-white text-black"
                                : "border-white/10 bg-black/25 text-white/72 hover:bg-black/35"
                            )}
                          >
                            <span className="block font-medium">
                              {compactText(sessionLabel(session, `Terminal ${index + 1}`), 34)}
                            </span>
                            <span className="mt-1 block uppercase tracking-[0.14em] opacity-70">
                              {statusLabel(session.status)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        {(["combined", "stdout", "stderr"] as TerminalStreamMode[]).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setTerminalStreamMode(mode)}
                            className={cn(
                              "rounded-full border px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] transition",
                              terminalStreamMode === mode
                                ? "border-white bg-white text-black"
                                : "border-white/10 bg-black/20 text-white/72 hover:bg-black/35"
                            )}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void copyTerminalOutput()}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs font-medium text-white/72 transition hover:bg-black/35"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy output
                        </button>
                        <button
                          type="button"
                          onClick={() => setTerminalFollowOutput((current) => !current)}
                          className={cn(
                            "rounded-full border px-3 py-2 text-xs font-medium transition",
                            terminalFollowOutput
                              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                              : "border-white/10 bg-black/25 text-white/72 hover:bg-black/35"
                          )}
                        >
                          Follow live {terminalFollowOutput ? "on" : "off"}
                        </button>
                        <button
                          type="button"
                          onClick={jumpTerminalToLatest}
                          className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs font-medium text-white/72 transition hover:bg-black/35"
                        >
                          Jump to latest
                        </button>
                      </div>
                    </div>

                    <div className="mb-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-[20px] border border-white/10 bg-black/35 px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-white/42">Phase</p>
                        <p className="mt-2 text-sm text-white/86">{terminalSession.phase ?? terminalSession.status}</p>
                      </div>
                      <div className="rounded-[20px] border border-white/10 bg-black/35 px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-white/42">Return code</p>
                        <p className="mt-2 text-sm text-white/86">
                          {terminalSession.returncode !== null && terminalSession.returncode !== undefined
                            ? terminalSession.returncode
                            : terminalSession.status === "running"
                              ? "Running"
                              : "Pending"}
                        </p>
                      </div>
                      <div className="rounded-[20px] border border-white/10 bg-black/35 px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-white/42">Captured size</p>
                        <p className="mt-2 text-sm text-white/86">
                          {`${(terminalSession.stdout ?? "").length + (terminalSession.stderr ?? "").length} chars`}
                        </p>
                      </div>
                    </div>

                    <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-white/45">
                      <span>
                        {terminalSession.status === "running"
                          ? "Live stream"
                          : terminalSession.returncode !== null && terminalSession.returncode !== undefined
                            ? `Return code ${terminalSession.returncode}`
                            : "Session output"}
                      </span>
                      <span>
                        {terminalSession.timed_out
                          ? "Timed out"
                          : `${(terminalSession.stdout ?? "").length + (terminalSession.stderr ?? "").length} chars`}
                      </span>
                    </div>
                    <div
                      ref={terminalOutputRef}
                      className="max-h-[460px] overflow-auto rounded-[20px] border border-white/10 bg-black/45 p-4 font-mono text-xs leading-6 text-white/88"
                    >
                      {terminalOutput.trim() ? (
                        <pre
                          className={cn(
                            "whitespace-pre-wrap",
                            terminalStreamMode === "stderr" && "text-red-300"
                          )}
                        >
                          {terminalOutput}
                        </pre>
                      ) : (
                        <pre className="whitespace-pre-wrap text-white/55">
                          {terminalSession.status === "running"
                            ? "Waiting for terminal output..."
                            : "No terminal output captured yet."}
                        </pre>
                      )}
                    </div>

                    {terminalArtifacts.length > 0 && (
                      <div className="mt-4">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-white/42">Generated outputs</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {terminalArtifacts.map((artifact) => (
                            <button
                              key={artifact.storage_key}
                              type="button"
                              onClick={() => {
                                setSelectedPreviewStorageKey(artifact.storage_key);
                                setOperatorTab("preview");
                              }}
                              className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs text-white/78 transition hover:bg-white/14"
                            >
                              {artifactLabel(artifact)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    </div>
                  ) : (
                    <div className="rounded-[26px] border border-dashed border-black/10 bg-white/75 px-5 py-8 text-center text-sm text-black/[0.6]">
                      Terminal and code execution output will appear here when the coding or analysis agents use the sandbox.
                    </div>
                  ))}

                {showPreviewMode && (
                  <div className="rounded-[26px] border border-black/10 bg-white/80 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                        <Code2 className="h-4 w-4" />
                        App preview
                      </div>
                      <p className="mt-2 text-sm text-black/[0.58]">
                        Generated web pages, reports, screenshots, and other previewable outputs render inline here.
                      </p>
                    </div>
                    {selectedPreviewArtifact && (
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={toolArtifactPreviewHref(data.workspace_id, selectedPreviewArtifact)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-3 py-2 text-xs font-medium text-black/[0.72] transition hover:bg-white"
                        >
                          Open preview
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                        <a
                          href={toolArtifactHref(data.workspace_id, selectedPreviewArtifact)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-3 py-2 text-xs font-medium text-black/[0.72] transition hover:bg-white"
                        >
                          Download
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    )}
                  </div>

                  {previewArtifacts.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {previewArtifacts.map((artifact) => (
                        <button
                          key={artifact.storage_key}
                          type="button"
                          onClick={() => setSelectedPreviewStorageKey(artifact.storage_key)}
                          className={cn(
                            "rounded-full border px-3 py-2 text-left text-xs transition",
                            selectedPreviewArtifact?.storage_key === artifact.storage_key
                              ? "border-ink bg-ink text-white"
                              : "border-black/10 bg-white/75 text-black/[0.7] hover:bg-white"
                          )}
                        >
                          {compactText(artifactLabel(artifact), 36)}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 overflow-hidden rounded-[24px] border border-black/10 bg-[#f5f0e6]">
                    {selectedPreviewArtifact ? (
                      selectedPreviewMode === "image" ? (
                        <Image
                          src={toolArtifactPreviewHref(data.workspace_id, selectedPreviewArtifact)}
                          alt={artifactLabel(selectedPreviewArtifact)}
                          width={1600}
                          height={900}
                          unoptimized
                          className="h-auto w-full bg-sand/70 object-contain"
                        />
                      ) : selectedPreviewMode === "frame" ? (
                        <iframe
                          key={selectedPreviewArtifact.storage_key}
                          src={toolArtifactPreviewHref(data.workspace_id, selectedPreviewArtifact)}
                          title={artifactLabel(selectedPreviewArtifact)}
                          className="h-[560px] w-full bg-white"
                          sandbox="allow-same-origin allow-scripts"
                        />
                      ) : (
                        <div className="flex min-h-[340px] items-center justify-center px-6 py-12 text-center text-sm text-black/[0.58]">
                          This artifact is not previewable inline yet. Use the download action above to inspect it.
                        </div>
                      )
                    ) : (
                      <div className="flex min-h-[340px] items-center justify-center px-6 py-12 text-center text-sm text-black/[0.58]">
                        Generated apps, docs, images, and reports will render here as soon as the agents create previewable artifacts.
                      </div>
                    )}
                  </div>

                  {selectedPreviewArtifact && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="rounded-full bg-black/[0.04] px-3 py-1.5 text-xs text-black/[0.62]">
                        {selectedPreviewArtifact.content_type ?? "artifact"}
                      </span>
                      <span className="rounded-full bg-black/[0.04] px-3 py-1.5 text-xs text-black/[0.62]">
                        {formatBytes(selectedPreviewArtifact.size_bytes)}
                      </span>
                      <span className="rounded-full bg-black/[0.04] px-3 py-1.5 text-xs text-black/[0.62]">
                        {artifactFileName(selectedPreviewArtifact)}
                      </span>
                    </div>
                  )}
                  </div>
                )}

                {operatorTab === "files" && (
                  <div className="rounded-[26px] border border-black/10 bg-white/80 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                      <FolderTree className="h-4 w-4" />
                      Workspace files
                    </div>
                    <p className="mt-2 text-sm text-black/[0.58]">
                      Jump from the live operator surface into the files the coding agent is reading or changing.
                    </p>

                    <div className="mt-4 space-y-2">
                      {rootWorkbenchTree && rootWorkbenchTree.entries.length > 0 ? (
                        rootWorkbenchTree.entries.slice(0, 16).map((entry) => (
                          <button
                            key={entry.relative_path}
                            type="button"
                            onClick={() => {
                              if (entry.kind === "dir") {
                                void toggleWorkbenchDirectory(entry.relative_path);
                                setOperatorTab("code");
                                return;
                              }
                              void openWorkbenchFile(entry.relative_path);
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-[18px] border border-black/10 bg-sand/45 px-4 py-3 text-left text-sm text-black/[0.72] transition hover:bg-sand/65"
                          >
                            <span className="flex items-center gap-2 truncate">
                              {entry.kind === "dir" ? (
                                <FolderTree className="h-4 w-4 shrink-0" />
                              ) : (
                                <FileText className="h-4 w-4 shrink-0" />
                              )}
                              <span className="truncate">{entry.relative_path}</span>
                            </span>
                            <span className="text-xs uppercase tracking-[0.14em] text-black/[0.45]">
                              {entry.kind === "dir" ? "folder" : entry.extension?.replace(".", "") || "file"}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="rounded-[22px] border border-dashed border-black/10 bg-sand/35 px-4 py-8 text-center text-sm text-black/[0.58]">
                          Workspace files will appear here once the workbench tree is loaded.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {showFilesMode && (
                  <div className="rounded-[26px] border border-black/10 bg-white/80 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                    <Activity className="h-4 w-4" />
                    {operatorTab === "files" ? "Files and outputs" : "Session activity"}
                  </div>
                  <div className="mt-4 space-y-3">
                    {operatorTab === "files" && liveWorkbenchActivities.length > 0 ? (
                      liveWorkbenchActivities.slice(0, 8).map((activity) => (
                        <button
                          key={activity.id}
                          type="button"
                          onClick={() => {
                            if (activity.relative_path) {
                              void openWorkbenchFile(activity.relative_path);
                              return;
                            }
                            if (activity.directory_path) {
                              void fetchWorkbenchDirectory(activity.directory_path, { force: true });
                            }
                          }}
                          className="w-full rounded-[20px] bg-sand/55 px-4 py-3 text-left transition hover:bg-sand/70"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-black/[0.8]">
                                {activity.relative_path ?? activity.directory_path ?? "workspace"}
                              </p>
                              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.46]">
                                {activity.agent_name ?? "Coding agent"} - {formatRelativeTime(activity.created_at)}
                              </p>
                            </div>
                            <span
                              className={cn(
                                "rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em]",
                                workbenchActivityTone(activity)
                              )}
                            >
                              {workbenchActivityLabel(activity)}
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-black/[0.66]">
                            {compactText(activity.summary, 140)}
                          </p>
                        </button>
                      ))
                    ) : computerSessions.length > 0 ? (
                      computerSessions.slice(0, 8).map((session, index) => (
                        <div key={session.session_id} className="rounded-[20px] bg-sand/55 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-black/[0.8]">
                                {compactText(
                                  sessionLabel(
                                    session,
                                    `${session.session_kind === "browser" ? "Browser" : "Terminal"} ${index + 1}`
                                  ),
                                  54
                                )}
                              </p>
                              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.46]">
                                {session.session_kind === "browser" ? "browser" : "terminal"} - {formatRelativeTime(session.updated_at)}
                              </p>
                            </div>
                            <Badge className={statusBadgeClass(session.status)}>
                              {statusLabel(session.status)}
                            </Badge>
                          </div>
                          {session.session_kind === "browser" ? (
                            <p className="mt-3 text-sm leading-6 text-black/[0.68]">
                              {compactText(session.final_url || session.target_url || session.extracted_text || "", 140) || "Browser capture in progress."}
                            </p>
                          ) : (
                            <p className="mt-3 text-sm leading-6 text-black/[0.68]">
                              {compactText((session.command ?? []).join(" "), 140) || "Python sandbox execution"}
                            </p>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[22px] border border-dashed border-black/10 bg-sand/35 px-4 py-8 text-center text-sm text-black/[0.58]">
                        Session history will populate as soon as tools start opening pages, running code, or producing artifacts.
                      </div>
                    )}
                  </div>

                  {mergedArtifacts.length > 0 && (
                    <div className="mt-5">
                      <p className="text-xs uppercase tracking-[0.16em] text-black/[0.44]">Quick outputs</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {mergedArtifacts.slice(0, 10).map((artifact) => (
                          <button
                            key={artifact.storage_key}
                            type="button"
                            onClick={() => {
                              if (isPreviewableArtifact(artifact)) {
                                setSelectedPreviewStorageKey(artifact.storage_key);
                                setOperatorTab("preview");
                              } else {
                                window.open(toolArtifactHref(data.workspace_id, artifact), "_blank", "noopener,noreferrer");
                              }
                            }}
                            className="rounded-full border border-black/10 bg-white/80 px-3 py-2 text-xs text-black/[0.72] transition hover:bg-white"
                          >
                            {artifactLabel(artifact)}
                          </button>
                        ))}
                      </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {operatorTab === "timeline" && (
              <div className="space-y-3">
                {mergedTimeline.length === 0 ? (
                  <div className="rounded-[26px] border border-dashed border-black/10 bg-white/75 px-5 py-10 text-center text-sm text-black/[0.6]">
                    The execution timeline will populate as soon as tools and sessions start running.
                  </div>
                ) : (
                  mergedTimeline.map((entry) => (
                    <motion.div
                      layout
                      key={entry.id}
                      className="rounded-[22px] border border-black/10 bg-white/78 p-4"
                      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 24 }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                            {entry.kind === "artifact" ? (
                              <Boxes className="h-4 w-4" />
                            ) : entry.session_kind === "terminal" ? (
                              <TerminalSquare className="h-4 w-4" />
                            ) : entry.session_kind === "browser" ? (
                              <MonitorSmartphone className="h-4 w-4" />
                            ) : (
                              <Activity className="h-4 w-4" />
                            )}
                            {entry.title}
                          </div>
                          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.46]">
                            {formatRelativeTime(entry.created_at)}
                          </p>
                        </div>
                        <Badge className={statusBadgeClass(entry.status)}>{statusLabel(entry.status)}</Badge>
                      </div>
                      {entry.summary && (
                        <p className="mt-3 text-sm leading-7 text-black/[0.72]">{entry.summary}</p>
                      )}
                      {entry.artifact && (
                        <a
                          href={toolArtifactHref(data.workspace_id, entry.artifact)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-2 rounded-full bg-sand/65 px-3 py-2 text-sm text-black/[0.74]"
                        >
                          Open {artifactLabel(entry.artifact)}
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {entry.meta && entry.meta.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.45]">
                          {entry.meta.map((value) => (
                            <span key={`${entry.id}-${value}`} className="rounded-full bg-black/[0.04] px-2 py-1">
                              {value}
                            </span>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))
                )}
              </div>
            )}

            {operatorTab === "artifacts" && (
              <div className="space-y-3">
                {mergedArtifacts.length === 0 ? (
                  <div className="rounded-[26px] border border-dashed border-black/10 bg-white/75 px-5 py-10 text-center text-sm text-black/[0.6]">
                    Generated files, screenshots, HTML snapshots, and sandbox outputs will appear here.
                  </div>
                ) : (
                  mergedArtifacts.map((artifact) => (
                    <motion.a
                      layout
                      key={artifact.storage_key}
                      href={toolArtifactHref(data.workspace_id, artifact)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 rounded-[22px] border border-black/10 bg-white/78 px-4 py-4 transition hover:bg-white"
                      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 24 }}
                    >
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                          <FileText className="h-4 w-4" />
                          {artifactLabel(artifact)}
                        </div>
                        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.46]">
                          {artifact.content_type ?? "application/octet-stream"}
                        </p>
                      </div>
                      <ArrowUpRight className="h-4 w-4 text-black/[0.45]" />
                    </motion.a>
                  ))
                )}
              </div>
            )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </aside>
        )}
      </div>
    </section>
  );
}

