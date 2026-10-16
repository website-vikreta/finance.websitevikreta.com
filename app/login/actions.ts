"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { authenticate, LOGIN_ERRORS, SESSION_COOKIE_OPTIONS } from "@/lib/credentials";

export type LoginResult = { ok: false; error: string } | { ok: true };

/**
 * Login server action.
 * Checks credentials with authenticate (lib/credentials.ts).
 * On success: sets an HTTP-only session cookie and redirects to /dashboard.
 * On failure: returns an error string shown under the form.
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

  const result = await authenticate(email, password);
  if (!result.ok) return { ok: false, error: LOGIN_ERRORS[result.error] };

  const token = await createSession(result.userId);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

  redirect("/dashboard");
}
