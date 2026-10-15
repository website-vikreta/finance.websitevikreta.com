/**
 * POST /api/chatbot/extract
 *
 * Phase 1 test endpoint — manually send a manager message and inspect
 * the structured extraction result from Gemini.
 *
 * Protected by proxy.ts (requires a valid session cookie).
 * This endpoint ONLY calls the extraction service. It does NOT:
 *   - save anything to the database
 *   - perform currency conversion
 *   - create transactions
 *   - confirm anything
 *
 * Request body:
 *   { "message": "Acme paid $500 for design work today." }
 *
 * Success response (200):
 *   { "ok": true, "data": { type, original_amount, ... } }
 *
 * Error response (400 / 500):
 *   { "ok": false, "error": "..." }
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { todayInIndia } from "@/lib/transactions/period";
import { extractTransaction } from "@/lib/chatbot/extract";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Development/test-only endpoint: the UI never calls it, and in production it would
  // let any signed-in user make raw Gemini calls.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  // Defense-in-depth: verify session inside the handler too.
  // Next.js 16 docs: "Always verify auth inside each route handler —
  // proxy is the first gate, not the only gate."
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>)["message"] !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: 'Request body must include a "message" string field.' },
      { status: 400 },
    );
  }

  const message = ((body as Record<string, unknown>)["message"] as string).trim();

  if (!message) {
    return NextResponse.json(
      { ok: false, error: "message cannot be empty." },
      { status: 400 },
    );
  }

  // Today's date in YYYY-MM-DD (server local is IST, use UTC for consistency)
  const today = todayInIndia();

  const result = await extractTransaction(message, today);

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json(result, { status: 200 });
}
