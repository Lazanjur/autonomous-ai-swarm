import type {
  AdminSearchData,
  Artifact,
  ArtifactPreview,
  AuthProfile,
  Automation,
  ChatAgentsData,
  ChatSearchResponse,
  ChatTaskRailData,
  ChatWorkbenchDiffData,
  ChatWorkbenchFileData,
  ChatWorkbenchFileSaveResponse,
  ChatWorkbenchRepoData,
  ChatWorkbenchTreeData,
  ChatWorkspaceData,
  EnterpriseAdminData,
  EnterpriseAuditBrowseData,
  IntegrationsStatusData,
  KnowledgeDocument,
  KnowledgeHealth,
  LibraryDashboard,
  ModelCapability,
  OpsDashboard,
  ProviderCapability,
  SearchResult,
  TaskTemplateCatalogData
} from "@/lib/types";

const E2E_SESSION_TOKEN = "e2e-session-token";
const DEFAULT_WORKSPACE_ID = "ws-alpha";
const SECONDARY_WORKSPACE_ID = "ws-beta";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function iso(value: string) {
  return new Date(value).toISOString();
}

export function isE2EMockMode() {
  return (
    process.env.E2E_MOCK_MODE === "true" ||
    process.env.NEXT_PUBLIC_E2E_MOCK_MODE === "true"
  );
}

export function getE2ESessionToken() {
  return E2E_SESSION_TOKEN;
}

function resolveWorkspaceId(workspaceId?: string | null) {
  return workspaceId === SECONDARY_WORKSPACE_ID ? SECONDARY_WORKSPACE_ID : DEFAULT_WORKSPACE_ID;
}

function makeProviderCapability(
  key: string,
  label: string,
  family: string,
  configured: boolean
): ProviderCapability {
  return {
    key,
    label,
    family,
    configured,
    supports_chat: true,
    supports_embeddings: key !== "anthropic",
    supports_vision: key !== "mock-local",
    detail: `${label} provider`
  };
}

function makeModelCapability(
  name: string,
  overrides: Partial<ModelCapability> = {}
): ModelCapability {
  return {
    name,
    provider_key: "alibaba",
    provider_label: "Alibaba / Qwen",
    family: "qwen",
    configured: true,
    context_window_tokens: 262144,
    latency_tier: name.includes("flash") ? "fast" : "balanced",
    supports_chat: true,
    supports_embeddings: false,
    supports_vision: name.includes("vl"),
    supports_reasoning: true,
    supports_structured_output: true,
    supports_planning: !name.includes("coder"),
    supports_research: !name.includes("coder"),
    supports_coding: name.includes("coder"),
    supports_ui_diagrams: name.includes("vl") || !name.includes("coder"),
    specialties: name.includes("coder") ? ["coding"] : ["general"],
    notes: [],
    ...overrides
  };
}

const defaultProviders: ProviderCapability[] = [
  makeProviderCapability("alibaba", "Alibaba / Qwen", "qwen", true),
  makeProviderCapability("openai", "OpenAI", "gpt", false),
  makeProviderCapability("anthropic", "Anthropic", "claude", false),
  makeProviderCapability("gemini", "Google Gemini", "gemini", false),
  makeProviderCapability("mock-local", "Local Fallback", "fallback", true)
];

const defaultModelCatalog: ModelCapability[] = [
  makeModelCapability("qwen3.5-flash", { specialties: ["general", "planning", "research"] }),
  makeModelCapability("qwen3-max", {
    latency_tier: "deliberate",
    specialties: ["analysis", "synthesis"]
  }),
  makeModelCapability("qwen3-coder-flash", { specialties: ["coding", "debugging"] }),
  makeModelCapability("qwen3-coder-plus", { specialties: ["coding", "architecture"] }),
  makeModelCapability("qwen3-vl-flash", {
    supports_vision: true,
    specialties: ["vision", "browser", "ui"]
  }),
  makeModelCapability("qwen3-vl-plus", {
    latency_tier: "balanced",
    supports_vision: true,
    specialties: ["vision", "browser", "ui"]
  })
];

const mockSession: AuthProfile = {
  user: {
    id: "user-e2e",
    email: "operator@swarm.e2e",
    full_name: "E2E Operator",
    role: "owner",
    is_active: true
  },
  workspaces: [
    {
      workspace_id: DEFAULT_WORKSPACE_ID,
      workspace_name: "Executive Launch Workspace",
      workspace_slug: "executive-launch",
      role: "owner"
    },
    {
      workspace_id: SECONDARY_WORKSPACE_ID,
      workspace_name: "Operations Sandbox",
      workspace_slug: "ops-sandbox",
      role: "admin"
    }
  ]
};

const taskRailByWorkspace: Record<string, ChatTaskRailData> = {
  [DEFAULT_WORKSPACE_ID]: {
    workspace_id: DEFAULT_WORKSPACE_ID,
    projects: [
      {
        id: "proj-launch",
        workspace_id: DEFAULT_WORKSPACE_ID,
        name: "Website Launch",
        description: "Coordinate product messaging, implementation, and deployment readiness.",
        status: "active",
        metadata: { owner: "growth" },
        created_at: iso("2026-04-10T08:00:00Z"),
        updated_at: iso("2026-04-13T09:10:00Z"),
        thread_count: 2,
        last_activity_at: iso("2026-04-13T09:10:00Z")
      },
      {
        id: "proj-research",
        workspace_id: DEFAULT_WORKSPACE_ID,
        name: "Market Research",
        description: "Ground new growth decisions with current competitor and pricing intelligence.",
        status: "active",
        metadata: { owner: "research" },
        created_at: iso("2026-04-09T07:00:00Z"),
        updated_at: iso("2026-04-12T14:20:00Z"),
        thread_count: 1,
        last_activity_at: iso("2026-04-12T14:20:00Z")
      }
    ],
    threads: [
      {
        id: "thread-launch-site",
        workspace_id: DEFAULT_WORKSPACE_ID,
        project_id: "proj-launch",
        title: "Deploy Website After Saving All Files",
        status: "active",
        metadata: {
          model_profile: "qwen3-coder-plus",
          selected_template_key: "deploy-website"
        },
        created_at: iso("2026-04-12T09:00:00Z"),
        updated_at: iso("2026-04-13T09:12:00Z"),
        message_count: 4,
        run_count: 2,
        last_message_preview: "The deployment checklist is synced and the workbench is ready for final verification.",
        last_activity_at: iso("2026-04-13T09:12:00Z")
      },
      {
        id: "thread-launch-audit",
        workspace_id: DEFAULT_WORKSPACE_ID,
        project_id: "proj-launch",
        title: "Launch Readiness Audit",
        status: "paused",
        metadata: {
          model_profile: "qwen3.6-plus"
        },
        created_at: iso("2026-04-11T12:00:00Z"),
        updated_at: iso("2026-04-12T13:00:00Z"),
        message_count: 3,
        run_count: 1,
        last_message_preview: "Waiting for approval to execute the final webhook delivery.",
        last_activity_at: iso("2026-04-12T13:00:00Z")
      },
      {
        id: "thread-market-map",
        workspace_id: DEFAULT_WORKSPACE_ID,
        project_id: "proj-research",
        title: "Competitor Pricing Map",
        status: "completed",
        metadata: {
          model_profile: "qwen3.6-plus",
          selected_template_key: "research-landscape"
        },
        created_at: iso("2026-04-10T16:00:00Z"),
        updated_at: iso("2026-04-12T14:20:00Z"),
        message_count: 5,
        run_count: 1,
        last_message_preview: "Pricing intelligence is grounded with citations and reusable artifacts.",
        last_activity_at: iso("2026-04-12T14:20:00Z")
      }
    ]
  },
  [SECONDARY_WORKSPACE_ID]: {
    workspace_id: SECONDARY_WORKSPACE_ID,
    projects: [
      {
        id: "proj-ops",
        workspace_id: SECONDARY_WORKSPACE_ID,
        name: "Operations Readiness",
        description: "Internal sandbox for resilience and workflow testing.",
        status: "active",
        metadata: {},
        created_at: iso("2026-04-08T09:00:00Z"),
        updated_at: iso("2026-04-12T08:30:00Z"),
        thread_count: 1,
        last_activity_at: iso("2026-04-12T08:30:00Z")
      }
    ],
    threads: [
      {
        id: "thread-ops-drill",
        workspace_id: SECONDARY_WORKSPACE_ID,
        project_id: "proj-ops",
        title: "Run Incident Drill",
        status: "active",
        metadata: {
          model_profile: "qwen3-max"
        },
        created_at: iso("2026-04-12T07:30:00Z"),
        updated_at: iso("2026-04-12T08:30:00Z"),
        message_count: 2,
        run_count: 1,
        last_message_preview: "The sandbox captured the drill timeline and recommended follow-up actions.",
        last_activity_at: iso("2026-04-12T08:30:00Z")
      }
    ]
  }
};

