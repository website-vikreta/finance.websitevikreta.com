/**
 * POST /api/chatbot/message   — Phase 1 → Phase 3 → Phase 2 → Phase 4 → Phase 5
 * GET  /api/chatbot/message   — inspect current draft + session state
 *
 * COLLECTING state (normal turn):
 *   1. Load existing draft + session.
 *   2. Derive extraction context from current validation (Phase 2).
 *   3. Extract fields from manager message (Phase 1 / Gemini).
 *   4. Merge extraction into draft (Phase 3).
 *   5. Validate merged draft (Phase 2).
 *   6a. Incomplete → return next question.
 *   6b. Complete + INR  → Phase 4: compute inr_amount → Phase 5: READY_FOR_CONFIRMATION.
 *   6c. Complete + USD  → Phase 4: set AWAITING_EXCHANGE_RATE, ask manager for rate.
 *
 * AWAITING_EXCHANGE_RATE state:
 *   - Parse rate from manager message (no Gemini).
 *   - Valid rate  → Phase 4: compute inr_amount → Phase 5: READY_FOR_CONFIRMATION.
 *   - Invalid     → keep AWAITING_EXCHANGE_RATE, repeat the rate question.
 *
 * READY_FOR_CONFIRMATION state:
 *   - Any new message is treated as a correction → reset to COLLECTING, re-run flow.
 *
 * Phase-specific invariants (ALL preserved):
 *   - Phase 1 extraction unchanged.
 *   - Phase 2 validation unchanged.
 *   - Phase 3 merge/store unchanged.
 *   - Phase 4 never calls Gemini for rates.
 *   - Phase 5 never writes to the database.
 *
 * Protected by requireAuth — drafts isolated per userId.
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { withChatState } from "@/lib/chatbot/persistence";
import { todayInIndia } from "@/lib/transactions/period";
import { extractTransaction, type ExtractionContext } from "@/lib/chatbot/extract";
import { mergeDraft } from "@/lib/chatbot/merge";
import { getDraft, setDraft, getSession, setSession, clearAll } from "@/lib/chatbot/store";
import { validateExtraction } from "@/lib/chatbot/validate";
import { parseExchangeRate, buildConfirmation } from "@/lib/chatbot/confirm";
import { detectContradiction, extractExplicitExchangeRate } from "@/lib/chatbot/clarify";
import { confirmAndPersistTransaction } from "@/lib/transactions/persist";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Greeting detection — used across all states
// ---------------------------------------------------------------------------

/**
 * Tests whether the message is ONLY a casual greeting with no actionable
 * financial instruction. Must NOT match messages like "Hello, change the
 * amount to ₹500" — those contain actionable content.
 */
function isCasualGreeting(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");

  const greetingPatterns = [
    /^hi$/,
    /^hello$/,
    /^hey$/,
    /^hey\s+there$/,
    /^hello\s+there$/,
    /^good\s+(morning|afternoon|evening|day|night)$/,
    /^how\s+are\s+you(\s+doing)?$/,
    /^chat$/,
    /^howdy$/,
    /^greetings$/,
    /^whats\s+up$/,
    /^sup$/,
    /^hola$/,
    /^thanks?$/,
    /^thank\s+you(\s+so\s+much)?$/,
    /^thanks\s+a\s+lot$/,
    /^thx$/,
    /^ty$/,
    /^namaste$/,
  ];

  return greetingPatterns.some((pattern) => pattern.test(normalized));
}

// ---------------------------------------------------------------------------
// Exchange-rate edit detection — matches "change the exchange rate to X"
// ---------------------------------------------------------------------------

/**
 * Detects an explicit exchange-rate edit request such as:
 *   "change the exchange rate to 90"
 *   "set the rate to 88.50 rupees per dollar"
 *   "update exchange rate to 90 INR per USD"
 *   "exchange rate should be 90"
 *   "rate is 90 rupees per usd"
 *
 * Returns the parsed rate (positive finite number) or null if the message
 * is not an exchange-rate edit request.
 */
function parseExchangeRateEditRequest(message: string): number | null {
  const lower = message.toLowerCase().trim();

  // Must mention "rate" or "exchange rate" to be an exchange-rate edit
  if (!/\b(exchange\s*rate|rate)\b/.test(lower)) return null;

  // Must also contain an edit/change/set verb OR be a statement like "rate is 90"
  const hasEditIntent =
    /\b(change|update|set|make|modify|adjust|use)\b/.test(lower) ||
    /\brate\s+(is|should\s+be|would\s+be|will\s+be)\b/.test(lower);

  if (!hasEditIntent) return null;

  // Use the existing rate parser to extract the rate value
  return parseExchangeRate(message);
}

