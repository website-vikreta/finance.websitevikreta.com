import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";

/**
 * GET /api/auth/logout
 * Clears the session cookie and redirects to /login.
 * Simple GET so it can be triggered from a plain <a href> or router.push().
 */
export async function GET() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
