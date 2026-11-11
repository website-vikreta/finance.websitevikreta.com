/**
 * Display-only helpers for completed statement rows.
 *
 * These are the same values the completed-statement table shows, shared by the
 * PDF and CSV exports so the two can never disagree. Pure functions only.
 */

/**
 * Completed-statement Business Description display: the saved staging value
 * first, and the imported transaction's own saved description only when the
 * staging line has none (its real import relationship). Never regenerated,
 * never rewritten — the original narration column stays untouched.
 */
export function businessDescriptionText(line: {
  businessDescription?: string | null;
  transactionDescription?: string | null;
}): string {
  const fromStaging = line.businessDescription?.trim();
  if (fromStaging) return fromStaging;
  const fromTransaction = line.transactionDescription?.trim();
  if (fromTransaction) return fromTransaction;
  return "—";
}

/** Raw parser/reviewer flag identifiers, or an explicit dash when none exist. */
export function flagsText(flags: readonly string[]): string {
  return flags.length > 0 ? flags.join("; ") : "—";
}
