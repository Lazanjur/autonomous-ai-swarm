import "server-only";

import { cookies } from "next/headers";
import type {
  Automation,
  AutomationDashboard,
  Artifact,
  AuthProfile,
  ChatWorkspaceData,
  KnowledgeDocument,
  KnowledgeHealth,
  OpsDashboard
} from "@/lib/types";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

async function authHeaders() {
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
  return Boolean(cookieStore.get(COOKIE_NAME)?.value);
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
  return safeFetch<AuthProfile>("/api/v1/auth/me");
}

export async function getChatWorkspace(workspaceId: string, threadId?: string | null) {
  const query = new URLSearchParams({ workspace_id: workspaceId });
  if (threadId) {
    query.set("thread_id", threadId);
  }
  return safeFetch<ChatWorkspaceData>(`/api/v1/chat/workspace?${query.toString()}`);
}

export async function getWorkspaceDocuments(workspaceId: string) {
  return safeFetch<KnowledgeDocument[]>(`/api/v1/documents?workspace_id=${workspaceId}`);
}

export async function getWorkspaceArtifacts(workspaceId: string) {
  return safeFetch<Artifact[]>(`/api/v1/artifacts?workspace_id=${workspaceId}`);
}

export async function getWorkspaceKnowledgeHealth(workspaceId: string) {
  return safeFetch<KnowledgeHealth>(`/api/v1/documents/health?workspace_id=${workspaceId}`);
}

export async function getWorkspaceAutomations(workspaceId: string) {
  return safeFetch<Automation[]>(`/api/v1/automations?workspace_id=${workspaceId}`);
}

export async function getAutomationDashboard(automationId: string) {
  return safeFetch<AutomationDashboard>(`/api/v1/automations/${automationId}`);
}

export async function getOpsDashboard(workspaceId?: string | null) {
  const query = workspaceId ? `?workspace_id=${workspaceId}` : "";
  return safeFetch<OpsDashboard>(`/api/v1/admin/ops${query}`);
}