const chatWorkspaceByWorkspace: Record<string, ChatWorkspaceData> = {
  [DEFAULT_WORKSPACE_ID]: {
    workspace_id: DEFAULT_WORKSPACE_ID,
    selected_thread_id: "thread-launch-site",
    selected_project: {
      id: "proj-launch",
      workspace_id: DEFAULT_WORKSPACE_ID,
      name: "Website Launch",
      description: "Coordinate product messaging, implementation, and deployment readiness.",
      status: "active",
      metadata: {},
      created_at: iso("2026-04-10T08:00:00Z"),
      updated_at: iso("2026-04-13T09:10:00Z")
    },
    task_memory: {
      summary: "The team is focused on a launch-ready site, deployment proof, and follow-up deliverables.",
      findings: [
        "The code workbench already contains a deployment TODO and a verified README walkthrough."
      ],
      risks: ["Publishing should wait for the final production verification pass."],
      open_questions: ["Whether to gate publish behind a final smoke test artifact."],
      recent_requests: ["Verify the launch workflow and prepare the production rollout."],
      recent_summaries: ["Implementation surface is ready for final verification."],
      focus_areas: ["Deployment", "QA", "Delivery"],
      agent_memory: [
        {
          agent: "coding",
          summary: "Repo state is clean enough for a final edit-and-review pass.",
          confidence: 0.84
        }
      ],
      run_count: 2,
      last_updated_at: iso("2026-04-13T09:12:00Z"),
      source_run_id: "run-launch-2",
      source_thread_id: "thread-launch-site"
    },
    project_memory: {
      summary: "Launch workstreams connect messaging, code, deployment, and final artifact review.",
      findings: ["The launch project is the most active execution stream in this workspace."],
      risks: ["Any deployment blocker should pause publish until resolved."],
      open_questions: ["Whether to automate the final smoke test run."],
      recent_requests: ["Turn the dashboard into a tighter operating system."],
      recent_summaries: ["The workflow cockpit is now linked to the operator pane."],
      focus_areas: ["Execution", "Observability", "Deliverables"],
      agent_memory: [
        {
          agent: "supervisor",
          summary: "Keep coding, browser, and artifact views aligned during launch work.",
          confidence: 0.9
        }
      ],
      run_count: 4,
      last_updated_at: iso("2026-04-13T09:12:00Z"),
      source_run_id: "run-launch-2",
      source_thread_id: "thread-launch-site"
    },
    threads: clone(taskRailByWorkspace[DEFAULT_WORKSPACE_ID].threads),
    messages: [
      {
        id: "msg-launch-user-1",
        thread_id: "thread-launch-site",
        run_id: "run-launch-2",
        role: "user",
        content: "Verify the launch workflow and prepare the production rollout.",
        citations: [],
        metadata: {},
        created_at: iso("2026-04-13T09:00:00Z")
      },
      {
        id: "msg-launch-assistant-1",
        thread_id: "thread-launch-site",
        run_id: "run-launch-2",
        role: "assistant",
        content:
          "The launch workflow is in good shape. The remaining action is the final production verification pass, and the evidence is grounded in the linked rollout checklist [S1] and deployment artifact [S2].",
        citations: [
          {
            reference_id: "S1",
            title: "Launch checklist",
            kind: "document",
            source_type: "upload",
            excerpt: "A synchronized checklist for the production launch workflow.",
            document_id: "doc-launch-checklist",
            relative_path: "todo.md"
          },
          {
            reference_id: "S2",
            title: "Deployment summary",
            kind: "artifact",
            source_type: "generated",
            excerpt: "Generated summary of the production deployment plan.",
            document_id: null,
            relative_path: "artifacts/deployment-summary.md"
          }
        ],
        metadata: {},
        created_at: iso("2026-04-13T09:04:00Z")
      }
    ],
    runs: [
      {
        id: "run-launch-2",
        thread_id: "thread-launch-site",
        workspace_id: DEFAULT_WORKSPACE_ID,
        status: "completed",
        supervisor_model: "qwen3.5-flash",
        user_message: "Verify the launch workflow and prepare the production rollout.",
        final_response:
          "Verification completed. The rollout is blocked only on the final smoke test and production publish confirmation.",
        summary: "Launch rollout is ready pending final smoke-test confirmation.",
        plan: [
          {
            key: "step-1",
            objective: "Inspect the current repo and launch checklist",
            reason: "Ground the final recommendation in the current workbench and checklist state.",
            dependencies: [],
            expected_output: "Current launch posture",
            execution_mode: "parallel",
            priority: 1,
            plan_index: 0
          },
          {
            key: "step-2",
            objective: "Summarize final readiness and next actions",
            reason: "Provide an operator-ready conclusion and linked deliverables.",
            dependencies: ["step-1"],
            expected_output: "Launch summary",
            execution_mode: "sequential",
            priority: 2,
            plan_index: 1
          }
        ],
        created_at: iso("2026-04-13T09:01:00Z")
      }
    ],
    run_steps: [
      {
        id: "run-step-1",
        run_id: "run-launch-2",
        agent_name: "Coding Agent",
        step_index: 0,
        status: "completed",
        confidence: 0.84,
        input_payload: {
          objective: "Inspect repo state and checklist"
        },
        output_payload: {
          summary: "Workbench state and checklist are ready for a final verification pass."
        },
        created_at: iso("2026-04-13T09:02:00Z")
      },
      {
        id: "run-step-2",
        run_id: "run-launch-2",
        agent_name: "Content Agent",
        step_index: 1,
        status: "completed",
        confidence: 0.88,
        input_payload: {
          objective: "Summarize readiness"
        },
        output_payload: {
          summary: "The workflow cockpit and deliverables are aligned for rollout."
        },
        created_at: iso("2026-04-13T09:03:00Z")
      }
    ],
    tool_calls: [
      {
        id: "tool-call-1",
        run_step_id: "run-step-1",
        tool_name: "workspace_files",
        status: "completed",
        input_payload: {
          operation: "read_text",
          relative_path: "README.md"
        },
        output_payload: {
          relative_path: "README.md",
          summary: "Loaded the repository overview for the launch task."
        },
        created_at: iso("2026-04-13T09:02:10Z")
      },
      {
        id: "tool-call-2",
        run_step_id: "run-step-1",
        tool_name: "browser",
        status: "completed",
        input_payload: {
          target_url: "https://example.com/launch-check"
        },
        output_payload: {
          summary: "Captured a launch verification snapshot."
        },
        created_at: iso("2026-04-13T09:02:30Z")
      }
    ]
  },
  [SECONDARY_WORKSPACE_ID]: {
    workspace_id: SECONDARY_WORKSPACE_ID,
    selected_thread_id: "thread-ops-drill",
    selected_project: {
      id: "proj-ops",
      workspace_id: SECONDARY_WORKSPACE_ID,
      name: "Operations Readiness",
      description: "Internal sandbox for resilience and workflow testing.",
      status: "active",
      metadata: {},
      created_at: iso("2026-04-08T09:00:00Z"),
      updated_at: iso("2026-04-12T08:30:00Z")
    },
    task_memory: {
      summary: "Operations workspace is used for reliability drills.",
      findings: ["The drill thread is isolated from the launch workspace."],
      risks: [],
      open_questions: [],
      recent_requests: ["Run an incident drill."],
      recent_summaries: ["Sandbox captured the drill timeline."],
      focus_areas: ["Resilience"],
      agent_memory: [],
      run_count: 1,
      last_updated_at: iso("2026-04-12T08:30:00Z"),
      source_run_id: "run-ops-1",
      source_thread_id: "thread-ops-drill"
    },
    project_memory: null,
    threads: clone(taskRailByWorkspace[SECONDARY_WORKSPACE_ID].threads),
    messages: [
      {
        id: "msg-ops-user-1",
        thread_id: "thread-ops-drill",
        run_id: "run-ops-1",
        role: "user",
        content: "Run the incident drill and capture the outcome.",
        citations: [],
        metadata: {},
        created_at: iso("2026-04-12T08:00:00Z")
      }
    ],
    runs: [
      {
        id: "run-ops-1",
        thread_id: "thread-ops-drill",
        workspace_id: SECONDARY_WORKSPACE_ID,
        status: "completed",
        supervisor_model: "qwen3.5-flash",
        user_message: "Run the incident drill and capture the outcome.",
        final_response: "The drill completed and the follow-up actions are stored in the sandbox artifacts.",
        summary: "Ops drill completed successfully.",
        plan: [],
        created_at: iso("2026-04-12T08:10:00Z")
      }
    ],
    run_steps: [],
    tool_calls: []
  }
};

