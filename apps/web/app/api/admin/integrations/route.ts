import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";
import { getMockIntegrationStatus, isE2EMockMode } from "@/lib/e2e-mocks";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ detail: "workspace_id is required." }, { status: 400 });
  }

  if (isE2EMockMode()) {
    return NextResponse.json(getMockIntegrationStatus(workspaceId));
  }

  try {
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/admin/integrations?workspace_id=${workspaceId}`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({ detail: "Integration status fetch failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Integration status service is unavailable." }, { status: 503 });
  }
}
