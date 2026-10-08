/**
 * POST /api/chatbot/reset
 *
 * Phase 3 + Phase 4/5 — Clears the current transaction draft AND conversation
 * session state for the authenticated user.
 *
 * Use this to start a fresh conversation without restarting the server.
 *
 * Phase 4/5 change: calls clearAll(userId) instead of clearDraft(userId) so
 * that both the draft store and the session store are reset atomically.
 * Response shape is unchanged: { "ok": true, "message": "Draft cleared." }
 *
 * This endpoint MUST NOT:
 *   - write to the database
 *   - create or delete transactions
 *   - emit audit logs
 *
 * ── Request ──────────────────────────────────────────────────────────────────
 *   POST /api/chatbot/reset
 *   (no body required)
 *
 * ── Success response (200) ───────────────────────────────────────────────────
 *   { "ok": true, "message": "Draft cleared." }
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { clearAll } from "@/lib/chatbot/store";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  clearAll(auth.session.userId);

  return NextResponse.json({ ok: true, message: "Draft cleared." }, { status: 200 });
}
