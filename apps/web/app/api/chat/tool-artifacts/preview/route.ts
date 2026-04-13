import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspace_id");
  const storageKey = request.nextUrl.searchParams.get("storage_key");
  const query = new URLSearchParams();
  if (workspaceId) {
    query.set("workspace_id", workspaceId);
  }
  if (storageKey) {
    query.set("storage_key", storageKey);
  }

  try {
    const response = await fetch(
      `${INTERNAL_API_URL}/api/v1/chat/tool-artifacts/preview?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      }
    );

    if (!response.ok || !response.body) {
      const payload = await response.text().catch(() => '{"detail":"Tool artifact preview failed."}');
      return new NextResponse(payload, {
        status: response.status,
        headers: {
          "Content-Type": response.headers.get("content-type") ?? "application/json"
        }
      });
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=60"
      }
    });
  } catch {
    return NextResponse.json({ detail: "Tool artifact preview service is unavailable." }, { status: 503 });
  }
}
