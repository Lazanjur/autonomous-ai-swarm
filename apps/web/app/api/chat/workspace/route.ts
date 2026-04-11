import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspace_id");
  const threadId = request.nextUrl.searchParams.get("thread_id");
  const query = new URLSearchParams();
  if (workspaceId) {
    query.set("workspace_id", workspaceId);
  }
  if (threadId) {
    query.set("thread_id", threadId);
  }

  try {
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/chat/workspace?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({ detail: "Workspace fetch failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Workspace service is unavailable." }, { status: 503 });
  }
}
