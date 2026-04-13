import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

type Context = {
  params: Promise<{ automationId: string }>;
};

export async function POST(request: NextRequest, context: Context) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const { automationId } = await context.params;
    const body = await request.text();
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/automations/${automationId}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body,
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({ detail: "Automation approval failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Automation approval service is unavailable." }, { status: 503 });
  }
}
