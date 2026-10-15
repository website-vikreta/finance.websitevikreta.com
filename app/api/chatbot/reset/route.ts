/**
 * POST /api/chatbot/reset
 *
 * Clears the current transaction draft AND session state for the authenticated user.
 *
 * Phase 4/5 update: now calls clearAll() (instead of clearDraft()) to atomically
 * reset both the Phase 3 draft store and the Phase 4/5 session store.
 * This ensures no ghost session state (AWAITING_EXCHANGE_RATE, READY_FOR_CONFIRMATION)
 * is left behind after a reset.
 *
 * This endpoint MUST NOT:
 *   - write to the database
 *   - create or delete transactions
 *   - emit audit logs
 *
 * Request:  POST /api/chatbot/reset  (no body required)
 * Response: { "ok": true, "message": "Draft cleared." }
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