// ---------------------------------------------------------------------------
// Build a context-aware greeting response based on current state
// ---------------------------------------------------------------------------

function buildGreetingResponse(
  draft: ReturnType<typeof getDraft>,
  sessionStatus: string,
  currentValidation: ReturnType<typeof validateExtraction>,
): string {
  const hasDraft =
    draft.type !== null ||
    draft.original_amount !== null ||
    draft.original_currency !== null ||
    draft.txn_date !== null;

  // No active transaction — fresh welcome
  if (!hasDraft && sessionStatus === "COLLECTING") {
    return "Hi! What do you want to record — an income or an expense?";
  }

  // Active transaction in COLLECTING with missing fields
  if (sessionStatus === "COLLECTING" && !currentValidation.complete) {
    const fieldHint = currentValidation.question || "the remaining details";
    return `Hi! ${fieldHint}`;
  }

  // Active complete transaction in COLLECTING (shouldn't normally happen, but safe)
  if (sessionStatus === "COLLECTING" && currentValidation.complete) {
    return "Hi! Your transaction is ready to review.";
  }

  // READY_FOR_CONFIRMATION
  if (sessionStatus === "READY_FOR_CONFIRMATION") {
    return "Hi! Review the summary above: confirm, edit or cancel.";
  }

  // AWAITING_EXCHANGE_RATE
  if (sessionStatus === "AWAITING_EXCHANGE_RATE") {
    return "Hi! What USD → INR rate should I use?";
  }

  // Fallback
  return "Hi! What do you want to record — an income or an expense?";
}

