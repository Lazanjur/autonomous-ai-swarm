import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL, SESSION_COOKIE_NAME } from "@/lib/server-runtime";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ artifactId: string }> }
) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const { artifactId } = await context.params;
    const response = await fetch(`${INTERNAL_API_URL}/api/v1/artifacts/${artifactId}/download`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({ detail: "Download failed." }));
      return NextResponse.json(data, { status: response.status });
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      response.headers.get("content-type") ?? "application/octet-stream"
    );
    const disposition = response.headers.get("content-disposition");
    if (disposition) {
      headers.set("Content-Disposition", disposition);
    }

    return new NextResponse(response.body, {
      status: 200,
      headers
    });
  } catch {
    return NextResponse.json({ detail: "Download service is unavailable." }, { status: 503 });
  }
}
