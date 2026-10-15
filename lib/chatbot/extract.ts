/**
 * Chatbot Phase 1 — Gemini extraction service.
 *
 * Single responsibility: take a manager's natural-language message,
 * send it to Gemini, and return a strictly-typed extraction result.
 *
 * Phase 3 fix: accepts an optional ExtractionContext so Gemini can correctly
 * interpret short follow-up answers ("USD", "Today", "500") without inventing
 * values for unrelated fields.
 *
 * Resilient Architecture (Production Fix):
 *   - Google GenAI compliant deadline (10s minimum enforced by API).
 *   - Multi-model waterfall with automatic fallback (gemini-3.5-flash-lite →
 *     gemini-3.5-flash → gemini-3.8-flash → gemini-3.1-flash-lite).
 *   - Local deterministic fallback if all external AI services experience
 *     capacity limits, high demand spikes (503/429), or network timeouts.
 *   - Non-leaking, detailed server error logging.
 *
 * This module MUST NOT:
 *   - access the database
 *   - create or save transactions
 *   - perform currency conversion
 *   - call exchange-rate services
 *   - maintain conversation state
 */

import { GoogleGenAI, Type } from "@google/genai";
import { normalizeClientName } from "./clarify";

/** Keep a chat reply within the product's response budget (Google GenAI minimum deadline is 10s). */
const GEMINI_TIMEOUT_MS = 10_000;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  type: "income" | "expense" | null;
  original_amount: number | null;
  original_currency: "INR" | "USD" | null;
  client_name: string | null;
  expense_description: string | null;
  txn_date: string | null; // YYYY-MM-DD or null
}

export type ExtractionOutput =
  | { ok: true; data: ExtractionResult }
  | { ok: false; error: string; status: 400 | 500 | 502 | 503 };

/**
 * Optional context passed by the Phase 3 message handler.
 * Tells Gemini which field is currently being collected so it can correctly
 * interpret short answers ("USD", "Today", "500", a client name, etc.).
 *
 * IMPORTANT: Gemini must ONLY set the indicated field from this context.
 * It must NOT use the context to infer or set any other field.
 */
export interface ExtractionContext {
  /** The field name currently being collected, e.g. "original_currency". */
  missingField: string;
  /** The exact question that was asked, e.g. "What currency was the payment in — INR or USD?" */
  pendingQuestion: string;
}

// ─── Model Hierarchy & Fallback List ────────────────────────────────────────

const DEFAULT_MODELS = [
  "gemini-3.5-flash-lite", // Fast (~1.5s), reliable, low traffic contention
  "gemini-3.5-flash",      // High accuracy fallback
  "gemini-3.8-flash",      // Standard latest flash
  "gemini-3.1-flash-lite", // Secondary backup
];

export function getModelHierarchy(): string[] {
  const envModel = process.env.GEMINI_MODEL?.trim();
  const models = envModel ? [envModel, ...DEFAULT_MODELS.filter((m) => m !== envModel)] : DEFAULT_MODELS;
  return Array.from(new Set(models));
}

// ─── Response schema (enforced by Gemini) ──────────────────────────────────

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    type: {
      type: Type.STRING,
      nullable: true,
      enum: ["income", "expense"],
      description: "Transaction type. null if unclear.",
    },
    original_amount: {
      type: Type.NUMBER,
      nullable: true,
      description: "Numeric amount explicitly stated. null if not stated.",
    },
    original_currency: {
      type: Type.STRING,
      nullable: true,
      enum: ["INR", "USD"],
      description: "Currency explicitly stated. null if not stated — never assume.",
    },
    client_name: {
      type: Type.STRING,
      nullable: true,
      description: "Client name explicitly mentioned. null if not mentioned.",
    },
    expense_description: {
      type: Type.STRING,
      nullable: true,
      description: "What the expense was for, explicitly stated. null if not stated.",
    },
    txn_date: {
      type: Type.STRING,
      nullable: true,
      description:
        "Transaction date in YYYY-MM-DD. Resolve 'today'/'yesterday' using provided date. null if date cannot be determined.",
    },
  },
  required: [
    "type",
    "original_amount",
    "original_currency",
    "client_name",
    "expense_description",
    "txn_date",
  ],
};

