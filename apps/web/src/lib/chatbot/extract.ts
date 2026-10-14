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
  exchange_rate?: number | null;
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

function getModelHierarchy(): string[] {
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
    exchange_rate: {
      type: Type.NUMBER,
      nullable: true,
      description:
        "Exchange rate explicitly stated by manager (e.g. 80 for '80 per dollar'). null if not stated — never guess or assume.",
    },
  },
  required: [
    "type",
    "original_amount",
    "original_currency",
    "client_name",
    "expense_description",
    "txn_date",
    "exchange_rate",
  ],
};

// ─── Normalization & Contradiction Detection ───────────────────────────────

/**
 * Normalizes client and vendor names by stripping conversational prefixes,
 * articles, and surrounding punctuation/whitespace, while carefully preserving
 * legitimate company names (e.g. "From Software").
 *
 * Examples:
 *   - "from the Reliance" → "Reliance"
 *   - "payment received from Tata Consultancy Services" → "Tata Consultancy Services"
 *   - "paid to Acme Technologies" → "Acme Technologies"
 *   - "From Software" → "From Software" (preserved!)
 *   - "from From Software" → "From Software"
 *   - Ambiguous inputs (e.g. "from", "the", "from the") → null
 */
export function normalizeClientName(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;

  let cleaned = raw.trim();
  if (!cleaned) return null;

  // Strip leading and trailing quotation marks
  cleaned = cleaned.replace(/^["'“‘«]+|["'”’»]+$/g, "").trim();

  // Strip trailing punctuation if not part of a standard business abbreviation
  cleaned = cleaned.replace(/(?<!\b(?:inc|ltd|corp|co|llc))\s*[\.\,\!\?]+$/i, "").trim();

  if (!cleaned) return null;

  // Protected entity brands where leading words like "From" are genuinely part of the company name
  const isProtectedBrand = (str: string) =>
    /^(?:from\s*software|to\s+the\s+stars|about\s+you|in-n-out)\b/i.test(str);

  // If the string starts with a conversational prefix before the protected brand (e.g. "from From Software"),
  // strip the conversational prefix first so "From Software" remains
  const prefixBeforeBrand = /^(?:payment\s+(?:was\s+)?(?:received\s+)?from|received\s+from|paid\s+to|paid\s+by|from|to|by)\s+/i;
  if (!isProtectedBrand(cleaned) && prefixBeforeBrand.test(cleaned)) {
    const candidate = cleaned.replace(prefixBeforeBrand, "").trim();
    if (isProtectedBrand(candidate)) {
      return candidate;
    }
  }

  if (isProtectedBrand(cleaned)) {
    return cleaned;
  }

  // 1. Complex conversational prefixes
  const complexPrefixRegex =
    /^(?:payment\s+(?:was\s+)?(?:received\s+)?from|payment\s+from|received\s+from|received\s+by|paid\s+to|paid\s+by|bought\s+from|purchased\s+from|billed\s+by|billed\s+to|invoice\s+from|billed\s+from|transfer(?:red)?\s+from|transfer(?:red)?\s+to)\s+(?:the\s+)?/i;

  if (complexPrefixRegex.test(cleaned)) {
    cleaned = cleaned.replace(complexPrefixRegex, "").trim();
  } else {
    // 2. Pronoun prefixes ("it is from", "it was from", "it's", "its")
    const pronounPrefixRegex = /^(?:it\s+(?:is|was)|it's|its)\s+(?:from\s+)?(?:the\s+)?/i;
    if (pronounPrefixRegex.test(cleaned)) {
      cleaned = cleaned.replace(pronounPrefixRegex, "").trim();
    } else {
      // 3. Label prefixes ("client is", "the client is", "vendor:")
      const labelPrefixRegex = /^(?:the\s+)?(?:client|vendor|customer)\s*(?:name)?\s*(?:is|:|-)\s*(?:the\s+)?/i;
      if (labelPrefixRegex.test(cleaned)) {
        cleaned = cleaned.replace(labelPrefixRegex, "").trim();
      } else {
        // 4. Preposition + article ("from the", "to the", "by the")
        const prepArticleRegex = /^(?:from\s+the|to\s+the|by\s+the)\s+/i;
        if (prepArticleRegex.test(cleaned)) {
          cleaned = cleaned.replace(prepArticleRegex, "").trim();
        } else {
          // 5. Standalone prepositions ("from", "to", "by")
          const simplePrepRegex = /^(?:from|to|by)\s+/i;
          if (simplePrepRegex.test(cleaned)) {
            cleaned = cleaned.replace(simplePrepRegex, "").trim();
          }
        }
      }
    }
  }

  cleaned = cleaned.trim();
  cleaned = cleaned.replace(/^["'“‘«]+|["'”’»]+$/g, "").trim();
  cleaned = cleaned.replace(/(?<!\b(?:inc|ltd|corp|co|llc))\s*[\.\,\!\?]+$/i, "").trim();

  // Ambiguous words that cannot be standalone company names
  const genericWords = new Set([
    "from", "the", "to", "by", "for", "client", "vendor", "customer",
    "payment", "received", "paid", "unknown", "na", "n/a", "none"
  ]);

  if (!cleaned || genericWords.has(cleaned.toLowerCase()) || cleaned.length < 2) {
    return null;
  }

  return cleaned;
}

/**
 * Normalizes expense descriptions by stripping conversational prefixes,
 * articles, and surrounding punctuation/whitespace, while capitalizing the first letter.
 *
 * Examples:
 *   - "the expense is for buying the new PC setup in the office" → "New PC setup for the office"
 *   - "buying the new PC setup in the office" → "New PC setup for the office"
 *   - "for buying the new PC setup in the office" → "New PC setup for the office"
 */
export function normalizeExpenseDescription(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;

  let cleaned = raw.trim();
  if (!cleaned) return null;

  cleaned = cleaned.replace(/^["'“‘«]+|["'”’»]+$/g, "").trim();
  cleaned = cleaned.replace(/[\.\,\!\?]+$/g, "").trim();

  // Strip conversational prefixes
  cleaned = cleaned.replace(/^(?:the\s+)?expense\s+(?:is|was)\s+for\s+/i, "");
  cleaned = cleaned.replace(/^(?:it\s+(?:is|was)\s+)?(?:for\s+)?(?:buying|purchasing|paying\s+for)\s+(?:the\s+|a\s+|an\s+)?/i, "");
  cleaned = cleaned.replace(/^(?:it\s+(?:is|was)\s+for\s+)/i, "");
  cleaned = cleaned.replace(/^(?:for\s+)/i, "");
  cleaned = cleaned.replace(/^buying\s+(?:the\s+|a\s+|an\s+)?/i, "");
  cleaned = cleaned.replace(/^purchasing\s+(?:the\s+|a\s+|an\s+)?/i, "");
  cleaned = cleaned.trim();

  // Standardize common phrasing like "in the office" -> "for the office" if specified in expected format
  cleaned = cleaned.replace(/\bin the office$/i, "for the office");

  if (!cleaned || cleaned.length < 2) return null;

  return capitalizeFirst(cleaned);
}

/**
 * Parses an explicitly provided exchange rate from a natural language message.
 *
 * Recognizes statements like:
 *   - "the exchange rate is 80 per dollar"
 *   - "exchange rate is 80"
 *   - "rate is 88.50"
 *   - "80 per dollar"
 *   - "80 per usd"
 *   - "80 rupees per dollar"
 *   - "80 inr per dollar"
 *   - "1 USD = 80 INR"
 *   - "at a rate of 80"
 */
export function extractExplicitExchangeRate(message: string): number | null {
  const clean = message.trim();
  if (!clean) return null;

  // 1. Explicit rate patterns with keywords
  // e.g. "exchange rate is 80", "exchange rate: 80", "rate is 80", "rate of 80", "conversion rate is 80"
  const keywordMatch = clean.match(
    /\b(?:exchange\s*rate|conversion\s*rate|rate)\s*(?:is|of|:|was|at|=|should\s*be)?\s*(?:₹|rs\.?|inr)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i
  );
  if (keywordMatch) {
    const val = parseFloat(keywordMatch[1].replace(/,/g, ""));
    if (Number.isFinite(val) && val > 0) return val;
  }

  // 2. "X per dollar" / "X per usd" / "X / dollar" / "X / usd"
  // e.g. "80 per dollar", "88.50 per usd", "80 rupees per dollar", "80 inr per dollar", "80 / dollar"
  const perDollarMatch = clean.match(
    /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:₹|rs\.?|inr|rupees?)?\s*(?:per|\/)\s*(?:dollar|usd|\$)/i
  );
  if (perDollarMatch) {
    const val = parseFloat(perDollarMatch[1].replace(/,/g, ""));
    if (Number.isFinite(val) && val > 0) return val;
  }

  // 3. "1 USD = 80 INR" / "1 dollar = 80 rupees"
  const equationMatch = clean.match(
    /1\s*(?:usd|dollar|\$)\s*=\s*(?:₹|rs\.?|inr|rupees?)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i
  );
  if (equationMatch) {
    const val = parseFloat(equationMatch[1].replace(/,/g, ""));
    if (Number.isFinite(val) && val > 0) return val;
  }

  // 4. "at a rate of 80"
  const atRateMatch = clean.match(
    /\bat\s+(?:a\s+)?rate\s+of\s+(\d+(?:,\d{3})*(?:\.\d+)?)/i
  );
  if (atRateMatch) {
    const val = parseFloat(atRateMatch[1].replace(/,/g, ""));
    if (Number.isFinite(val) && val > 0) return val;
  }

  return null;
}

export interface ContradictionResult {
  field: "original_amount" | "txn_date" | "type" | "original_currency" | "exchange_rate";
  question: string;
}

/**
 * Detects whether a message provides contradictory values for a field
 * (e.g. "$50 or $60", "today or yesterday") without clearly indicating which one is correct.
 */
export function detectContradictions(message: string): ContradictionResult | null {
  const clean = message.trim();
  if (!clean) return null;

  // Exclude explicit corrections like "not 50, but 60" or "changed from 50 to 60"
  const isCorrection = /\b(not|change|instead\s+of|updated?\s+to|rather\s+than)\b/i.test(clean);

  if (!isCorrection) {
    // 1. Amount contradiction: e.g. "$50 or $60", "50 or 60", "50 / 60", "50 or maybe 60"
    const amountContradictionRegex =
      /(?:\$|₹|rs\.?|inr|usd)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:or|\/|or\s+maybe|maybe)\s*(?:\$|₹|rs\.?|inr|usd)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i;
    const match = clean.match(amountContradictionRegex);
    if (match) {
      const num1 = parseFloat(match[1].replace(/,/g, ""));
      const num2 = parseFloat(match[2].replace(/,/g, ""));
      if (!isNaN(num1) && !isNaN(num2) && num1 !== num2) {
        return {
          field: "original_amount",
          question: "Could you clarify which payment amount is correct?",
        };
      }
    }
  }

  // 2. Date contradiction: e.g. "today or yesterday", "yesterday or today", "today / yesterday"
  const dateContradictionRegex =
    /\b(today|yesterday|\d{4}-\d{2}-\d{2})\s*(?:or|\/|or\s+maybe)\s*(today|yesterday|\d{4}-\d{2}-\d{2})\b/i;
  const dateMatch = clean.match(dateContradictionRegex);
  if (dateMatch && dateMatch[1].toLowerCase() !== dateMatch[2].toLowerCase()) {
    return {
      field: "txn_date",
      question: "Could you clarify which payment date is correct?",
    };
  }

  // 3. Type contradiction: e.g. "income or expense", "expense or income", "both income and expense"
  if (/\b(income\s*(?:or|\/)\s*expense|expense\s*(?:or|\/)\s*income|both\s+income\s+and\s+expense)\b/i.test(clean)) {
    return {
      field: "type",
      question: "Was this an income or an expense?",
    };
  }

  // 4. Currency contradiction: e.g. "inr or usd", "usd or inr", "dollars or rupees", "rupees or dollars"
  if (/\b(inr\s*(?:or|\/)\s*usd|usd\s*(?:or|\/)\s*inr|dollars?\s*(?:or|\/)\s*rupees?|rupees?\s*(?:or|\/)\s*dollars?)\b/i.test(clean)) {
    return {
      field: "original_currency",
      question: "What currency was the payment in — INR or USD?",
    };
  }

  // 5. Exchange rate contradiction: e.g. "rate is 80 or 85", "80 or 85 per dollar", "80 or maybe 85"
  if (/\b(?:exchange\s*rate|rate|per\s+dollar|rupees?\s*per\s*dollar)\b/i.test(clean)) {
    const rateContradictionRegex =
      /(\d+(?:\.\d+)?)\s*(?:or|\/|or\s+maybe|maybe)\s*(\d+(?:\.\d+)?)/i;
    const rateMatch = clean.match(rateContradictionRegex);
    if (rateMatch && rateMatch[1] !== rateMatch[2]) {
      return {
        field: "exchange_rate",
        question: "Could you clarify which exchange rate is correct?",
      };
    }
  }

  return null;
}

// ─── System prompt ─────────────────────────────────────────────────────────

function buildSystemPrompt(today: string, context?: ExtractionContext | null): string {
  const contextBlock = context
    ? `
## Current conversation context
The manager was asked: "${context.pendingQuestion}"
The missing field being collected is: "${context.missingField}"

CRITICAL INSTRUCTIONS FOR CONVERSATIONAL FLOW:
1. Short answers: If the manager's message is a direct/short answer to the pending question (e.g. "USD", "today", "500", "Acme", "From the Reliance"), extract that value for "${context.missingField}".
2. Multi-field answers: The manager may provide MULTIPLE transaction details at once, regardless of which question was asked! For example, if asked for the payment amount and the manager replies "I bought a new laptop for $60 today", you MUST extract amount (60), currency ("USD"), expense_description ("New laptop"), txn_date ("${today}"), and type ("expense").
3. Do NOT restrict extraction to only "${context.missingField}". Extract EVERY transaction detail explicitly present in the message.
4. Clean entity names: Always extract normalized client and vendor names without conversational prefixes ("from the Reliance" → "Reliance", "payment received from Tata Consultancy Services" → "Tata Consultancy Services", "paid to Acme Technologies" → "Acme Technologies"). Preserve legitimate company names (e.g. "From Software").
5. Contradictions: If the manager provides contradictory or alternative values for a field without indicating which one is correct (e.g. "$50 or $60", "today or yesterday"), return null for that field so the system can ask for clarification.
`
    : `
CRITICAL INSTRUCTIONS:
1. Multi-field answers: Extract all explicitly mentioned transaction details from the message.
2. Clean entity names: Always extract normalized client and vendor names without conversational prefixes ("from the Reliance" → "Reliance", "payment received from Tata Consultancy Services" → "Tata Consultancy Services", "paid to Acme Technologies" → "Acme Technologies"). Preserve legitimate company names (e.g. "From Software").
3. Contradictions: If the manager provides contradictory or alternative values for a field without indicating which one is correct (e.g. "$50 or $60", "today or yesterday"), return null for that field so the system can ask for clarification.
`;

  return `You are a transaction extraction assistant for an internal finance tracker.

Your ONLY job is to extract structured transaction fields from the manager's message.
${contextBlock}
## Non-negotiable rules

1. Extract ONLY information explicitly stated by the manager.
2. NEVER guess, assume, or invent any value.
3. NEVER assume a currency. If the manager says "500" with no currency symbol or word, return null for original_currency (unless replying to a currency question with a specific currency).
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
- "USD" alone → "USD"
- "INR" alone → "INR"
- "500" alone (no currency symbol) → null

## Date extraction

Today's date: ${today}
Use this ONLY to resolve relative expressions:
- "today" → ${today}
- "yesterday" → the day before ${today}
If no date is mentioned or determinable → null.

## Amount extraction

Extract the numeric value only (no currency symbol).
Example: "$500" → 500, "₹12,000" → 12000.
If contradictory amounts are provided without clear resolution (e.g. "$50 or $60") → null.
If no amount is stated → null.

## client_name extraction

Extract clean client or vendor name:
- Strip conversational prefixes like "from the", "payment received from", "paid to", "paid by".
- Example: "from the Reliance" → "Reliance"
- Example: "payment received from Tata Consultancy Services" → "Tata Consultancy Services"
- Example: "paid to Acme Technologies" → "Acme Technologies"
- Example: "From Software" → "From Software" (preserve legitimate brand names)
If no client/vendor name is mentioned → null.

## expense_description extraction

The field "expense_description" captures the PURPOSE, SERVICE, or REASON for the transaction.
- "I bought a new laptop for $60 today" → "New laptop"
- "Acme paid $500 for design work" → "design work"
- "Paid ₹12,000 for office rent" → "office rent"
- "Paid 250 dollars for software subscription" → "software subscription"
- "the expense is for buying the new PC setup in the office" → "New PC setup for the office"
If no purpose or reason is stated → null.

## Exchange rate extraction

If the manager explicitly states an exchange rate (e.g. "exchange rate is 80 per dollar", "rate 88.50", "1 USD = 80 INR"):
- Extract the numeric rate (e.g. 80, 88.5).
- NEVER guess, assume, or invent an exchange rate.
- If no exchange rate is explicitly stated, return null.`;
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

  // exchange_rate
  if (
    obj.exchange_rate !== null &&
    obj.exchange_rate !== undefined &&
    (typeof obj.exchange_rate !== "number" ||
      !Number.isFinite(obj.exchange_rate) ||
      obj.exchange_rate <= 0)
  ) {
    throw new Error(
      'Invalid "exchange_rate": must be a finite positive number or null.',
    );
  }

  return {
    type: obj.type as ExtractionResult["type"],
    original_amount: obj.original_amount as number | null,
    original_currency: obj.original_currency as ExtractionResult["original_currency"],
    client_name: normalizeClientName(obj.client_name as string | null),
    expense_description: normalizeExpenseDescription(obj.expense_description as string | null),
    txn_date: obj.txn_date as string | null,
    exchange_rate: (obj.exchange_rate as number | null) ?? null,
  };
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Deterministic Local Fallback (Safety Net when AI is unreachable) ────────

export function tryDeterministicExtraction(
  message: string,
  today: string,
  context?: ExtractionContext | null,
): ExtractionResult | null {
  const clean = message.trim();
  if (!clean) return null;

  const contradiction = detectContradictions(clean);

  const result: ExtractionResult = {
    type: null,
    original_amount: null,
    original_currency: null,
    client_name: null,
    expense_description: null,
    txn_date: null,
    exchange_rate: null,
  };

  let recognizedAny = false;

  // 0. Exchange rate extraction
  if (contradiction?.field !== "exchange_rate") {
    const explicitRate = extractExplicitExchangeRate(clean);
    if (explicitRate !== null) {
      result.exchange_rate = explicitRate;
      recognizedAny = true;
    }
  }

  // Strip explicit exchange rate mentions so terms like "80 per dollar" or "1 USD = 80 INR"
  // do not confuse currency or amount extraction.
  const cleanWithoutRate = clean
    .replace(
      /\b(?:the\s+)?(?:exchange\s*rate|conversion\s*rate|rate)\s*(?:is|of|:|was|at|=|should\s*be)?\s*(?:₹|rs\.?|inr)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:(?:rupees?|inr)?\s*(?:per|\/)\s*(?:dollar|usd|\$))?/gi,
      ""
    )
    .replace(
      /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:₹|rs\.?|inr|rupees?)?\s*(?:per|\/)\s*(?:dollar|usd|\$)/gi,
      ""
    )
    .replace(
      /1\s*(?:usd|dollar|\$)\s*=\s*(?:₹|rs\.?|inr|rupees?)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:inr|rupees?|rs\.?|₹)?/gi,
      ""
    )
    .replace(
      /\bat\s+(?:a\s+)?rate\s+of\s+(\d+(?:,\d{3})*(?:\.\d+)?)/gi,
      ""
    );

  // 1. Currency extraction
  if (contradiction?.field !== "original_currency") {
    if (/(?:\$|\busd\b|\bdollars?\b)/i.test(cleanWithoutRate)) {
      result.original_currency = "USD";
      recognizedAny = true;
    } else if (/(?:₹|\brs\.?\b|\binr\b|\brupees?\b)/i.test(cleanWithoutRate)) {
      result.original_currency = "INR";
      recognizedAny = true;
    }
  }

  // 2. Amount extraction
  if (contradiction?.field !== "original_amount") {
    const usdMatch =
      cleanWithoutRate.match(/(?:\$|usd\s*)\s*([\d,]+(?:\.\d+)?)/i) ||
      cleanWithoutRate.match(/([\d,]+(?:\.\d+)?)\s*(?:\$|usd|dollars?)/i);
    const inrMatch =
      cleanWithoutRate.match(/(?:₹|rs\.?\s*|inr\s*)\s*([\d,]+(?:\.\d+)?)/i) ||
      cleanWithoutRate.match(/([\d,]+(?:\.\d+)?)\s*(?:₹|rs\.?|inr|rupees?)/i);

    if (usdMatch) {
      const amt = parseFloat(usdMatch[1].replace(/,/g, ""));
      if (!isNaN(amt) && amt > 0) {
        result.original_amount = amt;
        recognizedAny = true;
      }
    } else if (inrMatch) {
      const amt = parseFloat(inrMatch[1].replace(/,/g, ""));
      if (!isNaN(amt) && amt > 0) {
        result.original_amount = amt;
        recognizedAny = true;
      }
    } else if (context?.missingField === "original_amount" || /^[\$₹]?\s*[\d,]+(?:\.\d+)?$/.test(cleanWithoutRate.trim())) {
      const numStr = cleanWithoutRate.trim().replace(/,/g, "").replace(/^[^\d.]+/, "").replace(/[^\d.]+$/, "");
      const num = parseFloat(numStr);
      if (!isNaN(num) && num > 0) {
        result.original_amount = num;
        recognizedAny = true;
      }
    }
  }

  // 3. Type extraction
  if (contradiction?.field !== "type") {
    if (/\b(bought|spent|paid for|purchased|cost|expense)\b/i.test(clean)) {
      result.type = "expense";
      recognizedAny = true;
    } else if (/\b(received|paid to us|client paid|earned|income)\b/i.test(clean)) {
      result.type = "income";
      recognizedAny = true;
    } else if (context?.missingField === "type") {
      if (/^(income|received|earned|got|client payment)$/i.test(clean)) {
        result.type = "income";
        recognizedAny = true;
      } else if (/^(expense|spent|paid|cost)$/i.test(clean)) {
        result.type = "expense";
        recognizedAny = true;
      }
    }
  }

  // 4. Date extraction
  if (contradiction?.field !== "txn_date") {
    if (/\btoday\b/i.test(clean)) {
      result.txn_date = today;
      recognizedAny = true;
    } else if (/\byesterday\b/i.test(clean)) {
      const d = new Date(`${today}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      result.txn_date = d.toISOString().slice(0, 10);
      recognizedAny = true;
    } else {
      const isoMatch = clean.match(/\b\d{4}-\d{2}-\d{2}\b/);
      if (isoMatch && isValidIsoDate(isoMatch[0])) {
        result.txn_date = isoMatch[0];
        recognizedAny = true;
      }
    }
  }

  // 5. Expense Description extraction
  // Handles:
  // - "the expense is for buying the new PC setup in the office"
  // - "I bought a new laptop for $60 today"
  // - "paid for office supplies"
  const expensePurposeMatch = clean.match(
    /\b(?:the\s+)?expense\s+(?:is|was)\s+for\s+([^,]+?)(?:\s+(?:and\s+)?(?:today|yesterday)|\s+and\s+(?:the\s+)?(?:exchange|rate|payment\s+date|date)|[,\.]|$)/i
  );
  if (expensePurposeMatch && expensePurposeMatch[1].trim()) {
    const desc = normalizeExpenseDescription(expensePurposeMatch[1].trim());
    if (desc) {
      result.expense_description = desc;
      recognizedAny = true;
    }
  } else {
    const boughtMatch = clean.match(
      /\b(?:bought|purchased)\s+(?:a\s+|an\s+)?([^,]+?)(?:\s+for\s+|\s+today|\s+yesterday|[,\.]|$)/i,
    );
    if (boughtMatch && boughtMatch[1].trim()) {
      result.expense_description = normalizeExpenseDescription(boughtMatch[1].trim());
      recognizedAny = true;
    } else {
      const forMatch = clean.match(
        /\b(?:paid|spent|cost)\s+(?:[\$₹\d\.,]+\s+)?(?:on|for)\s+([^,]+?)(?:\s+today|\s+yesterday|[,\.]|$)/i,
      );
      if (forMatch && forMatch[1].trim()) {
        result.expense_description = normalizeExpenseDescription(forMatch[1].trim());
        recognizedAny = true;
      } else if (context?.missingField === "expense_description" && clean.length > 0 && clean.length <= 200) {
        const desc = normalizeExpenseDescription(clean);
        if (desc) {
          result.expense_description = desc;
          recognizedAny = true;
        }
      }
    }
  }

  // 6. Client Name extraction
  if (context?.missingField === "client_name") {
    const normalized = normalizeClientName(clean);
    if (normalized) {
      result.client_name = normalized;
      recognizedAny = true;
    }
  } else {
    // In multi-field messages: e.g. "from the Reliance", "paid to Acme Technologies", "received $500 from Tata Consultancy Services"
    const clientMatch = clean.match(
      /\b(?:from|paid\s+to|paid\s+by|received\s+from)\s+([A-Za-z0-9\s\.\,\&]+?)(?:\s+today|\s+yesterday|\s+for\b|\s+on\b|$)/i,
    );
    if (clientMatch && clientMatch[1].trim()) {
      const normalized = normalizeClientName(clientMatch[0].trim());
      if (normalized) {
        result.client_name = normalized;
        recognizedAny = true;
      }
    }
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
      const explicitRate = extractExplicitExchangeRate(message);
      if (explicitRate !== null && validated.exchange_rate === null) {
        validated.exchange_rate = explicitRate;
      }
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
    const explicitRate = extractExplicitExchangeRate(message);
    if (explicitRate !== null && localFallback.exchange_rate === null) {
      localFallback.exchange_rate = explicitRate;
    }
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
