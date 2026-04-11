type SessionCookieSameSite = "lax" | "strict" | "none";

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function parseSameSite(value: string | undefined): SessionCookieSameSite {
  const normalized = value?.toLowerCase();
  if (normalized === "strict" || normalized === "none") {
    return normalized;
  }
  return "lax";
}

const secureCookieDefault = process.env.NODE_ENV === "production";

export const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME ?? "swarm_session_token";

const sessionCookieSecure = parseBoolean(
  process.env.SESSION_COOKIE_SECURE,
  secureCookieDefault
);
const sessionCookieSameSite = parseSameSite(process.env.SESSION_COOKIE_SAMESITE);
const sessionCookieDomain = process.env.SESSION_COOKIE_DOMAIN?.trim();

export function buildSessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: sessionCookieSameSite,
    secure: sessionCookieSecure,
    path: "/",
    expires,
    ...(sessionCookieDomain ? { domain: sessionCookieDomain } : {})
  };
}

export function buildExpiredSessionCookieOptions() {
  return buildSessionCookieOptions(new Date(0));
}
