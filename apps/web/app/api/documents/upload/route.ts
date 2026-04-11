import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/documents/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData,
      cache: "no-store"
    });

    const data = await response.json().catch(() => ({ detail: "Upload failed." }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Upload service is unavailable." }, { status: 503 });
  }
}
