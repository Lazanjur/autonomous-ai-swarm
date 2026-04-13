import "server-only";

import { cookies } from "next/headers";
import type {
  ChatAgentsData,
  Automation,
  AutomationDashboard,
  AdminSearchData,
  Artifact,
  ArtifactPreview,
  AuthProfile,
  ChatWorkbenchFileData,
  ChatWorkbenchTreeData,
  ChatTaskRailData,
  TaskTemplateCatalogData,
  ChatWorkspaceData,
  KnowledgeDocument,
  KnowledgeHealth,
  LibraryDashboard,
  EnterpriseAdminData,
  EnterpriseAuditBrowseData,
  IntegrationsStatusData,
  OpsDashboard
} from "@/lib/types";
import {
  getMockAdminAudit,
  getMockAdminSearch,
  getMockArtifactPreview,
  getMockArtifacts,
  getMockChatAgents,
  getMockChatWorkbenchFile,
  getMockChatWorkbenchTree,
  getMockChatWorkspace,
  getMockCurrentSession,
  getMockDocuments,
  getMockEnterpriseAdmin,
  getMockIntegrationStatus,
  getMockKnowledgeHealth,
  getMockLibraryDashboard,
  getMockOpsDashboard,
  getMockTaskRail,
  getMockTaskTemplates,
  getMockWorkspaceAutomations,
  isE2EMockMode
} from "@/lib/e2e-mocks";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

async function authHeaders(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return token
    ? {
        Authorization: `Bearer ${token}`
      }
    : {};
}

