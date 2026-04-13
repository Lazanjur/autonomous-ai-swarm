import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

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

  try {
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/chat/workbench/download?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({ detail: "Workbench download failed." }));
      return NextResponse.json(failure, { status: response.status });
    }
    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    }
    const contentDisposition = response.headers.get("content-disposition");
    if (contentDisposition) {
      headers.set("content-disposition", contentDisposition);
    }
    const body = await response.arrayBuffer();
    return new NextResponse(body, { status: 200, headers });
  } catch {
    return NextResponse.json({ detail: "Workbench download service is unavailable." }, { status: 503 });
  }
}