const taskTemplateCatalogByWorkspace: Record<string, TaskTemplateCatalogData> = {
  [DEFAULT_WORKSPACE_ID]: {
    workspace_id: DEFAULT_WORKSPACE_ID,
    templates: [
      {
        key: "deploy-website",
        name: "Deploy Website",
        category: "computer",
        summary: "Verify code, checklist, and rollout posture before publishing.",
        description: "Use the code workbench, checklist sync, and operator surface to prepare a production deployment.",
        tags: ["deploy", "website", "launch"],
        capabilities: ["code", "preview", "artifacts"],
        recommended_operator_tab: "code",
        requires_approval: true,
        chat_defaults: {
          thread_title: "Deploy Website After Saving All Files",
          prompt: "Inspect the repo, verify the launch checklist, and prepare the final deployment summary.",
          model_profile: "qwen3-coder-plus",
          use_retrieval: true,
          suggested_steps: [
            "Inspect the repo state",
            "Sync the task checklist",
            "Summarize deployment readiness"
          ]
        },
        automation_defaults: {
          name: "Website Deploy Check",
          description: "Recurring launch readiness verification",
          prompt: "Inspect the repo and confirm deployment readiness.",
          schedule_hint: "Before major publishes",
          timezone: "Europe/Zagreb",
          use_retrieval: true,
          requires_approval: true,
          retry_limit: 2,
          timeout_seconds: 900,
          notify_on: ["approval_requested", "completed"],
          steps: ["Check repo", "Check artifacts", "Report readiness"]
        }
      }
    ]
  },
  [SECONDARY_WORKSPACE_ID]: {
    workspace_id: SECONDARY_WORKSPACE_ID,
    templates: []
  }
};

const workbenchTreesByWorkspace: Record<string, Record<string, ChatWorkbenchTreeData>> = {
  [DEFAULT_WORKSPACE_ID]: {
    ".": {
      workspace_id: DEFAULT_WORKSPACE_ID,
      root_label: "Launch Workspace",
      relative_path: ".",
      parent_relative_path: null,
      entries: [
        { name: "README.md", relative_path: "README.md", kind: "file", extension: ".md", size_bytes: 1200 },
        { name: "todo.md", relative_path: "todo.md", kind: "file", extension: ".md", size_bytes: 980 },
        { name: "apps", relative_path: "apps", kind: "dir" },
        { name: "package.json", relative_path: "package.json", kind: "file", extension: ".json", size_bytes: 320 }
      ]
    },
    apps: {
      workspace_id: DEFAULT_WORKSPACE_ID,
      root_label: "Launch Workspace",
      relative_path: "apps",
      parent_relative_path: ".",
      entries: [{ name: "web", relative_path: "apps/web", kind: "dir" }]
    },
    "apps/web": {
      workspace_id: DEFAULT_WORKSPACE_ID,
      root_label: "Launch Workspace",
      relative_path: "apps/web",
      parent_relative_path: "apps",
      entries: [
        { name: "package.json", relative_path: "apps/web/package.json", kind: "file", extension: ".json", size_bytes: 480 }
      ]
    }
  },
  [SECONDARY_WORKSPACE_ID]: {
    ".": {
      workspace_id: SECONDARY_WORKSPACE_ID,
      root_label: "Operations Sandbox",
      relative_path: ".",
      parent_relative_path: null,
      entries: [{ name: "README.md", relative_path: "README.md", kind: "file", extension: ".md", size_bytes: 640 }]
    }
  }
};

const workbenchFilesByWorkspace: Record<string, Record<string, ChatWorkbenchFileData>> = {
  [DEFAULT_WORKSPACE_ID]: {
      "README.md": {
        workspace_id: DEFAULT_WORKSPACE_ID,
        root_label: "Launch Workspace",
        relative_path: "README.md",
        name: "README.md",
        extension: ".md",
        size_bytes: 1200,
        truncated: false,
        related_files: [],
        content: [
        "# Autonomous AI Swarm",
        "",
        "## Launch Workspace",
        "",
        "- Workflow Cockpit is tied to the operator pane.",
        "- Task continuity spans checklist, code workbench, and artifacts.",
        "- Final publish remains gated behind the last verification pass."
      ].join("\n")
    },
      "todo.md": {
        workspace_id: DEFAULT_WORKSPACE_ID,
        root_label: "Launch Workspace",
        relative_path: "todo.md",
        name: "todo.md",
        extension: ".md",
        size_bytes: 980,
        truncated: false,
        related_files: [],
        content: [
        "# Launch Checklist",
        "",
        "- [x] Tighten the workspace shell",
        "- [x] Add a project-aware task rail",
        "- [ ] Run the final production verification pass"
      ].join("\n")
    },
      "package.json": {
        workspace_id: DEFAULT_WORKSPACE_ID,
        root_label: "Launch Workspace",
        relative_path: "package.json",
        name: "package.json",
        extension: ".json",
        size_bytes: 320,
        truncated: false,
        related_files: [],
        content: JSON.stringify(
        {
          name: "launch-workspace",
          private: true,
          scripts: {
            build: "next build",
            verify: "npm run build && npm run test:e2e"
          }
        },
        null,
        2
      )
    },
      "apps/web/package.json": {
        workspace_id: DEFAULT_WORKSPACE_ID,
        root_label: "Launch Workspace",
        relative_path: "apps/web/package.json",
        name: "package.json",
        extension: ".json",
        size_bytes: 480,
        truncated: false,
        related_files: [],
        content: JSON.stringify(
        {
          name: "web",
          scripts: {
            dev: "next dev",
            build: "next build"
          }
        },
        null,
        2
      )
    }
  },
  [SECONDARY_WORKSPACE_ID]: {
      "README.md": {
        workspace_id: SECONDARY_WORKSPACE_ID,
        root_label: "Operations Sandbox",
        relative_path: "README.md",
        name: "README.md",
        extension: ".md",
        size_bytes: 640,
        truncated: false,
        related_files: [],
        content: "# Operations Sandbox\n\nThis workspace is used for workflow and resilience drills."
      }
  }
};