// ─── System prompt ─────────────────────────────────────────────────────────

function buildSystemPrompt(today: string, context?: ExtractionContext | null): string {
  const contextBlock = context
    ? `
## Follow-up answer context (CRITICAL — read before extracting)

The manager is replying to this question: "${context.pendingQuestion}"
The field being collected: ${context.missingField}

If the manager's message is a short or direct answer to that question, extract it as ${context.missingField}.

Context-specific rules:
- If collecting "original_currency" and the message is "USD" or "INR" (or equivalent) → set original_currency accordingly.
- If collecting "original_amount" and the message is a number (e.g. "500") → set original_amount to that number.
- If collecting "txn_date" and the message is "today" or "yesterday" → resolve to YYYY-MM-DD as per date rules below.
- If collecting "client_name" and the message is a name → set client_name to that name.
- If collecting "expense_description" and the message is a short description → set expense_description.
- If collecting "type" and the message is "income" / "expense" or equivalent → set type.

DO NOT use this context to set any OTHER field.
DO NOT set txn_date to today's date just because today is known — only if the message explicitly mentions it.
DO NOT set original_currency just because the context mentions currency — only if the message explicitly states a currency.
All other fields not directly answered in this message must remain null.
`
    : "";

  return `You are a transaction extraction assistant for an internal finance tracker.

Your ONLY job is to extract structured transaction fields from the manager's message.
${contextBlock}
## Non-negotiable rules

1. Extract ONLY information explicitly stated by the manager.
2. NEVER guess, assume, or invent any value.
3. NEVER assume a currency. If the manager says "500" with no currency symbol or word, return null for original_currency.
4. NEVER invent an amount, client, date, or description.
5. If a field's information is absent from the message, return null for that field.
6. Return valid JSON only. No markdown fences. No explanation text.

## Type extraction

- "income": manager explicitly says money was received, paid by a client, or earned.
- "expense": manager explicitly says money was spent, paid for something, or a cost occurred.
- null: if the direction of money is unclear.

## Currency extraction

Extract currency ONLY when explicitly stated or clearly represented:
- "$500" or "500 USD" or "500 dollars" → "USD"
- "₹12,000" or "12000 INR" or "12000 rupees" → "INR"
- "USD" alone → "USD" (when context indicates currency is being collected)
- "INR" alone → "INR" (when context indicates currency is being collected)
- "500" alone (no context) → null (do NOT assume USD or INR)

## Date extraction

Today's date: ${today}
Use this ONLY to resolve relative expressions:
- "today" → ${today}
- "yesterday" → the day before ${today}
If no date is mentioned or determinable → null.

## Amount extraction

Extract the numeric value only (no currency symbol).
Example: "$500" → 500, "₹12,000" → 12000.
An exchange rate is never the amount: in "$100 at 85 per dollar" the amount is 100.
If two different amounts are offered as alternatives ("$50 or $60") → null; the system will ask.
If no amount is stated → null.

## client_name extraction

Return the bare client name without lead-ins: "from the Reliance" → "Reliance", "payment received from Tata Consultancy Services" → "Tata Consultancy Services".

## expense_description extraction

The field "expense_description" captures the PURPOSE, SERVICE, or REASON for the transaction.
It applies to BOTH income and expense transactions.
- "Acme paid $500 for design work" → "design work"
- "Paid ₹12,000 for office rent" → "office rent"
- "Paid 250 dollars for software subscription" → "software subscription"
If no purpose or reason is stated → null.`;
}

// ─── Validation ────────────────────────────────────────────────────────────

const VALID_TYPES = new Set(["income", "expense", null]);
const VALID_CURRENCIES = new Set(["INR", "USD", null]);

