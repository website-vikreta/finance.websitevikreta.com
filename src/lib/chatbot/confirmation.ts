/**
 * Chatbot Phase 5 — Confirmation transaction builder.
 *
 * Single responsibility: take a validated, complete draft and a resolved
 * CurrencyConversionResult, and produce a ConfirmationTransaction object
 * ready for manager review.
 *
 * Design rules:
 *   - Only include fields relevant to the transaction type.
 *   - Income:  include client_name,         omit expense_description.
 *   - Expense: include expense_description, omit client_name.
 *   - exchange_rate and inr_amount come from the CurrencyConversionResult,
 *     never from the draft or from Gemini.
 *   - Throws ConfirmationBuildError if any required draft field is null.
 *
 * This module MUST NOT:
 *   - call Gemini
 *   - perform currency conversion
 *   - access the draft store
 *   - access the database
 *   - save or persist anything
 */

import type { ExtractionResult } from './extract';
import type { CurrencyConversionResult } from '@/lib/currency/exchange-rate';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The transaction object presented to the manager for confirmation.
 *
 * Fields are typed as non-null here because buildConfirmationTransaction
 * validates all required fields before constructing this object.
 */
export interface ConfirmationTransaction {
  type: 'income' | 'expense';
  original_amount: number;
  original_currency: 'INR' | 'USD';
  /** Present for income transactions; absent for expense transactions. */
  client_name?: string;
  /** Present for expense transactions; absent for income transactions. */
  expense_description?: string;
  txn_date: string;
  /** null for INR transactions; exchange rate used for USD transactions. */
  exchange_rate: number | null;
  inr_amount: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Thrown when a required draft field is null at the point of building the
 * confirmation. This indicates the caller invoked this function before the
 * draft was complete — a programming error, not a user error.
 */
export class ConfirmationBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmationBuildError';
  }
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Builds a ConfirmationTransaction from a complete draft and the resolved
 * currency conversion result.
 *
 * @param draft    - The merged, validated transaction draft (all fields must be non-null).
 * @param currency - The CurrencyConversionResult from Phase 4.
 * @throws ConfirmationBuildError if any required draft field is null.
 */
export function buildConfirmationTransaction(
  draft: ExtractionResult,
  currency: CurrencyConversionResult,
): ConfirmationTransaction {
  // ── Validate all required base fields ────────────────────────────────────
  if (draft.type === null || draft.type === undefined) {
    throw new ConfirmationBuildError('Cannot build confirmation: draft.type is null.');
  }
  if (draft.original_amount === null || draft.original_amount === undefined) {
    throw new ConfirmationBuildError('Cannot build confirmation: draft.original_amount is null.');
  }
  if (draft.original_currency === null || draft.original_currency === undefined) {
    throw new ConfirmationBuildError('Cannot build confirmation: draft.original_currency is null.');
  }
  if (draft.txn_date === null || draft.txn_date === undefined) {
    throw new ConfirmationBuildError('Cannot build confirmation: draft.txn_date is null.');
  }

  // ── Build the type-specific confirmation object ───────────────────────────
  if (draft.type === 'income') {
    const transaction: ConfirmationTransaction = {
      type: 'income',
      original_amount: draft.original_amount,
      original_currency: draft.original_currency,
      txn_date: draft.txn_date,
      exchange_rate: currency.exchange_rate,
      inr_amount: currency.inr_amount,
    };
    if (draft.client_name) {
      transaction.client_name = draft.client_name;
    }
    return transaction;
  }

  // expense
  const transaction: ConfirmationTransaction = {
    type: 'expense',
    original_amount: draft.original_amount,
    original_currency: draft.original_currency,
    txn_date: draft.txn_date,
    exchange_rate: currency.exchange_rate,
    inr_amount: currency.inr_amount,
  };
  if (draft.expense_description) {
    transaction.expense_description = draft.expense_description;
  }
  return transaction;
}
