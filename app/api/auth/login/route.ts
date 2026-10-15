/**
 * POST /api/auth/login
 *
 * JSON-based login endpoint for Postman / API clients.
 * The browser login form uses the Server Action in app/login/actions.ts.
 * This route does the same credential check but accepts JSON and returns JSON.
 *
 * Request body:
 *   { "email": "<ADMIN_EMAIL>", "password": "<password>" }
 *
 * Success (200):
 *   { "ok": true }
 *   + Set-Cookie: wv_finance_session=<token>; HttpOnly; ...
 *
 * Failure (401):
 *   { "ok": false, "error": "Email or password is incorrect." }
 */

import { type NextRequest, NextResponse } from "next/server";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { LOGIN_ERRORS, SESSION_COOKIE_OPTIONS, verifyCredentials } from "@/lib/credentials";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const { email, password } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { ok: false, error: 'Body must include "email" and "password" strings.' },
      { status: 400 },
    );
  }

  const check = verifyCredentials(email, password);
  if (check !== "ok") {
    return NextResponse.json(
      { ok: false, error: LOGIN_ERRORS[check] },
      { status: check === "unconfigured" ? 500 : 401 },
    );
  }

  const token = await createSession("admin");

  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

  return res;
}
