import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";

/**
 * Proxy — Next.js 16 route guard (replaces middleware.ts).
 * Runs before every matched request. No database here: Netlify deploys the proxy as an Edge
 * Function, which can't load `pg`. Whether a member is still active comes from
 * /api/auth/session (Node), cached briefly per member.
 *
 * Rules:
 * - /login and /api/auth/* are public (no session required).
 * - Everything else requires a valid session JWT in the session cookie.
 * - Invalid / expired token, or a removed member → cookie cleared + redirect to /login.
 *
 * NOTE (from Next.js docs): Server Functions (Server Actions) are handled as
 * POST requests to the route they live on. A proxy matcher that excludes a
 * path also excludes its Server Functions. /login is public, so the login
 * Server Action on that path passes through correctly.
 * Always validate auth inside each Server Function too — proxy is the first
 * gate, not the only gate.
 */

// ponytail: per-isolate cache, so a removed member can keep access for up to ACTIVE_TTL_MS.
const ACTIVE_TTL_MS = 60_000;
const activeUntil = new Map<string, number>();

/**
 * Asks the Node route whether the cookie's member is still active (the Edge proxy can't query the DB).
 * null = couldn't tell (network error): deny this request but keep the cookie, so a blip doesn't log people out.
 */
async function stillActive(req: NextRequest, userId: string): Promise<boolean | null> {
  if (userId === "admin") return true; // the env admin can't be removed
  if ((activeUntil.get(userId) ?? 0) > Date.now()) return true;
  const res = await fetch(new URL("/api/auth/session", req.url), { headers: { cookie: req.headers.get("cookie") ?? "" }, cache: "no-store" }).catch(() => null);
  if (!res || (res.status !== 204 && res.status !== 401)) return null;
  if (res.status === 401) return false;
  activeUntil.set(userId, Date.now() + ACTIVE_TTL_MS);
  return true;
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Pass through auth API routes (login endpoint, logout endpoint).
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const verified = token ? await verifySession(token) : null;
  const active = verified ? await stillActive(req, verified.userId) : false;
  const session = active ? verified : null;

  // If visiting /login:
  if (pathname === "/login") {
    if (session) {
      // Already logged in -> redirect to /dashboard
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    // Not logged in -> allow access to login page
    return NextResponse.next();
  }

  // Not authenticated -> redirect page requests to /login (401 JSON for /api/*)
  if (!session) {
    const res = unauthenticated(req);
    if (token && active !== null) {
      res.cookies.delete(SESSION_COOKIE);
    }
    return res;
  }

  // Authenticated user visiting root "/" -> redirect to /dashboard
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Valid session -> allow access to protected page or API
  return NextResponse.next();
}

/**
 * Returns the appropriate unauthenticated response:
 * - API routes (/api/*): 401 JSON — clients expect JSON, not an HTML redirect.
 * - Page routes: 307 redirect to /login — browser follows it to the login page.
 */
function unauthenticated(req: NextRequest): NextResponse {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated." },
      { status: 401 },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Public assets must bypass auth. The Next image optimizer fetches the source
  // image internally, so redirecting `/brand/*.png` here makes optimized images fail.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
