/**
 * Credential check shared by the login form (app/login/actions.ts) and the JSON
 * login route (app/api/auth/login/route.ts), plus the session cookie options both set.
 *
 * The admin email and the SHA-256 hex digest of the password live in env vars
 * (ADMIN_EMAIL, ADMIN_PASSWORD_HASH). Never put real credentials in code or comments.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { and, eq } from "drizzle-orm";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { db } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";

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

/** Members added from Settings store a salted scrypt hash as "salt:hash" (hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, Buffer.from(salt, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Env admin first, then active members in app_users. Returns the user id to put in the session. */
export async function authenticate(
  email: string,
  password: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: Exclude<CredentialCheck, "ok"> }> {
  const adminCheck = verifyCredentials(email, password);
  if (adminCheck === "ok") return { ok: true, userId: "admin" };

  const [member] = await db
    .select({ id: appUsers.id, passwordHash: appUsers.passwordHash })
    .from(appUsers)
    .where(and(eq(appUsers.email, email.trim().toLowerCase()), eq(appUsers.isActive, true)))
    .limit(1);
  if (member?.passwordHash && verifyPassword(password, member.passwordHash)) return { ok: true, userId: member.id };

  return { ok: false, error: member ? "invalid" : adminCheck };
}

/** A removed member's JWT stays valid until expiry, so the proxy re-checks this on every request. */
// ponytail: one indexed PK lookup per request; cache briefly if it ever shows up in latency
export async function isActiveUser(userId: string): Promise<boolean> {
  if (userId === "admin") return true;
  const [user] = await db.select({ isActive: appUsers.isActive }).from(appUsers).where(eq(appUsers.id, userId)).limit(1);
  return user?.isActive === true;
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: SESSION_MAX_AGE_SECONDS,
  path: "/",
} as const;
