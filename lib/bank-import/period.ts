/**
 * The statement period managers actually see.
 *
 * An uploaded PDF can carry a header period that is wider than the rows it
 * contains (for example, a one-page extract of a six-month statement). Showing
 * that header period makes two different uploads look like they cover the same
 * dates. The displayed period therefore follows the dates of the rows that were
 * actually parsed, and falls back to the printed header period only when no row
 * carries a usable date.
 */

import { formatDate } from "@/lib/format";
import { isIsoDate } from "./normalize";

export interface StatementPeriod {
  from: string | null;
  to: string | null;
}

interface PeriodLine {
  txnDate: string | null;
  valueDate?: string | null;
}

interface PeriodStatement {
  statementFrom: string | null;
  statementTo: string | null;
}

/**
 * Resolves the display period from already-aggregated row bounds. The SQL
 * queries provide `rowFrom`/`rowTo` for statement lists, so every surface uses
 * the same rule without loading all rows.
 */
export function effectivePeriod(
  statement: PeriodStatement,
  rowFrom: string | null,
  rowTo: string | null,
): StatementPeriod {
  if (rowFrom || rowTo) {
    return { from: rowFrom ?? rowTo, to: rowTo ?? rowFrom };
  }
  return { from: statement.statementFrom, to: statement.statementTo };
}

/** Resolves the display period from the statement's loaded rows. */
export function effectiveStatementPeriod(
  statement: PeriodStatement,
  lines: readonly PeriodLine[],
): StatementPeriod {
  const dates = lines
    .map((line) => line.txnDate ?? line.valueDate ?? null)
    .filter(isIsoDate)
    .sort();
  if (dates.length === 0) return effectivePeriod(statement, null, null);
  return effectivePeriod(statement, dates[0], dates[dates.length - 1]);
}

/** "7 Apr 2026 → 25 May 2026"; null when either end is missing. */
export function formatPeriodRange(
  from: string | null,
  to: string | null,
): string | null {
  if (!from || !to) return null;
  return `${formatDate(from)} → ${formatDate(to)}`;
}

/** The one line rendered on upload-history cards and statement summaries. */
export function formatStatementPeriod(
  from: string | null,
  to: string | null,
): string {
  if (!from && !to) return "Statement period unavailable";
  if (!from) return to ? `Start unavailable → ${formatDate(to)}` : "Statement period unavailable";
  return `${formatDate(from)} → ${to ? formatDate(to) : "Ongoing"}`;
}