const workbenchRepoByWorkspace: Record<string, ChatWorkbenchRepoData> = {
  [DEFAULT_WORKSPACE_ID]: {
    workspace_id: DEFAULT_WORKSPACE_ID,
    is_repo: true,
    root_label: "Launch Workspace",
    branch: "main",
    head: "e2e1234",
    dirty: true,
    summary: "2 modified files and 1 checklist update ready for review.",
    changed_files: [
      {
        relative_path: "README.md",
        display_path: "README.md",
        status: "modified",
        staged_status: null,
        unstaged_status: "M",
        is_untracked: false
      },
      {
        relative_path: "todo.md",
        display_path: "todo.md",
        status: "modified",
        staged_status: null,
        unstaged_status: "M",
        is_untracked: false
      }
    ],
    staged_count: 0,
    unstaged_count: 2,
    untracked_count: 0
  },
  [SECONDARY_WORKSPACE_ID]: {
    workspace_id: SECONDARY_WORKSPACE_ID,
    is_repo: false,
    root_label: "Operations Sandbox",
    branch: null,
    head: null,
    dirty: false,
    summary: "This sandbox is not tied to a repository.",
    changed_files: [],
    staged_count: 0,
    unstaged_count: 0,
    untracked_count: 0
  }
};

const knowledgeDocumentsByWorkspace: Record<string, KnowledgeDocument[]> = {
  [DEFAULT_WORKSPACE_ID]: [
    {
      id: "doc-launch-checklist",
      workspace_id: DEFAULT_WORKSPACE_ID,
      title: "Launch checklist",
      source_type: "upload",
      source_uri: null,
      mime_type: "text/markdown",
      status: "indexed",
      content_text: "Launch checklist synced from the workflow cockpit.",
      metadata: { tags: ["launch", "checklist"] },
      created_at: iso("2026-04-12T10:00:00Z")
    }
  ],
  [SECONDARY_WORKSPACE_ID]: []
};

const artifactsByWorkspace: Record<string, Artifact[]> = {
  [DEFAULT_WORKSPACE_ID]: [
    {
      id: "artifact-deploy-summary",
      run_id: "run-launch-2",
      document_id: null,
      workspace_id: DEFAULT_WORKSPACE_ID,
      kind: "report",
      title: "Deployment summary",
      storage_key: "artifacts/deployment-summary.md",
      metadata: {
        mime_type: "text/markdown",
        size_bytes: 2048
      },
      created_at: iso("2026-04-13T09:05:00Z")
    },
    {
      id: "artifact-browser-shot",
      run_id: "run-launch-2",
      document_id: null,
      workspace_id: DEFAULT_WORKSPACE_ID,
      kind: "screenshot",
      title: "Launch verification capture",
      storage_key: "artifacts/browser-capture.png",
      metadata: {
        mime_type: "image/png",
        size_bytes: 4096
      },
      created_at: iso("2026-04-13T09:02:40Z")
    }
  ],
  [SECONDARY_WORKSPACE_ID]: []
};

const artifactPreviewById: Record<string, ArtifactPreview> = {
  "artifact-deploy-summary": {
    artifact_id: "artifact-deploy-summary",
    workspace_id: DEFAULT_WORKSPACE_ID,
    title: "Deployment summary",
    kind: "report",
    mime_type: "text/markdown",
    preview_kind: "text",
    inline_supported: true,
    text_content: "Deployment summary: final smoke test pending before publish.",
    page_summaries: [],
    table: null,
    sheets: [],
    slides: [],
    metadata: {},
    warnings: [],
    size_bytes: 2048
  },
  "artifact-browser-shot": {
    artifact_id: "artifact-browser-shot",
    workspace_id: DEFAULT_WORKSPACE_ID,
    title: "Launch verification capture",
    kind: "screenshot",
    mime_type: "image/png",
    preview_kind: "image",
    inline_supported: true,
    text_content: null,
    page_summaries: [],
    table: null,
    sheets: [],
    slides: [],
    metadata: {
      preview_url: "/e2e/browser-capture.png"
    },
    warnings: [],
    size_bytes: 4096
  }
};

const libraryDashboardByWorkspace: Record<string, LibraryDashboard> = {
  [DEFAULT_WORKSPACE_ID]: {
    workspace_id: DEFAULT_WORKSPACE_ID,
    stats: {
      total_items: 3,
      total_documents: 1,
      total_artifacts: 2,
      pinned_items: 2,
      reusable_items: 1,
      collection_count: 2,
      tagged_items: 3,
      unfiled_items: 0
    },
    collections: [
      {
        name: "launch shelf",
        item_count: 2,
        document_count: 1,
        artifact_count: 1,
        pinned_count: 1,
        reusable_count: 1,
        recent_titles: ["Launch checklist", "Deployment summary"]
      },
      {
        name: "browser captures",
        item_count: 1,
        document_count: 0,
        artifact_count: 1,
        pinned_count: 1,
        reusable_count: 0,
        recent_titles: ["Launch verification capture"]
      }
    ],
    top_tags: [
      { tag: "launch", count: 3 },
      { tag: "canonical", count: 1 }
    ],
    items: [
      {
        id: "library-doc-launch",
        item_type: "document",
        workspace_id: DEFAULT_WORKSPACE_ID,
        title: "Launch checklist",
        subtitle: "Workflow-backed deployment checklist",
        status: "indexed",
        kind: "document",
        mime_type: "text/markdown",
        source_uri: null,
        storage_key: null,
        document_id: "doc-launch-checklist",
        artifact_id: null,
        linked_document_id: null,
        linked_document_title: null,
        tags: ["launch", "checklist"],
        collections: ["launch shelf"],
        pinned: true,
        reusable: false,
        note: "Canonical launch checklist for the operator cockpit.",
        preview_text: "Checklist synced from the task workflow and ready for reuse.",
        metadata: {},
        created_at: iso("2026-04-12T10:00:00Z"),
        updated_at: iso("2026-04-13T09:00:00Z")
      },
      {
        id: "library-artifact-summary",
        item_type: "artifact",
        workspace_id: DEFAULT_WORKSPACE_ID,
        title: "Deployment summary",
        subtitle: "Generated launch report",
        status: "ready",
        kind: "report",
        mime_type: "text/markdown",
        source_uri: null,
        storage_key: "artifacts/deployment-summary.md",
        document_id: null,
        artifact_id: "artifact-deploy-summary",
        linked_document_id: "doc-launch-checklist",
        linked_document_title: "Launch checklist",
        tags: ["launch", "canonical"],
        collections: ["launch shelf"],
        pinned: false,
        reusable: true,
        note: "Use this as the base for publish approvals.",
        preview_text: "Final deployment summary with remaining verification callout.",
        metadata: {},
        created_at: iso("2026-04-13T09:05:00Z"),
        updated_at: iso("2026-04-13T09:06:00Z")
      },
      {
        id: "library-artifact-shot",
        item_type: "artifact",
        workspace_id: DEFAULT_WORKSPACE_ID,
        title: "Launch verification capture",
        subtitle: "Browser proof artifact",
        status: "ready",
        kind: "screenshot",
        mime_type: "image/png",
        source_uri: null,
        storage_key: "artifacts/browser-capture.png",
        document_id: null,
        artifact_id: "artifact-browser-shot",
        linked_document_id: null,
        linked_document_title: null,
        tags: ["launch", "browser"],
        collections: ["browser captures"],
        pinned: true,
        reusable: false,
        note: "Useful for share and publish workflows.",
        preview_text: "Browser snapshot captured during the final launch check.",
        metadata: {},
        created_at: iso("2026-04-13T09:02:40Z"),
        updated_at: iso("2026-04-13T09:02:40Z")
      }
    ]
  },
  [SECONDARY_WORKSPACE_ID]: {
    workspace_id: SECONDARY_WORKSPACE_ID,
    stats: {
      total_items: 0,
      total_documents: 0,
      total_artifacts: 0,
      pinned_items: 0,
      reusable_items: 0,
      collection_count: 0,
      tagged_items: 0,
      unfiled_items: 0
    },
    collections: [],
    top_tags: [],
    items: []
  }
};

