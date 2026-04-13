import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ membershipId: string }> }
) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ detail: "workspace_id is required." }, { status: 400 });
  }

  try {
    const { membershipId } = await context.params;
    const payload = await request.json();
    const response = await fetch(
      `${INTERNAL_API_URL}/api/v1/admin/memberships/${membershipId}?workspace_id=${workspaceId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        cache: "no-store"
      }
    );
    const data = await response.json().catch(() => ({ detail: "Membership update failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Membership update service is unavailable." }, { status: 503 });
  }
}
