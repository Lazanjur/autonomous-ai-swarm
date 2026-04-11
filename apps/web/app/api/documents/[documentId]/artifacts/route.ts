import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const { documentId } = await context.params;
    const payload = await request.json();
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/documents/${documentId}/artifacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    const data = await response.json().catch(() => ({ detail: "Artifact generation failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Artifact generation service is unavailable." }, { status: 503 });
  }
}