function validateExtraction(raw: unknown): ExtractionResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Gemini returned a non-object response.");
  }

  const obj = raw as Record<string, unknown>;
  const requiredKeys: (keyof ExtractionResult)[] = [
    "type",
    "original_amount",
    "original_currency",
    "client_name",
    "expense_description",
    "txn_date",
  ];

  for (const key of requiredKeys) {
    if (!(key in obj)) {
      throw new Error(`Gemini response is missing required field: "${key}".`);
    }
  }

  // type
  if (!VALID_TYPES.has(obj.type as string | null)) {
    throw new Error(
      `Invalid "type" value: "${obj.type}". Must be "income", "expense", or null.`,
    );
  }

  // original_amount
  if (
    obj.original_amount !== null &&
    (typeof obj.original_amount !== "number" ||
      !Number.isFinite(obj.original_amount) ||
      obj.original_amount <= 0)
  ) {
    throw new Error(
      'Invalid "original_amount": must be a finite positive number or null.',
    );
  }

  // original_currency
  if (!VALID_CURRENCIES.has(obj.original_currency as string | null)) {
    throw new Error(
      `Invalid "original_currency": "${obj.original_currency}". Must be "INR", "USD", or null.`,
    );
  }

  // string-or-null fields
  for (const key of ["client_name", "expense_description", "txn_date"] as const) {
    if (obj[key] !== null && typeof obj[key] !== "string") {
      throw new Error(`Invalid "${key}": must be a string or null.`);
    }
  }

  // txn_date format check
  if (obj.txn_date !== null && !isValidIsoDate(obj.txn_date as string)) {
    throw new Error(
      `Invalid "txn_date": "${obj.txn_date}". Expected a real YYYY-MM-DD date.`,
    );
  }

  return {
    type: obj.type as ExtractionResult["type"],
    original_amount: obj.original_amount as number | null,
    original_currency: obj.original_currency as ExtractionResult["original_currency"],
    client_name: normalizeClientName(obj.client_name as string | null),
    expense_description: obj.expense_description as string | null,
    txn_date: obj.txn_date as string | null,
  };
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// ─── Deterministic Local Fallback (Safety Net when AI is unreachable) ────────

