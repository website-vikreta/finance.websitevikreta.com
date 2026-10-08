/**
 * POST /api/chatbot/message
 *
 * Phase 3 + Phase 4 + Phase 5 — Conversational endpoint.
 *
 * Every call runs the full state machine:
 *
 *   READY_FOR_CONFIRMATION:
 *     CONFIRM keywords → mark CONFIRMED, return transaction
 *     CANCEL  keywords → clearAll, return CANCELLED
 *     anything else    → EDIT: restart Phase 1→3→2 chain fresh
 *
 *   AWAITING_EXCHANGE_RATE:
 *     valid positive number → Phase 4 USD conversion → READY_FOR_CONFIRMATION
 *     anything else         → re-ask for rate
 *
 *   COLLECTING (default):
 *     Phase 1 (Gemini) → Phase 3 (merge) → Phase 2 (validate)
 *     incomplete → return question (existing response shape — unchanged)
 *     complete + INR → Phase 4 INR → Phase 5 READY_FOR_CONFIRMATION
 *     complete + USD → set AWAITING_EXCHANGE_RATE, ask for rate
 *
 * Protected by requireAuth — drafts and sessions are isolated per userId.
 *
 * This endpoint MUST NOT:
 *   - save to the database
 *   - create transactions
 *   - call Gemini for exchange rates
 *   - perform any exchange-rate API call
 *   - emit audit logs
 *
 * ── Request ──────────────────────────────────────────────────────────────────
 *   POST /api/chatbot/message
 *   Content-Type: application/json
 *   { "message": "Acme paid 500 USD today for design work" }
 *
 * ── Response shapes ──────────────────────────────────────────────────────────
 *
 * COLLECTING (incomplete draft) — UNCHANGED from Phase 1–3:
 *   { "ok": true, "extraction": {...}, "draft": {...}, "validation": { "complete": false, ... } }
 *
 * AWAITING_EXCHANGE_RATE:
 *   { "ok": true, "status": "AWAITING_EXCHANGE_RATE", "draft": {...},
 *     "question": "What is today's USD to INR exchange rate?" }
 *
 * READY_FOR_CONFIRMATION:
 *   { "ok": true, "status": "READY_FOR_CONFIRMATION", "draft": {...},
 *     "currency": { "exchange_rate": 88.5, "inr_amount": 44250, "exchange_rate_date": "..." },
 *     "confirmation": { "required": true, "transaction": {...} } }
 *
 * CONFIRMED:
 *   { "ok": true, "status": "CONFIRMED", "transaction": {...} }
 *
 * CANCELLED:
 *   { "ok": true, "status": "CANCELLED", "message": "Transaction cancelled. You can start a new one." }
 *
 * Error (400 / 500):
 *   { "ok": false, "error": "..." }
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { extractTransaction, type ExtractionContext } from "@/lib/chatbot/extract";
import { mergeDraft } from "@/lib/chatbot/merge";
import { getDraft, setDraft, getSession, setSession, clearAll } from "@/lib/chatbot/store";
import { validateExtraction } from "@/lib/chatbot/validate";
import { convertToINR, CurrencyConversionError } from "@/lib/currency/convert";
import { buildConfirmationTransaction, ConfirmationBuildError } from "@/lib/chatbot/confirmation";

// ─── Keyword sets for confirmation actions ────────────────────────────────────

const CONFIRM_KEYWORDS = new Set(['confirm', 'yes', 'ok', 'approve', 'confirmed', 'correct', 'right', 'proceed']);
const CANCEL_KEYWORDS  = new Set(['cancel', 'no', 'reject', 'abort', 'cancelled', 'nope', 'stop']);

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const userId = auth.session.userId;

  // ── Parse body ────────────────────────────────────────────────────────────
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
  if (typeof bodyObj?.["message"] !== "string" || !bodyObj["message"].trim()) {
    return NextResponse.json(
      { ok: false, error: 'Body must include a non-empty "message" string.' },
      { status: 400 },
    );
  }

  const message = (bodyObj["message"] as string).trim();
  const today = new Date().toISOString().slice(0, 10);

  // ── Load state ────────────────────────────────────────────────────────────
  let existing = getDraft(userId);
  let session  = getSession(userId);

  // ═══════════════════════════════════════════════════════════════════════════
  // Branch A — READY_FOR_CONFIRMATION
  // ═══════════════════════════════════════════════════════════════════════════
  if (session.status === 'READY_FOR_CONFIRMATION') {
    const keyword = message.toLowerCase().trim();

    // Check single-word keyword match (exact)
    if (CONFIRM_KEYWORDS.has(keyword)) {
      if (!session.currency) {
        return NextResponse.json(
          { ok: false, error: 'Internal error: currency data is missing from session.' },
          { status: 500 },
        );
      }
      try {
        const transaction = buildConfirmationTransaction(existing, session.currency);
        setSession(userId, { status: 'CONFIRMED', currency: session.currency });
        return NextResponse.json(
          { ok: true, status: 'CONFIRMED', transaction },
          { status: 200 },
        );
      } catch (err) {
        if (err instanceof ConfirmationBuildError) {
          return NextResponse.json(
            { ok: false, error: 'Could not build confirmation. Please try again.' },
            { status: 500 },
          );
        }
        throw err;
      }
    }

    if (CANCEL_KEYWORDS.has(keyword)) {
      clearAll(userId);
      return NextResponse.json(
        { ok: true, status: 'CANCELLED', message: 'Transaction cancelled. You can start a new one.' },
        { status: 200 },
      );
    }

    // Neither confirm nor cancel → EDIT: clear everything and re-run Phase 1→3→2 below
    clearAll(userId);  // clears both draft and session atomically
    existing = getDraft(userId);
    session  = getSession(userId);
    // Falls through to Branch C (COLLECTING) below
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Branch B2 — CONFIRMED (guard: prevent re-entry after confirmation)
  // ═══════════════════════════════════════════════════════════════════════════
  if (session.status === 'CONFIRMED') {
    return NextResponse.json(
      {
        ok: false,
        error: 'This transaction has already been confirmed. Use /api/chatbot/reset to start a new one.',
      },
      { status: 409 },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Branch B — AWAITING_EXCHANGE_RATE
  // ═══════════════════════════════════════════════════════════════════════════
  if (session.status === 'AWAITING_EXCHANGE_RATE') {
    const rateValue = parseFloat(message.trim());

    if (Number.isNaN(rateValue) || rateValue <= 0) {
      return NextResponse.json(
        {
          ok: true,
          status: 'AWAITING_EXCHANGE_RATE',
          draft: existing,
          question: 'Please enter a numeric exchange rate (e.g. 88.5).',
        },
        { status: 200 },
      );
    }

    // Valid rate — run Phase 4 USD conversion
    try {
      const currency = convertToINR(existing.original_amount!, 'USD', rateValue);
      const transaction = buildConfirmationTransaction(existing, currency);
      setSession(userId, { status: 'READY_FOR_CONFIRMATION', currency });
      return NextResponse.json(
        {
          ok: true,
          status: 'READY_FOR_CONFIRMATION',
          draft: existing,
          currency: {
            exchange_rate: currency.exchange_rate,
            inr_amount: currency.inr_amount,
            exchange_rate_date: currency.exchange_rate_date,
          },
          confirmation: { required: true, transaction },
        },
        { status: 200 },
      );
    } catch (err) {
      if (err instanceof CurrencyConversionError) {
        return NextResponse.json(
          { ok: false, error: 'Currency conversion failed. Please try again.' },
          { status: 500 },
        );
      }
      if (err instanceof ConfirmationBuildError) {
        return NextResponse.json(
          { ok: false, error: 'Could not build confirmation. Please try again.' },
          { status: 500 },
        );
      }
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Branch C — COLLECTING (default, or fallen through from EDIT)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Load existing draft & derive extraction context ───────────────────────
  // Validate the draft BEFORE calling Gemini so we know what field is currently
  // missing. This context is passed to Gemini so it can correctly interpret
  // short follow-up answers like "USD", "Today", "500", or a client name.
  const currentValidation = validateExtraction(existing);

  const context: ExtractionContext | null =
    currentValidation.missingField && currentValidation.question
      ? {
          missingField: currentValidation.missingField,
          pendingQuestion: currentValidation.question,
        }
      : null;

  // ── Phase 1: Extract (with context when a follow-up is active) ───────────
  const extractResult = await extractTransaction(message, today, context);
  if (!extractResult.ok) {
    return NextResponse.json(
      { ok: false, error: extractResult.error },
      { status: extractResult.status },
    );
  }

  const extraction = extractResult.data;

  // ── Phase 3: Merge extraction into existing draft ─────────────────────────
  const draft = mergeDraft(existing, extraction);
  setDraft(userId, draft);

  // ── Phase 2: Validate merged draft ───────────────────────────────────────
  const validation = validateExtraction(draft);

  if (!validation.complete) {
    // Draft still incomplete — return existing Phase 1–3 response shape (UNCHANGED)
    return NextResponse.json(
      { ok: true, extraction, draft, validation },
      { status: 200 },
    );
  }

  // ── Draft complete — Phase 4: Currency processing ─────────────────────────
  try {
    if (draft.original_currency === 'INR') {
      const currency = convertToINR(draft.original_amount!, 'INR');
      const transaction = buildConfirmationTransaction(draft, currency);
      setSession(userId, { status: 'READY_FOR_CONFIRMATION', currency });
      return NextResponse.json(
        {
          ok: true,
          status: 'READY_FOR_CONFIRMATION',
          draft,
          currency: {
            exchange_rate: null,
            inr_amount: currency.inr_amount,
            exchange_rate_date: currency.exchange_rate_date,
          },
          confirmation: { required: true, transaction },
        },
        { status: 200 },
      );
    }

    if (draft.original_currency === 'USD') {
      setSession(userId, { status: 'AWAITING_EXCHANGE_RATE' });
      return NextResponse.json(
        {
          ok: true,
          status: 'AWAITING_EXCHANGE_RATE',
          draft,
          question: "What is today's USD to INR exchange rate?",
        },
        { status: 200 },
      );
    }

    // Should not be reachable if validation is correct, but handle gracefully
    return NextResponse.json(
      { ok: false, error: 'Unsupported currency in draft. Only INR and USD are supported.' },
      { status: 400 },
    );
  } catch (err) {
    if (err instanceof CurrencyConversionError) {
      return NextResponse.json(
        { ok: false, error: 'Currency conversion failed. Please try again.' },
        { status: 500 },
      );
    }
    if (err instanceof ConfirmationBuildError) {
      return NextResponse.json(
        { ok: false, error: 'Could not build confirmation. Please try again.' },
        { status: 500 },
      );
    }
    throw err;
  }
}

// ── GET: expose current draft + session state ─────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const userId = auth.session.userId;
  const draft = getDraft(userId);
  const validation = validateExtraction(draft);
  const session = getSession(userId);

  return NextResponse.json(
    { ok: true, draft, validation, session: { status: session.status } },
    { status: 200 },
  );
}
