import { NextRequest, NextResponse } from "next/server";
import {
  buildExpiredSessionCookieOptions,
  INTERNAL_API_URL,
  SESSION_COOKIE_NAME
} from "@/lib/server-runtime";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await fetch(`${INTERNAL_API_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
  }

  const response = NextResponse.json({ status: "ok" });
  response.cookies.set(SESSION_COOKIE_NAME, "", buildExpiredSessionCookieOptions());
  return response;
}
