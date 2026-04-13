import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ detail: "workspace_id is required." }, { status: 400 });
  }

  const query = new URLSearchParams({ workspace_id: workspaceId });
  for (const key of ["action", "resource_type", "actor_id", "limit"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) {
      query.set(key, value);
    }
  }

  try {
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/admin/audit?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({ detail: "Audit browse failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Audit service is unavailable." }, { status: 503 });
  }
}
