import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { isActiveUser } from "@/lib/credentials";

/**
 * GET /api/auth/session → 204 if the session cookie belongs to an active member, else 401.
 * Asked by proxy.ts: Netlify runs the proxy as an Edge Function, which can't load `pg`,
 * so the database check happens here, on Node.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  const active = session ? await isActiveUser(session.userId) : false;
  return new NextResponse(null, { status: active ? 204 : 401, headers: { "Cache-Control": "no-store" } });
}
