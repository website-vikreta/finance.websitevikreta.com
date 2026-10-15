"use server";

import { createHash } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export type LoginResult = { ok: false; error: string } | { ok: true };

/**
 * Login server action.
 * Compares submitted credentials against the hashed values in env vars.
 * On success: sets an HTTP-only session cookie and redirects to /.
 * On failure: returns an error string shown under the form.
 *
 * Security: password is SHA-256 hashed client-side... actually no, hashing
 * happens here server-side on the raw password. The stored env value is the
 * SHA-256 hex digest. Plaintext never leaves this function.
 */
export async function loginAction(
  _prev: LoginResult,
  formData: FormData,
): Promise<LoginResult> {
  const email = (formData.get("email")?.toString() ?? "").trim().toLowerCase();
  const password = formData.get("password")?.toString() ?? "";

  // Guard: empty fields
  if (!email || !password) {
    return { ok: false, error: "Enter your email and password." };
  }

  const adminEmail = (process.env.ADMIN_EMAIL ?? "").toLowerCase();
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH ?? "";

  if (!adminEmail || !adminPasswordHash) {
    // Env not configured — surface a clear message instead of silently failing.
    return { ok: false, error: "Auth is not configured. Check server env vars." };
  }

  const inputHash = createHash("sha256").update(password).digest("hex");

  const emailMatch = email === adminEmail;
  const passwordMatch = inputHash === adminPasswordHash;

  // Compare both before branching to avoid timing differences leaking which field was wrong.
  if (!emailMatch || !passwordMatch) {
    return { ok: false, error: "Email or password is incorrect." };
  }

  const token = await createSession("admin");
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });

  redirect("/dashboard");
}