export function tryDeterministicExtraction(
  message: string,
  today: string,
  context?: ExtractionContext | null,
): ExtractionResult | null {
  const clean = message.trim();
  if (!clean) return null;

  const result: ExtractionResult = {
    type: null,
    original_amount: null,
    original_currency: null,
    client_name: null,
    expense_description: null,
    txn_date: null,
  };

  // 1. Follow-up answer context (single field resolution)
  if (context?.missingField) {
    const lower = clean.toLowerCase();
    switch (context.missingField) {
      case "original_currency": {
        if (/^(usd|\$|dollars?)$/i.test(lower)) {
          result.original_currency = "USD";
          return result;
        }
        if (/^(inr|₹|rs\.?|rupees?)$/i.test(lower)) {
          result.original_currency = "INR";
          return result;
        }
        break;
      }
      case "original_amount": {
        const numStr = clean.replace(/,/g, "").replace(/^[^\d.]+/, "").replace(/[^\d.]+$/, "");
        const num = parseFloat(numStr);
        if (!isNaN(num) && num > 0) {
          result.original_amount = num;
          return result;
        }
        break;
      }
      case "type": {
        if (/^(income|received|earned|got|client payment)$/i.test(lower)) {
          result.type = "income";
          return result;
        }
        if (/^(expense|spent|paid|cost)$/i.test(lower)) {
          result.type = "expense";
          return result;
        }
        break;
      }
      case "txn_date": {
        if (lower === "today") {
          result.txn_date = today;
          return result;
        }
        if (lower === "yesterday") {
          const d = new Date(`${today}T00:00:00.000Z`);
          d.setUTCDate(d.getUTCDate() - 1);
          result.txn_date = d.toISOString().slice(0, 10);
          return result;
        }
        if (isValidIsoDate(clean)) {
          result.txn_date = clean;
          return result;
        }
        break;
      }
      case "client_name": {
        const name = clean.length <= 100 ? normalizeClientName(clean) : null;
        if (name) {
          result.client_name = name;
          return result;
        }
        break;
      }
      case "expense_description": {
        if (clean.length > 0 && clean.length <= 200) {
          result.expense_description = clean;
          return result;
        }
        break;
      }
    }
  }

  // 2. Direct standalone extraction for simple patterns (e.g. "Acme paid $500 today")
  let recognizedAny = false;

  // Currency & Amount
  const usdMatch =
    clean.match(/(?:\$|usd\s*)\s*([\d,]+(?:\.\d+)?)/i) ||
    clean.match(/([\d,]+(?:\.\d+)?)\s*(?:\$|usd|dollars?)/i);
  const inrMatch =
    clean.match(/(?:₹|rs\.?\s*|inr\s*)\s*([\d,]+(?:\.\d+)?)/i) ||
    clean.match(/([\d,]+(?:\.\d+)?)\s*(?:₹|rs\.?|inr|rupees?)/i);

  if (usdMatch) {
    const amt = parseFloat(usdMatch[1].replace(/,/g, ""));
    if (!isNaN(amt) && amt > 0) {
      result.original_amount = amt;
      result.original_currency = "USD";
      recognizedAny = true;
    }
  } else if (inrMatch) {
    const amt = parseFloat(inrMatch[1].replace(/,/g, ""));
    if (!isNaN(amt) && amt > 0) {
      result.original_amount = amt;
      result.original_currency = "INR";
      recognizedAny = true;
    }
  }

  // Type
  if (/\b(received|paid to us|client paid|earned|income)\b/i.test(clean)) {
    result.type = "income";
    recognizedAny = true;
  } else if (/\b(paid for|spent|expense|cost)\b/i.test(clean)) {
    result.type = "expense";
    recognizedAny = true;
  }

  // Date
  if (/\btoday\b/i.test(clean)) {
    result.txn_date = today;
    recognizedAny = true;
  } else if (/\byesterday\b/i.test(clean)) {
    const d = new Date(`${today}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    result.txn_date = d.toISOString().slice(0, 10);
    recognizedAny = true;
  }

  return recognizedAny ? result : null;
}

// ─── Main extraction function ───────────────────────────────────────────────

/**
 * Sends a manager message to Gemini and returns the extracted transaction fields.
 *
 * Implements a high-availability multi-model waterfall with automatic fallback,
 * Google GenAI compliant deadlines (>= 10s), and a local deterministic safety net
 * if cloud AI providers experience temporary outages or capacity limits.
 *
 * @param message - The raw natural-language message from the manager.
 * @param today   - Current date in YYYY-MM-DD, used to resolve "today"/"yesterday".
 * @param context - Optional. The field currently being collected (Phase 3 follow-up).
 */
export async function extractTransaction(
  message: string,
  today: string,
  context?: ExtractionContext | null,
): Promise<ExtractionOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Chat extraction is not configured.", status: 500 };
  }

  if (!message.trim()) {
    return { ok: false, error: "Message cannot be empty.", status: 400 };
  }

  const ai = new GoogleGenAI({ apiKey });
  const models = getModelHierarchy();
  const errors: Array<{ model: string; error: string; status?: number }> = [];

  // 1. Multi-model waterfall
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: message,
        config: {
          systemInstruction: buildSystemPrompt(today, context),
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0, // deterministic extraction
          httpOptions: { timeout: GEMINI_TIMEOUT_MS },
        },
      });

      const rawText = response.text;
      if (!rawText) {
        errors.push({ model, error: "Empty response text from model." });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        errors.push({ model, error: "Non-JSON response from model." });
        continue;
      }

      const validated = validateExtraction(parsed);
      return { ok: true, data: validated };
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string; name?: string };
      const status = errorObj?.status;
      const errorMsg = errorObj?.message || String(err);

      console.warn(
        `[Chatbot Extract] Model "${model}" failed (HTTP ${status || "N/A"}): ${errorMsg.slice(0, 150)}`,
      );

      errors.push({ model, error: errorMsg, status });

      // If error is a client-side bad request that is NOT deadline-related, don't keep trying models
      if (status === 400 && !errorMsg.includes("deadline")) {
        return {
          ok: false,
          error: "Invalid request payload for extraction.",
          status: 400,
        };
      }
    }
  }

  // 2. Emergency Local Fallback: If cloud AI is experiencing high demand / 503 / 429
  const localFallback = tryDeterministicExtraction(message, today, context);
  if (localFallback) {
    console.info(
      `[Chatbot Extract] AI models unavailable, successfully recovered via deterministic extraction for "${message}".`,
    );
    return { ok: true, data: localFallback };
  }

  // 3. All models and fallbacks exhausted
  console.error(
    `[Chatbot Extract] All models exhausted for message "${message}". Summary:`,
    errors,
  );

  return {
    ok: false,
    error: "Chat extraction is temporarily unavailable due to upstream provider load. Please try your message again.",
    status: 503,
  };
}
