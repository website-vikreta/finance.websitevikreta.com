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

import { type ExtractionResult, normalizeClientName, normalizeExpenseDescription } from "./extract";

/** An empty draft — the starting state for every new conversation. */
export const EMPTY_DRAFT: ExtractionResult = {
  type: null,
  original_amount: null,
  original_currency: null,
  client_name: null,
  expense_description: null,
  txn_date: null,
  exchange_rate: null,
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
  const mergedClient =
    incoming.client_name !== undefined && incoming.client_name !== null
      ? normalizeClientName(incoming.client_name)
      : normalizeClientName(existing.client_name);

  const mergedExpenseDesc =
    incoming.expense_description !== undefined && incoming.expense_description !== null
      ? normalizeExpenseDescription(incoming.expense_description)
      : normalizeExpenseDescription(existing.expense_description);

  return {
    type: incoming.type ?? existing.type,
    original_amount: incoming.original_amount ?? existing.original_amount,
    original_currency: incoming.original_currency ?? existing.original_currency,
    client_name: mergedClient,
    expense_description: mergedExpenseDesc,
    txn_date: incoming.txn_date ?? existing.txn_date,
    exchange_rate: incoming.exchange_rate ?? existing.exchange_rate ?? null,
  };
}
