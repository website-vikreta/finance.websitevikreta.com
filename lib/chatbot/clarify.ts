/**
 * Deterministic helpers that sit around Gemini extraction (ported and trimmed from PR #6):
 *
 *   - extractExplicitExchangeRate: a rate stated in the same message as a USD
 *     transaction ("…at 85 per dollar") so we don't ask for it again.
 *   - detectContradiction: "$50 or $60", "today or yesterday" → ask, never guess.
 *   - normalizeClientName: "from the Reliance" → "Reliance".
 *
 * Pure functions. No Gemini, no DB.
 */

import type { ExtractionResult } from "./extract";

const NUM = String.raw`(\d+(?:,\d{3})*(?:\.\d+)?)`;
const RUPEE = String.raw`(?:₹|rs\.?|inr|rupees?)`;
const DOLLAR = String.raw`(?:dollars?|usd|\$)`;

function toRate(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Returns a USD→INR rate only when the message states one explicitly:
 *   "exchange rate is 85", "rate 88.50", "at a rate of 85", "85 per dollar",
 *   "85 rupees per usd", "1 USD = 85 INR". A bare number is never a rate here.
 */
export function extractExplicitExchangeRate(message: string): number | null {
  const patterns = [
    new RegExp(String.raw`\b(?:exchange|conversion)?\s*rate\s*(?:is|of|:|=|was|at|should\s+be)?\s*${RUPEE}?\s*${NUM}`, "i"),
    new RegExp(String.raw`${NUM}\s*${RUPEE}?\s*(?:per|/|a)\s*${DOLLAR}`, "i"),
    new RegExp(String.raw`\b1\s*${DOLLAR}\s*=\s*${RUPEE}?\s*${NUM}`, "i"),
  ];
  for (const pattern of patterns) {
    const rate = toRate(message.match(pattern)?.[1]);
    if (rate !== null) return rate;
  }
  return null;
}

export interface Contradiction {
  field: keyof Pick<ExtractionResult, "original_amount" | "txn_date" | "type" | "original_currency">;
  question: string;
}

/**
 * Detects two alternative values for one field with no indication which is right.
 * Corrections ("not 50, 60", "change 50 to 60") are not contradictions.
 * Only "or" separates alternatives: "/" would misfire on dates like 15/10.
 */
export function detectContradiction(message: string): Contradiction | null {
  const text = message.trim();
  if (!text || /\bnot\s+(?:[$₹]|rs\b|\d)|\b(?:change[ds]?|instead\s+of|update[ds]?\s+to|rather\s+than|actually)\b/i.test(text)) return null;

  const money = String.raw`(?:${DOLLAR}|${RUPEE})?\s*`;
  const amounts = text.match(new RegExp(String.raw`${money}${NUM}\s*(?:${DOLLAR}|${RUPEE})?\s+or\s+(?:maybe\s+)?${money}${NUM}`, "i"));
  if (amounts && toRate(amounts[1]) !== toRate(amounts[2])) {
    return { field: "original_amount", question: "Which amount is correct? Please send just the one amount." };
  }

  const dates = text.match(/\b(today|yesterday|\d{4}-\d{2}-\d{2})\s+or\s+(?:maybe\s+)?(today|yesterday|\d{4}-\d{2}-\d{2})\b/i);
  if (dates && dates[1].toLowerCase() !== dates[2].toLowerCase()) {
    return { field: "txn_date", question: "Which date is correct? Please send just the one date." };
  }

  if (/\b(income\s+or\s+(?:an?\s+)?expense|expense\s+or\s+(?:an?\s+)?income)\b/i.test(text)) {
    return { field: "type", question: "Was this money in (income) or money out (expense)?" };
  }

  if (new RegExp(String.raw`\b(?:inr|rupees?)\s+or\s+(?:usd|dollars?)\b|\b(?:usd|dollars?)\s+or\s+(?:inr|rupees?)\b`, "i").test(text)) {
    return { field: "original_currency", question: "Was this in INR or USD?" };
  }

  return null;
}

/** Brand names that genuinely start with a preposition, kept as-is. */
const PROTECTED = /^(?:from\s*software|to\s+the\s+stars|about\s+you)\b/i;
const PREFIX =
  /^(?:(?:the\s+)?(?:client|vendor|customer)\s*(?:name)?\s*(?:is|:|-)\s*|it\s+(?:is|was)\s+(?:from\s+)?|it'?s\s+(?:from\s+)?|payment\s+(?:was\s+)?(?:received\s+)?from\s+|(?:received|paid|bought|purchased|billed|invoiced?|transfer(?:red)?)\s+(?:from|to|by)\s+|(?:from|to|by)\s+)(?:the\s+)?/i;
const NOT_A_NAME = new Set(["from", "the", "to", "by", "client", "vendor", "customer", "payment", "received", "paid", "unknown", "na", "n/a", "none"]);

/** Strip conversational lead-ins and stray quotes/punctuation from a client name. */
export function normalizeClientName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim();

  if (!PROTECTED.test(name)) {
    const stripped = name.replace(PREFIX, "").trim();
    name = stripped || name;
  }
  name = name.replace(/(?<!\b(?:inc|ltd|corp|co|llc|pvt))[.,!?]+$/i, "").trim();

  return name.length >= 2 && !NOT_A_NAME.has(name.toLowerCase()) ? name : null;
}
