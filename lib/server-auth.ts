/**
 * Auth helper for Route Handlers.
 *
 * Next.js 16 proxy docs: "Always verify authentication and authorization
 * inside each Server Function rather than relying on Proxy alone."
 *
 * Usage inside a route handler:
 *   const auth = await requireAuth(req)
 *   if (!auth.ok) return auth.response
 *   // auth.session is now available
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE, type SessionPayload } from "@/lib/auth";
import { isActiveUser } from "@/lib/credentials";

export type AuthResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; response: NextResponse };

/**
 * Verifies the session cookie from the current request.
 * Returns the session payload or a 401 JSON response.
 *
 * For use inside Route Handlers (req: NextRequest).
 */
export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 },
      ),
    };
  }

  const session = await verifySession(token);

  // A removed member's JWT stays valid until it expires; the proxy can't check the DB, so check here.
  if (!session || !(await isActiveUser(session.userId))) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Session expired. Sign in again." },
        { status: 401 },
      ),
    };
  }

  return { ok: true, session };
}

/**
 * Verifies the session from the Next.js cookie store.
 * For use inside Server Actions (no req object available).
 */
export async function requireAuthAction(): Promise<AuthResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 },
      ),
    };
  }

  const session = await verifySession(token);

  // A removed member's JWT stays valid until it expires; the proxy can't check the DB, so check here.
  if (!session || !(await isActiveUser(session.userId))) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Session expired. Sign in again." },
        { status: 401 },
      ),
    };
  }

  return { ok: true, session };
}
