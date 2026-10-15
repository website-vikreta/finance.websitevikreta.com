/**
 * Credential check shared by the login form (app/login/actions.ts) and the JSON
 * login route (app/api/auth/login/route.ts), plus the session cookie options both set.
 *
 * The admin email and the SHA-256 hex digest of the password live in env vars
 * (ADMIN_EMAIL, ADMIN_PASSWORD_HASH). Never put real credentials in code or comments.
 */

import { createHash, timingSafeEqual } from "crypto";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export type CredentialCheck = "ok" | "invalid" | "unconfigured";

export const LOGIN_ERRORS = {
  invalid: "Email or password is incorrect.",
  unconfigured: "Auth is not configured. Check server env vars.",
} as const;

// ponytail: single shared admin with an unsalted SHA-256; move to per-user bcrypt/argon2 in app_users
export function verifyCredentials(email: string, password: string): CredentialCheck {
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const adminHash = (process.env.ADMIN_PASSWORD_HASH ?? "").trim().toLowerCase();
  if (!adminEmail || !/^[0-9a-f]{64}$/.test(adminHash)) return "unconfigured";

  const inputHash = createHash("sha256").update(password).digest();
  // Evaluate both checks before branching so timing doesn't reveal which one failed.
  const passwordMatch = timingSafeEqual(inputHash, Buffer.from(adminHash, "hex"));
  const emailMatch = email.trim().toLowerCase() === adminEmail;
  return emailMatch && passwordMatch ? "ok" : "invalid";
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: SESSION_MAX_AGE_SECONDS,
  path: "/",
} as const;
