import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";
import { getMockChatWorkbenchTree, isE2EMockMode } from "@/lib/e2e-mocks";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspace_id");
  const relativePath = request.nextUrl.searchParams.get("relative_path");
  const query = new URLSearchParams();
  if (workspaceId) {
    query.set("workspace_id", workspaceId);
  }
  if (relativePath) {
    query.set("relative_path", relativePath);
  }

  if (isE2EMockMode()) {
    return NextResponse.json(getMockChatWorkbenchTree(workspaceId, relativePath ?? "."));
  }

  try {
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/chat/workbench/tree?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({ detail: "Workbench tree fetch failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Workbench tree service is unavailable." }, { status: 503 });
  }
}