const knowledgeHealthByWorkspace: Record<string, KnowledgeHealth> = {
  [DEFAULT_WORKSPACE_ID]: {
    workspace_id: DEFAULT_WORKSPACE_ID,
    total_documents: 1,
    indexed_documents: 1,
    duplicate_documents: 0,
    total_chunks: 8,
    embedded_chunks: 8,
    embedding_coverage: 1,
    average_trust_score: 0.92,
    status_breakdown: {
      indexed: 1
    },
    source_type_breakdown: {
      upload: 1
    },
    top_tags: [{ tag: "launch", count: 1 }],
    duplicate_groups: 0,
    untagged_documents: 0,
    latest_document_at: iso("2026-04-12T10:00:00Z")
  },
  [SECONDARY_WORKSPACE_ID]: {
    workspace_id: SECONDARY_WORKSPACE_ID,
    total_documents: 0,
    indexed_documents: 0,
    duplicate_documents: 0,
    total_chunks: 0,
    embedded_chunks: 0,
    embedding_coverage: 0,
    average_trust_score: 0,
    status_breakdown: {},
    source_type_breakdown: {},
    top_tags: [],
    duplicate_groups: 0,
    untagged_documents: 0,
    latest_document_at: null
  }
};

const automationsByWorkspace: Record<string, Automation[]> = {
  [DEFAULT_WORKSPACE_ID]: [
    {
      id: "automation-launch-check",
      workspace_id: DEFAULT_WORKSPACE_ID,
      name: "Launch Verification Pulse",
      description: "Run a pre-publish readiness sweep.",
      schedule: "Weekdays at 09:00",
      status: "active",
      definition: {
        prompt: "Inspect the launch workspace and summarize anything blocking publish.",
        template_key: "deploy-website",
        target_thread_id: "thread-launch-site",
        timezone: "Europe/Zagreb",
        use_retrieval: true,
        requires_approval: true,
        retry_limit: 2,
        timeout_seconds: 900,
        notify_channels: ["slack"],
        notify_on: ["approval_requested", "failed"],
        steps: ["Inspect repo", "Check artifacts", "Summarize blockers"]
      },
      last_run_at: iso("2026-04-13T08:00:00Z"),
      next_run_at: iso("2026-04-14T08:00:00Z"),
      created_at: iso("2026-04-10T08:30:00Z")
    }
  ],
  [SECONDARY_WORKSPACE_ID]: []
};

const agentsByWorkspace: Record<string, ChatAgentsData> = {
  [DEFAULT_WORKSPACE_ID]: {
    workspace_id: DEFAULT_WORKSPACE_ID,
    supervisor_model: "qwen3.5-flash",
    planner_model: "qwen3-max",
    supervisor_model_details: makeModelCapability("qwen3.5-flash", {
      specialties: ["general", "planning", "research"]
    }),
    planner_model_details: makeModelCapability("qwen3-max", {
      latency_tier: "deliberate",
      specialties: ["analysis", "synthesis"]
    }),
    overview: {
      total_agents: 7,
      configured_provider_count: 1,
      active_agents_24h: 4,
      busy_agents: 2,
      idle_agents: 3,
      total_steps: 12,
      total_tool_calls: 9,
      escalation_count: 1,
      average_confidence: 0.82,
      activity_window_hours: 24,
      last_activity_at: iso("2026-04-13T09:03:00Z")
    },
    providers: defaultProviders,
    model_catalog: defaultModelCatalog,
    agents: [
      {
        key: "coding",
        name: "Coding Agent",
        fast_model: "qwen3-coder-flash",
        slow_model: "qwen3-coder-plus",
        fast_model_details: makeModelCapability("qwen3-coder-flash", {
          specialties: ["coding", "debugging"]
        }),
        slow_model_details: makeModelCapability("qwen3-coder-plus", {
          specialties: ["coding", "architecture"]
        }),
        specialties: ["implementation", "refactor", "verification"],
        tools: [
          { name: "workspace_files", description: "Browse and update code files" },
          { name: "sandbox", description: "Run code in a sandbox" }
        ],
        health_state: "live",
        workload_score: 82,
        step_count: 6,
        recent_step_count: 3,
        average_confidence: 0.84,
        escalation_count: 0,
        tool_call_count: 5,
        active_thread_count: 2,
        active_project_count: 1,
        last_active_at: iso("2026-04-13T09:02:00Z"),
        last_status: "completed",
        last_model: "qwen3-coder-plus",
        last_provider: "alibaba",
        recent_tools: ["workspace_files", "sandbox"],
        status_breakdown: { completed: 5, running: 1 },
        recent_summaries: ["Verified the launch workbench and checklist."],
        recent_steps: [
          {
            run_step_id: "run-step-1",
            run_id: "run-launch-2",
            thread_id: "thread-launch-site",
            thread_title: "Deploy Website After Saving All Files",
            project_id: "proj-launch",
            agent_key: "coding",
            agent_name: "Coding Agent",
            status: "completed",
            confidence: 0.84,
            summary: "Verified repo readiness and checklist state.",
            validation_summary: "Grounded in workbench and task state.",
            model: "qwen3-coder-plus",
            provider: "alibaba",
            tools: ["workspace_files", "browser"],
            created_at: iso("2026-04-13T09:02:00Z")
          }
        ]
      }
    ],
    recent_activity: [
      {
        run_step_id: "run-step-1",
        run_id: "run-launch-2",
        thread_id: "thread-launch-site",
        thread_title: "Deploy Website After Saving All Files",
        project_id: "proj-launch",
        agent_key: "coding",
        agent_name: "Coding Agent",
        status: "completed",
        confidence: 0.84,
        summary: "Verified repo readiness and checklist state.",
        validation_summary: "Grounded in workbench and task state.",
        model: "qwen3-coder-plus",
        provider: "alibaba",
        tools: ["workspace_files", "browser"],
        created_at: iso("2026-04-13T09:02:00Z")
      }
    ]
  },
  [SECONDARY_WORKSPACE_ID]: {
    workspace_id: SECONDARY_WORKSPACE_ID,
    supervisor_model: "qwen3.5-flash",
    planner_model: "qwen3-max",
    supervisor_model_details: makeModelCapability("qwen3.5-flash", {
      specialties: ["general", "planning", "research"]
    }),
    planner_model_details: makeModelCapability("qwen3-max", {
      latency_tier: "deliberate",
      specialties: ["analysis", "synthesis"]
    }),
    overview: {
      total_agents: 7,
      configured_provider_count: 1,
      active_agents_24h: 1,
      busy_agents: 1,
      idle_agents: 6,
      total_steps: 1,
      total_tool_calls: 1,
      escalation_count: 0,
      average_confidence: 0.78,
      activity_window_hours: 24,
      last_activity_at: iso("2026-04-12T08:30:00Z")
    },
    providers: defaultProviders,
    model_catalog: defaultModelCatalog,
    agents: [],
    recent_activity: []
  }
};

