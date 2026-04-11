export type Thread = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
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
  citations: { title: string; url: string; agent?: string }[];
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
  threads: Thread[];
  messages: Message[];
  runs: ChatRun[];
};

export type DemoWorkspace = ChatWorkspaceData;

export type ChatRunRequestPayload = {
  workspace_id: string;
  thread_id?: string | null;
  message: string;
  mode?: string;
  use_retrieval?: boolean;
};

export type ChatThreadCreatePayload = {
  workspace_id: string;
  title?: string | null;
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

export type Automation = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  schedule: string;
  status: string;
  definition: Record<string, unknown>;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
};

export type AutomationDashboard = {
  automation: Automation;
  recent_executions: AutomationExecution[];
  schedule_summary: string;
  pending_approval: boolean;
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