export async function hasSessionCookie() {
  const cookieStore = await cookies();
  return Boolean(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

async function safeFetch<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${INTERNAL_API_URL}${path}`, {
      headers: {
        ...(await authHeaders())
      },
      cache: "no-store"
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function getCurrentSession() {
  if (isE2EMockMode()) {
    return getMockCurrentSession();
  }
  return safeFetch<AuthProfile>("/api/v1/auth/me");
}

export async function getChatWorkspace(workspaceId: string, threadId?: string | null, projectId?: string | null) {
  if (isE2EMockMode()) {
    return getMockChatWorkspace(workspaceId, threadId, projectId);
  }
  const query = new URLSearchParams({ workspace_id: workspaceId });
  if (threadId) {
    query.set("thread_id", threadId);
  }
  if (projectId) {
    query.set("project_id", projectId);
  }
  return safeFetch<ChatWorkspaceData>(`/api/v1/chat/workspace?${query.toString()}`);
}

export async function getTaskRail(workspaceId: string) {
  if (isE2EMockMode()) {
    return getMockTaskRail(workspaceId);
  }
  return safeFetch<ChatTaskRailData>(`/api/v1/chat/task-rail?workspace_id=${workspaceId}`);
}

export async function getTaskTemplates(workspaceId: string) {
  if (isE2EMockMode()) {
    return getMockTaskTemplates(workspaceId);
  }
  return safeFetch<TaskTemplateCatalogData>(`/api/v1/chat/templates?workspace_id=${workspaceId}`);
}

export async function getChatAgents(workspaceId: string) {
  if (isE2EMockMode()) {
    return getMockChatAgents(workspaceId);
  }
  return safeFetch<ChatAgentsData>(`/api/v1/chat/agents?workspace_id=${workspaceId}`);
}

export async function getChatWorkbenchTree(workspaceId: string, relativePath = ".") {
  if (isE2EMockMode()) {
    return getMockChatWorkbenchTree(workspaceId, relativePath);
  }
  const query = new URLSearchParams({ workspace_id: workspaceId, relative_path: relativePath });
  return safeFetch<ChatWorkbenchTreeData>(`/api/v1/chat/workbench/tree?${query.toString()}`);
}

export async function getChatWorkbenchFile(workspaceId: string, relativePath: string, maxChars = 24000) {
  if (isE2EMockMode()) {
    return getMockChatWorkbenchFile(workspaceId, relativePath);
  }
  const query = new URLSearchParams({
    workspace_id: workspaceId,
    relative_path: relativePath,
    max_chars: String(maxChars)
  });
  return safeFetch<ChatWorkbenchFileData>(`/api/v1/chat/workbench/file?${query.toString()}`);
}

export async function getWorkspaceDocuments(workspaceId: string) {
  if (isE2EMockMode()) {
    return getMockDocuments(workspaceId);
  }
  return safeFetch<KnowledgeDocument[]>(`/api/v1/documents?workspace_id=${workspaceId}`);
}

export async function getWorkspaceArtifacts(workspaceId: string) {
  if (isE2EMockMode()) {
    return getMockArtifacts(workspaceId);
  }
  return safeFetch<Artifact[]>(`/api/v1/artifacts?workspace_id=${workspaceId}`);
}

export async function getArtifactPreview(artifactId: string) {
  if (isE2EMockMode()) {
    return getMockArtifactPreview(artifactId);
  }
  return safeFetch<ArtifactPreview>(`/api/v1/artifacts/${artifactId}/preview`);
}

export async function getLibraryDashboard(workspaceId: string) {
  if (isE2EMockMode()) {
    return getMockLibraryDashboard(workspaceId);
  }
  return safeFetch<LibraryDashboard>(`/api/v1/library?workspace_id=${workspaceId}`);
}

export async function getWorkspaceKnowledgeHealth(workspaceId: string) {
  if (isE2EMockMode()) {
    return getMockKnowledgeHealth(workspaceId);
  }
  return safeFetch<KnowledgeHealth>(`/api/v1/documents/health?workspace_id=${workspaceId}`);
}

export async function getWorkspaceAutomations(workspaceId: string) {
  if (isE2EMockMode()) {
    return getMockWorkspaceAutomations(workspaceId);
  }
  return safeFetch<Automation[]>(`/api/v1/automations?workspace_id=${workspaceId}`);
}

export async function getAutomationDashboard(automationId: string) {
  return safeFetch<AutomationDashboard>(`/api/v1/automations/${automationId}`);
}

export async function getOpsDashboard(workspaceId?: string | null) {
  if (isE2EMockMode()) {
    return getMockOpsDashboard(workspaceId);
  }
  const query = workspaceId ? `?workspace_id=${workspaceId}` : "";
  return safeFetch<OpsDashboard>(`/api/v1/admin/ops${query}`);
}

export async function getAdminSearch(queryValue: string, workspaceId?: string | null, limit = 40) {
  if (isE2EMockMode()) {
    return getMockAdminSearch(queryValue, workspaceId);
  }
  const query = new URLSearchParams({
    q: queryValue,
    limit: String(limit)
  });
  if (workspaceId) {
    query.set("workspace_id", workspaceId);
  }
  return safeFetch<AdminSearchData>(`/api/v1/admin/search?${query.toString()}`);
}

export async function getIntegrationStatus(workspaceId?: string | null) {
  if (isE2EMockMode()) {
    return getMockIntegrationStatus(workspaceId);
  }
  const query = workspaceId ? `?workspace_id=${workspaceId}` : "";
  return safeFetch<IntegrationsStatusData>(`/api/v1/admin/integrations${query}`);
}

export async function getEnterpriseAdmin(workspaceId: string) {
  if (isE2EMockMode()) {
    return getMockEnterpriseAdmin(workspaceId);
  }
  return safeFetch<EnterpriseAdminData>(`/api/v1/admin/enterprise?workspace_id=${workspaceId}`);
}

export async function getAdminAudit(
  workspaceId: string,
  filters?: {
    action?: string | null;
    resourceType?: string | null;
    actorId?: string | null;
    limit?: number;
  }
) {
  if (isE2EMockMode()) {
    return getMockAdminAudit(workspaceId);
  }
  const query = new URLSearchParams({ workspace_id: workspaceId });
  if (filters?.action) {
    query.set("action", filters.action);
  }
  if (filters?.resourceType) {
    query.set("resource_type", filters.resourceType);
  }
  if (filters?.actorId) {
    query.set("actor_id", filters.actorId);
  }
  if (typeof filters?.limit === "number") {
    query.set("limit", String(filters.limit));
  }
  return safeFetch<EnterpriseAuditBrowseData>(`/api/v1/admin/audit?${query.toString()}`);
}
