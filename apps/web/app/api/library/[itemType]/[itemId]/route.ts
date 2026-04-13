import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ itemType: string; itemId: string }> }
) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const { itemType, itemId } = await context.params;
    const body = await request.text();
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/library/${itemType}/${itemId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({ detail: "Library update failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Library service is unavailable." }, { status: 503 });
  }
}
