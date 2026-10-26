import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { isActiveUser, isAdmin } from "@/lib/credentials";

/**
 * GET /api/auth/me → { role: "Admin" | "Manager" }
 * Returns the authenticated user's display role.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session || !(await isActiveUser(session.userId))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const admin = await isAdmin(session.userId);
  return NextResponse.json({ role: admin ? "Admin" : "Manager" }, { headers: { "Cache-Control": "no-store" } });
}
