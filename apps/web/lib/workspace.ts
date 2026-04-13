import type { AuthProfile } from "@/lib/types";

export function resolveActiveWorkspace(
  session: AuthProfile | null | undefined,
  requestedWorkspaceId?: string | null
) {
  const workspaces = session?.workspaces ?? [];
  if (workspaces.length === 0) {
    return null;
  }
  if (requestedWorkspaceId) {
    const matched = workspaces.find((workspace) => workspace.workspace_id === requestedWorkspaceId);
    if (matched) {
      return matched;
    }
  }
  return workspaces[0];
}

export function withWorkspacePath(
  path: string,
  workspaceId?: string | null,
  extraParams?: Record<string, string | null | undefined>
) {
  const [basePath, rawQuery = ""] = path.split("?");
  const params = new URLSearchParams(rawQuery);
  if (workspaceId) {
    params.set("workspace", workspaceId);
  } else {
    params.delete("workspace");
  }

  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
