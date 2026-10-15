/**
 * Chatbot Phase 4 + Phase 5 — Confirmation helpers.
 *
 * Single responsibility: turn a complete ExtractionResult + optional
 * manager-supplied exchange rate into a ConfirmationTransaction, and
 * parse a plain-text rate answer from the manager.
 *
 * Phase 4 (currency):
 *   - INR path  → inr_amount = original_amount, exchange_rate = null.
 *   - USD path  → manager types the rate; this module parses + validates it.
 *   - Gemini MUST NOT supply or calculate rates.
 *
 * Phase 5 (confirmation):
 *   - Builds the ConfirmationTransaction ready for the API response.
 *   - No database writes. Phase 6 owns the save.
 *
 * This module MUST NOT:
 *   - call Gemini
 *   - access the database
 *   - call external exchange-rate APIs
 *   - access the draft store
 *   - perform side-effects of any kind
 */

import type { ExtractionResult } from "./extract";
import { convertUsdToInrDecimal, DecimalPrecisionError } from "@/lib/currency/precision";

// --- Types -------------------------------------------------------------------

/**
 * The fully resolved transaction ready for Phase 6 (database save).
 *
 * Data-safety rules (data-safety.md):
 *   - original_amount and inr_amount carry the human-scale values here.
 *   - Phase 6 must multiply by 100 and round to integer paise/cents before
 *     storing — minor-unit conversion belongs at the persistence boundary.
 *   - exchange_rate is the manager-supplied rate; null for INR transactions.
 *   - This object is treated as immutable once returned.
 */
export interface ConfirmationTransaction {
  /** Database transaction UUID, present after confirmation persistence. */
  id?: string;
  type: "income" | "expense";
  original_amount: number;
  original_currency: "INR" | "USD";
  /** Populated for income (requireClientForIncome); null for expense. */
  client_name: string | null;
  /** Populated for expense (requireDescriptionForExpense); null for income. */
  expense_description: string | null;
  /** YYYY-MM-DD. Never null at this stage — validation.complete guarantees it. */
  txn_date: string;
  /** null for INR; a positive finite number for USD. Manager-supplied, never guessed. */
  exchange_rate: number | null;
  /** INR equivalent. Equals original_amount for INR; calculated for USD. */
  inr_amount: number;
}

// --- Rate parsing ------------------------------------------------------------

/**
 * Parses a USD->INR exchange rate from a free-text manager message.
 *
 * Accepts messages like:
 *   "88.5"  "Rate is 88.50"  "1 USD = 88.50 INR"
 *
 * Rules:
 *   - Extracts the FIRST valid positive finite number in the string.
 *   - Returns null when no valid rate is found.
 *   - NEVER uses Gemini. NEVER guesses a rate.
 *   - The rate must be strictly positive.
 */
export function parseExchangeRate(message: string): number | null {
  // Find ALL standalone numbers (with optional comma thousands + decimal period).
  // A number preceded by '-' is excluded (negative sign = not a valid rate).
  // Pattern: NOT preceded by '-', then digits, optional comma-groups, optional .decimals.
  const pattern = /(?<!-)\b(\d{1,10}(?:,\d{3})*(?:\.\d{1,6})?|\d{1,10}\.\d{1,6})\b/g;

  const candidates: number[] = [];
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(message)) !== null) {
    // Strip thousand-separator commas, then parse.
    const normalized = m[1].replace(/,/g, "");
    const n = Number(normalized);
    if (Number.isFinite(n) && n > 0) {
      candidates.push(n);
    }
  }

  if (candidates.length === 0) return null;

  // Return the LARGEST candidate — in "1 USD = 88.50 INR", 88.50 > 1.
  return Math.max(...candidates);
}

// --- INR calculation ---------------------------------------------------------

/**
 * Converts USD amount to INR using the manager-supplied rate, with the same exact
 * half-even rounding as persistence, so the card shows exactly what gets saved.
 * Returns null when the amount has >2 decimals or the rate >4 (what the DB stores).
 */
function toINR(original_amount: number, exchange_rate: number): number | null {
  try {
    return Number(convertUsdToInrDecimal(original_amount.toString(), exchange_rate.toString()));
  } catch (err) {
    if (err instanceof DecimalPrecisionError) return null;
    throw err;
  }
}

// --- Confirmation builder ----------------------------------------------------

export type BuildConfirmationResult =
  | { ok: true; transaction: ConfirmationTransaction }
  | { ok: false; error: string };

/**
 * Builds a ConfirmationTransaction from a complete ExtractionResult.
 *
 * INR path: exchange_rate must be null (or omitted).
 * USD path: exchange_rate must be a valid positive number.
 *
 * Precondition: draft must be COMPLETE (validation.complete === true).
 * This function does NOT re-validate the draft.
 */
export function buildConfirmation(
  draft: ExtractionResult,
  exchange_rate: number | null,
): BuildConfirmationResult {
  const type = draft.type as "income" | "expense";
  const original_amount = draft.original_amount as number;
  const original_currency = draft.original_currency as "INR" | "USD";
  const txn_date = draft.txn_date as string;

  // INR path
  if (original_currency === "INR") {
    return {
      ok: true,
      transaction: {
        type,
        original_amount,
        original_currency: "INR",
        client_name: draft.client_name,
        expense_description: draft.expense_description,
        txn_date,
        exchange_rate: null,
        inr_amount: original_amount,
      },
    };
  }

  // USD path — rate must be valid
  if (
    exchange_rate === null ||
    exchange_rate === undefined ||
    !Number.isFinite(exchange_rate) ||
    exchange_rate <= 0
  ) {
    return {
      ok: false,
      error: "A valid positive exchange rate is required for USD conversion.",
    };
  }

  const inr_amount = toINR(original_amount, exchange_rate);
  if (inr_amount === null) {
    return {
      ok: false,
      error: "Use at most 2 decimals for the amount and 4 for the exchange rate.",
    };
  }

  return {
    ok: true,
    transaction: {
      type,
      original_amount,
      original_currency: "USD",
      client_name: draft.client_name,
      expense_description: draft.expense_description,
      txn_date,
      exchange_rate,
      inr_amount,
    },
  };
}
