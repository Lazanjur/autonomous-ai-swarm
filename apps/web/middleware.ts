import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/app")) {
    const cookieName = process.env.SESSION_COOKIE_NAME ?? "swarm_session_token";
    const token = request.cookies.get(cookieName)?.value;
    if (!token) {
      const signInUrl = new URL("/signin", request.url);
      return NextResponse.redirect(signInUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"]
};
