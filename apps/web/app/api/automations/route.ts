import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${INTERNAL_API_URL}/api/v1/automations?${request.nextUrl.searchParams.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      }
    );
    const data = await response.json().catch(() => ({ detail: "Automation fetch failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Automation service is unavailable." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.text();
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/automations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body,
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({ detail: "Automation creation failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Automation creation service is unavailable." }, { status: 503 });
  }
}
