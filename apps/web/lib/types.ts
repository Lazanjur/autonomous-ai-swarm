export type Thread = {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  title: string;
  status: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  message_count?: number;
  run_count?: number;
  last_message_preview?: string | null;
  last_activity_at?: string;
};

export type Message = {
  id: string;
  thread_id: string;
  run_id: string | null;
  role: "user" | "assistant";
  content: string;
  citations: {
    reference_id?: string;
    title: string;
    url?: string;
    agent?: string;
    kind?: string;
    excerpt?: string | null;
    source_type?: string | null;
    source_uri?: string | null;
    document_id?: string | null;
    chunk_id?: string | null;
    relative_path?: string | null;
    score?: number | null;
  }[];
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ChatRun = {
  id: string;
  thread_id: string;
  workspace_id: string;
  status: string;
  supervisor_model: string;
  user_message: string;
  final_response: string | null;
  summary: string | null;
  plan: Record<string, unknown>[];
  created_at: string;
};

export type ChatWorkspaceData = {
  workspace_id: string;
  selected_thread_id: string | null;
  selected_project?: ProjectRecord | null;
  task_memory?: SharedMemory | null;
  project_memory?: SharedMemory | null;
  threads: Thread[];
  messages: Message[];
  runs: ChatRun[];
  run_steps: RunStepRecord[];
  tool_calls: ToolCallRecord[];
};

export type SharedMemory = {
  summary?: string | null;
  findings: string[];
  risks: string[];
  open_questions: string[];
  recent_requests: string[];
  recent_summaries: string[];
  focus_areas: string[];
  agent_memory: {
    agent: string;
    summary: string;
    confidence?: number;
  }[];
  run_count: number;
  last_updated_at?: string | null;
  source_run_id?: string | null;
  source_thread_id?: string | null;
};

export type ProjectSummary = {
  id: string;
  workspace_id: string;
  name: string;
  description?: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  thread_count: number;
  last_activity_at?: string | null;
};

export type ProjectRecord = {
  id: string;
  workspace_id: string;
  name: string;
  description?: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ChatTaskRailData = {
  workspace_id: string;
  projects: ProjectSummary[];
  threads: Thread[];
};

export type TaskTemplate = {
  key: string;
  name: string;
  category: "browser" | "computer";
  summary: string;
  description: string;
  tags: string[];
  capabilities: string[];
  recommended_operator_tab:
    | "code"
    | "computer"
    | "browser"
    | "terminal"
    | "files"
    | "preview"
    | "timeline"
    | "artifacts";
  requires_approval: boolean;
  chat_defaults: {
    thread_title: string;
    prompt: string;
    model_profile?: string | null;
    use_retrieval: boolean;
    suggested_steps: string[];
  };
  automation_defaults: {
    name: string;
    description: string;
    prompt: string;
    schedule_hint: string;
    timezone: string;
    use_retrieval: boolean;
    requires_approval: boolean;
    retry_limit: number;
    timeout_seconds: number;
    notify_on: string[];
    steps: string[];
  };
};

export type TaskTemplateCatalogData = {
  workspace_id: string;
  templates: TaskTemplate[];
};

export type SearchResult = {
  kind: "project" | "task" | "document" | "artifact";
  score: number;
  matched_by: string[];
  highlight: string | null;
  project?: ProjectRecord | null;
  thread?: Thread | null;
  document?: KnowledgeDocument | null;
  artifact?: Artifact | null;
};

export type ChatSearchResponse = {
  workspace_id: string;
  query: string;
  scope: "workspace" | "project";
  project_id?: string | null;
  total_results: number;
  result_counts: Record<string, number>;
  searched_fields: string[];
  results: SearchResult[];
};

export type WorkbenchTreeEntry = {
  name: string;
  relative_path: string;
  kind: "dir" | "file";
  extension?: string | null;
  size_bytes?: number | null;
};

export type ChatWorkbenchTreeData = {
  workspace_id: string;
  root_label: string;
  relative_path: string;
  parent_relative_path: string | null;
  entries: WorkbenchTreeEntry[];
};

export type ChatWorkbenchFileData = {
  workspace_id: string;
  root_label: string;
  relative_path: string;
  name: string;
  extension?: string | null;
  size_bytes: number;
  truncated: boolean;
  content: string;
};

export type ChatWorkbenchFileSaveResponse = {
  workspace_id: string;
  relative_path: string;
  saved_at: string;
  file: ChatWorkbenchFileData;
};

export type ChatWorkbenchRepoFile = {
  relative_path: string;
  display_path: string;
  status: string;
  staged_status?: string | null;
  unstaged_status?: string | null;
  is_untracked: boolean;
};

export type ChatWorkbenchRepoData = {
  workspace_id: string;
  is_repo: boolean;
  root_label: string;
  branch?: string | null;
  head?: string | null;
  dirty: boolean;
  summary?: string | null;
  changed_files: ChatWorkbenchRepoFile[];
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
};

export type ChatWorkbenchDiffData = {
  workspace_id: string;
  relative_path: string;
  compare_target: string;
  has_changes: boolean;
  status?: string | null;
  diff: string;
  truncated: boolean;
  note?: string | null;
};

export type ChatTodoSyncResponse = {
  workspace_id: string;
  thread_id: string;
  relative_path: string;
  created: boolean;
  total_items: number;
  completed_items: number;
  file: ChatWorkbenchFileData;
};

export type AgentTool = {
  name: string;
  description: string;
};

export type AgentRecentStep = {
  run_step_id: string;
  run_id: string;
  thread_id: string;
  thread_title: string;
  project_id?: string | null;
  agent_key?: string | null;
  agent_name?: string | null;
  status: string;
  confidence: number;
  summary?: string | null;
  validation_summary?: string | null;
  model?: string | null;
  provider?: string | null;
  tools: string[];
  created_at: string;
};

export type AgentWorkspaceOverview = {
  total_agents: number;
  active_agents_24h: number;
  busy_agents: number;
  idle_agents: number;
  total_steps: number;
  total_tool_calls: number;
  escalation_count: number;
  average_confidence: number;
  activity_window_hours: number;
  last_activity_at?: string | null;
};

export type AgentSurface = {
  key: string;
  name: string;
  fast_model: string;
  slow_model: string;
  specialties: string[];
  tools: AgentTool[];
  health_state: string;
  workload_score: number;
  step_count: number;
  recent_step_count: number;
  average_confidence: number;
  escalation_count: number;
  tool_call_count: number;
  active_thread_count: number;
  active_project_count: number;
  last_active_at?: string | null;
  last_status?: string | null;
  last_model?: string | null;
  last_provider?: string | null;
  recent_tools: string[];
  status_breakdown: Record<string, number>;
  recent_summaries: string[];
  recent_steps: AgentRecentStep[];
};

export type ChatAgentsData = {
  workspace_id: string;
  supervisor_model: string;
  overview: AgentWorkspaceOverview;
  agents: AgentSurface[];
  recent_activity: AgentRecentStep[];
};

export type DemoWorkspace = ChatWorkspaceData;

export type ChatRunRequestPayload = {
  workspace_id: string;
  thread_id?: string | null;
  project_id?: string | null;
  message: string;
  mode?: string;
  use_retrieval?: boolean;
  model_profile?: string | null;
  template_key?: string | null;
  composer_context?: Record<string, unknown>;
};

export type ChatThreadCreatePayload = {
  workspace_id: string;
  project_id?: string | null;
  title?: string | null;
};

export type ChatProjectCreatePayload = {
  workspace_id: string;
  name: string;
  description?: string | null;
};

export type LivePlanStep = {
  key: string;
  objective: string;
  reason: string;
  dependencies: string[];
  expected_output: string;
  execution_mode: string;
  priority: number;
  plan_index: number;
};

export type LiveRunStepState = {
  step_index: number;
  batch_index: number;
  agent_key: string;
  agent_name: string;
  status: string;
  objective?: string;
  dependencies: string[];
  execution_mode?: string;
  confidence?: number;
  validation_summary?: string;
  summary?: string;
  model?: string;
  provider?: string;
  escalated?: boolean;
  tools?: { tool: string; status: string }[];
};

export type RunStepRecord = {
  id: string;
  run_id: string;
  agent_name: string;
  step_index: number;
  status: string;
  confidence: number;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown>;
  created_at: string;
};

export type ToolCallRecord = {
  id: string;
  run_step_id: string;
  tool_name: string;
  status: string;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown>;
  created_at: string;
};

export type ToolArtifactRef = {
  storage_key: string;
  path?: string;
  content_type?: string;
  relative_path?: string;
  size_bytes?: number;
  title?: string;
};

export type LiveToolEvent = {
  agent_key?: string;
  agent_name?: string;
  step_index?: number;
  batch_index?: number;
  tool: string;
  operation?: string;
  status: string;
  summary?: string;
  output_preview?: string;
  artifacts?: ToolArtifactRef[];
  metrics?: Record<string, unknown> | null;
  result?: Record<string, unknown>;
};

export type ComputerSession = {
  session_id: string;
  session_kind: "browser" | "terminal";
  tool: string;
  status: string;
  agent_key?: string;
  agent_name?: string;
  step_index?: number;
  batch_index?: number;
  created_at: string;
  updated_at: string;
  target_url?: string | null;
  final_url?: string | null;
  page_title?: string | null;
  action_mode?: string | null;
  executed_actions?: { kind: string; selector: string; value?: string | null; status?: string }[];
  skipped_actions?: { kind: string; selector: string; value?: string | null; status?: string }[];
  headings?: string[];
  links?: { text: string; url: string }[];
  extracted_text?: string | null;
  warnings?: string[];
  artifacts?: ToolArtifactRef[];
  metrics?: Record<string, unknown>;
  command?: string[];
  stdout?: string | null;
  stderr?: string | null;
  stdout_delta?: string | null;
  stderr_delta?: string | null;
  phase?: string | null;
  stream?: string | null;
  returncode?: number | null;
  timed_out?: boolean;
};

export type LiveRunEvent = {
  event: string;
  data: Record<string, unknown>;
};

export type AuthProfile = {
  user: {
    id: string;
    email: string;
    full_name: string;
    role: string;
    is_active: boolean;
  };
  workspaces: {
    workspace_id: string;
    workspace_name: string;
    workspace_slug: string;
    role: string;
  }[];
};

export type KnowledgeDocument = {
  id: string;
  workspace_id: string;
  title: string;
  source_type: string;
  source_uri: string | null;
  mime_type: string | null;
  status: string;
  content_text: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type Artifact = {
  id: string;
  run_id: string | null;
  document_id: string | null;
  workspace_id: string;
  kind: string;
  title: string;
  storage_key: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ArtifactTablePreview = {
  columns: string[];
  rows: string[][];
};

export type ArtifactSheetPreview = {
  name: string;
  columns: string[];
  rows: string[][];
};

export type ArtifactSlidePreview = {
  slide_number: number;
  title: string | null;
  bullets: string[];
};

export type ArtifactPreview = {
  artifact_id: string;
  workspace_id: string;
  title: string;
  kind: string;
  mime_type: string;
  preview_kind: string;
  inline_supported: boolean;
  text_content: string | null;
  page_summaries: string[];
  table: ArtifactTablePreview | null;
  sheets: ArtifactSheetPreview[];
  slides: ArtifactSlidePreview[];
  metadata: Record<string, unknown>;
  warnings: string[];
  size_bytes: number | null;
};

export type LibraryCollection = {
  name: string;
  item_count: number;
  document_count: number;
  artifact_count: number;
  pinned_count: number;
  reusable_count: number;
  recent_titles: string[];
};

export type LibraryTagMetric = {
  tag: string;
  count: number;
};

export type LibraryItem = {
  id: string;
  item_type: "document" | "artifact";
  workspace_id: string;
  title: string;
  subtitle: string | null;
  status: string;
  kind: string;
  mime_type: string | null;
  source_uri: string | null;
  storage_key: string | null;
  document_id: string | null;
  artifact_id: string | null;
  linked_document_id: string | null;
  linked_document_title: string | null;
  tags: string[];
  collections: string[];
  pinned: boolean;
  reusable: boolean;
  note: string | null;
  preview_text: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type LibraryStats = {
  total_items: number;
  total_documents: number;
  total_artifacts: number;
  pinned_items: number;
  reusable_items: number;
  collection_count: number;
  tagged_items: number;
  unfiled_items: number;
};

export type LibraryDashboard = {
  workspace_id: string;
  stats: LibraryStats;
  collections: LibraryCollection[];
  top_tags: LibraryTagMetric[];
  items: LibraryItem[];
};

export type LibraryItemUpdatePayload = {
  pinned?: boolean;
  reusable?: boolean;
  note?: string | null;
  tags?: string[];
  collections?: string[];
};

export type DocumentUploadResponse = {
  documents: KnowledgeDocument[];
  artifacts: Artifact[];
};

export type KnowledgeSearchResult = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  source_type: string;
  source_uri: string | null;
  document_created_at: string;
  content: string;
  chunk_index: number;
  token_estimate: number;
  metadata: Record<string, unknown>;
  score: number;
  base_score: number;
  keyword_score: number;
  vector_score: number;
  trust_score: number;
  freshness_score: number;
  is_duplicate: boolean;
  duplicate_of_document_id: string | null;
  overlap_terms: string[];
};

export type KnowledgeSearchObservability = {
  path_used: string;
  attempted_paths: string[];
  reason: string;
  fallback_triggered: boolean;
  fallback_reason: string | null;
  query_embedding_available: boolean;
  query_embedding_dimensions: number | null;
  query_embedding_provider: string | null;
  query_embedding_fallback: boolean;
  candidate_limit: number;
  candidate_counts: Record<string, number>;
  returned_count: number;
  signals_considered: string[];
  weights: {
    keyword: number;
    vector: number;
    trust: number;
    freshness: number;
  };
  timings_ms: Record<string, number>;
  notes: string[];
  filters_applied: Record<string, unknown>;
  max_chunks_per_document: number;
  rerank_strategy: string;
};

export type KnowledgeSearchResponse = {
  query: string;
  results: KnowledgeSearchResult[];
  observability: KnowledgeSearchObservability;
};

export type KnowledgeHealth = {
  workspace_id: string;
  total_documents: number;
  indexed_documents: number;
  duplicate_documents: number;
  total_chunks: number;
  embedded_chunks: number;
  embedding_coverage: number;
  average_trust_score: number;
  status_breakdown: Record<string, number>;
  source_type_breakdown: Record<string, number>;
  top_tags: { tag: string; count: number }[];
  duplicate_groups: number;
  untagged_documents: number;
  latest_document_at: string | null;
};

export type AutomationExecution = {
  id: string;
  automation_id: string;
  workspace_id: string;
  run_id: string | null;
  thread_id: string | null;
  status: string;
  trigger: string;
  attempt: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  result_summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AutomationDefinition = {
  prompt: string;
  template_key?: string | null;
  target_thread_id?: string | null;
  timezone?: string;
  use_retrieval?: boolean;
  requires_approval?: boolean;
  retry_limit?: number;
  timeout_seconds?: number;
  notify_channels?: string[];
  notify_on?: string[];
  steps?: string[];
};

export type AutomationRuntimeEvent = {
  timestamp: string;
  type: string;
  level: string;
  message: string;
  data: Record<string, unknown>;
};

export type AutomationNotification = {
  channel: string;
  target?: string | null;
  event: string;
  status: string;
  storage_key?: string | null;
  response_status?: number | null;
  detail?: string | null;
  timestamp: string;
};

export type AutomationRetryState = {
  retry_limit: number;
  attempts_used: number;
  attempts_remaining: number;
  retryable: boolean;
  next_retry_at?: string | null;
  backoff_seconds?: number | null;
  last_error?: string | null;
};

export type AutomationApprovalState = {
  required: boolean;
  state: string;
  requested_at?: string | null;
  decided_at?: string | null;
  trigger?: string | null;
  decision_note?: string | null;
  decision_by?: string | null;
};

export type AutomationRuntimeSummary = {
  queue_status: string;
  scheduler_enabled: boolean;
  poll_interval_seconds: number;
  active_execution_count: number;
  awaiting_approval_count: number;
  retry_scheduled_count: number;
  completed_executions_24h: number;
  failed_executions_24h: number;
  latest_event?: AutomationRuntimeEvent | null;
  latest_notification?: AutomationNotification | null;
  retry_state?: AutomationRetryState | null;
  approval?: AutomationApprovalState | null;
};

export type Automation = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  schedule: string;
  status: string;
  definition: AutomationDefinition;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
};

export type AutomationDashboard = {
  automation: Automation;
  recent_executions: AutomationExecution[];
  schedule_summary: string;
  pending_approval: boolean;
  runtime: AutomationRuntimeSummary;
};

export type OpsDashboard = {
  generated_at: string;
  scope: {
    workspace_id: string | null;
  };
  health: {
    status: string;
    models_configured: boolean;
    database_ok: boolean;
    rate_limiting_enabled: boolean;
    provider_budget_enforced: boolean;
  };
  request_metrics: {
    total_requests: number;
    rate_limited_requests: number;
    status_breakdown: Record<string, number>;
    recent_requests: {
      request_id: string;
      method: string;
      path: string;
      status_code: number;
      duration_ms: number;
      client_ip: string | null;
      timestamp: string;
    }[];
  };
  provider_usage: {
    total_cost_usd_24h: number;
    total_prompt_tokens_24h: number;
    total_completion_tokens_24h: number;
    by_model: {
      model_name: string;
      provider_name: string;
      request_count: number;
      prompt_tokens: number;
      completion_tokens: number;
      estimated_cost: number;
    }[];
    recent_provider_events: {
      provider: string;
      model: string;
      operation: string;
      latency_ms: number;
      fallback: boolean;
      guardrail_reason: string | null;
      request_id: string | null;
      workspace_id: string | null;
      timestamp: string;
    }[];
  };
  budget: {
    cap_usd: number;
    current_spend_usd: number;
    remaining_usd: number;
    utilization: number;
    window_started_at: string;
    enforced?: boolean;
  };
  automations: {
    active_automations: number;
    awaiting_approval: number;
    failed_executions_24h: number;
  };
  approvals: {
    pending_items: number;
    blocked_actions: number;
    recent_sensitive_actions: {
      action: string;
      outcome: string;
      reason: string;
      request_id: string | null;
      workspace_id: string | null;
      timestamp: string;
    }[];
  };
  audit: {
    recent_audits: {
      id: string;
      created_at: string;
      action: string;
      resource_type: string;
      resource_id: string;
      details: Record<string, unknown>;
    }[];
    recent_alerts: {
      level: string;
      code: string;
      message: string;
      context: Record<string, unknown>;
      timestamp: string;
    }[];
  };
};

export type AdminSearchResult = {
  kind: "project" | "task" | "document" | "artifact";
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  score: number;
  matched_by: string[];
  highlight?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  thread_id?: string | null;
  document_id?: string | null;
  artifact_id?: string | null;
  title: string;
  subtitle?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AdminSearchData = {
  query: string;
  scope: "global" | "workspace";
  workspace_id?: string | null;
  workspace_count: number;
  total_results: number;
  result_counts: Record<string, number>;
  results: AdminSearchResult[];
};

export type IntegrationProviderStatus = {
  key: string;
  provider: string;
  configured: boolean;
  live_delivery_supported: boolean;
  uses_approval_gate: boolean;
  detail: string;
};

export type IntegrationsStatusData = {
  generated_at: string;
  capabilities: Record<string, boolean>;
  providers: IntegrationProviderStatus[];
};

export type EnterpriseSSOProvider = {
  key: "google" | "microsoft" | "oidc" | "saml";
  label: string;
  configured: boolean;
  enabled: boolean;
  preferred: boolean;
  detail: string;
};

export type EnterpriseMember = {
  membership_id: string;
  user_id: string;
  email: string;
  full_name: string;
  workspace_role: string;
  global_role: string;
  status: string;
  joined_at: string;
  last_login_at?: string | null;
  session_active: boolean;
  active_session_count: number;
};

export type EnterprisePolicyPayload = {
  sso_enforced?: boolean;
  password_login_allowed?: boolean;
  preferred_provider?: string | null;
  allowed_sso_providers?: string[];
  domain_allowlist?: string[];
  invite_policy?: string;
  default_role?: string;
  project_quota?: number;
  thread_quota?: number;
  document_quota?: number;
  artifact_quota?: number;
  automation_quota?: number;
  monthly_cost_cap_usd?: number;
  monthly_token_cap?: number;
  soft_enforcement?: boolean;
  billing_alert_thresholds?: number[];
};

export type EnterpriseAuditItem = {
  id: string;
  created_at: string;
  action: string;
  resource_type: string;
  resource_id: string;
  actor_id?: string | null;
  actor_email?: string | null;
  actor_name?: string | null;
  details: Record<string, unknown>;
};

export type EnterpriseAuditBrowseData = {
  generated_at: string;
  workspace_id: string;
  filters: Record<string, unknown>;
  action_counts: Record<string, number>;
  resource_counts: Record<string, number>;
  items: EnterpriseAuditItem[];
};

export type EnterpriseAdminData = {
  generated_at: string;
  workspace: {
    id: string;
    organization_id: string;
    name: string;
    slug: string;
    description?: string | null;
  };
  sso: {
    enforced: boolean;
    password_login_allowed: boolean;
    preferred_provider?: string | null;
    allowed_providers: string[];
    domain_allowlist: string[];
    providers: EnterpriseSSOProvider[];
  };
  rbac: {
    membership_count: number;
    pending_memberships: number;
    default_role: string;
    invite_policy: string;
    role_matrix: {
      role: string;
      label: string;
      rank: number;
      capabilities: string[];
    }[];
    members: EnterpriseMember[];
  };
  quotas: {
    policy: {
      projects: number;
      threads: number;
      documents: number;
      artifacts: number;
      automations: number;
      monthly_cost_cap_usd: number;
      monthly_token_cap: number;
      soft_enforcement: boolean;
      billing_alert_thresholds: number[];
    };
    usage: {
      projects: number;
      threads: number;
      documents: number;
      artifacts: number;
      automations: number;
    };
    utilization: Record<string, number>;
  };
  billing: {
    window_started_at: string;
    current_cost_usd: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    monthly_cost_cap_usd: number;
    monthly_token_cap: number;
    cost_utilization: number;
    token_utilization: number;
    alert_thresholds: number[];
    by_day: {
      day: string;
      cost_usd: number;
      prompt_tokens: number;
      completion_tokens: number;
    }[];
    top_models: {
      model_name: string;
      provider_name: string;
      request_count: number;
      cost_usd: number;
      prompt_tokens: number;
      completion_tokens: number;
    }[];
  };
  audit: {
    recent_items: EnterpriseAuditItem[];
  };
};
