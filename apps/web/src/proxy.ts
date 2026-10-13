import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";

/**
 * Proxy — Next.js 16 route guard (replaces middleware.ts).
 * Runs on the Node.js runtime before every matched request.
 *
 * Rules:
 * - /login and /api/auth/* are public (no session required).
 * - Everything else requires a valid session JWT in the session cookie.
 * - Invalid / expired token → cookie cleared + redirect to /login.
 *
 * NOTE (from Next.js docs): Server Functions (Server Actions) are handled as
 * POST requests to the route they live on. A proxy matcher that excludes a
 * path also excludes its Server Functions. /login is public, so the login
 * Server Action on that path passes through correctly.
 * Always validate auth inside each Server Function too — proxy is the first
 * gate, not the only gate.
 */

/**
 * Paths that do NOT require a session. Checked as prefix matches.
 * /api/auth covers: /api/auth/login (JSON login for Postman) and
 *                   /api/auth/logout (cookie clear).
 */
const PUBLIC_PREFIXES = ["/login", "/api/auth"];

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Pass through auth API routes (login endpoint, logout endpoint).
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

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
    if (token) {
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
