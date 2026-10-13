/**
 * Currency module — conversion logic.
 *
 * Single responsibility: convert an original amount to INR.
 *
 * Design rules:
 *   - NEVER call external exchange-rate APIs.
 *   - NEVER ask Gemini for a rate.
 *   - NEVER guess or assume a rate.
 *   - For USD, the caller MUST supply the manager-entered rate.
 *   - For INR, no rate is needed; inr_amount == original_amount.
 *
 * This module MUST NOT:
 *   - access the database
 *   - access the chatbot draft store
 *   - call Gemini
 */

import type { CurrencyConversionResult, SupportedCurrency } from './exchange-rate';

/**
 * Thrown when USD conversion is requested but no valid exchange rate
 * was provided. The caller must NOT silently swallow this error or fall
 * back to a guessed rate.
 */
export class CurrencyConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurrencyConversionError';
  }
}

/**
 * Converts an original amount to INR.
 *
 * INR path:
 *   exchange_rate = null
 *   inr_amount    = original_amount
 *
 * USD path:
 *   exchange_rate must be a finite positive number supplied by the caller
 *   (entered by the manager — never guessed or fetched automatically).
 *   inr_amount = Math.round(original_amount * exchange_rate * 100) / 100
 *   This avoids IEEE 754 floating-point drift for two-decimal-place results.
 *
 * @param original_amount   - The transaction amount in the original currency.
 * @param original_currency - 'INR' or 'USD'.
 * @param exchange_rate     - Required for USD. Ignored (and set to null) for INR.
 * @throws CurrencyConversionError if USD conversion is requested without a valid rate.
 */
export function convertToINR(
  original_amount: number,
  original_currency: SupportedCurrency,
  exchange_rate?: number | null,
): CurrencyConversionResult {
  const today = new Date().toISOString().slice(0, 10);

  if (original_currency === 'INR') {
    return {
      original_amount,
      original_currency: 'INR',
      exchange_rate: null,
      inr_amount: original_amount,
      exchange_rate_date: today,
    };
  }

  // USD path — rate must be valid
  if (
    exchange_rate === undefined ||
    exchange_rate === null ||
    !Number.isFinite(exchange_rate) ||
    exchange_rate <= 0
  ) {
    throw new CurrencyConversionError(
      'A valid positive exchange rate is required for USD conversion. ' +
        'Do not guess or invent a rate.',
    );
  }

  const inr_amount = Math.round(original_amount * exchange_rate * 100) / 100;

  return {
    original_amount,
    original_currency: 'USD',
    exchange_rate,
    inr_amount,
    exchange_rate_date: today,
  };
}