const opsDashboardByWorkspace: Record<string, OpsDashboard> = {
  [DEFAULT_WORKSPACE_ID]: {
    generated_at: iso("2026-04-13T09:15:00Z"),
    scope: {
      workspace_id: DEFAULT_WORKSPACE_ID
    },
    health: {
      status: "healthy",
      models_configured: true,
      configured_providers: ["alibaba"],
      database_ok: true,
      rate_limiting_enabled: true,
      provider_budget_enforced: true
    },
    request_metrics: {
      total_requests: 128,
      rate_limited_requests: 0,
      status_breakdown: { "200": 120, "401": 8 },
      recent_requests: [
        {
          request_id: "req-1",
          method: "GET",
          path: "/api/v1/chat/workspace",
          status_code: 200,
          duration_ms: 48,
          client_ip: "127.0.0.1",
          timestamp: iso("2026-04-13T09:14:00Z")
        }
      ]
    },
    provider_usage: {
      total_cost_usd_24h: 2.42,
      total_prompt_tokens_24h: 18000,
      total_completion_tokens_24h: 9400,
      by_model: [
        {
          model_name: "qwen3.5-flash",
          provider_name: "alibaba",
          request_count: 12,
          prompt_tokens: 12000,
          completion_tokens: 6200,
          estimated_cost: 1.24
        }
      ],
      recent_provider_events: [
        {
          provider: "alibaba",
          model: "qwen3-coder-plus",
          operation: "chat.completions",
          latency_ms: 820,
          fallback: false,
          guardrail_reason: null,
          request_id: "req-1",
          workspace_id: DEFAULT_WORKSPACE_ID,
          timestamp: iso("2026-04-13T09:13:00Z")
        }
      ]
    },
    budget: {
      cap_usd: 25,
      current_spend_usd: 2.42,
      remaining_usd: 22.58,
      utilization: 0.0968,
      window_started_at: iso("2026-04-01T00:00:00Z"),
      enforced: true
    },
    automations: {
      active_automations: 1,
      awaiting_approval: 1,
      failed_executions_24h: 0
    },
    approvals: {
      pending_items: 1,
      blocked_actions: 0,
      recent_sensitive_actions: [
        {
          action: "publish",
          outcome: "approval_requested",
          reason: "Final smoke test pending.",
          request_id: "req-approval-1",
          workspace_id: DEFAULT_WORKSPACE_ID,
          timestamp: iso("2026-04-13T09:05:00Z")
        }
      ]
    },
    audit: {
      recent_audits: [
        {
          id: "audit-1",
          created_at: iso("2026-04-13T09:05:00Z"),
          action: "thread.publish_requested",
          resource_type: "thread",
          resource_id: "thread-launch-site",
          details: {}
        }
      ],
      recent_alerts: [
        {
          level: "info",
          code: "launch_verification",
          message: "Final verification is still pending before publish.",
          context: {},
          timestamp: iso("2026-04-13T09:06:00Z")
        }
      ]
    }
  },
  [SECONDARY_WORKSPACE_ID]: {
    generated_at: iso("2026-04-12T09:00:00Z"),
    scope: {
      workspace_id: SECONDARY_WORKSPACE_ID
    },
    health: {
      status: "healthy",
      models_configured: true,
      configured_providers: ["alibaba"],
      database_ok: true,
      rate_limiting_enabled: true,
      provider_budget_enforced: true
    },
    request_metrics: {
      total_requests: 12,
      rate_limited_requests: 0,
      status_breakdown: { "200": 12 },
      recent_requests: []
    },
    provider_usage: {
      total_cost_usd_24h: 0.15,
      total_prompt_tokens_24h: 1200,
      total_completion_tokens_24h: 900,
      by_model: [],
      recent_provider_events: []
    },
    budget: {
      cap_usd: 25,
      current_spend_usd: 0.15,
      remaining_usd: 24.85,
      utilization: 0.006,
      window_started_at: iso("2026-04-01T00:00:00Z"),
      enforced: true
    },
    automations: {
      active_automations: 0,
      awaiting_approval: 0,
      failed_executions_24h: 0
    },
    approvals: {
      pending_items: 0,
      blocked_actions: 0,
      recent_sensitive_actions: []
    },
    audit: {
      recent_audits: [],
      recent_alerts: []
    }
  }
};

const integrationsStatusByWorkspace: Record<string, IntegrationsStatusData> = {
  [DEFAULT_WORKSPACE_ID]: {
    generated_at: iso("2026-04-13T09:15:00Z"),
    capabilities: {
      email: true,
      slack: true,
      webhook: true,
      calendar: true
    },
    providers: [
      {
        key: "email",
        provider: "smtp",
        configured: true,
        live_delivery_supported: true,
        uses_approval_gate: false,
        detail: "SMTP relay configured for launch notifications."
      }
    ]
  },
  [SECONDARY_WORKSPACE_ID]: {
    generated_at: iso("2026-04-12T09:00:00Z"),
    capabilities: {
      email: false,
      slack: false,
      webhook: false,
      calendar: false
    },
    providers: []
  }
};

