/**
 * Chatbot Phase 2 — Deterministic question map.
 *
 * Single responsibility: map a missing field name to the exact question
 * the chatbot will ask the manager.
 *
 * Rules:
 *   - These strings are the ONLY source of follow-up questions.
 *   - Gemini MUST NOT generate questions. The engine calls this map.
 *   - Edit here to change wording. Do not scatter question strings in other files.
 */

import type { ExtractionField } from "./validate";

/**
 * One question per missing field.
 * The order here is irrelevant — priority is enforced in validate.ts.
 */
export const QUESTIONS: Record<ExtractionField, string> = {
  type: "Was this an income or an expense?",
  original_amount: "What was the payment amount?",
  original_currency: "What currency was the payment in — INR or USD?",
  txn_date: "What was the payment date?",
  client_name: "Which client was this payment from?",
  expense_description: "What was this expense for?",
};

/**
 * Returns the deterministic follow-up question for a given missing field.
 */
export function getQuestion(field: ExtractionField): string {
  return QUESTIONS[field];
}