// ---------------------------------------------------------------------------
// POST — send a manager message
// ---------------------------------------------------------------------------
async function handlePost(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const userId = auth.session.userId;

  // -- Parse body ----------------------------------------------------------
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
  const today = todayInIndia();

  // -- Load current state --------------------------------------------------
  const session = getSession(userId);

  // =========================================================================
  // AWAITING_EXCHANGE_RATE — parse rate from manager reply (no Gemini)
  // =========================================================================
  if (session.status === "AWAITING_EXCHANGE_RATE") {
    // Handle greetings during rate collection
    if (isCasualGreeting(message)) {
      return NextResponse.json(
        {
          ok: true,
          status: "AWAITING_EXCHANGE_RATE",
          draft: getDraft(userId),
          question: "Hi! What USD → INR rate should I use? e.g. 88.50",
        },
        { status: 200 },
      );
    }

    const rate = parseExchangeRate(message);

    if (rate === null) {
      return NextResponse.json(
        {
          ok: true,
          status: "AWAITING_EXCHANGE_RATE",
          draft: getDraft(userId),
          question:
            "What USD → INR exchange rate should I use? Send just the number, e.g. 88.50.",
        },
        { status: 200 },
      );
    }

    // Rate is valid — build confirmation
    const draft = getDraft(userId);
    const result = buildConfirmation(draft, rate);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    setSession(userId, {
      status: "READY_FOR_CONFIRMATION",
      idempotencyKey: session.idempotencyKey || `chat-${userId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      currency: {
        original_amount: draft.original_amount as number,
        original_currency: "USD",
        exchange_rate: rate,
        inr_amount: result.transaction.inr_amount,
        exchange_rate_date: today,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        status: "READY_FOR_CONFIRMATION",
        draft,
        confirmation: {
          required: true,
          transaction: result.transaction,
        },
        currency: {
          exchange_rate: rate,
          inr_amount: result.transaction.inr_amount,
        },
      },
      { status: 200 },
    );
  }

  // =========================================================================
  // CONFIRMED — previous transaction was confirmed; clear state to start fresh
  // =========================================================================
  if (session.status === "CONFIRMED") {
    clearAll(userId);
  }

  // =========================================================================
  // READY_FOR_CONFIRMATION — handle confirm/cancel keywords, greetings,
  // exchange-rate edits, or correction message
  // =========================================================================
  if (session.status === "READY_FOR_CONFIRMATION") {
    const lower = message.toLowerCase().trim();

    // -- Confirm / Cancel keywords --
    if (lower === "confirm" || lower === "yes") {
      const result = await confirmAndPersistTransaction({
        userId,
        source: "chatbot",
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
    } else if (lower === "cancel") {
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

    // -- Greeting during review: respond politely, keep state --
    if (isCasualGreeting(message)) {
      const draft = getDraft(userId);
      const currency = session.currency;

      // Rebuild the confirmation to re-display the review card
      if (currency) {
        const transaction = {
          type: draft.type as "income" | "expense",
          original_amount: draft.original_amount as number,
          original_currency: draft.original_currency as "INR" | "USD",
          client_name: draft.client_name,
          expense_description: draft.expense_description,
          txn_date: draft.txn_date as string,
          exchange_rate: currency.exchange_rate,
          inr_amount: currency.inr_amount,
        };

        return NextResponse.json(
          {
            ok: true,
            status: "READY_FOR_CONFIRMATION",
            draft,
            confirmation: {
              required: true,
              transaction,
            },
            question: "Hi! Review the summary above: confirm, edit or cancel.",
          },
          { status: 200 },
        );
      }

      return NextResponse.json(
        {
          ok: true,
          status: "READY_FOR_CONFIRMATION",
          draft,
          question: "Hi! Review the summary above: confirm, edit or cancel.",
        },
        { status: 200 },
      );
    }

    // -- Exchange-rate edit request during review --
    const rateEditValue = parseExchangeRateEditRequest(message);
    if (rateEditValue !== null) {
      const draft = getDraft(userId);

      // Scenario A: USD transaction — apply the new rate
      if (draft.original_currency === "USD") {
        const result = buildConfirmation(draft, rateEditValue);

        if (!result.ok) {
          return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
        }

        setSession(userId, {
          status: "READY_FOR_CONFIRMATION",
          currency: {
            original_amount: draft.original_amount as number,
            original_currency: "USD",
            exchange_rate: rateEditValue,
            inr_amount: result.transaction.inr_amount,
            exchange_rate_date: today,
          },
        });

        return NextResponse.json(
          {
            ok: true,
            status: "READY_FOR_CONFIRMATION",
            draft,
            confirmation: {
              required: true,
              transaction: result.transaction,
            },
            currency: {
              exchange_rate: rateEditValue,
              inr_amount: result.transaction.inr_amount,
            },
            question: `Exchange rate updated to ₹${rateEditValue.toFixed(2)} per USD. Please review the updated details.`,
          },
          { status: 200 },
        );
      }

      // Scenario B: INR transaction — exchange rate is irrelevant
      const currency = session.currency;
      const transaction = currency
        ? {
            type: draft.type as "income" | "expense",
            original_amount: draft.original_amount as number,
            original_currency: draft.original_currency as "INR" | "USD",
            client_name: draft.client_name,
            expense_description: draft.expense_description,
            txn_date: draft.txn_date as string,
            exchange_rate: currency.exchange_rate,
            inr_amount: currency.inr_amount,
          }
        : null;

      return NextResponse.json(
        {
          ok: true,
          status: "READY_FOR_CONFIRMATION",
          draft,
          ...(transaction
            ? { confirmation: { required: true, transaction } }
            : {}),
          question:
            "This transaction is currently in INR, so an exchange rate will not change its amount. Would you like to switch to USD and enter the dollar amount, or keep the transaction in INR?",
        },
        { status: 200 },
      );
    }

    // Any other message is a correction:
    // Discard pending confirmation — manager is making a correction.
    setSession(userId, { status: "COLLECTING" });
    // Fall through to the COLLECTING flow below with the existing draft intact.
  }

  // =========================================================================
  // COLLECTING — normal Phase 1 → Phase 3 → Phase 2 loop
  // =========================================================================

  // Validate existing draft to derive context for Gemini (Phase 2 before extract)
  const existing = getDraft(userId);
  const currentValidation = validateExtraction(existing);

  // Casual greeting: respond warmly without premature validation errors
  if (isCasualGreeting(message)) {
    const greetingText = buildGreetingResponse(existing, "COLLECTING", currentValidation);

    return NextResponse.json(
      {
        ok: true,
        status: "COLLECTING",
        draft: existing,
        validation: {
          ...currentValidation,
          question: greetingText,
        },
        question: greetingText,
      },
      { status: 200 },
    );
  }

  // -- Exchange-rate edit in COLLECTING state (after EDIT action) --
  const rateEditInCollecting = parseExchangeRateEditRequest(message);
  if (rateEditInCollecting !== null && currentValidation.complete) {
    // USD draft — apply the rate and go to confirmation
    if (existing.original_currency === "USD") {
      const result = buildConfirmation(existing, rateEditInCollecting);

      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }

      setSession(userId, {
        status: "READY_FOR_CONFIRMATION",
        currency: {
          original_amount: existing.original_amount as number,
          original_currency: "USD",
          exchange_rate: rateEditInCollecting,
          inr_amount: result.transaction.inr_amount,
          exchange_rate_date: today,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          status: "READY_FOR_CONFIRMATION",
          draft: existing,
          validation: currentValidation,
          confirmation: {
            required: true,
            transaction: result.transaction,
          },
          currency: {
            exchange_rate: rateEditInCollecting,
            inr_amount: result.transaction.inr_amount,
          },
          question: `Exchange rate updated to ₹${rateEditInCollecting.toFixed(2)} per USD. Please review the updated details.`,
        },
        { status: 200 },
      );
    }

    // INR draft — rate not applicable
    if (existing.original_currency === "INR") {
      return NextResponse.json(
        {
          ok: true,
          status: "COLLECTING",
          draft: existing,
          validation: currentValidation,
          question:
            "This transaction is currently in INR, so an exchange rate will not change its amount. Would you like to switch to USD and enter the dollar amount, or keep the transaction in INR?",
        },
        { status: 200 },
      );
    }
  }

  const context: ExtractionContext | null =
    currentValidation.missingField && currentValidation.question
      ? {
          missingField: currentValidation.missingField,
          pendingQuestion: currentValidation.question,
        }
      : null;

  // Phase 1 — Gemini extraction
  const extractResult = await extractTransaction(message, today, context);
  if (!extractResult.ok) {
    return NextResponse.json(
      { ok: false, error: extractResult.error },
      { status: extractResult.status },
    );
  }

  const extraction = extractResult.data;

  // Two alternative values for one field ("$50 or $60") — drop it and ask, never guess.
  const contradiction = detectContradiction(message);
  if (contradiction) extraction[contradiction.field] = null;

  // Phase 3 — merge + store
  const draft = mergeDraft(existing, extraction);
  setDraft(userId, draft);

  // Phase 2 — validate merged draft
  const validation = validateExtraction(draft);

  if (contradiction) {
    const clarifying = { ...validation, complete: false, missingField: contradiction.field, question: contradiction.question };
    return NextResponse.json(
      { ok: true, status: "COLLECTING", extraction, draft, validation: clarifying, question: contradiction.question },
      { status: 200 },
    );
  }

  // Still collecting fields — return next question
  if (!validation.complete) {
    return NextResponse.json(
      {
        ok: true,
        status: "COLLECTING",
        extraction,
        draft,
        validation,
      },
      { status: 200 },
    );
  }

  // =========================================================================
  // Draft is COMPLETE — run Phase 4 (currency)
  // =========================================================================

  if (draft.original_currency === "INR") {
    // INR path — no rate needed
    const result = buildConfirmation(draft, null);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    setSession(userId, {
      status: "READY_FOR_CONFIRMATION",
      idempotencyKey: session.idempotencyKey || `chat-${userId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      currency: {
        original_amount: draft.original_amount as number,
        original_currency: "INR",
        exchange_rate: null,
        inr_amount: result.transaction.inr_amount,
        exchange_rate_date: today,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        status: "READY_FOR_CONFIRMATION",
        extraction,
        draft,
        validation,
        confirmation: {
          required: true,
          transaction: result.transaction,
        },
        currency: {
          exchange_rate: null,
          inr_amount: result.transaction.inr_amount,
        },
      },
      { status: 200 },
    );
  }

  // USD path — use a rate stated in this message ("…at 85 per dollar"), otherwise ask for one.
  // ponytail: only the current message is checked; a rate given in an earlier turn is asked for again
  const statedRate = extractExplicitExchangeRate(message);
  if (statedRate !== null) {
    const result = buildConfirmation(draft, statedRate);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    setSession(userId, {
      status: "READY_FOR_CONFIRMATION",
      idempotencyKey: session.idempotencyKey || `chat-${userId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      currency: {
        original_amount: draft.original_amount as number,
        original_currency: "USD",
        exchange_rate: statedRate,
        inr_amount: result.transaction.inr_amount,
        exchange_rate_date: today,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        status: "READY_FOR_CONFIRMATION",
        extraction,
        draft,
        validation,
        confirmation: { required: true, transaction: result.transaction },
        currency: { exchange_rate: statedRate, inr_amount: result.transaction.inr_amount },
      },
      { status: 200 },
    );
  }

  setSession(userId, { status: "AWAITING_EXCHANGE_RATE" });

  return NextResponse.json(
    {
      ok: true,
      status: "AWAITING_EXCHANGE_RATE",
      extraction,
      draft,
      validation,
      question:
        "What USD → INR rate should I use? Send just the number, e.g. 88.50.",
    },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// GET — inspect current draft + session state (no message sent)
// ---------------------------------------------------------------------------
async function handleGet(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const userId = auth.session.userId;
  const draft = getDraft(userId);
  const session = getSession(userId);
  const validation = validateExtraction(draft);

  return NextResponse.json(
    { ok: true, status: session.status, draft, validation, currency: session.currency ?? null },
    { status: 200 },
  );
}

export const POST = withChatState(handlePost);
export const GET = withChatState(handleGet);