const enterpriseAdminByWorkspace: Record<string, EnterpriseAdminData> = {
  [DEFAULT_WORKSPACE_ID]: {
    generated_at: iso("2026-04-13T09:15:00Z"),
    workspace: {
      id: DEFAULT_WORKSPACE_ID,
      organization_id: "org-e2e",
      name: "Executive Launch Workspace",
      slug: "executive-launch",
      description: "Primary launch workspace"
    },
    sso: {
      enforced: false,
      password_login_allowed: true,
      preferred_provider: null,
      allowed_providers: ["google", "microsoft"],
      domain_allowlist: ["swarm.e2e"],
      providers: [
        {
          key: "google",
          label: "Google",
          configured: true,
          enabled: true,
          preferred: false,
          detail: "Configured for workspace logins."
        }
      ]
    },
    rbac: {
      membership_count: 2,
      pending_memberships: 0,
      default_role: "member",
      invite_policy: "owner_admin",
      role_matrix: [
        {
          role: "owner",
          label: "Owner",
          rank: 100,
          capabilities: ["manage_workspace", "manage_billing"]
        }
      ],
      members: [
        {
          membership_id: "membership-1",
          user_id: "user-e2e",
          email: "operator@swarm.e2e",
          full_name: "E2E Operator",
          workspace_role: "owner",
          global_role: "owner",
          status: "active",
          joined_at: iso("2026-04-01T09:00:00Z"),
          last_login_at: iso("2026-04-13T09:00:00Z"),
          session_active: true,
          active_session_count: 1
        }
      ]
    },
    quotas: {
      policy: {
        projects: 10,
        threads: 50,
        documents: 250,
        artifacts: 500,
        automations: 20,
        monthly_cost_cap_usd: 250,
        monthly_token_cap: 1000000,
        soft_enforcement: true,
        billing_alert_thresholds: [0.5, 0.8, 1]
      },
      usage: {
        projects: 2,
        threads: 3,
        documents: 1,
        artifacts: 2,
        automations: 1
      },
      utilization: {
        projects: 0.2,
        threads: 0.06,
        documents: 0.004,
        artifacts: 0.004,
        automations: 0.05
      }
    },
    billing: {
      window_started_at: iso("2026-04-01T00:00:00Z"),
      current_cost_usd: 2.42,
      prompt_tokens: 18000,
      completion_tokens: 9400,
      total_tokens: 27400,
      monthly_cost_cap_usd: 250,
      monthly_token_cap: 1000000,
      cost_utilization: 0.00968,
      token_utilization: 0.0274,
      alert_thresholds: [0.5, 0.8, 1],
      by_day: [
        {
          day: "2026-04-13",
          cost_usd: 2.42,
          prompt_tokens: 18000,
          completion_tokens: 9400
        }
      ],
      top_models: [
        {
          model_name: "qwen3-coder-plus",
          provider_name: "alibaba",
          request_count: 4,
          cost_usd: 1.12,
          prompt_tokens: 8000,
          completion_tokens: 4300
        }
      ]
    },
    audit: {
      recent_items: [
        {
          id: "audit-1",
          created_at: iso("2026-04-13T09:05:00Z"),
          action: "thread.publish_requested",
          resource_type: "thread",
          resource_id: "thread-launch-site",
          actor_id: "user-e2e",
          actor_email: "operator@swarm.e2e",
          actor_name: "E2E Operator",
          details: {}
        }
      ]
    }
  },
  [SECONDARY_WORKSPACE_ID]: {
    generated_at: iso("2026-04-12T09:00:00Z"),
    workspace: {
      id: SECONDARY_WORKSPACE_ID,
      organization_id: "org-e2e",
      name: "Operations Sandbox",
      slug: "ops-sandbox",
      description: "Secondary workspace"
    },
    sso: {
      enforced: false,
      password_login_allowed: true,
      preferred_provider: null,
      allowed_providers: [],
      domain_allowlist: [],
      providers: []
    },
    rbac: {
      membership_count: 1,
      pending_memberships: 0,
      default_role: "member",
      invite_policy: "owner_admin",
      role_matrix: [],
      members: []
    },
    quotas: {
      policy: {
        projects: 10,
        threads: 50,
        documents: 250,
        artifacts: 500,
        automations: 20,
        monthly_cost_cap_usd: 250,
        monthly_token_cap: 1000000,
        soft_enforcement: true,
        billing_alert_thresholds: [0.5, 0.8, 1]
      },
      usage: {
        projects: 1,
        threads: 1,
        documents: 0,
        artifacts: 0,
        automations: 0
      },
      utilization: {
        projects: 0.1,
        threads: 0.02,
        documents: 0,
        artifacts: 0,
        automations: 0
      }
    },
    billing: {
      window_started_at: iso("2026-04-01T00:00:00Z"),
      current_cost_usd: 0.15,
      prompt_tokens: 1200,
      completion_tokens: 900,
      total_tokens: 2100,
      monthly_cost_cap_usd: 250,
      monthly_token_cap: 1000000,
      cost_utilization: 0.0006,
      token_utilization: 0.0021,
      alert_thresholds: [0.5, 0.8, 1],
      by_day: [],
      top_models: []
    },
    audit: {
      recent_items: []
    }
  }
};

const enterpriseAuditByWorkspace: Record<string, EnterpriseAuditBrowseData> = {
  [DEFAULT_WORKSPACE_ID]: {
    generated_at: iso("2026-04-13T09:15:00Z"),
    workspace_id: DEFAULT_WORKSPACE_ID,
    filters: {},
    action_counts: {
      "thread.publish_requested": 1
    },
    resource_counts: {
      thread: 1
    },
    items: enterpriseAdminByWorkspace[DEFAULT_WORKSPACE_ID].audit.recent_items
  },
  [SECONDARY_WORKSPACE_ID]: {
    generated_at: iso("2026-04-12T09:00:00Z"),
    workspace_id: SECONDARY_WORKSPACE_ID,
    filters: {},
    action_counts: {},
    resource_counts: {},
    items: []
  }
};

function normalizeWorkspaceData<T>(record: Record<string, T>, workspaceId?: string | null): T {
  return clone(record[resolveWorkspaceId(workspaceId)]);
}

export function getMockCurrentSession() {
  return clone(mockSession);
}

export function getMockTaskRail(workspaceId?: string | null) {
  return normalizeWorkspaceData(taskRailByWorkspace, workspaceId);
}

export function getMockChatWorkspace(workspaceId?: string | null, threadId?: string | null, projectId?: string | null) {
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
  const workspace = normalizeWorkspaceData(chatWorkspaceByWorkspace, resolvedWorkspaceId);
  const selectedThread =
    workspace.threads.find((thread) => thread.id === threadId) ??
    (projectId
      ? workspace.threads.find((thread) => thread.project_id === projectId)
      : null) ??
    workspace.threads[0] ??
    null;

  workspace.selected_thread_id = selectedThread?.id ?? null;
  if (projectId) {
    const project = taskRailByWorkspace[resolvedWorkspaceId].projects.find((entry) => entry.id === projectId);
    workspace.selected_project = project
      ? {
          id: project.id,
          workspace_id: project.workspace_id,
          name: project.name,
          description: project.description ?? null,
          status: project.status,
          metadata: project.metadata ?? {},
          created_at: project.created_at,
          updated_at: project.updated_at
        }
      : null;
  } else if (selectedThread?.project_id) {
    const project = taskRailByWorkspace[resolvedWorkspaceId].projects.find((entry) => entry.id === selectedThread.project_id);
    workspace.selected_project = project
      ? {
          id: project.id,
          workspace_id: project.workspace_id,
          name: project.name,
          description: project.description ?? null,
          status: project.status,
          metadata: project.metadata ?? {},
          created_at: project.created_at,
          updated_at: project.updated_at
        }
      : null;
  } else {
    workspace.selected_project = null;
  }
  return workspace;
}

export function getMockTaskTemplates(workspaceId?: string | null) {
  return normalizeWorkspaceData(taskTemplateCatalogByWorkspace, workspaceId);
}

export function getMockChatWorkbenchTree(workspaceId?: string | null, relativePath = ".") {
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
  const record = workbenchTreesByWorkspace[resolvedWorkspaceId] ?? {};
  return clone(record[relativePath] ?? record["."]);
}

export function getMockChatWorkbenchFile(workspaceId?: string | null, relativePath = "README.md") {
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
  const record = workbenchFilesByWorkspace[resolvedWorkspaceId] ?? {};
  return clone(record[relativePath] ?? record["README.md"]);
}

