/**
 * Currency module — types and constants.
 *
 * Single responsibility: define the shared types used by the currency
 * conversion service. No logic lives here.
 *
 * This module MUST NOT:
 *   - call external APIs
 *   - perform calculations
 *   - access the database
 */

/** Currencies currently supported by the finance chatbot. */
export type SupportedCurrency = 'INR' | 'USD';

/**
 * The result produced by the currency conversion service after Phase 4.
 *
 * INR transactions:
 *   exchange_rate = null
 *   inr_amount    = original_amount
 *
 * USD transactions:
 *   exchange_rate = manager-supplied rate (e.g. 88.5)
 *   inr_amount    = original_amount × exchange_rate (rounded to 2 dp)
 */
export interface CurrencyConversionResult {
  original_amount: number;
  original_currency: SupportedCurrency;
  /** null for INR transactions; a positive finite number for USD transactions. */
  exchange_rate: number | null;
  inr_amount: number;
  /** Conversion date in YYYY-MM-DD format. */
  exchange_rate_date: string;
}
