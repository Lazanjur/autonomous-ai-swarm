import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";
import {
  getMockChatWorkbenchFile,
  isE2EMockMode,
  saveMockChatWorkbenchFile
} from "@/lib/e2e-mocks";

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
    return NextResponse.json(getMockChatWorkbenchFile(workspaceId, relativePath ?? "README.md"));
  }

  try {
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/chat/workbench/file?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({ detail: "Workbench file fetch failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Workbench file service is unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await request.json();

    if (isE2EMockMode()) {
      return NextResponse.json(
        saveMockChatWorkbenchFile(payload.workspace_id, payload.relative_path, payload.content ?? "")
      );
    }

    const response = await fetch(`${INTERNAL_API_URL}/api/v1/chat/workbench/file`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({ detail: "Workbench save failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Workbench save service is unavailable." }, { status: 503 });
  }
}
