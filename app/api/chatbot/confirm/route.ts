/**
 * POST /api/chatbot/confirm
 *
 * Phase 5 — Confirmation actions endpoint.
 *
 * Handles explicit manager decisions after READY_FOR_CONFIRMATION:
 *
 *   CONFIRM  — marks the transaction as confirmed (status: CONFIRMED).
 *              Returns the ConfirmationTransaction for Phase 6.
 *              Does NOT write to the database — Phase 6 owns that.
 *
 *   CANCEL   — discards the pending transaction, resets draft + session.
 *              Manager starts fresh.
 *
 *   EDIT     — resets phase to COLLECTING while keeping the existing draft.
 *              The next POST /api/chatbot/message will accept corrections and
 *              re-run Phase 1 → Phase 3 → Phase 2 → Phase 4 → Phase 5.
 *
 * Request:
 *   POST /api/chatbot/confirm
 *   Content-Type: application/json
 *   { "action": "CONFIRM" | "CANCEL" | "EDIT" }
 *
 * Success responses (200):
 *
 *   CONFIRM:
 *   {
 *     "ok": true,
 *     "status": "CONFIRMED",
 *     "transaction": { ...ConfirmationTransaction }
 *   }
 *
 *   CANCEL:
 *   { "ok": true, "status": "CANCELLED", "message": "Transaction discarded." }
 *
 *   EDIT:
 *   { "ok": true, "status": "COLLECTING", "draft": { ...ExtractionResult } }
 *
 * Error responses:
 *   400 — invalid action or wrong state
 *   401 — not authenticated
 *
 * This endpoint MUST NOT:
 *   - write to the database
 *   - call Gemini
 *   - modify transactions outside this session
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { getDraft, setSession, clearAll } from "@/lib/chatbot/store";
import { confirmAndPersistTransaction } from "@/lib/transactions/persist";

const VALID_ACTIONS = new Set(["CONFIRM", "CANCEL", "EDIT"]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const userId = auth.session.userId;

  // -- Parse body -----------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const bodyObj = body as Record<string, unknown>;
  const action = bodyObj?.["action"];

  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { ok: false, error: 'Body must include "action": "CONFIRM" | "CANCEL" | "EDIT".' },
      { status: 400 },
    );
  }

  // -- CONFIRM --------------------------------------------------------------
  if (action === "CONFIRM") {
    const customIdempotencyKey =
      typeof bodyObj?.["idempotencyKey"] === "string" && bodyObj["idempotencyKey"].trim()
        ? (bodyObj["idempotencyKey"] as string).trim()
        : undefined;

    const result = await confirmAndPersistTransaction({
      userId,
      source: "chatbot",
      idempotencyKey: customIdempotencyKey,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, code: result.code },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        status: "CONFIRMED",
        transaction: result.transaction,
        savedTransactionId: result.transaction.id,
      },
      { status: 200 },
    );
  }

  // -- CANCEL ---------------------------------------------------------------
  if (action === "CANCEL") {
    clearAll(userId);

    return NextResponse.json(
      {
        ok: true,
        status: "CANCELLED",
        message: "Transaction discarded. Start a new message to record another.",
      },
      { status: 200 },
    );
  }

  // -- EDIT -----------------------------------------------------------------
  // action === "EDIT"
  // Reset to COLLECTING but keep the draft so the manager can send a correction.
  setSession(userId, { status: "COLLECTING" });

  const draft = getDraft(userId);

  return NextResponse.json(
    {
      ok: true,
      status: "COLLECTING",
      message: "Ready for your correction. Send your updated transaction details.",
      draft,
    },
    { status: 200 },
  );
}
