import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.text();
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/chat/runs/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body,
      cache: "no-store"
    });

    if (!response.ok || !response.body) {
      const payload = await response.text().catch(() => '{"detail":"Streaming failed."}');
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
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch {
    return NextResponse.json({ detail: "Streaming service is unavailable." }, { status: 503 });
  }
}
