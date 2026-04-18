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
  RotateCcw,
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
  ChatAgentsData,
  AutonomyMode,
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
  ModelCapability,
  RunStepRecord,
  SharedMemory,
  ExecutionEnvironmentRequest,
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

type SideBySideDiffCellKind = "context" | "removed" | "added" | "empty";

type SideBySideDiffRow =
  | {
      kind: "hunk";
      header: string;
    }
  | {
      kind: "content";
      leftLineNumber: number | null;
      rightLineNumber: number | null;
      leftText: string;
      rightText: string;
      leftKind: SideBySideDiffCellKind;
      rightKind: SideBySideDiffCellKind;
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
  kind: "browser_interaction" | "browser_takeover" | "external_delivery";
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

type ModelProfileOption = {
  value: string;
  label: string;
  menuLabel: string;
  description: string;
  configured: boolean;
};

const PREMIUM_TEMPLATE_KEYS = new Set([
  "autonomous_app_builder",
  "live_debugging_assistant",
  "team_delivery_swarm"
]);

const EXECUTION_TARGET_OS_OPTIONS = [
  { value: "", label: "Auto OS" },
  { value: "linux", label: "Linux" },
  { value: "windows", label: "Windows" },
  { value: "macos", label: "macOS" }
] as const;

const EXECUTION_RUNTIME_PROFILE_OPTIONS = [
  { value: "auto", label: "Auto runtime" },
  { value: "python", label: "Python" },
  { value: "node", label: "Node" },
  { value: "shell", label: "Shell" },
  { value: "powershell", label: "PowerShell" }
] as const;

const EXECUTION_RESOURCE_TIER_OPTIONS = [
  { value: "", label: "Auto tier" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "gpu", label: "GPU" }
] as const;

const EXECUTION_PERSISTENCE_SCOPE_OPTIONS = [
  { value: "", label: "Auto scope" },
  { value: "task", label: "Task-scoped" },
  { value: "workspace", label: "Workspace-scoped" }
] as const;

const AUTONOMY_MODE_OPTIONS = [
  {
    value: "safe",
    label: "Safe",
    description: "Move carefully, stop sooner on uncertainty, and surface blockers explicitly."
  },
  {
    value: "autonomous",
    label: "Autonomous",
    description: "Default behavior: handle normal steps automatically and stop only for real blockers."
  },
  {
    value: "maximum",
    label: "Maximum autonomy",
    description: "Push through directly implied allowed steps and interrupt only for hard limits or takeover."
  }
] as const satisfies ReadonlyArray<{
  value: AutonomyMode;
  label: string;
  description: string;
}>;

const PREMIUM_TEMPLATE_ENVIRONMENT_PRESETS: Record<string, ExecutionEnvironmentRequest> = {
  autonomous_app_builder: {
    target_os: "linux",
    runtime_profile: "node",
    resource_tier: "large",
    network_access: true,
    persistence_scope: "workspace"
  },
  live_debugging_assistant: {
    target_os: "linux",
    runtime_profile: "shell",
    resource_tier: "medium",
    network_access: true,
    persistence_scope: "task"
  },
  team_delivery_swarm: {
    target_os: "linux",
    runtime_profile: "auto",
    resource_tier: "medium",
    network_access: true,
    persistence_scope: "workspace"
  }
};

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
const OPTIMISTIC_BROWSER_SESSION_ID = "pending-browser-session";
const CITATION_REFERENCE_PATTERN = /\[(S\d+)\]/g;

function summarizeModelStrengths(model: ModelCapability) {
  const strengths: string[] = [];
  if (model.supports_research) {
    strengths.push("Research");
  }
  if (model.supports_structured_output) {
    strengths.push("Content");
  }
  if (model.supports_coding) {
    strengths.push("Coding");
  }
  if (model.supports_ui_diagrams) {
    strengths.push("UI/Diagrams");
  }
  if (model.supports_planning || model.supports_reasoning) {
    strengths.push("Planning");
  }
  if (model.supports_vision) {
    strengths.push("Vision");
  }
  const deduped = Array.from(new Set(strengths));
  return deduped.length > 0 ? deduped : ["General"];
}

function formatModelLabel(modelName: string) {
  const normalized = modelName.trim();
  const knownLabels: Record<string, string> = {
    "qwen3.5-flash": "Qwen3.5 Flash",
    "qwen3.6-plus": "Qwen3.6 Plus",
    "qwen3-max": "Qwen3 Max",
    "qwen3.5-plus": "Qwen3.5 Plus",
    "qwen3-coder-flash": "Qwen3 Coder Flash",
    "qwen3-coder-plus": "Qwen3 Coder Plus",
    "qwen3-vl-flash": "Qwen3 VL Flash",
    "qwen3-vl-plus": "Qwen3 VL Plus",
    "gpt-5.4": "GPT-5.4",
    "gpt-5.4-mini": "GPT-5.4 Mini",
    "gpt-5.2": "GPT-5.2",
    "claude-sonnet-4": "Claude Sonnet 4",
    "claude-opus-4": "Claude Opus 4",
    "gemini-2.5-pro": "Gemini 2.5 Pro",
    "gemini-2.5-flash": "Gemini 2.5 Flash"
  };

  return knownLabels[normalized] ?? normalized;
}

function isTaskRunnableModel(model: ModelCapability) {
  return Boolean(
    model.supports_chat ||
      model.supports_reasoning ||
      model.supports_planning ||
      model.supports_research ||
      model.supports_coding ||
      model.supports_ui_diagrams ||
      model.supports_vision ||
      model.supports_structured_output
  );
}

function buildModelProfileOptions(chatAgents?: ChatAgentsData): ModelProfileOption[] {
  const catalog = (chatAgents?.model_catalog ?? [])
    .filter((model) => isTaskRunnableModel(model))
    .sort((left, right) => {
      if (left.name === "qwen3.5-flash" || right.name === "qwen3.5-flash") {
        return left.name === "qwen3.5-flash" ? -1 : 1;
      }
      if (left.configured !== right.configured) {
        return left.configured ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  if (catalog.length === 0) {
    return [
      {
        value: "qwen3.5-flash",
        label: "Qwen3.5 Flash",
        menuLabel: "Qwen3.5 Flash — Auto swarm orchestration",
        description: "Auto swarm orchestration for this task",
        configured: true
      }
    ];
  }

  return catalog.map((model) => {
    const modelLabel = formatModelLabel(model.name);
    if (model.name === "qwen3.5-flash") {
      return {
        value: model.name,
        label: modelLabel,
        menuLabel: `${modelLabel} — Auto swarm orchestration`,
        description: "Auto swarm orchestration for this task",
        configured: model.configured
      };
    }
    const strengths = summarizeModelStrengths(model);
    const suffix = model.configured
      ? strengths.join(", ")
      : `${strengths.join(", ")} • Not configured`;
    return {
      value: model.name,
      label: modelLabel,
      menuLabel: `${modelLabel} — ${suffix}`,
      description: model.configured
        ? `Best for ${strengths.join(", ")}`
        : `Best for ${strengths.join(", ")} • Not configured on this server`,
      configured: model.configured
    };
  });
}

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

function formatElapsedLabel(startedAt: string | null | undefined, nowMs: number) {
  if (!startedAt) {
    return null;
  }

  const startedMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
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

function normalizeExecutionEnvironment(value: unknown): ExecutionEnvironmentRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const normalized: ExecutionEnvironmentRequest = {};

  if (value.target_os === "linux" || value.target_os === "windows" || value.target_os === "macos") {
    normalized.target_os = value.target_os;
  }

  if (
    value.runtime_profile === "auto" ||
    value.runtime_profile === "python" ||
    value.runtime_profile === "node" ||
    value.runtime_profile === "shell" ||
    value.runtime_profile === "powershell"
  ) {
    normalized.runtime_profile = value.runtime_profile;
  }

  if (
    value.resource_tier === "small" ||
    value.resource_tier === "medium" ||
    value.resource_tier === "large" ||
    value.resource_tier === "gpu"
  ) {
    normalized.resource_tier = value.resource_tier;
  }

  if (typeof value.network_access === "boolean") {
    normalized.network_access = value.network_access;
  }

  if (value.persistence_scope === "task" || value.persistence_scope === "workspace") {
    normalized.persistence_scope = value.persistence_scope;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function cleanExecutionEnvironment(
  value: ExecutionEnvironmentRequest | null | undefined
): ExecutionEnvironmentRequest | null {
  return normalizeExecutionEnvironment(value ?? null);
}

function normalizeAutonomyMode(value: unknown): AutonomyMode {
  if (value === "safe" || value === "autonomous" || value === "maximum") {
    return value;
  }
  return "autonomous";
}

function autonomyModeSummary(value: AutonomyMode) {
  switch (value) {
    case "safe":
      return "Smaller steps, earlier blockers, and more conservative execution.";
    case "maximum":
      return "Aggressive automatic execution inside hard platform boundaries.";
    case "autonomous":
    default:
      return "Balanced automatic execution with interruptions only for real blockers.";
  }
}

function executionEnvironmentSummary(value: ExecutionEnvironmentRequest | null | undefined) {
  const normalized = cleanExecutionEnvironment(value);
  if (!normalized) {
    return "Auto-select the runner, runtime, and scale for each task.";
  }

  const parts: string[] = [];
  if (normalized.target_os) {
    parts.push(normalized.target_os);
  }
  if (normalized.runtime_profile) {
    parts.push(normalized.runtime_profile);
  }
  if (normalized.resource_tier) {
    parts.push(normalized.resource_tier);
  }
  if (typeof normalized.network_access === "boolean") {
    parts.push(normalized.network_access ? "network on" : "network off");
  }
  if (normalized.persistence_scope) {
    parts.push(`${normalized.persistence_scope} persistence`);
  }
  return parts.join(" · ");
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

function isTerminalRunStatus(status: string | null | undefined) {
  if (!status) {
    return false;
  }
  return ["completed", "failed", "cancelled", "canceled"].includes(status.toLowerCase());
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

function renderInlineMessageText(
  content: string,
  citationLookup: Map<string, Message["citations"][number]>,
  keyPrefix: string
) {
  const citationSegments = content.split(CITATION_REFERENCE_PATTERN);
  return citationSegments.flatMap((segment, segmentIndex) => {
    const citation = citationLookup.get(segment);
    if (citation) {
      return (
        <span
          key={`${keyPrefix}-citation-${segmentIndex}`}
          title={citation.title}
          className="mx-1 inline-flex rounded-full border border-black/10 bg-sand/75 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-black/65"
        >
          [{segment}]
        </span>
      );
    }

    const richSegments = segment.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return richSegments.filter(Boolean).map((part, richIndex) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return (
          <code
            key={`${keyPrefix}-code-${segmentIndex}-${richIndex}`}
            className="rounded-md border border-black/8 bg-black/[0.04] px-1.5 py-0.5 text-[0.92em] text-black/[0.82]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return (
          <strong key={`${keyPrefix}-bold-${segmentIndex}-${richIndex}`} className="font-semibold text-black/[0.82]">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return (
          <em key={`${keyPrefix}-italic-${segmentIndex}-${richIndex}`} className="italic text-black/[0.74]">
            {part.slice(1, -1)}
          </em>
        );
      }
      return <span key={`${keyPrefix}-text-${segmentIndex}-${richIndex}`}>{part}</span>;
    });
  });
}

function renderMessageContent(
  content: string,
  citationLookup: Map<string, Message["citations"][number]>
) {
  const lines = content.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let paragraphBuffer: string[] = [];
  let howToContinueActive = false;
  let fencedCodeBuffer: string[] | null = null;

  const flushParagraph = () => {
    const text = paragraphBuffer.join(" ").trim();
    if (!text) {
      paragraphBuffer = [];
      return;
    }
    const paragraphIndex = blocks.length;
    blocks.push(
      <p key={`paragraph-${paragraphIndex}`} className="text-sm leading-8 text-black/75">
        {renderInlineMessageText(text, citationLookup, `paragraph-${paragraphIndex}`)}
      </p>
    );
    paragraphBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      if (fencedCodeBuffer) {
        const code = fencedCodeBuffer.join("\n").trimEnd();
        blocks.push(
          <pre
            key={`code-block-${index}`}
            className="overflow-x-auto rounded-[18px] border border-black/8 bg-black/[0.04] px-4 py-3 text-[13px] leading-6 text-black/[0.78]"
          >
            <code>{code}</code>
          </pre>
        );
        fencedCodeBuffer = null;
      } else {
        fencedCodeBuffer = [];
      }
      continue;
    }

    if (fencedCodeBuffer) {
      fencedCodeBuffer.push(rawLine);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (/^---+$/.test(trimmed) || /^___+$/.test(trimmed)) {
      flushParagraph();
      blocks.push(<div key={`divider-${index}`} className="my-1 border-t border-black/[0.08]" />);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      const headingLevel = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      howToContinueActive = headingText.toLowerCase().replace(/:\s*$/, "") === "how to continue";
      const headingClasses =
        headingLevel === 1
          ? "text-[24px] font-semibold leading-[1.18] tracking-[-0.03em] text-black/[0.92]"
          : headingLevel === 2
            ? "text-[19px] font-semibold leading-[1.3] text-black/[0.88]"
            : "text-[15px] font-semibold uppercase tracking-[0.12em] text-black/[0.58]";
      blocks.push(
        <div key={`heading-${index}`} className={headingClasses}>
          {renderInlineMessageText(headingText, citationLookup, `heading-${index}`)}
        </div>
      );
      continue;
    }

    const quoteLines: string[] = [];
    while (index < lines.length) {
      const candidate = (lines[index] ?? "").trim();
      const quoteMatch = candidate.match(/^>\s?(.*)$/);
      if (!quoteMatch) {
        break;
      }
      quoteLines.push(quoteMatch[1].trim());
      index += 1;
    }
    if (quoteLines.length > 0) {
      flushParagraph();
      blocks.push(
        <div
          key={`quote-${index}`}
          className="border-l-2 border-black/[0.14] pl-4 text-sm leading-7 italic text-black/[0.62]"
        >
          {quoteLines.map((line, quoteIndex) => (
            <div key={`quote-${index}-${quoteIndex}`}>
              {renderInlineMessageText(line, citationLookup, `quote-${index}-${quoteIndex}`)}
            </div>
          ))}
        </div>
      );
      index -= 1;
      continue;
    }

    if (trimmed.toLowerCase().replace(/:\s*$/, "") === "how to continue") {
      flushParagraph();
      howToContinueActive = true;
      blocks.push(
        <div
          key={`how-to-continue-${index}`}
          className="text-[15px] leading-7 text-black/[0.7]"
        >
          How to continue:
        </div>
      );
      continue;
    }

    const numberedItems: Array<{ marker: string; content: string }> = [];
    while (index < lines.length) {
      const candidate = (lines[index] ?? "").trim();
      const numberedMatch = candidate.match(/^(\d+\.)\s+(.+)$/);
      if (!numberedMatch) {
        break;
      }
      numberedItems.push({ marker: numberedMatch[1].trim(), content: numberedMatch[2].trim() });
      index += 1;
    }
    if (numberedItems.length > 0) {
      flushParagraph();
      blocks.push(
        <div key={`numbered-${index}`} className="space-y-1.5">
          {numberedItems.map((item, itemIndex) => (
            <div
              key={`numbered-${index}-${itemIndex}`}
              className="flex items-start gap-2 text-sm leading-7 text-black/75"
            >
              <span className={cn("shrink-0 text-black/[0.72]", howToContinueActive && "font-semibold text-black/[0.82]")}>
                {item.marker}
              </span>
              <span className={cn(howToContinueActive && "font-semibold text-black/[0.84]")}>
                {renderInlineMessageText(item.content, citationLookup, `numbered-${index}-${itemIndex}`)}
              </span>
            </div>
          ))}
        </div>
      );
      howToContinueActive = false;
      index -= 1;
      continue;
    }

    const bulletItems: string[] = [];
    while (index < lines.length) {
      const candidate = (lines[index] ?? "").trim();
      const bulletMatch = candidate.match(/^(?:[-*])\s+(.+)$/);
      if (!bulletMatch) {
        break;
      }
      bulletItems.push(bulletMatch[1].trim());
      index += 1;
    }
    if (bulletItems.length > 0) {
      flushParagraph();
      blocks.push(
        <div key={`bullets-${index}`} className="space-y-1.5">
          {bulletItems.map((item, itemIndex) => (
            <div key={`bullet-${index}-${itemIndex}`} className="flex items-start gap-2 text-sm leading-7 text-black/75">
              <span className="mt-[0.45rem] h-1.5 w-1.5 rounded-full bg-black/30" />
              <div>{renderInlineMessageText(item, citationLookup, `bullet-${index}-${itemIndex}`)}</div>
            </div>
          ))}
        </div>
      );
      index -= 1;
      continue;
    }

    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  if (fencedCodeBuffer && fencedCodeBuffer.length > 0) {
    blocks.push(
      <pre
        key="code-block-trailing"
        className="overflow-x-auto rounded-[18px] border border-black/8 bg-black/[0.04] px-4 py-3 text-[13px] leading-6 text-black/[0.78]"
      >
        <code>{fencedCodeBuffer.join("\n").trimEnd()}</code>
      </pre>
    );
  }
  return blocks;
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
  kind: "browser_interaction" | "browser_takeover" | "external_delivery",
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
    const manualTakeover = normalizeManualTakeover(payload.manual_takeover);
    const skippedActions = Array.isArray(payload.skipped_actions) ? payload.skipped_actions : [];
    const warnings = Array.isArray(payload.warnings) ? payload.warnings.map(String) : [];
    if (manualTakeover?.required) {
      const targetUrl =
        manualTakeover.target_url ??
        (typeof payload.final_url === "string"
          ? payload.final_url
          : typeof payload.target_url === "string"
            ? payload.target_url
            : "the current page");
      const markerSummary =
        manualTakeover.detected_markers && manualTakeover.detected_markers.length > 0
          ? `Detected: ${manualTakeover.detected_markers.join(", ")}`
          : "A protection challenge needs a human to take over.";
      return {
        id: approvalRequestId("browser_takeover", {
          runId,
          stepIndex,
          target: targetUrl,
          reason: manualTakeover.reason
        }),
        kind: "browser_takeover",
        title: "Take control of browser session",
        reason:
          manualTakeover.reason ??
          "The browser reached a protected step that needs a human to finish before the agent can continue.",
        approvalPrompt: "",
        created_at: toolCall.created_at,
        tool: toolCall.tool_name,
        targetLabel: targetUrl,
        detailLines: [
          `Target: ${targetUrl}`,
          markerSummary,
          "Open the live page, complete the blocked step, then tell the agent what you did so it can continue."
        ]
      };
    }
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
  if (event === "browser.snapshot" || event === "computer.session.completed") {
    const manualTakeover = normalizeManualTakeover(data.manual_takeover);
    if (!manualTakeover?.required) {
      return null;
    }
    const now = new Date().toISOString();
    const targetUrl =
      manualTakeover.target_url ??
      (typeof data.final_url === "string"
        ? data.final_url
        : typeof data.target_url === "string"
          ? data.target_url
          : "the current page");
    const markerSummary =
      manualTakeover.detected_markers && manualTakeover.detected_markers.length > 0
        ? `Detected: ${manualTakeover.detected_markers.join(", ")}`
        : "A protection challenge needs a human to take over.";
    const runId = typeof data.run_id === "string" ? data.run_id : null;
    const stepIndex =
      typeof data.step_index === "number"
        ? data.step_index
        : typeof data.step_index === "string" && data.step_index.trim()
          ? Number(data.step_index)
          : null;
    return {
      id: approvalRequestId("browser_takeover", {
        runId,
        stepIndex: Number.isFinite(stepIndex) ? stepIndex : null,
        target: targetUrl,
        reason: manualTakeover.reason
      }),
      kind: "browser_takeover",
      title: "Take control of browser session",
      reason:
        manualTakeover.reason ??
        "The browser reached a protected step that needs a human to finish before the agent can continue.",
      approvalPrompt: "",
      created_at: now,
      tool: typeof data.tool === "string" ? data.tool : "browser_automation",
      targetLabel: targetUrl,
      detailLines: [
        `Target: ${targetUrl}`,
        markerSummary,
        "Open the live page, complete the blocked step, then tell the agent what you did so it can continue."
      ]
    };
  }

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
    const manualTakeover = normalizeManualTakeover(result.manual_takeover);
    const skippedActions = Array.isArray(result.skipped_actions) ? result.skipped_actions : [];
    const warnings = Array.isArray(result.warnings) ? result.warnings.map(String) : [];
    if (manualTakeover?.required) {
      const targetUrl =
        manualTakeover.target_url ??
        (typeof result.final_url === "string"
          ? result.final_url
          : typeof result.target_url === "string"
            ? result.target_url
            : "the current page");
      const markerSummary =
        manualTakeover.detected_markers && manualTakeover.detected_markers.length > 0
          ? `Detected: ${manualTakeover.detected_markers.join(", ")}`
          : "A protection challenge needs a human to take over.";
      return {
        id: approvalRequestId("browser_takeover", {
          runId,
          stepIndex: Number.isFinite(stepIndex) ? stepIndex : null,
          target: targetUrl,
          reason: manualTakeover.reason
        }),
        kind: "browser_takeover",
        title: "Take control of browser session",
        reason:
          manualTakeover.reason ??
          "The browser reached a protected step that needs a human to finish before the agent can continue.",
        approvalPrompt: "",
        created_at: now,
        tool,
        targetLabel: targetUrl,
        detailLines: [
          `Target: ${targetUrl}`,
          markerSummary,
          "Open the live page, complete the blocked step, then tell the agent what you did so it can continue."
        ]
      };
    }
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

function parseUnifiedDiffRows(diffText: string): SideBySideDiffRow[] {
  const rows: SideBySideDiffRow[] = [];
  const lines = diffText.split("\n");
  let leftLineNumber = 0;
  let rightLineNumber = 0;
  let removedBlock: Array<{ lineNumber: number; text: string }> = [];
  let addedBlock: Array<{ lineNumber: number; text: string }> = [];

  const flushChangeBlock = () => {
    if (removedBlock.length === 0 && addedBlock.length === 0) {
      return;
    }
    const count = Math.max(removedBlock.length, addedBlock.length);
    for (let index = 0; index < count; index += 1) {
      const removedLine = removedBlock[index] ?? null;
      const addedLine = addedBlock[index] ?? null;
      rows.push({
        kind: "content",
        leftLineNumber: removedLine?.lineNumber ?? null,
        rightLineNumber: addedLine?.lineNumber ?? null,
        leftText: removedLine?.text ?? "",
        rightText: addedLine?.text ?? "",
        leftKind: removedLine ? "removed" : "empty",
        rightKind: addedLine ? "added" : "empty"
      });
    }
    removedBlock = [];
    addedBlock = [];
  };

  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }
    if (line.startsWith("@@")) {
      flushChangeBlock();
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      leftLineNumber = Number(match?.[1] ?? 0);
      rightLineNumber = Number(match?.[2] ?? 0);
      rows.push({ kind: "hunk", header: line });
      continue;
    }
    if (line.startsWith("-")) {
      removedBlock.push({
        lineNumber: leftLineNumber,
        text: line.slice(1)
      });
      leftLineNumber += 1;
      continue;
    }
    if (line.startsWith("+")) {
      addedBlock.push({
        lineNumber: rightLineNumber,
        text: line.slice(1)
      });
      rightLineNumber += 1;
      continue;
    }
    if (line.startsWith("\\")) {
      continue;
    }
    flushChangeBlock();
    const content = line.startsWith(" ") ? line.slice(1) : line;
    rows.push({
      kind: "content",
      leftLineNumber,
      rightLineNumber,
      leftText: content,
      rightText: content,
      leftKind: "context",
      rightKind: "context"
    });
    leftLineNumber += 1;
    rightLineNumber += 1;
  }

  flushChangeBlock();
  return rows;
}

function workbenchDiffCellTone(kind: SideBySideDiffCellKind) {
  switch (kind) {
    case "removed":
      return "bg-rose-50 text-rose-950";
    case "added":
      return "bg-emerald-50 text-emerald-950";
    case "empty":
      return "bg-black/[0.02] text-black/[0.2]";
    default:
      return "bg-white text-black/[0.78]";
  }
}

function normalizeManualTakeover(value: unknown): ComputerSession["manual_takeover"] {
  if (!isRecord(value) || value.required !== true) {
    return null;
  }
  return {
    required: true,
    reason: typeof value.reason === "string" ? value.reason : null,
    target_url: typeof value.target_url === "string" ? value.target_url : null,
    detected_markers: Array.isArray(value.detected_markers)
      ? value.detected_markers.map(String).filter(Boolean)
      : []
  };
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
  let eventCount = 0;

  const flushFrames = (source: string) => {
    const normalizedSource = source.replace(/\r\n/g, "\n");
    const frames = normalizedSource.split("\n\n");
    const remainder = frames.pop() ?? "";

    for (const frame of frames) {
      const normalizedFrame = frame.trim();
      if (!normalizedFrame) {
        continue;
      }

      let event = "message";
      const dataLines: string[] = [];

      for (const line of normalizedFrame.split("\n")) {
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
      eventCount += 1;
    }

    return remainder;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = flushFrames(buffer);
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    buffer = flushFrames(`${buffer}\n\n`);
  }

  return eventCount;
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
    manual_takeover: normalizeManualTakeover(payload.manual_takeover),
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

function filterToolCallsForRun(
  toolCalls: ToolCallRecord[],
  stepById: Map<string, RunStepRecord>,
  latestRunId?: string | null
) {
  if (!latestRunId) {
    return toolCalls;
  }
  const filtered = toolCalls.filter((toolCall) => stepById.get(toolCall.run_step_id)?.run_id === latestRunId);
  return filtered.length > 0 ? filtered : toolCalls;
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
    manual_takeover: normalizeManualTakeover(data.manual_takeover),
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
  const shouldReplaceOptimisticBrowserSession =
    next.session_kind === "browser" &&
    next.session_id !== OPTIMISTIC_BROWSER_SESSION_ID &&
    Boolean(sessions[OPTIMISTIC_BROWSER_SESSION_ID]);

  const optimisticBrowserSession = shouldReplaceOptimisticBrowserSession
    ? sessions[OPTIMISTIC_BROWSER_SESSION_ID]
    : null;
  const existing = sessions[next.session_id];
  if (!existing) {
    const mergedNext =
      optimisticBrowserSession && optimisticBrowserSession.session_kind === "browser"
        ? {
            ...optimisticBrowserSession,
            ...next,
            target_url: next.target_url ?? optimisticBrowserSession.target_url,
            action_mode: next.action_mode ?? optimisticBrowserSession.action_mode,
            created_at: optimisticBrowserSession.created_at,
            executed_actions:
              (next.executed_actions?.length ?? 0) > 0
                ? next.executed_actions
                : optimisticBrowserSession.executed_actions,
            skipped_actions:
              (next.skipped_actions?.length ?? 0) > 0
                ? next.skipped_actions
                : optimisticBrowserSession.skipped_actions,
            warnings: [
              ...new Set([
                ...(optimisticBrowserSession.warnings ?? []),
                ...(next.warnings ?? [])
              ])
            ],
            artifacts: mergeArtifacts(
              optimisticBrowserSession.artifacts ?? [],
              next.artifacts ?? []
            )
          }
        : next;

    const nextSessions = { ...sessions };
    if (shouldReplaceOptimisticBrowserSession) {
      delete nextSessions[OPTIMISTIC_BROWSER_SESSION_ID];
    }
    nextSessions[next.session_id] = {
      ...mergedNext,
      stdout: mergedNext.stdout ?? mergedNext.stdout_delta ?? null,
      stderr: mergedNext.stderr ?? mergedNext.stderr_delta ?? null
    };
    return nextSessions;
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
    content: String(payload.content ?? ""),
    related_files: Array.isArray(payload.related_files) ? payload.related_files : []
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
      content: typeof result.content === "string" ? result.content : "",
      related_files: Array.isArray(result.related_files) ? result.related_files : []
    };
  }

function looksLikeBrowserExecutionPrompt(value: string) {
  const lowered = value.toLowerCase();
  const hasAddress = /(https?:\/\/|www\.|\b[a-z0-9-]+\.[a-z]{2,}\b)/i.test(lowered);
  const hasIntent =
    /(?:^|\b)(open|show|visit|go to|navigate|login|log in|sign in|credentials|email:|password|pw:)/i.test(
      lowered
    );
  return hasAddress && hasIntent;
}

function extractBrowserTargetFromPrompt(value: string) {
  const match = value.match(/(https?:\/\/[^\s,;]+|www\.[^\s,;]+|\b[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s,;]*)?)/i);
  if (!match) {
    return null;
  }
  const candidate = match[1];
  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  return `https://${candidate}`;
}

function humanizeLiveObjective(objective: string | null | undefined) {
  const text = (objective ?? "").trim();
  if (!text) {
    return null;
  }
  const lowered = text.toLowerCase();
  if (lowered.startsWith("synthesize prior work into a polished deliverable")) {
    return "Preparing the result for you.";
  }
  if (lowered.startsWith("collect grounded evidence")) {
    return "Gathering the information needed to answer clearly.";
  }
  if (lowered.startsWith("answer the factual question quickly")) {
    return "Searching reliable sources and preparing a short answer.";
  }
  if (lowered.startsWith("turn raw evidence into decisions")) {
    return "Analyzing the best answer and the key tradeoffs.";
  }
  if (lowered.startsWith("design or implement the technical solution")) {
    return "Working through the technical implementation.";
  }
  if (lowered.startsWith("execute browser or ui workflows")) {
    return "Working through the browser task.";
  }
  if (lowered.startsWith("present the work as a clear final deliverable")) {
    return "Turning the result into a clear final answer.";
  }
  return text;
}

function filterMessagesForThread(messages: Message[], threadId: string | null) {
  if (!threadId) {
    return messages;
  }
  return messages.filter((message) => !message.thread_id || message.thread_id === threadId);
}

function filterRunsForThread(runs: ChatRun[], threadId: string | null) {
  if (!threadId) {
    return runs;
  }
  return runs.filter((run) => run.thread_id === threadId);
}

function filterRunStepsForRuns(runSteps: RunStepRecord[], runs: ChatRun[]) {
  const allowedRunIds = new Set(runs.map((run) => run.id).filter(Boolean));
  if (allowedRunIds.size === 0) {
    return [];
  }
  return runSteps.filter((step) => allowedRunIds.has(step.run_id));
}

export function ChatWorkspace({
  data,
  initialWorkbenchTree,
  initialWorkbenchFile,
  taskTemplates = [],
  chatAgents
}: {
  data: ChatWorkspaceData;
  initialWorkbenchTree?: ChatWorkbenchTreeData | null;
  initialWorkbenchFile?: ChatWorkbenchFileData | null;
  taskTemplates?: TaskTemplate[];
  chatAgents?: ChatAgentsData;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialSelectedThreadId = data.selected_thread_id ?? data.threads[0]?.id ?? null;
  const initialScopedMessages = filterMessagesForThread(data.messages, initialSelectedThreadId);
  const initialScopedRuns = filterRunsForThread(data.runs, initialSelectedThreadId);
  const initialScopedRunSteps = filterRunStepsForRuns(data.run_steps ?? [], initialScopedRuns);
  const initialRunStepById = new Map(initialScopedRunSteps.map((step) => [step.id, step]));
  const initialScopedToolCalls = filterToolCallsForRun(
    data.tool_calls ?? [],
    initialRunStepById,
    initialScopedRuns[0]?.id ?? null
  );
  const modelProfileOptions = useMemo(() => buildModelProfileOptions(chatAgents), [chatAgents]);
  const [threads, setThreads] = useState(data.threads);
  const [selectedProject, setSelectedProject] = useState(data.selected_project ?? null);
  const [taskMemory, setTaskMemory] = useState<SharedMemory | null>(data.task_memory ?? null);
  const [projectMemory, setProjectMemory] = useState<SharedMemory | null>(data.project_memory ?? null);
  const [liveApprovalRequests, setLiveApprovalRequests] = useState<ApprovalRequest[]>([]);
  const [messages, setMessages] = useState(initialScopedMessages);
  const [runs, setRuns] = useState(initialScopedRuns);
  const [runSteps, setRunSteps] = useState(initialScopedRunSteps);
  const [toolCalls, setToolCalls] = useState(initialScopedToolCalls);
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
  const [autonomyModeDraft, setAutonomyModeDraft] = useState<AutonomyMode>(() => {
    const selectedThread =
      data.threads.find((thread) => thread.id === data.selected_thread_id) ?? data.threads[0] ?? null;
    const metadata = isRecord(selectedThread?.metadata) ? selectedThread.metadata : {};
    return normalizeAutonomyMode(metadata.autonomy_mode);
  });
  const [executionEnvironmentDraft, setExecutionEnvironmentDraft] = useState<ExecutionEnvironmentRequest | null>(() => {
    const selectedThread =
      data.threads.find((thread) => thread.id === data.selected_thread_id) ?? data.threads[0] ?? null;
    const metadata = isRecord(selectedThread?.metadata) ? selectedThread.metadata : {};
    return normalizeExecutionEnvironment(metadata.execution_environment);
  });
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [currentRunStartedAt, setCurrentRunStartedAt] = useState<string | null>(null);
  const [runClock, setRunClock] = useState(() => Date.now());
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
  const [takeoverNotes, setTakeoverNotes] = useState<Record<string, string>>({});
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [headerNotice, setHeaderNotice] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [threadStatusDraft, setThreadStatusDraft] = useState("active");
  const [taskBriefDraft, setTaskBriefDraft] = useState("");
  const [isDesktopWorkspace, setIsDesktopWorkspace] = useState(false);
  const [workspacePaneWidth, setWorkspacePaneWidth] = useState(DEFAULT_WORKSPACE_SPLIT);
  const [workspacePaneCollapsed, setWorkspacePaneCollapsed] = useState(false);
  const [operatorPaneCollapsed, setOperatorPaneCollapsed] = useState(false);
  const [workbenchExpanded, setWorkbenchExpanded] = useState(false);
  const [workbenchAutoFollow, setWorkbenchAutoFollow] = useState(true);
  const [isResizingWorkspace, setIsResizingWorkspace] = useState(false);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(initialSelectedThreadId);
  const workspaceShellRef = useRef<HTMLElement | null>(null);
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const copiedMessageTimeoutRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognitionLike | null>(null);
  const autoCreateMarker = useRef<string | null>(null);
  const terminalOutputRef = useRef<HTMLDivElement | null>(null);
  const repoRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workspaceRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browserAutofocusSignatureRef = useRef<string | null>(null);
  const pendingThreadUrlSyncRef = useRef<string | null>(null);
  const hydratedWorkspaceSignatureRef = useRef<string | null>(null);
  const pendingRunSyncIdRef = useRef<string | null>(null);
  const pendingRunSyncThreadIdRef = useRef<string | null>(null);
  const liveStreamActiveRef = useRef(false);
  const replayRequestRef = useRef<string | null>(null);
  const syncThreadInUrlRef = useRef<((threadId: string | null) => void) | null>(null);
  const submitRunMessageRef = useRef<((messageInput: string) => Promise<void>) | null>(null);
  const createThreadActionRef = useRef<(() => Promise<void>) | null>(null);
  const fetchWorkbenchDirectoryRef = useRef<((relativePath?: string, options?: { force?: boolean }) => Promise<ChatWorkbenchTreeData | null>) | null>(null);
  const fetchWorkbenchRepoStateRef = useRef<((options?: { force?: boolean }) => Promise<ChatWorkbenchRepoData | null>) | null>(null);
  const openWorkbenchFileRef = useRef<((relativePath: string) => Promise<void>) | null>(null);
  const searchParamKey = searchParams.toString();
  const wantsNewTask = searchParams.get("new") === "1";
  const wantsReplay = searchParams.get("replay") === "1";
  const workspaceId = data.workspace_id;
  const currentProjectId = searchParams.get("project");
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (wantsNewTask) {
      hydratedWorkspaceSignatureRef.current = null;
      return;
    }
    if (liveStreamActiveRef.current) {
      return;
    }
    if (running) {
      return;
    }

    const nextSelectedThread =
      data.threads.find((thread) => thread.id === data.selected_thread_id) ?? data.threads[0] ?? null;
    const nextSelectedThreadMetadata = isRecord(nextSelectedThread?.metadata) ? nextSelectedThread.metadata : {};
    const nextSelectedThreadId = nextSelectedThread?.id ?? null;
    const nextMessages = filterMessagesForThread(data.messages, nextSelectedThreadId);
    const nextRuns = filterRunsForThread(data.runs, nextSelectedThreadId);
    const nextRunSteps = filterRunStepsForRuns(data.run_steps ?? [], nextRuns);
    const nextRunStepById = new Map(nextRunSteps.map((step) => [step.id, step]));
    const nextLatestRunId = nextRuns[0]?.id ?? null;
    const nextToolCalls = data.tool_calls ?? [];
    const nextScopedToolCalls = filterToolCallsForRun(nextToolCalls, nextRunStepById, nextLatestRunId);
    const nextWorkspaceSignature = JSON.stringify({
      selected_thread_id: nextSelectedThreadId,
      thread_ids: data.threads.map((thread) => thread.id),
      message_ids: nextMessages.map((message) => message.id),
      run_keys: nextRuns.map((run) => `${run.id}:${run.status}`),
      run_step_ids: nextRunSteps.map((step) => step.id),
      tool_call_ids: nextScopedToolCalls.map((toolCall) => toolCall.id),
      initial_tree_path: initialWorkbenchTree?.relative_path ?? null,
      initial_file_path: initialWorkbenchFile?.relative_path ?? null
    });
    if (hydratedWorkspaceSignatureRef.current === nextWorkspaceSignature) {
      return;
    }
    hydratedWorkspaceSignatureRef.current = nextWorkspaceSignature;

    const nextPersistedSessions = nextScopedToolCalls
      .flatMap((toolCall) => {
        const sessionsForToolCall: ComputerSession[] = [];
        const browserSession = buildBrowserSessionFromToolCall(toolCall);
        if (browserSession) {
          sessionsForToolCall.push(browserSession);
        }
        const terminalSession = buildTerminalSessionFromToolCall(toolCall);
        if (terminalSession) {
          sessionsForToolCall.push(terminalSession);
        }
        return sessionsForToolCall;
      })
      .sort(sessionSort);
    const nextBrowserSession =
      nextPersistedSessions.find((session) => session.session_kind === "browser") ?? null;
    const nextTerminalSession =
      nextPersistedSessions.find((session) => session.session_kind === "terminal") ?? null;
    const nextPreviewArtifacts = previewableArtifacts(
      dedupeArtifacts([
        ...(nextBrowserSession?.artifacts ?? []),
        ...(nextTerminalSession?.artifacts ?? []),
        ...nextScopedToolCalls.flatMap((toolCall) => extractArtifactsFromToolResult(toolCall.output_payload))
      ])
    );
    const nextPreferredPreview =
      (nextBrowserSession
        ? browserScreenshotArtifact(nextBrowserSession) ?? browserHtmlArtifact(nextBrowserSession)
        : null) ??
      nextPreviewArtifacts[0] ??
      null;

    setThreads(data.threads);
    setSelectedProject(data.selected_project ?? null);
    setTaskMemory(data.task_memory ?? null);
    setProjectMemory(data.project_memory ?? null);
    setLiveApprovalRequests([]);
    setMessages(nextMessages);
    setRuns(nextRuns);
    setRunSteps(nextRunSteps);
    setToolCalls(nextScopedToolCalls);
    setSelectedTaskTemplateKey(
      typeof nextSelectedThreadMetadata.selected_template_key === "string"
        ? nextSelectedThreadMetadata.selected_template_key
        : null
    );
    setAutonomyModeDraft(normalizeAutonomyMode(nextSelectedThreadMetadata.autonomy_mode));
    setExecutionEnvironmentDraft(normalizeExecutionEnvironment(nextSelectedThreadMetadata.execution_environment));
    setTemplateNotice(null);
    setRunning(false);
    setLoadingThread(false);
    setError(null);
    setLivePlan([]);
    setExecutionBatches([]);
    setLiveSteps([]);
    setActiveBatchIndex(null);
    setLiveTimeline([]);
    setLiveSessions({});
    setLiveArtifacts([]);
    setLiveWorkbenchActivities([]);
    setSelectedBrowserSessionId(nextBrowserSession?.session_id ?? null);
    setSelectedTerminalSessionId(nextTerminalSession?.session_id ?? null);
    setSelectedPreviewStorageKey(nextPreferredPreview?.storage_key ?? null);
    setTerminalStreamMode("combined");
    setTerminalFollowOutput(true);
    setComputerNotice(null);
    setComputerError(null);
    browserAutofocusSignatureRef.current = nextBrowserSession
      ? `${nextBrowserSession.session_id}:${nextPreferredPreview?.storage_key ?? "none"}`
      : null;
    setWorkbenchTree(initialWorkbenchTree ? { [initialWorkbenchTree.relative_path]: initialWorkbenchTree } : {});
    setExpandedDirectories({
      [initialWorkbenchTree?.relative_path ?? "."]: true
    });
    setWorkbenchEditors(
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
    setWorkbenchTabPaths(initialWorkbenchFile ? [initialWorkbenchFile.relative_path] : []);
    setSelectedWorkbenchPath(initialWorkbenchFile?.relative_path ?? null);
    setWorkbenchLoadingPath(null);
    setWorkbenchError(null);
    setWorkbenchSavePath(null);
    setWorkbenchNotice(null);
    setWorkbenchViewMode("edit");
    setRepoState(null);
    setRepoLoading(false);
    setRepoDiff(null);
    setRepoDiffLoadingPath(null);
    setTodoSyncError(null);
    setTodoSyncNotice(null);
    setHeaderPanel(null);
    setHeaderActionLoading(null);
    setApprovalActionLoading(null);
    setHeaderError(null);
    setHeaderNotice(null);
    setInviteEmail("");
    setThreadTitleDraft(nextSelectedThread?.title ?? "");
    setThreadStatusDraft(nextSelectedThread?.status ?? "active");
    setTaskBriefDraft(
      typeof nextSelectedThreadMetadata.task_brief === "string" ? nextSelectedThreadMetadata.task_brief : ""
    );
    setCurrentThreadId(nextSelectedThreadId);
    if (nextPreferredPreview) {
      setOperatorTab("preview");
    } else if (nextBrowserSession) {
      setOperatorTab("browser");
    } else if (nextTerminalSession) {
      setOperatorTab("terminal");
    }
  }, [data, initialWorkbenchFile, initialWorkbenchTree, wantsNewTask, running]);

  const displayedPlan = useMemo(() => {
    if (livePlan.length > 0) {
      return livePlan;
    }
    return ((runs[0]?.plan ?? []) as LivePlanStep[]) ?? [];
  }, [livePlan, runs]);

  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
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
  const activeThreadReplayMessage = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((message) => message.role === "user" && (!activeThread?.id || message.thread_id === activeThread.id)) ?? null,
    [activeThread?.id, messages]
  );
  const activeThreadReplayPrompt = activeThreadReplayMessage?.content.trim() || null;
  const activeThreadTitle = activeThread?.title ?? "";
  const activeThreadStatus = activeThread?.status ?? "active";
  const activeTaskBrief = typeof activeThreadMetadata.task_brief === "string" ? activeThreadMetadata.task_brief : "";
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
    typeof activeThreadMetadata.model_profile === "string" &&
    modelProfileOptions.some((option) => option.value === activeThreadMetadata.model_profile)
      ? activeThreadMetadata.model_profile
      : modelProfileOptions.find((option) => option.value === chatAgents?.supervisor_model)?.value ??
        modelProfileOptions.find((option) => option.configured)?.value ??
        modelProfileOptions[0]?.value ??
        "qwen3.5-flash";
  const selectedModelOption =
    modelProfileOptions.find((option) => option.value === selectedModelProfile) ?? null;
  const activeAutonomyMode = normalizeAutonomyMode(activeThreadMetadata.autonomy_mode);
  const activeExecutionEnvironment = useMemo(
    () => normalizeExecutionEnvironment(activeThreadMetadata.execution_environment),
    [activeThreadMetadata.execution_environment]
  );
  const selectedTaskTemplate = useMemo(
    () => taskTemplates.find((template) => template.key === selectedTaskTemplateKey) ?? null,
    [selectedTaskTemplateKey, taskTemplates]
  );
  const premiumTaskTemplates = useMemo(
    () => taskTemplates.filter((template) => PREMIUM_TEMPLATE_KEYS.has(template.key)),
    [taskTemplates]
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
  const latestRun = runs[0] ?? null;
  const latestRunId = latestRun?.id ?? null;
  const runStepById = useMemo(
    () => new Map(runSteps.map((step) => [step.id, step])),
    [runSteps]
  );
  const scopedPersistedToolCalls = useMemo(
    () => filterToolCallsForRun(toolCalls, runStepById, latestRunId),
    [latestRunId, runStepById, toolCalls]
  );

  const persistedSessions = useMemo(() => {
    const sessions: ComputerSession[] = [];
    for (const toolCall of scopedPersistedToolCalls) {
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
  }, [scopedPersistedToolCalls]);

  const persistedTimeline = useMemo(
    () => scopedPersistedToolCalls.map((toolCall) => persistedTimelineEntry(toolCall, runStepById)).sort(timelineSort),
    [runStepById, scopedPersistedToolCalls]
  );

  const persistedArtifacts = useMemo(
    () =>
      dedupeArtifacts(
        scopedPersistedToolCalls.flatMap((toolCall) => extractArtifactsFromToolResult(toolCall.output_payload))
      ),
    [scopedPersistedToolCalls]
  );
  const persistedApprovalRequests = useMemo(
    () =>
      scopedPersistedToolCalls
        .map((toolCall) => approvalRequestFromToolCall(toolCall, runStepById))
        .filter((item): item is ApprovalRequest => Boolean(item)),
    [runStepById, scopedPersistedToolCalls]
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
  const browserTakeoverRequest = useMemo(
    () => pendingApprovalRequests.find((request) => request.kind === "browser_takeover") ?? null,
    [pendingApprovalRequests]
  );

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
    () => {
      const selected =
        browserSessions.find((session) => session.session_id === selectedBrowserSessionId) ?? null;
      if (
        selected &&
        (selected.session_id !== OPTIMISTIC_BROWSER_SESSION_ID ||
          (selected.artifacts?.length ?? 0) > 0 ||
          Boolean(selected.final_url) ||
          Boolean(selected.page_title) ||
          (selected.executed_actions?.length ?? 0) > 0)
      ) {
        return selected;
      }

      const preferredRealSession =
        browserSessions.find(
          (session) =>
            session.session_id !== OPTIMISTIC_BROWSER_SESSION_ID &&
            (
              (session.artifacts?.length ?? 0) > 0 ||
              Boolean(session.final_url) ||
              Boolean(session.page_title) ||
              (session.executed_actions?.length ?? 0) > 0 ||
              session.status !== "running"
            )
        ) ??
        browserSessions.find((session) => session.session_id !== OPTIMISTIC_BROWSER_SESSION_ID) ??
        null;

      return preferredRealSession ?? selected ?? browserSessions[0] ?? null;
    },
    [browserSessions, selectedBrowserSessionId]
  );
  const terminalSession = useMemo(
    () =>
      terminalSessions.find((session) => session.session_id === selectedTerminalSessionId) ??
      terminalSessions[0] ??
      null,
    [selectedTerminalSessionId, terminalSessions]
  );
  const activeLiveStep = useMemo(
    () =>
      liveSteps.find((step) => ["running", "active", "in_progress", "escalating"].includes(step.status)) ??
      liveSteps[liveSteps.length - 1] ??
      null,
    [liveSteps]
  );
  const activeLiveTool = useMemo(
    () =>
      liveTimeline.find(
        (entry) =>
          entry.kind === "tool" &&
          (entry.status === "running" || entry.status === "active" || entry.status === "started")
      ) ?? null,
    [liveTimeline]
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
  const availablePreviewArtifacts = useMemo(
    () => {
      const sessionPreviewArtifacts = previewableArtifacts([
        ...browserArtifacts,
        ...terminalArtifacts
      ]);
      if (sessionPreviewArtifacts.length > 0) {
        return sessionPreviewArtifacts;
      }
      if (previewArtifacts.length > 0) {
        return previewArtifacts;
      }
      return dedupeArtifacts(
        [selectedBrowserScreenshot, selectedBrowserHtml].filter(
          (artifact): artifact is ToolArtifactRef => Boolean(artifact)
        )
      );
    },
    [browserArtifacts, previewArtifacts, selectedBrowserHtml, selectedBrowserScreenshot, terminalArtifacts]
  );
  const selectedPreviewArtifact =
    availablePreviewArtifacts.find((artifact) => artifact.storage_key === selectedPreviewStorageKey) ??
    availablePreviewArtifacts[0] ??
    null;
  const selectedPreviewMode = selectedPreviewArtifact ? artifactPreviewMode(selectedPreviewArtifact) : "none";
  const showComputerOverview = operatorTab === "computer";
  const isWorkbenchFocusLayout = workbenchExpanded && isDesktopWorkspace;
  const showOverviewCompanionModes = false;
  const showBrowserMode = showOverviewCompanionModes || operatorTab === "browser";
  const showTerminalMode = showOverviewCompanionModes || operatorTab === "terminal";
  const showFilesMode = showOverviewCompanionModes || operatorTab === "files";
  const showPreviewMode = showOverviewCompanionModes || operatorTab === "preview";
  const useMinimalWorkbenchOverview = true;
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
  const deliverableCount =
    availablePreviewArtifacts.length > 0 ? availablePreviewArtifacts.length : mergedArtifacts.length;
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
  const autonomySuggestedTab: OperatorTab = pendingApprovalRequests.length > 0
    ? "browser"
    : selectedPreviewArtifact
      ? "preview"
      : browserSession
        ? "browser"
        : terminalSession
          ? "terminal"
          : liveWorkbenchActivities.length > 0
            ? "code"
            : workflowRecommendedTab;
  const autonomyStateLabel = pendingApprovalRequests.length > 0
    ? "Needs your review"
    : running
      ? "Autonomy running"
      : browserSession || terminalSession || selectedPreviewArtifact
        ? "Recent execution ready"
        : "Standing by";
  const autonomySummary = pendingApprovalRequests.length > 0
    ? "The agent paused for a sensitive step. Review the handoff here, then approve to continue."
    : browserSession
      ? "The browser agent is navigating live pages and keeping the latest screen ready here."
      : terminalSession
        ? "The coding agent is running the sandbox and streaming output directly into the workbench."
        : selectedPreviewArtifact
          ? "The latest generated app or deliverable is ready to inspect in preview."
          : liveWorkbenchActivities.length > 0
            ? "The coding agent is opening files and leaving its current code path in sync here."
            : "Chat sets the objective. The workbench follows the browser, code, files, and previews as the run evolves.";
  const autonomyMeta = [
    workbenchAutoFollow ? "Auto-follow on" : "Auto-follow paused",
    running ? "Live run" : null,
    browserSession ? `${browserSessions.length} browser` : null,
    terminalSession ? `${terminalSessions.length} terminal` : null,
      selectedPreviewArtifact ? `${availablePreviewArtifacts.length} preview` : null,
    liveWorkbenchActivities.length > 0 ? `${liveWorkbenchActivities.length} file updates` : null
  ].filter((value): value is string => Boolean(value));
  const activeWorkbenchTabLabel =
    OPERATOR_TAB_OPTIONS.find((tab) => tab.key === operatorTab)?.label ?? "Overview";
  const workbenchFocusHeaderMeta = [
    activeWorkbenchTabLabel,
    autonomyStateLabel,
    browserSessions.length > 0 ? `${browserSessions.length} browser` : null,
    terminalSessions.length > 0 ? `${terminalSessions.length} terminal` : null,
      availablePreviewArtifacts.length > 0 ? `${availablePreviewArtifacts.length} preview` : null
  ].filter((value): value is string => Boolean(value));
  const workbenchPrimaryViewportHeight = isWorkbenchFocusLayout ? "calc(100dvh - 8.75rem)" : "min(32dvh, 300px)";
  const workbenchSecondaryViewportHeight = isWorkbenchFocusLayout ? "calc(100dvh - 11.5rem)" : "min(16dvh, 168px)";
  const liveRunElapsedLabel = formatElapsedLabel(currentRunStartedAt, runClock);
  const activeCommandSession = terminalSessions.find((session) => session.status === "running") ?? null;
  const activeCommandElapsedLabel = formatElapsedLabel(activeCommandSession?.created_at ?? null, runClock);
  const liveRunObjective = running
    ? compactText(
        humanizeLiveObjective(activeLiveStep?.objective) ||
          activeChecklistItem?.summary ||
          activeChecklistItem?.title ||
          activeLiveTool?.summary ||
          activeLiveTool?.title ||
          latestRun?.user_message ||
          activeThread?.last_message_preview ||
          "Reviewing your request and choosing the best execution path.",
        220
      )
    : null;
  const liveRunStatusText = activeCommandSession
    ? `Running command${activeCommandElapsedLabel ? ` for ${activeCommandElapsedLabel}` : ""}`
    : "Thinking";
  const workbenchFocusPrimaryLabel =
    autonomySuggestedTab === "browser"
      ? "Live browser"
      : autonomySuggestedTab === "terminal"
        ? "Live terminal"
        : autonomySuggestedTab === "preview"
          ? "Generated preview"
          : autonomySuggestedTab === "code"
            ? "Code workspace"
            : autonomySuggestedTab === "files"
              ? "Workspace files"
              : "Operator surface";
  const workbenchFocusPrimaryCaption =
    autonomySuggestedTab === "browser"
      ? browserSession?.final_url || browserSession?.target_url || "Watching the latest browser step."
      : autonomySuggestedTab === "terminal"
        ? (terminalSession?.command ?? []).join(" ") || "Following the coding sandbox output."
        : autonomySuggestedTab === "preview"
          ? selectedPreviewArtifact
            ? artifactLabel(selectedPreviewArtifact)
            : "Waiting for a previewable output."
          : autonomySuggestedTab === "code"
            ? selectedWorkbenchFile?.relative_path || "Following the coding agent's current file focus."
            : rootWorkbenchTree?.relative_path || "Tracking workspace files and recent file activity.";
  const workbenchFocusPrimaryStats = [
    browserSession ? `${browserSessions.length} browser session${browserSessions.length === 1 ? "" : "s"}` : null,
    terminalSession ? `${terminalSessions.length} terminal session${terminalSessions.length === 1 ? "" : "s"}` : null,
    liveWorkbenchActivities.length > 0 ? `${liveWorkbenchActivities.length} tracked file update${liveWorkbenchActivities.length === 1 ? "" : "s"}` : null,
    selectedPreviewArtifact
      ? `${availablePreviewArtifacts.length} preview artifact${availablePreviewArtifacts.length === 1 ? "" : "s"}`
      : null
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

  function activateOperatorTab(nextTab: OperatorTab, options?: { manual?: boolean }) {
    const manual = options?.manual ?? true;
    if (manual) {
      setWorkbenchAutoFollow(false);
    }
    setOperatorTab(nextTab);
  }

  function resumeWorkbenchAutonomy(preferredTab?: OperatorTab) {
    setWorkbenchAutoFollow(true);
    setOperatorTab(preferredTab ?? autonomySuggestedTab);
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
    params.delete("replay");
    if (threadId) {
      params.set("thread", threadId);
    } else {
      params.delete("thread");
    }
    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", href);
      return;
    }
    router.replace(href, { scroll: false });
  }

  function stopWorkspaceRefreshLoop() {
    if (workspaceRefreshIntervalRef.current) {
      clearInterval(workspaceRefreshIntervalRef.current);
      workspaceRefreshIntervalRef.current = null;
    }
    if (workspaceRefreshTimeoutRef.current) {
      clearTimeout(workspaceRefreshTimeoutRef.current);
      workspaceRefreshTimeoutRef.current = null;
    }
  }

  function startWorkspaceRefreshLoop(
    threadId?: string | null,
    options?: { immediate?: boolean; timeoutMs?: number }
  ) {
    stopWorkspaceRefreshLoop();
    if (options?.immediate) {
      void refreshWorkspace(threadId ?? null, { preserveLiveRuntime: true });
    }
    workspaceRefreshIntervalRef.current = setInterval(() => {
      void refreshWorkspace(threadId ?? null, { preserveLiveRuntime: true });
    }, 1800);
    workspaceRefreshTimeoutRef.current = setTimeout(() => {
      stopWorkspaceRefreshLoop();
      void refreshWorkspace(threadId ?? null, { preserveLiveRuntime: true });
    }, options?.timeoutMs ?? 60000);
  }

  useEffect(() => () => stopWorkspaceRefreshLoop(), []);

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

  async function refreshWorkspace(
    threadId?: string | null,
    options?: { preserveLiveRuntime?: boolean }
  ) {
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
      const nextToolCalls = payload.tool_calls ?? [];
      const selectedThreadId = payload.selected_thread_id ?? threadId ?? null;
      const nextMessages = filterMessagesForThread(payload.messages ?? [], selectedThreadId);
      const nextRuns = filterRunsForThread(payload.runs ?? [], selectedThreadId);
      const latestThreadRun = nextRuns[0] ?? null;
      const nextRunSteps = filterRunStepsForRuns(payload.run_steps ?? [], nextRuns);
      const nextRunStepById = new Map(nextRunSteps.map((step) => [step.id, step]));
      const nextScopedToolCalls = filterToolCallsForRun(nextToolCalls, nextRunStepById, latestThreadRun?.id ?? null);
      const nextPersistedSessions = nextScopedToolCalls
        .flatMap((toolCall) => {
          const sessionsForToolCall: ComputerSession[] = [];
          const browserSession = buildBrowserSessionFromToolCall(toolCall);
          if (browserSession) {
            sessionsForToolCall.push(browserSession);
          }
          const terminalSession = buildTerminalSessionFromToolCall(toolCall);
          if (terminalSession) {
            sessionsForToolCall.push(terminalSession);
          }
          return sessionsForToolCall;
        })
        .sort(sessionSort);
      const nextBrowserSession =
        nextPersistedSessions.find((session) => session.session_kind === "browser") ?? null;
      const nextTerminalSession =
        nextPersistedSessions.find((session) => session.session_kind === "terminal") ?? null;
      const nextArtifacts = dedupeArtifacts([
        ...(nextBrowserSession?.artifacts ?? []),
        ...(nextTerminalSession?.artifacts ?? []),
        ...nextScopedToolCalls.flatMap((toolCall) => extractArtifactsFromToolResult(toolCall.output_payload))
      ]);
      const nextPreviewArtifacts = previewableArtifacts(nextArtifacts);
      const nextPreferredPreview =
        (nextBrowserSession
          ? browserScreenshotArtifact(nextBrowserSession) ?? browserHtmlArtifact(nextBrowserSession)
          : null) ??
        nextPreviewArtifacts[0] ??
        null;
      const preserveLiveRuntime = options?.preserveLiveRuntime === true;
      const hasAssistantReply =
        nextMessages.some(
          (message) => message.role === "assistant" && (!selectedThreadId || message.thread_id === selectedThreadId)
        ) ?? false;
      const pendingRunId = pendingRunSyncIdRef.current;
      const pendingThreadId = pendingRunSyncThreadIdRef.current;
      const matchingPendingThread =
        !pendingThreadId || !selectedThreadId || pendingThreadId === selectedThreadId;
      const pendingRunVisible =
        Boolean(
          pendingRunId &&
            matchingPendingThread &&
            latestThreadRun?.id === pendingRunId
        );
      const pendingRunReady =
        pendingRunVisible &&
        (hasAssistantReply ||
          nextScopedToolCalls.length > 0 ||
          nextPersistedSessions.length > 0 ||
          isTerminalRunStatus(latestThreadRun?.status ?? ""));
      setThreads(payload.threads ?? []);
      setSelectedProject(payload.selected_project ?? null);
      setTaskMemory(payload.task_memory ?? null);
      setProjectMemory(payload.project_memory ?? null);
      setMessages(nextMessages);
      setRuns(nextRuns);
      setRunSteps(nextRunSteps);
      setToolCalls(nextToolCalls);
      setLiveSessions((current) => {
        if (preserveLiveRuntime && nextPersistedSessions.length === 0 && Object.keys(current).length > 0) {
          return current;
        }
        return nextPersistedSessions.reduce<Record<string, ComputerSession>>((accumulator, session) => {
          accumulator[session.session_id] = session;
          return accumulator;
        }, {});
      });
      setLiveArtifacts((current) =>
        preserveLiveRuntime && nextArtifacts.length === 0 && current.length > 0 ? current : nextArtifacts
      );
      setSelectedBrowserSessionId((current) => nextBrowserSession?.session_id ?? (preserveLiveRuntime ? current : null));
      setSelectedTerminalSessionId((current) =>
        nextTerminalSession?.session_id ?? (preserveLiveRuntime ? current : null)
      );
      setSelectedPreviewStorageKey((current) =>
        nextPreferredPreview?.storage_key ?? (preserveLiveRuntime ? current : null)
      );
      if (nextBrowserSession || nextPreferredPreview) {
        browserAutofocusSignatureRef.current = nextBrowserSession
          ? `${nextBrowserSession.session_id}:${nextPreferredPreview?.storage_key ?? "none"}`
          : null;
      }
      setOperatorTab((current) => {
        if (nextPreferredPreview) {
          return "preview";
        }
        if (nextBrowserSession) {
          return "browser";
        }
        if (nextTerminalSession) {
          return "terminal";
        }
        return current;
      });
      setCurrentThreadId(selectedThreadId);
      if (preserveLiveRuntime && running) {
        pendingThreadUrlSyncRef.current = selectedThreadId;
      } else {
        syncThreadInUrl(selectedThreadId);
      }
      if (preserveLiveRuntime) {
        if (pendingRunReady || (!pendingRunId && latestThreadRun && isTerminalRunStatus(latestThreadRun.status))) {
          setRunning(false);
          setCurrentRunStartedAt(null);
          stopWorkspaceRefreshLoop();
          pendingRunSyncIdRef.current = null;
          pendingRunSyncThreadIdRef.current = null;
          if (pendingThreadUrlSyncRef.current) {
            syncThreadInUrl(pendingThreadUrlSyncRef.current);
            pendingThreadUrlSyncRef.current = null;
          }
        } else if (
          latestThreadRun ||
          nextPersistedSessions.length > 0 ||
          nextScopedToolCalls.length > 0 ||
          hasAssistantReply ||
          Boolean(pendingRunId)
        ) {
          setRunning(true);
        }
      }
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
        content: String(payload.file.content ?? ""),
        related_files: Array.isArray(payload.file.related_files) ? payload.file.related_files : []
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

  function startBrowserTakeover(request: ApprovalRequest) {
    activateOperatorTab("browser");
    if (request.targetLabel) {
      window.open(request.targetLabel, "_blank", "noopener,noreferrer");
    }
    setHeaderError(null);
    setHeaderNotice(
      "Take over the blocked browser step in the opened page, then tell the agent what you did so it can continue."
    );
  }

  async function resumeBrowserTakeover(request: ApprovalRequest) {
    if (!activeThread?.id) {
      return;
    }
    if (isTaskPaused) {
      setError("This task is paused. Resume it before handing control back to the agent.");
      return;
    }
    const note = (takeoverNotes[request.id] ?? "").trim();
    if (!note) {
      setHeaderError("Add a short note describing what you did before handing control back.");
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
      setTakeoverNotes((current) => {
        const next = { ...current };
        delete next[request.id];
        return next;
      });
      setHeaderNotice("Thanks. The agent is continuing from your browser handoff.");
      await submitRunMessage(
        `Manual browser takeover completed for ${request.targetLabel ?? "the blocked page"}. The human operator reports: ${note}. Continue the task from this updated context and proceed with the next steps.`
      );
    } catch (approvalError) {
      setHeaderError(
        approvalError instanceof Error ? approvalError.message : "Browser handoff resume failed."
      );
    } finally {
      setApprovalActionLoading(null);
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
      if (request.kind === "browser_takeover") {
        setTakeoverNotes((current) => {
          const next = { ...current };
          delete next[request.id];
          return next;
        });
      }
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
        modelProfileOptions.find((option) => option.value === nextProfile)?.label ?? nextProfile;
      setHeaderNotice(
        nextProfile === "qwen3.5-flash"
          ? "Auto swarm orchestration enabled for this task."
          : `Task model updated to ${profileLabel}. The next run will use it.`
      );
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
          selected_template_key: selectedTaskTemplateKey,
          autonomy_mode: autonomyModeDraft,
          execution_environment: cleanExecutionEnvironment(executionEnvironmentDraft),
          task_brief: taskBriefDraft.trim() || null,
          task_brief_updated_at: new Date().toISOString(),
          share_enabled: shareEnabled
        }
      });
      setHeaderNotice(taskBriefDraft.trim() ? "Task settings and task brief saved." : "Task settings saved.");
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
        workbenchAutoFollow?: boolean;
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
      const nextWorkbenchAutoFollow =
        typeof parsed.workbenchAutoFollow === "boolean" ? parsed.workbenchAutoFollow : true;
      setWorkspacePaneCollapsed(nextWorkbenchExpanded ? false : nextWorkspaceCollapsed);
      setOperatorPaneCollapsed(nextWorkbenchExpanded ? false : nextOperatorCollapsed);
      setWorkbenchExpanded(nextWorkbenchExpanded);
      setWorkbenchAutoFollow(nextWorkbenchAutoFollow);
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
        workbenchExpanded,
        workbenchAutoFollow
      })
    );
  }, [operatorPaneCollapsed, workbenchAutoFollow, workbenchExpanded, workspacePaneCollapsed, workspacePaneWidth]);

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
    if (!availablePreviewArtifacts.length) {
      setSelectedPreviewStorageKey(null);
      return;
    }
    setSelectedPreviewStorageKey((current) =>
      current && availablePreviewArtifacts.some((artifact) => artifact.storage_key === current)
        ? current
        : availablePreviewArtifacts[0].storage_key
    );
  }, [availablePreviewArtifacts]);

  useEffect(() => {
    if (!browserSession) {
      return;
    }

    const preferredBrowserPreview =
      browserScreenshotArtifact(browserSession) ?? browserHtmlArtifact(browserSession);
    const signature = `${browserSession.session_id}:${preferredBrowserPreview?.storage_key ?? "none"}`;

    if (browserAutofocusSignatureRef.current === signature) {
      return;
    }

    browserAutofocusSignatureRef.current = signature;

    if (preferredBrowserPreview) {
      setSelectedPreviewStorageKey((current) =>
        current && availablePreviewArtifacts.some((artifact) => artifact.storage_key === current)
          ? current
          : preferredBrowserPreview.storage_key
      );
      setOperatorTab("preview");
      return;
    }

    if (workbenchAutoFollow || operatorTab === "code" || operatorTab === "computer") {
      setOperatorTab("browser");
    }
  }, [availablePreviewArtifacts, browserSession, operatorTab, workbenchAutoFollow]);

  useEffect(() => {
    if (operatorTab !== "preview" || selectedPreviewArtifact || !browserSession) {
      return;
    }
    setOperatorTab("browser");
  }, [browserSession, operatorTab, selectedPreviewArtifact]);

  useEffect(() => {
    if (!workbenchAutoFollow) {
      return;
    }
    if (pendingApprovalRequests.length > 0) {
      setOperatorTab(browserSession ? "browser" : "computer");
      return;
    }
    if (selectedPreviewArtifact) {
      setOperatorTab("preview");
      return;
    }
    if (browserSession) {
      setOperatorTab("browser");
      return;
    }
    if (terminalSession) {
      setOperatorTab("terminal");
      return;
    }
    if (liveWorkbenchActivities.length > 0) {
      setOperatorTab("code");
      return;
    }
    if (running || runningComputerSessionCount > 0) {
      setOperatorTab("computer");
    }
  }, [
    browserSession,
    liveWorkbenchActivities.length,
    pendingApprovalRequests.length,
    running,
    runningComputerSessionCount,
    selectedPreviewArtifact,
    terminalSession,
    workbenchAutoFollow
  ]);

  useEffect(() => {
    if (!terminalFollowOutput || !terminalOutputRef.current) {
      return;
    }
    terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
  }, [terminalFollowOutput, terminalOutput, terminalSession?.status]);

  useEffect(() => {
    if (!running && activeCommandSession?.status !== "running") {
      return;
    }

    setRunClock(Date.now());
    const intervalId = window.setInterval(() => setRunClock(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [activeCommandSession?.status, running]);

  useEffect(() => {
    if (!running && currentRunStartedAt) {
      setCurrentRunStartedAt(null);
    }
  }, [currentRunStartedAt, running]);

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
    browserAutofocusSignatureRef.current = null;
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
    setTaskBriefDraft(activeTaskBrief);
    setInviteEmail("");
    setSelectedTaskTemplateKey(activeThreadSelectedTemplateKey);
    setAutonomyModeDraft(activeAutonomyMode);
    setExecutionEnvironmentDraft(activeExecutionEnvironment);
    setTemplateNotice(null);
    setHeaderError(null);
    setHeaderNotice(null);
    setHeaderPanel(null);
  }, [
    activeAutonomyMode,
    activeExecutionEnvironment,
    activeTaskBrief,
    activeThread?.id,
    activeThreadSelectedTemplateKey,
    activeThreadStatus,
    activeThreadTitle
  ]);

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

  function updateExecutionEnvironmentField<K extends keyof ExecutionEnvironmentRequest>(
    key: K,
    value: ExecutionEnvironmentRequest[K] | undefined
  ) {
    setExecutionEnvironmentDraft((current) => {
      const next: Record<string, unknown> = { ...(current ?? {}) };
      const isEmptyString = typeof value === "string" && value.trim().length === 0;
      if (value === undefined || value === null || isEmptyString) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return cleanExecutionEnvironment(next as ExecutionEnvironmentRequest);
    });
  }

  async function persistTaskControls(
    nextTemplateKey: string | null,
    nextAutonomyMode: AutonomyMode,
    nextEnvironment: ExecutionEnvironmentRequest | null,
    successMessage: string
  ) {
    if (!activeThread?.id) {
      setTemplateNotice(successMessage);
      return;
    }

    setHeaderActionLoading("controls");
    setHeaderError(null);
    setHeaderNotice(null);
    try {
      await updateActiveThread({
        metadata_updates: {
          ...activeThreadMetadata,
          selected_template_key: nextTemplateKey,
          autonomy_mode: nextAutonomyMode,
          execution_environment: cleanExecutionEnvironment(nextEnvironment)
        }
      });
      setHeaderNotice(successMessage);
    } catch (controlError) {
      setHeaderError(
        controlError instanceof Error ? controlError.message : "Task controls could not be saved."
      );
    } finally {
      setHeaderActionLoading(null);
    }
  }

  async function saveExecutionEnvironmentControls() {
    await persistTaskControls(
      selectedTaskTemplateKey,
      autonomyModeDraft,
      executionEnvironmentDraft,
      "Execution environment saved for this task."
    );
  }

  async function saveAutonomyModeControls() {
    await persistTaskControls(
      selectedTaskTemplateKey,
      autonomyModeDraft,
      executionEnvironmentDraft,
      "Autonomy mode saved for this task."
    );
  }

  async function applyTaskTemplate(template: TaskTemplate) {
    const nextEnvironment =
      cleanExecutionEnvironment(PREMIUM_TEMPLATE_ENVIRONMENT_PRESETS[template.key]) ??
      executionEnvironmentDraft;
    setSelectedTaskTemplateKey(template.key);
    setExecutionEnvironmentDraft(nextEnvironment);
    setDraft(template.chat_defaults.prompt);
    setTemplateNotice(
      `${template.name} loaded. We prefilled the task brief, set the recommended operator focus, and prepared its execution profile.`
    );
    setOperatorTab(template.recommended_operator_tab);
    setError(null);
    await persistTaskControls(
      template.key,
      autonomyModeDraft,
      nextEnvironment,
      `${template.name} is now the active premium mode for this task.`
    );
  }

  async function clearTaskTemplate() {
    setSelectedTaskTemplateKey(null);
    setTemplateNotice(null);
    await persistTaskControls(
      null,
      autonomyModeDraft,
      executionEnvironmentDraft,
      "Premium mode cleared for this task."
    );
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
    let fallbackRefreshThreadId: string | null = currentThreadId ?? null;
    let sawRunPersistedEvent = false;
    let sawDoneEvent = false;
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
    const browserIntent = looksLikeBrowserExecutionPrompt(finalMessage);
    const optimisticBrowserTarget = browserIntent ? extractBrowserTargetFromPrompt(finalMessage) : null;

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
    pendingThreadUrlSyncRef.current = null;
    stopWorkspaceRefreshLoop();
    liveStreamActiveRef.current = true;
    browserAutofocusSignatureRef.current = null;
    setRunning(true);
    setCurrentRunStartedAt(new Date().toISOString());
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
    setWorkbenchAutoFollow(true);
    if (browserIntent) {
      const optimisticSessionId = OPTIMISTIC_BROWSER_SESSION_ID;
      setOperatorTab("browser");
      setSelectedPreviewStorageKey(null);
      setSelectedBrowserSessionId(optimisticSessionId);
      setLiveSessions({
        [optimisticSessionId]: {
          session_id: optimisticSessionId,
          session_kind: "browser",
          tool: "browser_automation",
          status: "running",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          target_url: optimisticBrowserTarget,
          final_url: null,
          page_title: null,
          action_mode: /login|log in|sign in|credentials|email:|password|pw:/i.test(finalMessage)
            ? "interactive"
            : "observe",
          executed_actions: [],
          skipped_actions: [],
          headings: [],
          links: [],
          extracted_text: null,
          warnings: [],
          artifacts: [],
          phase: "starting",
          command: [],
          stdout: null,
          stderr: null,
          stdout_delta: null,
          stderr_delta: null,
          returncode: null,
          timed_out: false
        }
      });
      setLiveSteps([
        {
          step_index: 0,
          batch_index: 0,
          agent_key: "vision_automation",
          agent_name: "Vision / Automation Agent",
          status: "running",
          objective: compactText(finalMessage, 220),
          dependencies: [],
          execution_mode: "direct_browser_fast_path"
        }
      ]);
      setLiveTimeline([
        {
          id: `optimistic-browser-${Date.now()}`,
          created_at: new Date().toISOString(),
          kind: "tool",
          title: "Vision / Automation Agent started Browser automation",
          status: "running",
          tool: "browser_automation",
          summary: optimisticBrowserTarget
            ? `Opening ${optimisticBrowserTarget} and continuing the requested browser workflow.`
            : "Opening the requested site and continuing the requested browser workflow."
        }
      ]);
    } else {
      setOperatorTab(selectedTaskTemplate?.recommended_operator_tab ?? "computer");
    }

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
      model_profile: selectedModelProfile,
      template_key: selectedTaskTemplateKey,
      autonomy_mode: autonomyModeDraft,
      execution_environment: cleanExecutionEnvironment(executionEnvironmentDraft),
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
        liveStreamActiveRef.current = false;
        setError(failure.detail ?? "Streaming failed.");
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
        setRunning(false);
        setCurrentRunStartedAt(null);
        return;
      }

      const receivedEventCount = await consumeEventStream(response, (streamEvent) => {
        try {
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
              if (session.session_kind === "browser") {
                setSelectedBrowserSessionId((current) =>
                  !current || current === OPTIMISTIC_BROWSER_SESSION_ID ? session.session_id : current
                );
                setOperatorTab((current) => {
                  if (current === "browser") {
                    return current;
                  }
                  if (workbenchAutoFollow || current === "code" || current === "computer") {
                    return "browser";
                  }
                  return current;
                });
                const sessionPreviewArtifacts = previewableArtifacts(session.artifacts ?? []);
                if (sessionPreviewArtifacts.length > 0) {
                  const preferredSessionPreview =
                    browserScreenshotArtifact(session) ??
                    browserHtmlArtifact(session) ??
                    sessionPreviewArtifacts[0];
                  if (preferredSessionPreview) {
                    setSelectedPreviewStorageKey(preferredSessionPreview.storage_key);
                    setOperatorTab((current) =>
                      workbenchAutoFollow || current === "browser" || current === "code" || current === "computer"
                        ? "preview"
                        : current
                    );
                  }
                }
              }
              if ((session.artifacts?.length ?? 0) > 0) {
                setLiveArtifacts((current) => mergeArtifacts(current, session.artifacts ?? []));
              }
            }
          }

          if (event === "thread") {
            const threadId = String(data.thread_id ?? resolvedThreadId ?? "pending-thread");
            resolvedThreadId = threadId;
            fallbackRefreshThreadId = threadId;
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
            pendingThreadUrlSyncRef.current = threadId;
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
            pendingRunSyncIdRef.current = resolvedRunId;
            pendingRunSyncThreadIdRef.current = String(data.thread_id ?? resolvedThreadId ?? currentThreadId ?? "");
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
            sawRunPersistedEvent = true;
            fallbackRefreshThreadId = resolvedThreadId ?? fallbackRefreshThreadId;
            return;
          }

          if (event === "error") {
            liveStreamActiveRef.current = false;
            setError(String(data.message ?? "Streaming failed."));
            pendingRunSyncIdRef.current = null;
            pendingRunSyncThreadIdRef.current = null;
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
            sawDoneEvent = true;
            liveStreamActiveRef.current = false;
            setActiveBatchIndex(null);
            const nextThreadId = resolvedThreadId ?? fallbackRefreshThreadId ?? null;
            if (nextThreadId) {
              startWorkspaceRefreshLoop(nextThreadId, {
                immediate: true,
                timeoutMs: 20000
              });
            } else {
              setRunning(false);
              setCurrentRunStartedAt(null);
            }
          }
        } catch (streamHandlingError) {
          console.error("Live run event handling failed.", streamEvent, streamHandlingError);
          setComputerError("Live browser state hit a sync issue. Recovering from persisted run data.");
        }
      });
      if (receivedEventCount === 0) {
        throw new Error("Live run emitted no events.");
      }
      liveStreamActiveRef.current = false;
      if (!sawDoneEvent || !sawRunPersistedEvent) {
        fallbackRefreshThreadId =
          resolvedThreadId ?? pendingThreadUrlSyncRef.current ?? currentThreadId ?? fallbackRefreshThreadId ?? null;
        setActiveBatchIndex(null);
        setRunning(true);
        startWorkspaceRefreshLoop(fallbackRefreshThreadId, {
          immediate: true,
          timeoutMs: 90000
        });
      }
      setComposerAttachments([]);
      setSelectedComposerShortcutKeys([]);
      setVoiceInterimTranscript("");
      setVoiceCapturedInDraft(false);
    } catch {
      liveStreamActiveRef.current = false;
      fallbackRefreshThreadId =
        resolvedThreadId ?? pendingThreadUrlSyncRef.current ?? currentThreadId ?? fallbackRefreshThreadId ?? null;
      setError("Live updates are delayed. The task is still syncing.");
      setActiveBatchIndex(null);
      setRunning(true);
      startWorkspaceRefreshLoop(fallbackRefreshThreadId, {
        immediate: true,
        timeoutMs: 90000
      });
    }
  }

  syncThreadInUrlRef.current = syncThreadInUrl;
  submitRunMessageRef.current = submitRunMessage;

  useEffect(() => {
    if (!wantsReplay || !currentThreadId || !activeThreadReplayPrompt || running || loadingThread || isTaskPaused) {
      if (!wantsReplay) {
        replayRequestRef.current = null;
      }
      return;
    }
    const replayKey = `${currentThreadId}:${activeThreadReplayMessage?.id ?? activeThreadReplayPrompt}`;
    if (replayRequestRef.current === replayKey) {
      return;
    }
    replayRequestRef.current = replayKey;
    syncThreadInUrlRef.current?.(currentThreadId);
    void submitRunMessageRef.current?.(activeThreadReplayPrompt);
  }, [
    activeThreadReplayMessage?.id,
    activeThreadReplayPrompt,
    currentThreadId,
    isTaskPaused,
    loadingThread,
    running,
    wantsReplay
  ]);

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
                    onClick={() => activateOperatorTab(stage.tab)}
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
        <div className="relative border-b border-black/10 pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="surface-label">Chat</p>
                {running ? (
                  <span className="text-[11px] uppercase tracking-[0.16em] text-black/[0.46]">
                    Working for {liveRunElapsedLabel ?? "0s"}
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
                <div className="flex min-w-[320px] flex-col gap-0.5">
                  <select
                    value={selectedModelProfile}
                    onChange={(event) => void handleModelProfileChange(event.target.value)}
                    disabled={!activeThread || headerActionLoading === "model"}
                    className="appearance-none bg-transparent pr-6 text-[13px] outline-none disabled:opacity-60"
                  >
                    {modelProfileOptions.map((option) => (
                      <option key={option.value} value={option.value} disabled={!option.configured}>
                        {option.menuLabel}
                      </option>
                    ))}
                  </select>
                  <span className="pr-6 text-[10px] uppercase tracking-[0.12em] text-black/[0.42]">
                    {selectedModelOption?.description ?? "General"}
                  </span>
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
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[13px] disabled:opacity-60",
                  browserTakeoverRequest
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-black/10 bg-white text-black/[0.72]"
                )}
              >
                <Settings2 className="h-3.5 w-3.5" />
                Controls
              </button>
              {activeThreadReplayPrompt && (
                <button
                  type="button"
                  onClick={() => void submitRunMessage(activeThreadReplayPrompt)}
                  disabled={!activeThread || running || isTaskPaused}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-[13px] text-black/[0.72] disabled:opacity-60"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Replay
                </button>
              )}
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
            <div className="absolute inset-x-0 top-full z-30 mt-3 flex justify-end">
              <div className="w-full max-w-[860px] overflow-hidden rounded-[24px] border border-black/10 bg-white/96 shadow-[0_26px_70px_rgba(15,23,42,0.14)] backdrop-blur">
                <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-black/[0.46]">
                      {headerPanel === "share" ? "Share controls" : headerPanel === "settings" ? "Task controls" : "Task panel"}
                    </p>
                    <p className="mt-1 text-sm text-black/[0.62]">
                      Open this only when you need controls. The chat column stays dedicated to the conversation.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHeaderPanel(null)}
                    className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-black/[0.6] transition hover:bg-sand/45"
                  >
                    Close
                  </button>
                </div>
                <div className="max-h-[min(72vh,760px)] overflow-y-auto px-3.5 py-3.5">
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
                  <p className="text-sm font-medium text-black/[0.82]">Task controls</p>
                  <p className="mt-1 text-sm leading-7 text-black/[0.62]">
                    Keep chat centered in the middle column, and handle task settings, autonomy, takeover, premium swarm modes, and execution controls here instead.
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
                <label className="space-y-2 text-sm text-black/[0.72]">
                  <span className="block text-xs uppercase tracking-[0.16em] text-black/[0.45]">Task brief</span>
                  <textarea
                    value={taskBriefDraft}
                    onChange={(event) => setTaskBriefDraft(event.target.value)}
                    rows={5}
                    placeholder="Set the persistent goal, constraints, or preferred direction for this task. Future runs on this thread will use it as their standing brief."
                    className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 outline-none resize-y"
                  />
                  <p className="text-xs leading-6 text-black/[0.5]">
                    This is the task’s standing objective. New instructions will be executed in the context of this brief until you change it.
                  </p>
                </label>
                <div className="space-y-3 rounded-[20px] border border-black/10 bg-sand/25 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-black/[0.82]">Autonomy mode</p>
                      <p className="mt-1 text-sm leading-7 text-black/[0.62]">
                        Decide how aggressively Intmatrix should keep moving before it stops to hand back a blocker.
                      </p>
                    </div>
                    <span className="rounded-full bg-black/[0.04] px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-black/[0.5]">
                      {autonomyModeSummary(autonomyModeDraft)}
                    </span>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-3">
                    {AUTONOMY_MODE_OPTIONS.map((option) => {
                      const isSelected = autonomyModeDraft === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setAutonomyModeDraft(option.value)}
                          className={cn(
                            "rounded-[18px] border px-4 py-4 text-left transition",
                            isSelected
                              ? "border-transparent bg-ink text-white shadow-[0_16px_36px_rgba(15,58,50,0.12)]"
                              : "border-black/10 bg-white text-black/[0.76] hover:bg-sand/35"
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium">{option.label}</span>
                            {isSelected && <ShieldCheck className="h-4 w-4" />}
                          </div>
                          <p className={cn("mt-2 text-sm leading-6", isSelected ? "text-white/82" : "text-black/[0.62]")}>
                            {option.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void saveAutonomyModeControls()}
                      disabled={!activeThread || headerActionLoading === "controls"}
                      className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      {headerActionLoading === "controls" ? "Saving..." : "Save autonomy"}
                    </button>
                    <span className="text-sm text-black/[0.56]">
                      {autonomyModeDraft === "maximum"
                        ? "Maximum autonomy still respects hard platform boundaries."
                        : "You can switch this per task without changing the overall UI."}
                    </span>
                  </div>
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

                {(browserTakeoverRequest || premiumTaskTemplates.length > 0 || activeThread) && (
                  <div className="space-y-4 border-t border-black/10 pt-4">
                    {browserTakeoverRequest && (
                      <div className="rounded-[24px] border border-amber-200 bg-amber-50/85 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.16em] text-amber-900/70">
                              Manual browser takeover
                            </p>
                            <h3 className="mt-2 text-base font-medium text-black/[0.82]">
                              The site is blocked. You can take over this browser step.
                            </h3>
                            <p className="mt-2 text-sm leading-7 text-black/[0.66]">
                              Solve the CAPTCHA, protection step, or unexpected browser gate, then tell the agent what
                              you changed so it can continue from the updated page state.
                            </p>
                          </div>
                          <Badge className="border-transparent bg-amber-600 text-white">takeover ready</Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/[0.48]">
                          <span>{formatToolName(browserTakeoverRequest.tool)}</span>
                          {browserTakeoverRequest.targetLabel && (
                            <span>{compactText(browserTakeoverRequest.targetLabel, 56)}</span>
                          )}
                          <span>{formatRelativeTime(browserTakeoverRequest.created_at)}</span>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => startBrowserTakeover(browserTakeoverRequest)}
                            disabled={approvalActionLoading === browserTakeoverRequest.id}
                            className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                          >
                            <ArrowUpRight className="h-4 w-4" />
                            Take control in browser
                          </button>
                          <button
                            type="button"
                            onClick={() => activateOperatorTab("browser")}
                            className="rounded-full border border-black/10 bg-white/85 px-4 py-2 text-sm text-black/[0.72] transition hover:bg-white"
                          >
                            Focus browser workbench
                          </button>
                        </div>
                        <label className="mt-4 flex flex-col gap-2 text-sm text-black/[0.68]">
                          <span className="text-xs uppercase tracking-[0.14em] text-black/[0.46]">
                            Tell the agent what you did
                          </span>
                          <textarea
                            value={takeoverNotes[browserTakeoverRequest.id] ?? ""}
                            onChange={(event) =>
                              setTakeoverNotes((current) => ({
                                ...current,
                                [browserTakeoverRequest.id]: event.target.value
                              }))
                            }
                            rows={3}
                            placeholder="I solved the CAPTCHA, confirmed the account, and landed on the dashboard."
                            className="min-h-[92px] rounded-[18px] border border-black/10 bg-white/90 px-4 py-3 text-sm leading-6 text-black/[0.82] outline-none transition focus:border-black/20"
                          />
                        </label>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => void resumeBrowserTakeover(browserTakeoverRequest)}
                            disabled={
                              approvalActionLoading === browserTakeoverRequest.id ||
                              isTaskPaused ||
                              !(takeoverNotes[browserTakeoverRequest.id] ?? "").trim()
                            }
                            className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                          >
                            <ShieldCheck className="h-4 w-4" />
                            {approvalActionLoading === browserTakeoverRequest.id ? "Resuming..." : "Hand control back"}
                          </button>
                          <span className="text-sm text-black/[0.58]">
                            The agent will continue immediately from your note.
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                      {premiumTaskTemplates.length > 0 && (
                        <div className="rounded-[24px] border border-black/10 bg-white/78 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">
                                Premium swarm modes
                              </p>
                              <h3 className="mt-2 text-base font-medium text-black/[0.82]">
                                Launch the higher-end multi-agent workflows deliberately.
                              </h3>
                              <p className="mt-2 text-sm leading-7 text-black/[0.62]">
                                These presets make the planner, coder, tester, and research flows more visible and
                                repeatable instead of hiding them behind prompt luck.
                              </p>
                            </div>
                            {selectedTaskTemplate && (
                              <span className="rounded-full bg-black/[0.04] px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-black/[0.5]">
                                {selectedTaskTemplate.name}
                              </span>
                            )}
                          </div>
                          <div className="mt-4 grid gap-3">
                            {premiumTaskTemplates.map((template) => {
                              const isSelected = selectedTaskTemplateKey === template.key;
                              const presetSummary = executionEnvironmentSummary(
                                PREMIUM_TEMPLATE_ENVIRONMENT_PRESETS[template.key]
                              );
                              return (
                                <button
                                  key={template.key}
                                  type="button"
                                  onClick={() => void applyTaskTemplate(template)}
                                  className={cn(
                                    "rounded-[20px] border px-4 py-4 text-left transition",
                                    isSelected
                                      ? "border-transparent bg-ink text-white shadow-[0_16px_36px_rgba(15,58,50,0.12)]"
                                      : "border-black/10 bg-white/88 text-black/[0.76] hover:bg-sand/35"
                                  )}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <span className="text-sm font-medium">{template.name}</span>
                                    <span
                                      className={cn(
                                        "rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]",
                                        isSelected ? "bg-white/14 text-white/80" : "bg-black/[0.05] text-black/[0.46]"
                                      )}
                                    >
                                      {template.recommended_operator_tab}
                                    </span>
                                  </div>
                                  <p className={cn("mt-2 text-sm leading-6", isSelected ? "text-white/82" : "text-black/[0.62]")}>
                                    {template.summary}
                                  </p>
                                  <p
                                    className={cn(
                                      "mt-3 text-[11px] uppercase tracking-[0.14em]",
                                      isSelected ? "text-white/65" : "text-black/[0.46]"
                                    )}
                                  >
                                    {presetSummary}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            {selectedTaskTemplate && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => activateOperatorTab(selectedTaskTemplate.recommended_operator_tab)}
                                  className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white"
                                >
                                  <Sparkles className="h-4 w-4" />
                                  Open {selectedTaskTemplate.recommended_operator_tab}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void clearTaskTemplate()}
                                  className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/[0.72] transition hover:bg-sand/45"
                                >
                                  Clear mode
                                </button>
                              </>
                            )}
                            {templateNotice && <span className="text-sm text-emerald-700">{templateNotice}</span>}
                          </div>
                        </div>
                      )}

                      <div className="rounded-[24px] border border-black/10 bg-white/78 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.16em] text-black/[0.45]">
                              Execution environment
                            </p>
                            <h3 className="mt-2 text-base font-medium text-black/[0.82]">
                              Choose the runtime the swarm should steer toward.
                            </h3>
                            <p className="mt-2 text-sm leading-7 text-black/[0.62]">
                              This controls the task’s preferred OS profile, runtime style, scale, and persistence so the
                              agents behave more predictably.
                            </p>
                          </div>
                          <span className="rounded-full bg-black/[0.04] px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-black/[0.5]">
                            {executionEnvironmentSummary(executionEnvironmentDraft)}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <label className="space-y-2 text-sm text-black/[0.72]">
                            <span className="block text-xs uppercase tracking-[0.16em] text-black/[0.45]">Target OS</span>
                            <select
                              value={executionEnvironmentDraft?.target_os ?? ""}
                              onChange={(event) =>
                                updateExecutionEnvironmentField(
                                  "target_os",
                                  (event.target.value || undefined) as ExecutionEnvironmentRequest["target_os"] | undefined
                                )
                              }
                              className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 outline-none"
                            >
                              {EXECUTION_TARGET_OS_OPTIONS.map((option) => (
                                <option key={option.value || "auto-os"} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-2 text-sm text-black/[0.72]">
                            <span className="block text-xs uppercase tracking-[0.16em] text-black/[0.45]">Runtime</span>
                            <select
                              value={executionEnvironmentDraft?.runtime_profile ?? "auto"}
                              onChange={(event) =>
                                updateExecutionEnvironmentField(
                                  "runtime_profile",
                                  event.target.value as ExecutionEnvironmentRequest["runtime_profile"]
                                )
                              }
                              className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 outline-none"
                            >
                              {EXECUTION_RUNTIME_PROFILE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-2 text-sm text-black/[0.72]">
                            <span className="block text-xs uppercase tracking-[0.16em] text-black/[0.45]">Resource tier</span>
                            <select
                              value={executionEnvironmentDraft?.resource_tier ?? ""}
                              onChange={(event) =>
                                updateExecutionEnvironmentField(
                                  "resource_tier",
                                  (event.target.value || undefined) as ExecutionEnvironmentRequest["resource_tier"] | undefined
                                )
                              }
                              className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 outline-none"
                            >
                              {EXECUTION_RESOURCE_TIER_OPTIONS.map((option) => (
                                <option key={option.value || "auto-tier"} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-2 text-sm text-black/[0.72]">
                            <span className="block text-xs uppercase tracking-[0.16em] text-black/[0.45]">Persistence</span>
                            <select
                              value={executionEnvironmentDraft?.persistence_scope ?? ""}
                              onChange={(event) =>
                                updateExecutionEnvironmentField(
                                  "persistence_scope",
                                  (event.target.value || undefined) as ExecutionEnvironmentRequest["persistence_scope"] | undefined
                                )
                              }
                              className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 outline-none"
                            >
                              {EXECUTION_PERSISTENCE_SCOPE_OPTIONS.map((option) => (
                                <option key={option.value || "auto-scope"} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-2 text-sm text-black/[0.72] sm:col-span-2">
                            <span className="block text-xs uppercase tracking-[0.16em] text-black/[0.45]">Network access</span>
                            <select
                              value={
                                typeof executionEnvironmentDraft?.network_access === "boolean"
                                  ? executionEnvironmentDraft.network_access
                                    ? "enabled"
                                    : "disabled"
                                  : ""
                              }
                              onChange={(event) =>
                                updateExecutionEnvironmentField(
                                  "network_access",
                                  event.target.value === ""
                                    ? undefined
                                    : event.target.value === "enabled"
                                      ? true
                                      : false
                                )
                              }
                              className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 outline-none"
                            >
                              <option value="">Auto network</option>
                              <option value="enabled">Enabled</option>
                              <option value="disabled">Disabled</option>
                            </select>
                          </label>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => void saveExecutionEnvironmentControls()}
                            disabled={!activeThread || headerActionLoading === "controls"}
                            className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                          >
                            <Save className="h-4 w-4" />
                            {headerActionLoading === "controls" ? "Saving..." : "Save environment"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setExecutionEnvironmentDraft(activeExecutionEnvironment)}
                            className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/[0.72] transition hover:bg-sand/45"
                          >
                            Reset to saved
                          </button>
                          {!activeThread && (
                            <span className="text-sm text-black/[0.56]">
                              Start or select a task to persist these controls.
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
                </div>
              </div>
            </div>
          )}
        </div>

        {browserTakeoverRequest && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-amber-200 bg-amber-50/70 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.16em] text-amber-900/70">Browser blocked</p>
              <p className="mt-1 text-sm text-black/[0.72]">
                The agent needs your help with a CAPTCHA or protection step. Open Controls to take over and hand it back when you’re done.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setHeaderPanel("settings");
                  setHeaderError(null);
                  setHeaderNotice(null);
                }}
                className="rounded-full bg-ink px-4 py-2 text-sm text-white"
              >
                Open controls
              </button>
              <button
                type="button"
                onClick={() => activateOperatorTab("browser")}
                className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/[0.72] transition hover:bg-white"
              >
                Focus browser
              </button>
            </div>
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
              onClick={() => activateOperatorTab(workflowRecommendedTab)}
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
                    onClick={() => activateOperatorTab(workflowRecommendedTab)}
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white"
                  >
                    <MonitorSmartphone className="h-4 w-4" />
                    Open {workflowRecommendedTabLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => activateOperatorTab("timeline")}
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
                        {request.kind === "browser_takeover" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => startBrowserTakeover(request)}
                              disabled={approvalActionLoading === request.id}
                              className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                            >
                              <ArrowUpRight className="h-4 w-4" />
                              Take control
                            </button>
                            <label className="flex min-w-[260px] flex-1 flex-col gap-2 text-sm text-black/[0.68]">
                              <span className="text-xs uppercase tracking-[0.14em] text-black/[0.46]">
                                What did you do?
                              </span>
                              <textarea
                                value={takeoverNotes[request.id] ?? ""}
                                onChange={(event) =>
                                  setTakeoverNotes((current) => ({
                                    ...current,
                                    [request.id]: event.target.value
                                  }))
                                }
                                rows={3}
                                placeholder="I solved the CAPTCHA and reached the dashboard."
                                className="min-h-[92px] rounded-[18px] border border-black/10 bg-white/85 px-4 py-3 text-sm leading-6 text-black/[0.82] outline-none transition focus:border-black/20"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => void resumeBrowserTakeover(request)}
                              disabled={approvalActionLoading === request.id || isTaskPaused}
                              className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                            >
                              <ShieldCheck className="h-4 w-4" />
                              {approvalActionLoading === request.id ? "Resuming..." : "Resume with note"}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void approvePendingRequest(request)}
                            disabled={approvalActionLoading === request.id || running || isTaskPaused}
                            className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-60"
                          >
                            <ShieldCheck className="h-4 w-4" />
                            {approvalActionLoading === request.id ? "Approving..." : "Approve and continue"}
                          </button>
                        )}
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
                          <div className="mt-3 border-t border-black/[0.08] pt-3">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-black/[0.56]">
                                <Globe className="h-3.5 w-3.5" />
                                Sources
                              </div>
                              <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-black/[0.42]">
                                {referencedCitationIds.map((referenceId) => (
                                  <span key={`${message.id}-${referenceId}`}>{referenceId}</span>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              {message.citations.map((citation, citationIndex) => {
                                const href = citationHref(data.workspace_id, citation);
                                const citationKey =
                                  citation.reference_id ??
                                  citation.document_id ??
                                  citation.chunk_id ??
                                  citation.relative_path ??
                                  citation.url ??
                                  `${message.id}-${citationIndex}`;
                                const lineContent = (
                                  <div className="flex items-start justify-between gap-3 text-[13px] leading-6 text-black/[0.7]">
                                    <div className="min-w-0">
                                      <span className="font-medium text-black/[0.52]">
                                        {citation.reference_id ?? `S${citationIndex + 1}`}
                                      </span>{" "}
                                      <span className="font-medium text-black/[0.78]">{citation.title}</span>
                                      {citation.kind && (
                                        <span className="text-black/[0.42]"> · {citation.kind.replaceAll("_", " ")}</span>
                                      )}
                                      {(citation.source_uri || citation.relative_path || citation.agent) && (
                                        <span className="text-black/[0.42]">
                                          {" "}
                                          · {citation.source_uri ?? citation.relative_path ?? citation.agent}
                                        </span>
                                      )}
                                      {citation.excerpt && (
                                        <span className="text-black/[0.48]"> — {citation.excerpt}</span>
                                      )}
                                    </div>
                                    {href && <ArrowUpRight className="mt-1 h-3.5 w-3.5 shrink-0 text-black/45" />}
                                  </div>
                                );

                                return href ? (
                                  <a
                                    key={citationKey}
                                    href={href}
                                    target={citation.url ? "_blank" : undefined}
                                    rel={citation.url ? "noreferrer" : undefined}
                                    className="block transition hover:text-black"
                                  >
                                    {lineContent}
                                  </a>
                                ) : (
                                  <div key={citationKey}>{lineContent}</div>
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
          {running && (
            <article className="flex justify-start">
              <div className="max-w-[min(42rem,100%)] px-1 py-0.5">
                <p className="text-[12px] leading-5 text-black/[0.42]">
                  Working for {liveRunElapsedLabel ?? "0s"}
                </p>
                <p className="mt-0.5 text-[14px] leading-6 text-black/[0.8] md:text-[15px]">
                  {liveRunObjective || "Reviewing your request and choosing the best execution path."}
                </p>
                <p className="mt-0.5 text-[12px] leading-5 text-black/[0.46]">
                  {liveRunStatusText}
                </p>
              </div>
            </article>
          )}
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
                    onClick={() => void applyTaskTemplate(template)}
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
                    onClick={() => void clearTaskTemplate()}
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
        <div
          className={cn(
            "flex h-full min-h-0 flex-col overflow-hidden bg-white/96",
            isWorkbenchFocusLayout ? "" : "border-l border-black/8"
          )}
        >
          <div className={cn("border-b border-black/10", isWorkbenchFocusLayout ? "px-3 py-2" : "px-4 py-3")}>
            {isWorkbenchFocusLayout ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="surface-label">Workbench</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-black/[0.46]">
                      {workbenchFocusHeaderMeta.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-black/[0.5]">
                    <button
                      type="button"
                      onClick={() =>
                        workbenchAutoFollow
                          ? setWorkbenchAutoFollow(false)
                          : resumeWorkbenchAutonomy(autonomySuggestedTab)
                      }
                      className="inline-flex items-center gap-1.5 text-black/[0.66] transition hover:text-black"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {workbenchAutoFollow ? "Pause auto-follow" : "Resume auto-follow"}
                    </button>
                    <button
                      type="button"
                      onClick={toggleWorkbenchExpanded}
                      className="inline-flex items-center gap-1.5 text-black/[0.66] transition hover:text-black"
                      aria-label={workbenchExpanded ? "Exit workbench focus mode" : "Expand workbench"}
                      title={workbenchExpanded ? "Exit workbench focus mode" : "Expand workbench"}
                    >
                      {workbenchExpanded ? <X className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                      {workbenchExpanded ? "Close" : "Expand"}
                    </button>
                    <button
                      type="button"
                      onClick={toggleOperatorPaneCollapsed}
                      className="hidden text-black/[0.66] transition hover:text-black xl:inline-flex"
                      aria-label="Collapse operator canvas"
                      title="Collapse operator canvas"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-4 overflow-x-auto pb-0.5">
                  {OPERATOR_TAB_OPTIONS.map((tab) => {
                    const Icon = tab.icon;
                    const active = operatorTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => activateOperatorTab(tab.key as OperatorTab)}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1.5 border-b pb-1 text-[11px] uppercase tracking-[0.16em] transition",
                          active
                            ? "border-black text-black/[0.9]"
                            : "border-transparent text-black/[0.42] hover:text-black/[0.72]"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/8 pb-1.5">
                  <div className="min-w-0">
                    <p className="surface-label">Workbench</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-black/[0.46]">
                      {(workbenchFocusHeaderMeta.length > 0
                        ? workbenchFocusHeaderMeta
                        : ["Autonomous execution", "Browser, code, files, preview"]).map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.52]">
                    <button
                      type="button"
                      onClick={() =>
                        workbenchAutoFollow
                          ? setWorkbenchAutoFollow(false)
                          : resumeWorkbenchAutonomy(autonomySuggestedTab)
                      }
                      className="transition hover:text-black"
                    >
                      {workbenchAutoFollow ? "Pause auto-follow" : "Resume auto-follow"}
                    </button>
                    <button
                      type="button"
                      onClick={toggleWorkbenchExpanded}
                      className="transition hover:text-black"
                      aria-label={workbenchExpanded ? "Exit workbench focus mode" : "Expand workbench"}
                      title={workbenchExpanded ? "Exit workbench focus mode" : "Expand workbench"}
                    >
                      {workbenchExpanded ? "Exit focus" : "Expand"}
                    </button>
                    <button
                      type="button"
                      onClick={toggleOperatorPaneCollapsed}
                      className="hidden transition hover:text-black xl:inline-flex"
                      aria-label="Collapse operator canvas"
                      title="Collapse operator canvas"
                    >
                      Collapse
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
                  {OPERATOR_TAB_OPTIONS.map((tab) => {
                    const Icon = tab.icon;
                    const active = operatorTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => activateOperatorTab(tab.key as OperatorTab)}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1.5 border-b pb-1 text-[11px] uppercase tracking-[0.16em] transition",
                          active
                            ? "border-black text-black/[0.9]"
                            : "border-transparent text-black/[0.42] hover:text-black/[0.72]"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto", isWorkbenchFocusLayout ? "p-2" : "px-4 py-3")}>
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={operatorTab}
                initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -14 }}
                transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 24 }}
                className={cn("space-y-3", isWorkbenchFocusLayout && "space-y-3")}
              >
            <div className="border-b border-black/8 pb-1.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className={cn(isWorkbenchFocusLayout ? "max-w-xl" : "max-w-2xl")}>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-black/[0.42]">Autonomy</p>
                  <p className="mt-1 text-[13px] font-medium text-black/[0.82]">{autonomyStateLabel}</p>
                  <p className="mt-1 text-[13px] leading-6 text-black/[0.58]">{compactText(autonomySummary, 180)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.52]">
                  <span className="text-black/[0.62]">{autonomyStateLabel}</span>
                  {pendingApprovalRequests.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => activateOperatorTab(browserSession ? "browser" : "computer")}
                      className="inline-flex items-center gap-2 transition hover:text-black"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Review handoff
                    </button>
                  ) : browserSession?.final_url ? (
                    <a
                      href={browserSession.final_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 transition hover:text-black"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      Open live page
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => activateOperatorTab(autonomySuggestedTab)}
                      className="inline-flex items-center gap-2 transition hover:text-black"
                    >
                      <MonitorSmartphone className="h-3.5 w-3.5" />
                      Open {OPERATOR_TAB_OPTIONS.find((tab) => tab.key === autonomySuggestedTab)?.label ?? "surface"}
                    </button>
                  )}
                </div>
              </div>
              {autonomyMeta.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-black/[0.44]">
                  {autonomyMeta.map((item) => (
                    <span key={item}>
                      {item}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {operatorTab === "code" && (
              <div className={cn("space-y-5", isWorkbenchFocusLayout && "space-y-4")}>
                <div className={cn("grid gap-4", isWorkbenchFocusLayout ? "xl:grid-cols-[248px_minmax(0,1fr)]" : "xl:grid-cols-[280px_minmax(0,1fr)]")}>
                  <div className="space-y-4">
                    <div className={cn("rounded-[24px] border border-black/10 bg-white/80", isWorkbenchFocusLayout ? "p-3.5" : "p-4")}>
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
                        <div
                          className="space-y-2 overflow-y-auto"
                          style={workbenchPrimaryViewportHeight ? { maxHeight: workbenchPrimaryViewportHeight } : undefined}
                        >
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

                    <div className={cn("rounded-[24px] border border-black/10 bg-white/80", isWorkbenchFocusLayout ? "p-3.5" : "p-4")}>
                      <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                        <Activity className="h-4 w-4" />
                        Agent file focus
                      </div>
                      <p className="mt-2 text-xs uppercase tracking-[0.16em] text-black/[0.46]">
                        Live coding-agent browsing and edit tracking
                      </p>

                      <div
                        className="mt-4 space-y-2 overflow-y-auto"
                        style={workbenchSecondaryViewportHeight ? { maxHeight: workbenchSecondaryViewportHeight } : undefined}
                      >
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

                    <div className={cn("rounded-[24px] border border-black/10 bg-white/80", isWorkbenchFocusLayout ? "p-3.5" : "p-4")}>
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
                          <div
                            className="mt-4 space-y-2 overflow-y-auto"
                            style={workbenchSecondaryViewportHeight ? { maxHeight: workbenchSecondaryViewportHeight } : undefined}
                          >
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

                  <div className={cn("rounded-[24px] border border-black/10 bg-white/82", isWorkbenchFocusLayout ? "p-3.5" : "p-4")}>
                    <div className={cn("flex flex-wrap gap-2 border-b border-black/10", isWorkbenchFocusLayout ? "pb-3" : "pb-4")}>
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

                    <div className={cn("mt-4 flex flex-wrap items-start justify-between gap-3 border-b border-black/10", isWorkbenchFocusLayout ? "pb-3" : "pb-4")}>
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
                              <div
                                className="overflow-hidden border-r border-white/8 bg-black/20 px-3 py-4 text-right font-mono text-xs leading-6 text-white/28"
                                style={{ maxHeight: workbenchPrimaryViewportHeight ?? "620px" }}
                              >
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
                                className="w-full resize-none bg-transparent px-4 py-4 font-mono text-xs leading-6 text-white/88 outline-none"
                                style={{ minHeight: workbenchPrimaryViewportHeight ?? "620px" }}
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
                              <pre
                                className="overflow-auto bg-[#101114] px-4 py-4 font-mono text-xs leading-6 text-white/78"
                                style={{ maxHeight: workbenchPrimaryViewportHeight ?? "620px" }}
                              >
                                {selectedWorkbenchEditor?.originalContent || " "}
                              </pre>
                            </div>
                            <div className="overflow-hidden rounded-[24px] border border-black/10 bg-white">
                              <div className="border-b border-black/10 px-4 py-3 text-xs uppercase tracking-[0.16em] text-black/[0.5]">
                                Current draft
                              </div>
                              <pre
                                className="overflow-auto bg-[#101114] px-4 py-4 font-mono text-xs leading-6 text-white/88"
                                style={{ maxHeight: workbenchPrimaryViewportHeight ?? "620px" }}
                              >
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
                            <div
                              className="overflow-auto px-4 py-4 font-mono text-xs leading-6 text-white/82"
                              style={{ maxHeight: workbenchPrimaryViewportHeight ?? "620px" }}
                            >
                              {repoDiff && repoDiff.relative_path === selectedWorkbenchFile.relative_path ? (
                                repoDiff.diff ? (
                                  <div className="min-w-[900px] overflow-hidden rounded-[20px] border border-white/10">
                                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-white/10 bg-white/[0.04] text-[10px] uppercase tracking-[0.16em] text-white/55">
                                      <div className="border-r border-white/10 px-4 py-3">Saved / HEAD</div>
                                      <div className="px-4 py-3">Working copy</div>
                                    </div>
                                    <div className="divide-y divide-white/6">
                                      {parseUnifiedDiffRows(repoDiff.diff).map((row, index) =>
                                        row.kind === "hunk" ? (
                                          <div
                                            key={`repo-hunk-${index}`}
                                            className="px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-sky-200/90"
                                          >
                                            {row.header}
                                          </div>
                                        ) : (
                                          <div
                                            key={`repo-row-${index}`}
                                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                                          >
                                            <div
                                              className={cn(
                                                "grid grid-cols-[56px_minmax(0,1fr)] border-r border-white/10",
                                                workbenchDiffCellTone(row.leftKind)
                                              )}
                                            >
                                              <div className="border-r border-black/5 px-3 py-2 text-right text-[10px] opacity-70">
                                                {row.leftLineNumber ?? ""}
                                              </div>
                                              <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-2">
                                                {row.leftText || " "}
                                              </pre>
                                            </div>
                                            <div
                                              className={cn(
                                                "grid grid-cols-[56px_minmax(0,1fr)]",
                                                workbenchDiffCellTone(row.rightKind)
                                              )}
                                            >
                                              <div className="border-r border-black/5 px-3 py-2 text-right text-[10px] opacity-70">
                                                {row.rightLineNumber ?? ""}
                                              </div>
                                              <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-2">
                                                {row.rightText || " "}
                                              </pre>
                                            </div>
                                          </div>
                                        )
                                      )}
                                    </div>
                                  </div>
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
              <div className="space-y-3">
                {(computerError || computerNotice) && (
                  <div
                    className={cn(
                      "border-l px-3 py-1 text-[13px] leading-6",
                      computerError
                        ? "border-red-300 text-red-800"
                        : "border-emerald-300 text-emerald-800"
                    )}
                  >
                    {computerError ?? computerNotice}
                  </div>
                )}

                {showComputerOverview &&
                  (useMinimalWorkbenchOverview || isWorkbenchFocusLayout ? (
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_176px]">
                      <div className="min-w-0 overflow-hidden xl:pr-3">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/8 pb-2">
                          <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-black/[0.42]">
                              {workbenchFocusPrimaryLabel}
                            </p>
                            <p className="mt-1.5 truncate text-[13px] font-medium text-black/[0.82]">
                              {workbenchFocusPrimaryCaption}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            <span className="text-[11px] uppercase tracking-[0.16em] text-black/[0.46]">{autonomyStateLabel}</span>
                            <button
                              type="button"
                              onClick={() => activateOperatorTab(autonomySuggestedTab)}
                              className="text-[11px] uppercase tracking-[0.16em] text-black/[0.52] transition hover:text-black"
                            >
                              Follow {OPERATOR_TAB_OPTIONS.find((tab) => tab.key === autonomySuggestedTab)?.label ?? "surface"}
                            </button>
                          </div>
                        </div>

                        <div className="pt-2.5">
                          {autonomySuggestedTab === "browser" ? (
                            browserSession ? (
                              <div className="space-y-3">
                                {selectedBrowserScreenshot ? (
                                  <Image
                                    src={toolArtifactPreviewHref(data.workspace_id, selectedBrowserScreenshot)}
                                    alt={browserSession.page_title || "Browser capture"}
                                    width={1600}
                                    height={900}
                                    unoptimized
                                  className="h-auto w-full bg-white object-contain"
                                  style={workbenchPrimaryViewportHeight ? { maxHeight: workbenchPrimaryViewportHeight } : undefined}
                                />
                              ) : selectedBrowserHtml ? (
                                  <iframe
                                    key={selectedBrowserHtml.storage_key}
                                    src={toolArtifactPreviewHref(data.workspace_id, selectedBrowserHtml)}
                                    title={artifactLabel(selectedBrowserHtml)}
                                    className="w-full bg-white"
                                    style={{ height: workbenchPrimaryViewportHeight ?? "300px" }}
                                    sandbox="allow-same-origin allow-scripts"
                                  />
                                ) : (
                                  <div className="flex min-h-[220px] items-center justify-center px-2 py-6 text-center text-sm text-black/[0.58]">
                                    No screenshot or inline page preview is available for the current browser session yet.
                                  </div>
                                )}
                                <div className="border-t border-black/8 pt-3 text-sm leading-6 text-black/[0.68]">
                                  {browserSession.extracted_text
                                    ? compactText(browserSession.extracted_text, 420)
                                    : "The browser session is active, but readable page text has not been captured yet."}
                                </div>
                              </div>
                            ) : (
                              <div className="flex min-h-[220px] items-center justify-center px-2 py-6 text-center text-sm text-black/[0.58]">
                                Browser work will appear here when a run opens pages, captures screenshots, or asks for review.
                              </div>
                            )
                          ) : autonomySuggestedTab === "terminal" ? (
                            terminalSession ? (
                              <div className="overflow-hidden bg-[#111111]">
                                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-white/48">
                                  <span>{(terminalSession.command ?? []).join(" ") || "Python sandbox"}</span>
                                  <span>{statusLabel(terminalSession.status)}</span>
                                </div>
                                <div
                                  ref={terminalOutputRef}
                                  className="overflow-auto px-4 py-4 font-mono text-xs leading-6 text-white/88"
                                  style={{ maxHeight: workbenchPrimaryViewportHeight ?? "300px" }}
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
                              </div>
                            ) : (
                              <div className="flex min-h-[220px] items-center justify-center px-2 py-6 text-center text-sm text-black/[0.58]">
                                Terminal and code execution output will appear here when the coding or analysis agents use the sandbox.
                              </div>
                            )
                          ) : autonomySuggestedTab === "preview" ? (
                            <div className="overflow-hidden bg-[#f8f5ef]">
                              {selectedPreviewArtifact ? (
                                selectedPreviewMode === "image" ? (
                                  <Image
                                    src={toolArtifactPreviewHref(data.workspace_id, selectedPreviewArtifact)}
                                    alt={artifactLabel(selectedPreviewArtifact)}
                                    width={1600}
                                    height={900}
                                    unoptimized
                                    className="h-auto w-full bg-sand/60 object-contain"
                                  />
                                ) : selectedPreviewMode === "frame" ? (
                                  <iframe
                                    key={selectedPreviewArtifact.storage_key}
                                    src={toolArtifactPreviewHref(data.workspace_id, selectedPreviewArtifact)}
                                    title={artifactLabel(selectedPreviewArtifact)}
                                    className="w-full bg-white"
                                    style={{ height: workbenchPrimaryViewportHeight ?? "300px" }}
                                    sandbox="allow-same-origin allow-scripts"
                                  />
                                ) : (
                                  <div className="flex min-h-[220px] items-center justify-center px-2 py-6 text-center text-sm text-black/[0.58]">
                                    This artifact is not previewable inline yet. Use the download action to inspect it.
                                  </div>
                                )
                              ) : (
                                <div className="flex min-h-[220px] items-center justify-center px-2 py-6 text-center text-sm text-black/[0.58]">
                                  Generated apps, docs, images, and reports will render here as soon as the agents create previewable artifacts.
                                </div>
                              )}
                            </div>
                          ) : autonomySuggestedTab === "code" ? (
                            selectedWorkbenchFile ? (
                              <div className="overflow-hidden bg-[#101114]">
                                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-white/48">
                                  <span>{selectedWorkbenchFile.relative_path}</span>
                                  <span>{selectedWorkbenchDirty ? "Modified" : "Synced"}</span>
                                </div>
                                <pre
                                  className="overflow-auto px-4 py-4 font-mono text-xs leading-6 text-white/84"
                                  style={{ maxHeight: workbenchPrimaryViewportHeight ?? "300px" }}
                                >
                                  {selectedWorkbenchDraft || " "}
                                </pre>
                              </div>
                            ) : (
                              <div className="bg-transparent">
                                <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-black/[0.46]">
                                  <span>{rootWorkbenchTree?.root_label ?? "Workspace"}</span>
                                  <button
                                    type="button"
                                    onClick={() => void fetchWorkbenchDirectory(".", { force: true })}
                                    className="text-[11px] uppercase tracking-[0.16em] text-black/[0.52] transition hover:text-black"
                                  >
                                    Refresh
                                  </button>
                                </div>
                                <div
                                  className="space-y-2 overflow-y-auto p-3"
                                  style={workbenchPrimaryViewportHeight ? { maxHeight: workbenchPrimaryViewportHeight } : undefined}
                                >
                                  {rootWorkbenchTree && rootWorkbenchTree.entries.length > 0 ? (
                                    rootWorkbenchTree.entries.slice(0, 14).map((entry) => (
                                      <button
                                        key={entry.relative_path}
                                        type="button"
                                        onClick={() => {
                                          if (entry.kind === "dir") {
                                            void toggleWorkbenchDirectory(entry.relative_path);
                                            activateOperatorTab("code");
                                            return;
                                          }
                                          void openWorkbenchFile(entry.relative_path);
                                        }}
                                      className="flex w-full items-center justify-between gap-3 border-b border-black/8 px-0 py-2 text-left text-sm text-black/[0.72] transition hover:text-black"
                                      >
                                        <span className="flex items-center gap-2 truncate">
                                          {entry.kind === "dir" ? (
                                            <FolderTree className="h-4 w-4 shrink-0" />
                                          ) : (
                                            <FileText className="h-4 w-4 shrink-0" />
                                          )}
                                          <span className="truncate">{entry.relative_path}</span>
                                        </span>
                                        <span className="text-[10px] uppercase tracking-[0.14em] text-black/[0.45]">
                                          {entry.kind === "dir" ? "folder" : entry.extension?.replace(".", "") || "file"}
                                        </span>
                                      </button>
                                    ))
                                  ) : (
                                      <div className="flex min-h-[220px] items-center justify-center px-2 py-6 text-center text-sm text-black/[0.58]">
                                        Workspace files will appear here when the workbench tree is loaded.
                                      </div>
                                    )}
                                </div>
                              </div>
                            )
                          ) : (
                            <div className="bg-transparent">
                              <div className="border-b border-black/10 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-black/[0.46]">
                                Workspace files and outputs
                              </div>
                              <div
                                className="space-y-2 overflow-y-auto p-3"
                                style={workbenchPrimaryViewportHeight ? { maxHeight: workbenchPrimaryViewportHeight } : undefined}
                              >
                                {rootWorkbenchTree && rootWorkbenchTree.entries.length > 0 ? (
                                  rootWorkbenchTree.entries.slice(0, 16).map((entry) => (
                                    <button
                                      key={entry.relative_path}
                                      type="button"
                                      onClick={() => {
                                        if (entry.kind === "dir") {
                                          void toggleWorkbenchDirectory(entry.relative_path);
                                          activateOperatorTab("code");
                                          return;
                                        }
                                        void openWorkbenchFile(entry.relative_path);
                                      }}
                                      className="flex w-full items-center justify-between gap-3 border-b border-black/8 px-0 py-2 text-left text-sm text-black/[0.72] transition hover:text-black"
                                    >
                                      <span className="flex items-center gap-2 truncate">
                                        {entry.kind === "dir" ? (
                                          <FolderTree className="h-4 w-4 shrink-0" />
                                        ) : (
                                          <FileText className="h-4 w-4 shrink-0" />
                                        )}
                                        <span className="truncate">{entry.relative_path}</span>
                                      </span>
                                      <span className="text-[10px] uppercase tracking-[0.14em] text-black/[0.45]">
                                        {entry.kind === "dir" ? "folder" : entry.extension?.replace(".", "") || "file"}
                                      </span>
                                    </button>
                                  ))
                                ) : (
                                  <div className="flex min-h-[220px] items-center justify-center px-2 py-6 text-center text-sm text-black/[0.58]">
                                    Workspace files and outputs will appear here as soon as the run touches them.
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="border-l border-black/8 pl-2.5">
                        <div className="pb-3">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-black/[0.42]">Status</p>
                          <p className="mt-1.5 text-[13px] font-medium text-black/[0.82]">{autonomyStateLabel}</p>
                          <p className="mt-1.5 text-[13px] leading-6 text-black/[0.62]">{autonomySummary}</p>
                          {autonomyMeta.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-black/[0.44]">
                              {autonomyMeta.map((item) => (
                                <span key={item}>
                                  {item}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {pendingApprovalRequests.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => activateOperatorTab("browser")}
                                className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.52] transition hover:text-black"
                              >
                                <ShieldAlert className="h-3.5 w-3.5" />
                                Review handoff
                              </button>
                            ) : browserSession?.final_url ? (
                              <a
                                href={browserSession.final_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.52] transition hover:text-black"
                              >
                                <ArrowUpRight className="h-3.5 w-3.5" />
                                Open live page
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() => resumeWorkbenchAutonomy(autonomySuggestedTab)}
                                className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.52] transition hover:text-black"
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                                Resume auto-follow
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="border-t border-black/8 pt-3">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-black/[0.42]">Trace</p>
                          <div className="mt-3 space-y-2">
                            {liveWorkbenchActivities.length > 0 ? (
                              liveWorkbenchActivities.slice(0, 5).map((activity) => (
                                <button
                                  key={activity.id}
                                  type="button"
                                  onClick={() => {
                                    if (activity.relative_path) {
                                      void openWorkbenchFile(activity.relative_path);
                                      activateOperatorTab("code");
                                      return;
                                    }
                                    if (activity.directory_path) {
                                      void fetchWorkbenchDirectory(activity.directory_path, { force: true });
                                      activateOperatorTab("files");
                                    }
                                  }}
                                  className="w-full border-b border-black/8 px-0 py-2.5 text-left transition hover:text-black"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="truncate text-sm font-medium text-black/[0.8]">
                                      {activity.relative_path ?? activity.directory_path ?? "workspace"}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-[0.12em] text-black/[0.46]">
                                      {workbenchActivityLabel(activity)}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-xs uppercase tracking-[0.14em] text-black/[0.44]">
                                    {activity.agent_name ?? "Coding agent"} - {formatRelativeTime(activity.created_at)}
                                  </p>
                                </button>
                              ))
                            ) : (
                              <div className="px-0 py-2 text-sm text-black/[0.58]">
                                File focus, browser movement, and generated outputs will appear here as the autonomous run progresses.
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="border-t border-black/8 pt-3">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-black/[0.42]">Outputs</p>
                          <div className="mt-3 space-y-2">
                            {mergedArtifacts.length > 0 ? (
                              mergedArtifacts.slice(0, 6).map((artifact) => (
                                <button
                                  key={artifact.storage_key}
                                  type="button"
                                  onClick={() => {
                                    if (isPreviewableArtifact(artifact)) {
                                      setSelectedPreviewStorageKey(artifact.storage_key);
                                      activateOperatorTab("preview");
                                      return;
                                    }
                                    window.open(toolArtifactHref(data.workspace_id, artifact), "_blank", "noopener,noreferrer");
                                  }}
                                  className="block w-full border-b border-black/8 px-0 py-2 text-left text-[11px] uppercase tracking-[0.16em] text-black/[0.52] transition hover:text-black"
                                >
                                  {compactText(artifactLabel(artifact), 28)}
                                </button>
                              ))
                            ) : workbenchFocusPrimaryStats.length > 0 ? (
                              workbenchFocusPrimaryStats.map((item) => (
                                <span key={item} className="block border-b border-black/8 px-0 py-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.44]">
                                  {item}
                                </span>
                              ))
                            ) : (
                              <div className="px-0 py-2 text-sm text-black/[0.58]">
                                Outputs will appear here as soon as the autonomous run generates something previewable or downloadable.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className={cn("border-t border-black/8 pt-3", isWorkbenchFocusLayout ? "p-0" : "")}>
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
                          {availablePreviewArtifacts.length} preview{availablePreviewArtifacts.length === 1 ? "" : "s"}
                        </Badge>
                      <Badge className="border-black/10 bg-white/80 text-black/[0.72]">
                        {computerSessions.filter((session) => session.status === "running").length} live
                      </Badge>
                    </div>
                  </div>

                  <div className={cn("mt-4 grid gap-3 sm:grid-cols-2", isWorkbenchFocusLayout ? "xl:grid-cols-4" : "xl:grid-cols-4")}>
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
                                  {request.kind === "browser_takeover" ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => startBrowserTakeover(request)}
                                        disabled={approvalActionLoading === request.id}
                                        className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-2 text-xs uppercase tracking-[0.14em] text-white disabled:opacity-60"
                                      >
                                        <ArrowUpRight className="h-3.5 w-3.5" />
                                        Take control
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void resumeBrowserTakeover(request)}
                                        disabled={
                                          approvalActionLoading === request.id ||
                                          isTaskPaused ||
                                          !(takeoverNotes[request.id] ?? "").trim()
                                        }
                                        className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-2 text-xs uppercase tracking-[0.14em] text-white disabled:opacity-60"
                                      >
                                        <ShieldCheck className="h-3.5 w-3.5" />
                                        {approvalActionLoading === request.id ? "Resuming..." : "Resume"}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => void approvePendingRequest(request)}
                                      disabled={approvalActionLoading === request.id || running || isTaskPaused}
                                      className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-2 text-xs uppercase tracking-[0.14em] text-white disabled:opacity-60"
                                    >
                                      <ShieldCheck className="h-3.5 w-3.5" />
                                      {approvalActionLoading === request.id ? "Approving..." : "Approve"}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => void deferPendingRequest(request)}
                                    disabled={approvalActionLoading === request.id}
                                    className="rounded-full border border-black/10 bg-white/85 px-3 py-2 text-xs uppercase tracking-[0.14em] text-black/[0.72] disabled:opacity-60"
                                  >
                                    Keep blocked
                                  </button>
                                </div>
                                {request.kind === "browser_takeover" && (
                                  <textarea
                                    value={takeoverNotes[request.id] ?? ""}
                                    onChange={(event) =>
                                      setTakeoverNotes((current) => ({
                                        ...current,
                                        [request.id]: event.target.value
                                      }))
                                    }
                                    rows={3}
                                    placeholder="Describe what you did after taking over."
                                    className="mt-3 min-h-[84px] w-full rounded-[16px] border border-black/10 bg-white/88 px-3 py-3 text-sm leading-6 text-black/[0.82] outline-none transition focus:border-black/20"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!isWorkbenchFocusLayout && (activeTaskMemory || activeProjectMemory) && (
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

                  {!isWorkbenchFocusLayout && taskTemplates.length > 0 && (
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
                              onClick={() => void applyTaskTemplate(template)}
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
                            onClick={() => void clearTaskTemplate()}
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
                  ))}

                {showBrowserMode &&
                  (browserSession ? (
                    <div
                      className={cn(
                        "border-b border-black/8",
                        isWorkbenchFocusLayout ? "rounded-none border-0 bg-transparent p-0" : "pb-4"
                      )}
                    >
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
                        <span className="text-[11px] uppercase tracking-[0.16em] text-black/[0.46]">
                          {statusLabel(browserSession.status)}
                        </span>
                        {browserSession.final_url && (
                          <a
                            href={browserSession.final_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.52] transition hover:text-black"
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
                            className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.52] transition hover:text-black"
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
                              "border-b px-0 py-0.5 text-left text-[11px] uppercase tracking-[0.16em] transition",
                              browserSession.session_id === session.session_id
                                ? "border-black text-black"
                                : "border-transparent text-black/[0.45] hover:text-black"
                            )}
                          >
                            <span className="block font-medium normal-case tracking-normal">
                              {compactText(sessionLabel(session, `Browser ${index + 1}`), 34)}
                            </span>
                            <span className="mt-1 block text-[10px] uppercase tracking-[0.14em] opacity-70">
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
                        className={cn("h-auto w-full rounded-[22px] border border-black/10 bg-sand/60", isWorkbenchFocusLayout && "rounded-none border-black/8 bg-white")}
                        style={workbenchPrimaryViewportHeight ? { maxHeight: workbenchPrimaryViewportHeight } : undefined}
                      />
                    ) : selectedBrowserHtml ? (
                      <iframe
                        key={selectedBrowserHtml.storage_key}
                        src={toolArtifactPreviewHref(data.workspace_id, selectedBrowserHtml)}
                        title={artifactLabel(selectedBrowserHtml)}
                        className={cn("w-full rounded-[22px] border border-black/10 bg-white", isWorkbenchFocusLayout && "rounded-none border-black/8")}
                        style={{ height: workbenchPrimaryViewportHeight ?? "380px" }}
                        sandbox="allow-same-origin allow-scripts"
                      />
                    ) : (
                      <div className="rounded-[22px] border border-dashed border-black/10 bg-sand/40 px-4 py-12 text-center text-sm text-black/[0.58]">
                        No screenshot or inline page preview is available for this browser session yet.
                      </div>
                    )}

                    {browserMetrics.length > 0 && (
                      <div className={cn("mt-4 flex flex-wrap gap-2", isWorkbenchFocusLayout && "gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-black/[0.44]")}>
                        {browserMetrics.map((entry) => (
                          <span
                            key={`${browserSession.session_id}-${entry.key}`}
                            className={cn("rounded-full bg-black/[0.04] px-3 py-1.5 text-xs text-black/[0.62]", isWorkbenchFocusLayout && "rounded-none bg-transparent px-0 py-0")}
                          >
                            {entry.label}: {entry.value}
                          </span>
                        ))}
                      </div>
                    )}

                      <div className={cn("mt-4 grid gap-4", isWorkbenchFocusLayout ? "lg:grid-cols-[0.62fr_0.38fr]" : "lg:grid-cols-[0.56fr_0.44fr]")}>
                        <div className={cn("rounded-[22px] bg-sand/60 p-4", isWorkbenchFocusLayout && "rounded-none border-t border-black/8 bg-transparent px-0 pb-0 pt-3")}>
                          <p className="text-xs uppercase tracking-[0.16em] text-black/[0.44]">Page extract</p>
                          <p
                            className="mt-3 overflow-y-auto text-sm leading-7 text-black/[0.74]"
                            style={workbenchSecondaryViewportHeight ? { maxHeight: workbenchSecondaryViewportHeight } : undefined}
                          >
                            {browserSession.extracted_text
                              ? compactText(browserSession.extracted_text, 520)
                              : "The browser session has not captured readable page text yet."}
                          </p>
                        </div>
                        <div className={cn("space-y-4", isWorkbenchFocusLayout && "overflow-y-auto")} style={workbenchSecondaryViewportHeight ? { maxHeight: workbenchSecondaryViewportHeight } : undefined}>
                          <div className={cn("rounded-[22px] bg-white/75 p-4", isWorkbenchFocusLayout && "rounded-none border-t border-black/8 bg-transparent px-0 pb-0 pt-3")}>
                          <p className="text-xs uppercase tracking-[0.16em] text-black/[0.44]">Actions</p>
                          <div className="mt-3 space-y-2 text-sm text-black/[0.72]">
                            {[...(browserSession.executed_actions ?? []), ...(browserSession.skipped_actions ?? [])].length > 0 ? (
                              <>
                                {(browserSession.executed_actions ?? []).map((action, index) => (
                                  <div
                                    key={`executed-${action.kind}-${action.selector}-${index}`}
                                    className={cn("rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-3", isWorkbenchFocusLayout && "rounded-none border-x-0 border-t-0 border-b-black/8 bg-transparent px-0")}
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
                                    className={cn("rounded-2xl border border-black/10 bg-sand/55 px-3 py-3", isWorkbenchFocusLayout && "rounded-none border-x-0 border-t-0 border-b-black/8 bg-transparent px-0")}
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
                              <div className={cn("rounded-2xl bg-sand/55 px-3 py-2", isWorkbenchFocusLayout && "rounded-none bg-transparent px-0")}>
                                Read-only capture. No interactive browser actions executed.
                              </div>
                            )}
                          </div>
                        </div>
                        <div className={cn("rounded-[22px] bg-white/75 p-4", isWorkbenchFocusLayout && "rounded-none border-t border-black/8 bg-transparent px-0 pb-0 pt-3")}>
                          <p className="text-xs uppercase tracking-[0.16em] text-black/[0.44]">Headings</p>
                          <div className="mt-3 space-y-2 text-sm text-black/[0.72]">
                            {browserSession.headings && browserSession.headings.length > 0 ? (
                              browserSession.headings.slice(0, 6).map((heading, index) => (
                                <div key={`${heading}-${index}`} className={cn("rounded-2xl bg-sand/55 px-3 py-2", isWorkbenchFocusLayout && "rounded-none bg-transparent px-0")}>
                                  {heading}
                                </div>
                              ))
                            ) : (
                              <div className={cn("rounded-2xl bg-sand/55 px-3 py-2", isWorkbenchFocusLayout && "rounded-none bg-transparent px-0")}>No heading summary captured yet.</div>
                            )}
                          </div>
                        </div>
                        <div className={cn("rounded-[22px] bg-white/75 p-4", isWorkbenchFocusLayout && "rounded-none border-t border-black/8 bg-transparent px-0 pb-0 pt-3")}>
                          <p className="text-xs uppercase tracking-[0.16em] text-black/[0.44]">Links</p>
                          <div className="mt-3 space-y-2 text-sm text-black/[0.72]">
                            {browserSession.links && browserSession.links.length > 0 ? (
                              browserSession.links.slice(0, 5).map((link) => (
                                <a
                                  key={`${link.text}-${link.url}`}
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={cn("flex items-center justify-between gap-2 rounded-2xl bg-sand/55 px-3 py-2 transition hover:bg-sand/75", isWorkbenchFocusLayout && "rounded-none bg-transparent px-0 hover:bg-transparent")}
                                >
                                  <span className="truncate">{link.text || link.url}</span>
                                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                                </a>
                              ))
                            ) : (
                              <div className={cn("rounded-2xl bg-sand/55 px-3 py-2", isWorkbenchFocusLayout && "rounded-none bg-transparent px-0")}>No link summary captured yet.</div>
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
                    <div
                      className={cn(
                        "border-b border-black/8 bg-[#111111] text-white",
                        isWorkbenchFocusLayout ? "rounded-none border-0 bg-[#111111] p-0" : "pb-4"
                      )}
                    >
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
                      <span className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                        {statusLabel(terminalSession.status)}
                      </span>
                    </div>

                    {terminalSessions.length > 1 && (
                      <div className="mb-4 flex flex-wrap gap-2">
                        {terminalSessions.map((session, index) => (
                          <button
                            key={session.session_id}
                            type="button"
                            onClick={() => setSelectedTerminalSessionId(session.session_id)}
                            className={cn(
                              "border-b px-0 py-0.5 text-left text-[11px] uppercase tracking-[0.16em] transition",
                              terminalSession.session_id === session.session_id
                                ? "border-white text-white"
                                : "border-transparent text-white/52 hover:text-white"
                            )}
                          >
                            <span className="block font-medium normal-case tracking-normal">
                              {compactText(sessionLabel(session, `Terminal ${index + 1}`), 34)}
                            </span>
                            <span className="mt-1 block text-[10px] uppercase tracking-[0.14em] opacity-70">
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
                              "border-b px-0 py-0.5 text-[11px] uppercase tracking-[0.16em] transition",
                              terminalStreamMode === mode
                                ? "border-white text-white"
                                : "border-transparent text-white/52 hover:text-white"
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
                          className={cn(
                            "inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs font-medium text-white/72 transition hover:bg-black/35",
                            isWorkbenchFocusLayout && "rounded-none border-0 bg-transparent px-0 py-0 uppercase tracking-[0.16em] text-white/55 hover:text-white"
                          )}
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
                              : "border-white/10 bg-black/25 text-white/72 hover:bg-black/35",
                            isWorkbenchFocusLayout &&
                              (terminalFollowOutput
                                ? "rounded-none border-0 bg-transparent px-0 py-0 uppercase tracking-[0.16em] text-emerald-200"
                                : "rounded-none border-0 bg-transparent px-0 py-0 uppercase tracking-[0.16em] text-white/55 hover:text-white")
                          )}
                        >
                          Follow live {terminalFollowOutput ? "on" : "off"}
                        </button>
                        <button
                          type="button"
                          onClick={jumpTerminalToLatest}
                          className={cn(
                            "rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs font-medium text-white/72 transition hover:bg-black/35",
                            isWorkbenchFocusLayout && "rounded-none border-0 bg-transparent px-0 py-0 uppercase tracking-[0.16em] text-white/55 hover:text-white"
                          )}
                        >
                          Jump to latest
                        </button>
                      </div>
                    </div>

                    <div className={cn("mb-4 grid gap-3 sm:grid-cols-3", isWorkbenchFocusLayout && "grid-cols-1 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-white/45 sm:grid-cols-1")}>
                      <div className={cn("rounded-[20px] border border-white/10 bg-black/35 px-4 py-3", isWorkbenchFocusLayout && "rounded-none border-0 bg-transparent px-0 py-0")}>
                        <p className="text-[11px] uppercase tracking-[0.16em] text-white/42">Phase</p>
                        <p className="mt-2 text-sm text-white/86">{terminalSession.phase ?? terminalSession.status}</p>
                      </div>
                      <div className={cn("rounded-[20px] border border-white/10 bg-black/35 px-4 py-3", isWorkbenchFocusLayout && "rounded-none border-0 bg-transparent px-0 py-0")}>
                        <p className="text-[11px] uppercase tracking-[0.16em] text-white/42">Return code</p>
                        <p className="mt-2 text-sm text-white/86">
                          {terminalSession.returncode !== null && terminalSession.returncode !== undefined
                            ? terminalSession.returncode
                            : terminalSession.status === "running"
                              ? "Running"
                              : "Pending"}
                        </p>
                      </div>
                      <div className={cn("rounded-[20px] border border-white/10 bg-black/35 px-4 py-3", isWorkbenchFocusLayout && "rounded-none border-0 bg-transparent px-0 py-0")}>
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
                      className={cn("overflow-auto rounded-[20px] border border-white/10 bg-black/45 p-4 font-mono text-xs leading-6 text-white/88", isWorkbenchFocusLayout && "rounded-none border-white/12 bg-black/60")}
                      style={{ maxHeight: workbenchPrimaryViewportHeight ?? "460px" }}
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
                                activateOperatorTab("preview");
                              }}
                              className={cn(
                                "rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs text-white/78 transition hover:bg-white/14",
                                isWorkbenchFocusLayout && "rounded-none border-0 bg-transparent px-0 py-0 uppercase tracking-[0.16em] text-white/55 hover:text-white"
                              )}
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
                  <div
                    className={cn(
                      "border-b border-black/8",
                      isWorkbenchFocusLayout ? "rounded-none border-0 bg-transparent p-0" : "pb-4"
                    )}
                  >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                        <Code2 className="h-4 w-4" />
                        App preview
                      </div>
                      <p className={cn("mt-2 text-sm text-black/[0.58]", isWorkbenchFocusLayout && "max-w-2xl text-[13px] leading-6")}>
                        Generated web pages, reports, screenshots, and other previewable outputs render inline here.
                      </p>
                    </div>
                    {selectedPreviewArtifact && (
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={toolArtifactPreviewHref(data.workspace_id, selectedPreviewArtifact)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.52] transition hover:text-black"
                        >
                          Open preview
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                        <a
                          href={toolArtifactHref(data.workspace_id, selectedPreviewArtifact)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-black/[0.52] transition hover:text-black"
                        >
                          Download
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    )}
                  </div>

                  {availablePreviewArtifacts.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {availablePreviewArtifacts.map((artifact) => (
                        <button
                          key={artifact.storage_key}
                          type="button"
                          onClick={() => setSelectedPreviewStorageKey(artifact.storage_key)}
                          className={cn(
                            "border-b px-0 py-0.5 text-left text-[11px] uppercase tracking-[0.16em] transition",
                            selectedPreviewArtifact?.storage_key === artifact.storage_key
                              ? "border-black text-black"
                              : "border-transparent text-black/[0.45] hover:text-black"
                          )}
                        >
                          {compactText(artifactLabel(artifact), 36)}
                        </button>
                      ))}
                    </div>
                  )}

                    <div
                      className={cn(
                        "mt-4 overflow-hidden border border-black/8 bg-[#f5f0e6]",
                        isWorkbenchFocusLayout && "rounded-none border-black/8 bg-[#f8f5ef]"
                      )}
                    >
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
                          className="w-full bg-white"
                          style={{ height: workbenchPrimaryViewportHeight ?? "560px" }}
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
                    <div className={cn("mt-4 flex flex-wrap gap-2", isWorkbenchFocusLayout && "gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-black/[0.44]")}>
                      <span className="text-[11px] uppercase tracking-[0.16em] text-black/[0.44]">
                        {selectedPreviewArtifact.content_type ?? "artifact"}
                      </span>
                      <span className="text-[11px] uppercase tracking-[0.16em] text-black/[0.44]">
                        {formatBytes(selectedPreviewArtifact.size_bytes)}
                      </span>
                      <span className="text-[11px] uppercase tracking-[0.16em] text-black/[0.44]">
                        {artifactFileName(selectedPreviewArtifact)}
                      </span>
                    </div>
                  )}
                  </div>
                )}

                {operatorTab === "files" && (
                  <div
                    className={cn(
                      "border-b border-black/8",
                      isWorkbenchFocusLayout ? "rounded-none border-0 bg-transparent p-0" : "pb-4"
                    )}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-black/[0.82]">
                      <FolderTree className="h-4 w-4" />
                      Workspace files
                    </div>
                    <p className="mt-2 text-sm text-black/[0.58]">
                      Jump from the live operator surface into the files the coding agent is reading or changing.
                    </p>

                    <div
                      className="mt-4 space-y-2 overflow-y-auto"
                      style={workbenchPrimaryViewportHeight ? { maxHeight: workbenchPrimaryViewportHeight } : undefined}
                    >
                      {rootWorkbenchTree && rootWorkbenchTree.entries.length > 0 ? (
                        rootWorkbenchTree.entries.slice(0, 16).map((entry) => (
                          <button
                            key={entry.relative_path}
                            type="button"
                            onClick={() => {
                              if (entry.kind === "dir") {
                                void toggleWorkbenchDirectory(entry.relative_path);
                                activateOperatorTab("code");
                                return;
                              }
                              void openWorkbenchFile(entry.relative_path);
                            }}
                            className={cn(
                              "flex w-full items-center justify-between gap-3 border-b border-black/8 px-0 py-2.5 text-left text-sm text-black/[0.72] transition hover:text-black",
                              isWorkbenchFocusLayout && "rounded-none border-x-0 border-t-0 border-b-black/8 bg-transparent px-0 hover:bg-transparent"
                            )}
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
                        <div className="border border-dashed border-black/8 px-4 py-8 text-center text-sm text-black/[0.58]">
                          Workspace files will appear here once the workbench tree is loaded.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {showFilesMode && (
                  <div
                    className={cn(
                      "border-b border-black/8",
                      isWorkbenchFocusLayout ? "rounded-none border-0 bg-transparent p-0" : "pb-4"
                    )}
                  >
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
                          className={cn(
                            "w-full border-b border-black/8 px-0 py-2.5 text-left transition hover:text-black",
                            isWorkbenchFocusLayout && "rounded-none border-b border-black/8 bg-transparent px-0 hover:bg-transparent"
                          )}
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
                            <span className="text-[10px] uppercase tracking-[0.12em] text-black/[0.46]">
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
                        <div key={session.session_id} className={cn("border-b border-black/8 px-0 py-2.5", isWorkbenchFocusLayout && "rounded-none border-b border-black/8 bg-transparent px-0")}>
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
                            <span className="text-[10px] uppercase tracking-[0.12em] text-black/[0.46]">
                              {statusLabel(session.status)}
                            </span>
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
                                activateOperatorTab("preview");
                              } else {
                                window.open(toolArtifactHref(data.workspace_id, artifact), "_blank", "noopener,noreferrer");
                              }
                            }}
                            className={cn(
                              "rounded-full border border-black/10 bg-white/80 px-3 py-2 text-xs text-black/[0.72] transition hover:bg-white",
                              isWorkbenchFocusLayout && "rounded-none border-0 bg-transparent px-0 py-0 uppercase tracking-[0.16em] text-black/[0.52] hover:text-black"
                            )}
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

