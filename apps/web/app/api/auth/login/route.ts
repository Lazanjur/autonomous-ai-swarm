import { NextRequest, NextResponse } from "next/server";
import {
  buildSessionCookieOptions,
  INTERNAL_API_URL,
  SESSION_COOKIE_NAME
} from "@/lib/server-runtime";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    const response = await fetch(`${INTERNAL_API_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": request.headers.get("user-agent") ?? "swarm-web"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    const data = await response.json().catch(() => ({ detail: "Login failed." }));
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const nextResponse = NextResponse.json({
      user: data.user,
      workspaces: data.workspaces
    });

    nextResponse.cookies.set(
      SESSION_COOKIE_NAME,
      data.token,
      buildSessionCookieOptions(new Date(data.expires_at))
    );

    return nextResponse;
  } catch {
    return NextResponse.json({ detail: "Login service is unavailable." }, { status: 503 });
  }
}
