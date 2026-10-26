/**
 * Server-side limits for bank-statement uploads.
 *
 * Limits are configurable with env vars so deployment limits can be tuned
 * without changing code. Malformed values fall back to safe defaults.
 */

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_PAGES } from "./pdf";

/** Matches the parser default (`lib/bank-import/parse.ts`). */
const DEFAULT_MAX_ROWS = 5_000;

export interface BankImportLimits {
  /** One provisioned limit is bytes, not a request length. */
  maxBytes: number;
  maxPages: number;
  maxRows: number;
}

function positiveInt(envValue: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(envValue ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

export function bankImportLimits(
  env: Record<string, string | undefined> = process.env,
): BankImportLimits {
  const maxBytes = positiveInt(
    env.BANK_IMPORT_MAX_FILE_BYTES,
    DEFAULT_MAX_BYTES,
    1024,
    64 * 1024 * 1024,
  );
  return {
    maxBytes,
    maxPages: positiveInt(env.BANK_IMPORT_MAX_PAGES, DEFAULT_MAX_PAGES, 1, 500),
    maxRows: positiveInt(env.BANK_IMPORT_MAX_ROWS, DEFAULT_MAX_ROWS, 1, 20_000),
  };
}
