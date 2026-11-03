/**
 * Chatbot Phase 2 — Missing-field validation engine.
 *
 * Single responsibility: inspect an ExtractionResult, determine which field
 * is missing (in a fixed priority order), and return a MissingFieldResult.
 *
 * This module MUST NOT:
 *   - call Gemini
 *   - access the database
 *   - create or save transactions
 *   - perform currency conversion
 *   - assume or invent values for any field
 *
 * Design note:
 *   Conditional fields (client_name, expense_description) are gated by
 *   PRODUCT_RULES flags. Flip the flags here — do not scatter the logic.
 */

import type { ExtractionResult } from "./extract";
import { getQuestion } from "./questions";

// ─── Types ───────────────────────────────────────────────────────────────────

/** All field names that can appear in a MissingFieldResult. */
export type ExtractionField =
  | "type"
  | "original_amount"
  | "original_currency"
  | "txn_date"
  | "client_name"
  | "expense_description";

export interface MissingFieldResult {
  /** true when all required (and applicable conditional) fields are present. */
  complete: boolean;
  /** The first missing field in priority order. null when complete. */
  missingField: ExtractionField | null;
  /** The deterministic question to ask the manager. null when complete. */
  question: string | null;
}

// ─── Product rules ───────────────────────────────────────────────────────────

/**
 * Conditional field requirements.
 * Adjust here when product rules are finalized.
 * Do NOT hardcode these decisions in the validation loop.
 */
const PRODUCT_RULES = {
  /** Whether client_name is required for income transactions. */
  requireClientForIncome: true,
  /** Whether expense_description is required for expense transactions. */
  requireDescriptionForExpense: true,
} as const;

// ─── Required fields — fixed priority order ───────────────────────────────────

/**
 * Base required fields, checked in this exact order.
 * The priority order is the spec. Do not reorder.
 */
const BASE_REQUIRED: ExtractionField[] = [
  "type",
  "original_amount",
  "original_currency",
  "txn_date",
];

// ─── Engine ──────────────────────────────────────────────────────────────────

/**
 * Checks an ExtractionResult for completeness.
 *
 * Returns:
 *   - { complete: true, missingField: null, question: null }  — all fields present
 *   - { complete: false, missingField: "...", question: "..." } — first gap found
 *
 * Only ONE missing field is returned at a time (one question per turn).
 * The caller must NOT ask multiple questions simultaneously.
 */
export function validateExtraction(data: ExtractionResult): MissingFieldResult {
  // ── 1. Check base required fields in priority order ──────────────────────
  for (const field of BASE_REQUIRED) {
    if (isMissing(data[field])) {
      return missing(field);
    }
  }

  // ── 2. Conditional fields (only reachable once base fields are complete) ──
  if (data.type === "income" && PRODUCT_RULES.requireClientForIncome) {
    if (isMissing(data.client_name)) {
      return missing("client_name");
    }
  }

  if (data.type === "expense" && PRODUCT_RULES.requireDescriptionForExpense) {
    if (isMissing(data.expense_description)) {
      return missing("expense_description");
    }
  }

  // ── 3. All checks passed ──────────────────────────────────────────────────
  return { complete: true, missingField: null, question: null };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** A value is "missing" when it is null, undefined, or an empty string. */
function isMissing(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** Build the result for a single missing field. */
function missing(field: ExtractionField): MissingFieldResult {
  return {
    complete: false,
    missingField: field,
    question: getQuestion(field),
  };
}