export function saveMockChatWorkbenchFile(
  workspaceId: string | null | undefined,
  relativePath: string,
  content: string
) {
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
  const existing =
    workbenchFilesByWorkspace[resolvedWorkspaceId]?.[relativePath] ??
    getMockChatWorkbenchFile(resolvedWorkspaceId, relativePath);
  const nextFile: ChatWorkbenchFileData = {
    ...existing,
    relative_path: relativePath,
    name: relativePath.split("/").pop() ?? existing.name,
    content,
    size_bytes: content.length,
    truncated: false
  };
  if (!workbenchFilesByWorkspace[resolvedWorkspaceId]) {
    workbenchFilesByWorkspace[resolvedWorkspaceId] = {};
  }
  workbenchFilesByWorkspace[resolvedWorkspaceId][relativePath] = clone(nextFile);
  return {
    workspace_id: resolvedWorkspaceId,
    relative_path: relativePath,
    saved_at: new Date().toISOString(),
    file: nextFile
  } satisfies ChatWorkbenchFileSaveResponse;
}

export function getMockChatWorkbenchRepo(workspaceId?: string | null) {
  return normalizeWorkspaceData(workbenchRepoByWorkspace, workspaceId);
}

export function getMockChatWorkbenchDiff(workspaceId?: string | null, relativePath = "README.md") {
  return {
    workspace_id: resolveWorkspaceId(workspaceId),
    relative_path: relativePath,
    compare_target: "HEAD",
    has_changes: relativePath === "README.md" || relativePath === "todo.md",
    status: "modified",
    diff: `diff --git a/${relativePath} b/${relativePath}\n+ Updated during the E2E verification path.\n`,
    truncated: false,
    note: "Mock diff for deterministic E2E validation."
  } satisfies ChatWorkbenchDiffData;
}

export function getMockDocuments(workspaceId?: string | null) {
  return normalizeWorkspaceData(knowledgeDocumentsByWorkspace, workspaceId);
}

export function getMockArtifacts(workspaceId?: string | null) {
  return normalizeWorkspaceData(artifactsByWorkspace, workspaceId);
}

export function getMockArtifactPreview(artifactId: string) {
  return clone(
    artifactPreviewById[artifactId] ??
      ({
        artifact_id: artifactId,
        workspace_id: DEFAULT_WORKSPACE_ID,
        title: "Unknown artifact",
        kind: "file",
        mime_type: "text/plain",
        preview_kind: "text",
        inline_supported: true,
        text_content: "Mock artifact preview",
        page_summaries: [],
        table: null,
        sheets: [],
        slides: [],
        metadata: {},
        warnings: [],
        size_bytes: 0
      } satisfies ArtifactPreview)
  );
}

export function getMockLibraryDashboard(workspaceId?: string | null) {
  return normalizeWorkspaceData(libraryDashboardByWorkspace, workspaceId);
}

export function getMockKnowledgeHealth(workspaceId?: string | null) {
  return normalizeWorkspaceData(knowledgeHealthByWorkspace, workspaceId);
}

export function getMockWorkspaceAutomations(workspaceId?: string | null) {
  return normalizeWorkspaceData(automationsByWorkspace, workspaceId);
}

export function getMockChatAgents(workspaceId?: string | null) {
  return normalizeWorkspaceData(agentsByWorkspace, workspaceId);
}

export function getMockOpsDashboard(workspaceId?: string | null) {
  return normalizeWorkspaceData(opsDashboardByWorkspace, workspaceId);
}

export function getMockIntegrationStatus(workspaceId?: string | null) {
  return normalizeWorkspaceData(integrationsStatusByWorkspace, workspaceId);
}

export function getMockEnterpriseAdmin(workspaceId?: string | null) {
  return normalizeWorkspaceData(enterpriseAdminByWorkspace, workspaceId);
}

export function getMockAdminAudit(workspaceId?: string | null) {
  return normalizeWorkspaceData(enterpriseAuditByWorkspace, workspaceId);
}

export function getMockAdminSearch(queryValue: string, workspaceId?: string | null) {
  const query = queryValue.trim().toLowerCase();
  const results: AdminSearchData["results"] = [];

  for (const workspace of mockSession.workspaces) {
    if (workspaceId && workspace.workspace_id !== resolveWorkspaceId(workspaceId)) {
      continue;
    }
    const rail = taskRailByWorkspace[workspace.workspace_id];
    for (const project of rail.projects) {
      const haystack = `${project.name} ${project.description ?? ""}`.toLowerCase();
      if (!query || haystack.includes(query)) {
        results.push({
          kind: "project",
          workspace_id: workspace.workspace_id,
          workspace_name: workspace.workspace_name,
          workspace_slug: workspace.workspace_slug,
          score: 0.9,
          matched_by: ["project_name"],
          highlight: project.description ?? null,
          project_id: project.id,
          project_name: project.name,
          title: project.name,
          subtitle: project.description ?? null,
          status: project.status,
          created_at: project.created_at,
          updated_at: project.updated_at
        });
      }
    }
  }

  return {
    query: queryValue,
    scope: workspaceId ? "workspace" : "global",
    workspace_id: workspaceId ?? null,
    workspace_count: workspaceId ? 1 : mockSession.workspaces.length,
    total_results: results.length,
    result_counts: {
      project: results.length,
      task: 0,
      document: 0,
      artifact: 0
    },
    results
  } satisfies AdminSearchData;
}

export function getMockChatSearch(queryValue: string, workspaceId?: string | null, projectId?: string | null) {
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
  const normalizedQuery = queryValue.trim().toLowerCase();
  const rail = taskRailByWorkspace[resolvedWorkspaceId];
  const searchResults: SearchResult[] = [];

  const matches = (value: string | null | undefined) =>
    !normalizedQuery || (value ?? "").toLowerCase().includes(normalizedQuery);

  for (const project of rail.projects) {
    if ((!projectId || project.id === projectId) && (matches(project.name) || matches(project.description))) {
      searchResults.push({
        kind: "project",
        score: 0.91,
        matched_by: ["project_name"],
        highlight: project.description ?? null,
        project: {
          id: project.id,
          workspace_id: project.workspace_id,
          name: project.name,
          description: project.description ?? null,
          status: project.status,
          metadata: project.metadata ?? {},
          created_at: project.created_at,
          updated_at: project.updated_at
        }
      });
    }
  }

  for (const thread of rail.threads) {
    if (projectId && thread.project_id !== projectId) {
      continue;
    }
    if (matches(thread.title) || matches(thread.last_message_preview ?? null)) {
      searchResults.push({
        kind: "task",
        score: 0.88,
        matched_by: ["thread_title"],
        highlight: thread.last_message_preview ?? null,
        thread
      });
    }
  }

  for (const document of knowledgeDocumentsByWorkspace[resolvedWorkspaceId] ?? []) {
    if (matches(document.title) || matches(document.content_text)) {
      searchResults.push({
        kind: "document",
        score: 0.82,
        matched_by: ["document_title"],
        highlight: document.content_text,
        document
      });
    }
  }

  for (const artifact of artifactsByWorkspace[resolvedWorkspaceId] ?? []) {
    if (matches(artifact.title) || matches(artifact.storage_key)) {
      searchResults.push({
        kind: "artifact",
        score: 0.8,
        matched_by: ["artifact_title"],
        highlight: artifact.storage_key,
        artifact
      });
    }
  }

  return {
    workspace_id: resolvedWorkspaceId,
    query: queryValue,
    scope: projectId ? "project" : "workspace",
    project_id: projectId ?? null,
    total_results: searchResults.length,
    result_counts: searchResults.reduce<Record<string, number>>((counts, result) => {
      counts[result.kind] = (counts[result.kind] ?? 0) + 1;
      return counts;
    }, {}),
    searched_fields: ["projects", "threads", "documents", "artifacts"],
    results: searchResults
  } satisfies ChatSearchResponse;
}
