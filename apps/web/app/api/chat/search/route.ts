import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";
import { getMockChatSearch, isE2EMockMode } from "@/lib/e2e-mocks";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspace_id");
  const queryValue = request.nextUrl.searchParams.get("q");
  const projectId = request.nextUrl.searchParams.get("project_id");
  const limit = request.nextUrl.searchParams.get("limit");
  const query = new URLSearchParams();
  if (workspaceId) {
    query.set("workspace_id", workspaceId);
  }
  if (queryValue) {
    query.set("q", queryValue);
  }
  if (projectId) {
    query.set("project_id", projectId);
  }
  if (limit) {
    query.set("limit", limit);
  }

  if (isE2EMockMode()) {
    return NextResponse.json(getMockChatSearch(queryValue ?? "", workspaceId, projectId));
  }

  try {
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/chat/search?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({ detail: "Search failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Search service is unavailable." }, { status: 503 });
  }
}
