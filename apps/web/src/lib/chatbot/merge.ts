/**
 * Chatbot Phase 3 — Draft merge function.
 *
 * Single responsibility: merge a new ExtractionResult into the existing
 * transaction draft without losing previously collected information.
 *
 * Merge rule (applied per field):
 *   - If the new extraction has a non-null value → use it (allows corrections).
 *   - If the new extraction has null             → keep the existing value.
 *
 * This module MUST NOT:
 *   - call Gemini
 *   - validate fields
 *   - access the draft store
 *   - access the database
 */

import type { ExtractionResult } from "./extract";

/** An empty draft — the starting state for every new conversation. */
export const EMPTY_DRAFT: ExtractionResult = {
  type: null,
  original_amount: null,
  original_currency: null,
  client_name: null,
  expense_description: null,
  txn_date: null,
};

/**
 * Merges `incoming` into `existing`.
 *
 * Non-null values in `incoming` always win (enabling corrections).
 * Null values in `incoming` are ignored — existing value is preserved.
 *
 * @param existing - The current draft held in the session store.
 * @param incoming - The ExtractionResult from the latest Gemini call.
 * @returns        A new merged ExtractionResult object (no mutation).
 */
export function mergeDraft(
  existing: ExtractionResult,
  incoming: ExtractionResult,
): ExtractionResult {
  return {
    type: incoming.type ?? existing.type,
    original_amount: incoming.original_amount ?? existing.original_amount,
    original_currency: incoming.original_currency ?? existing.original_currency,
    client_name: incoming.client_name ?? existing.client_name,
    expense_description: incoming.expense_description ?? existing.expense_description,
    txn_date: incoming.txn_date ?? existing.txn_date,
  };
}
