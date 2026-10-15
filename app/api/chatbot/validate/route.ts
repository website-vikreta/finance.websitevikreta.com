/**
 * POST /api/chatbot/validate
 *
 * Phase 2 test endpoint — chains Gemini extraction (Phase 1) with the
 * missing-field engine (Phase 2) and returns a MissingFieldResult.
 *
 * Protected by proxy.ts (requires a valid session cookie).
 *
 * This endpoint ONLY extracts and validates. It does NOT:
 *   - save anything to the database
 *   - perform currency conversion
 *   - create transactions
 *   - manage conversation state
 *   - confirm anything
 *
 * ── Request body ─────────────────────────────────────────────────────────────
 *
 *   Option A — natural-language message (runs Phase 1 + Phase 2):
 *     { "message": "Acme paid $500 for design work today." }
 *
 *   Option B — pre-extracted object (runs Phase 2 only, skips Gemini):
 *     { "extraction": { "type": "income", "original_amount": 500, ... } }
 *
 * ── Success response (200) ───────────────────────────────────────────────────
 *
 *   {
 *     "ok": true,
 *     "extraction": { ...ExtractionResult },
 *     "validation": {
 *       "complete": false,
 *       "missingField": "original_currency",
 *       "question": "What currency was the payment in — INR or USD?"
 *     }
 *   }
 *
 * ── Error response (400 / 500) ───────────────────────────────────────────────
 *
 *   { "ok": false, "error": "..." }
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { todayInIndia } from "@/lib/transactions/period";
import { extractTransaction, type ExtractionResult } from "@/lib/chatbot/extract";
import { validateExtraction } from "@/lib/chatbot/validate";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Development/test-only endpoint: the UI never calls it, and in production it would
  // let any signed-in user make raw Gemini calls.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  // Defense-in-depth auth check inside the handler.
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  // ── Parse request body ────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { ok: false, error: 'Request body must be a JSON object with "message" or "extraction".' },
      { status: 400 },
    );
  }

  const bodyObj = body as Record<string, unknown>;

  // ── Determine input mode ──────────────────────────────────────────────────

  let extraction: ExtractionResult;

  if (typeof bodyObj["message"] === "string") {
    // ── Mode A: natural-language message → Phase 1 + Phase 2 ───────────────
    const message = bodyObj["message"].trim();

    if (!message) {
      return NextResponse.json(
        { ok: false, error: "message cannot be empty." },
        { status: 400 },
      );
    }

    const today = todayInIndia();
    const extractResult = await extractTransaction(message, today);

    if (!extractResult.ok) {
      return NextResponse.json(
        { ok: false, error: extractResult.error },
        { status: extractResult.status },
      );
    }

    extraction = extractResult.data;
  } else if (typeof bodyObj["extraction"] === "object" && bodyObj["extraction"] !== null) {
    // ── Mode B: pre-extracted object → Phase 2 only (no Gemini call) ───────
    const raw = bodyObj["extraction"] as Record<string, unknown>;

    // Light structural check — full validation is Gemini's concern in Mode A.
    // Here we only ensure the shape is usable by the validator.
    const ALLOWED_TYPES = new Set(["income", "expense", null]);
    const ALLOWED_CURRENCIES = new Set(["INR", "USD", null]);

    if (!ALLOWED_TYPES.has(raw["type"] as string | null)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid "type". Must be "income", "expense", or null.' },
        { status: 400 },
      );
    }

    if (
      raw["original_amount"] !== null &&
      raw["original_amount"] !== undefined &&
      typeof raw["original_amount"] !== "number"
    ) {
      return NextResponse.json(
        { ok: false, error: '"original_amount" must be a number or null.' },
        { status: 400 },
      );
    }

    if (!ALLOWED_CURRENCIES.has(raw["original_currency"] as string | null)) {
      return NextResponse.json(
        { ok: false, error: '"original_currency" must be "INR", "USD", or null.' },
        { status: 400 },
      );
    }

    extraction = {
      type: (raw["type"] ?? null) as ExtractionResult["type"],
      original_amount: (raw["original_amount"] ?? null) as number | null,
      original_currency: (raw["original_currency"] ?? null) as ExtractionResult["original_currency"],
      client_name: (raw["client_name"] ?? null) as string | null,
      expense_description: (raw["expense_description"] ?? null) as string | null,
      txn_date: (raw["txn_date"] ?? null) as string | null,
    };
  } else {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Request body must include either a "message" string or an "extraction" object.',
      },
      { status: 400 },
    );
  }

  // ── Phase 2: run the missing-field engine ─────────────────────────────────
  const validation = validateExtraction(extraction);

  return NextResponse.json(
    { ok: true, extraction, validation },
    { status: 200 },
  );
}
