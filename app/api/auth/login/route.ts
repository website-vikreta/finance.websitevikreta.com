/**
 * POST /api/auth/login
 *
 * JSON-based login endpoint for Postman / API clients.
 * The browser login form uses the Server Action in app/login/actions.ts.
 * This route does the same credential check but accepts JSON and returns JSON.
 *
 * Request body:
 *   { "email": "admin@websitevikreta.com", "password": "WVFinance@2026" }
 *
 * Success (200):
 *   { "ok": true }
 *   + Set-Cookie: wv_finance_session=<token>; HttpOnly; ...
 *
 * Failure (401):
 *   { "ok": false, "error": "Email or password is incorrect." }
 */

import { createHash } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

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

  const adminEmail = (process.env.ADMIN_EMAIL ?? "").toLowerCase();
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH ?? "";

  if (!adminEmail || !adminPasswordHash) {
    return NextResponse.json(
      { ok: false, error: "Auth is not configured. Check server env vars." },
      { status: 500 },
    );
  }

  const inputHash = createHash("sha256").update(password).digest("hex");
  const emailMatch = email.trim().toLowerCase() === adminEmail;
  const passwordMatch = inputHash === adminPasswordHash;

  if (!emailMatch || !passwordMatch) {
    return NextResponse.json(
      { ok: false, error: "Email or password is incorrect." },
      { status: 401 },
    );
  }

  const token = await createSession("admin");

  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });

  return res;
}
