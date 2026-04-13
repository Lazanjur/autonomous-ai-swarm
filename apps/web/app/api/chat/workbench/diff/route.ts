import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";
import { getMockChatWorkbenchDiff, isE2EMockMode } from "@/lib/e2e-mocks";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspace_id");
  const relativePath = request.nextUrl.searchParams.get("relative_path");
  const maxChars = request.nextUrl.searchParams.get("max_chars");
  const query = new URLSearchParams();
  if (workspaceId) {
    query.set("workspace_id", workspaceId);
  }
  if (relativePath) {
    query.set("relative_path", relativePath);
  }
  if (maxChars) {
    query.set("max_chars", maxChars);
  }

  if (isE2EMockMode()) {
    return NextResponse.json(getMockChatWorkbenchDiff(workspaceId, relativePath ?? "README.md"));
  }

  try {
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/chat/workbench/diff?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({ detail: "Workbench diff fetch failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Workbench diff service is unavailable." }, { status: 503 });
  }
}
