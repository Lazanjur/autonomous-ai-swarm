import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const response = await fetch(
    `${INTERNAL_API_URL}/api/v1/documents/health?${request.nextUrl.searchParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    }
  );

  const data = await response.json().catch(() => ({ detail: "Health fetch failed." }));
  return NextResponse.json(data, { status: response.status });
}
