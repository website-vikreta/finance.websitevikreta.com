/**
 * Phase 3 statement reconciliation (informational only).
 *
 * - Checks opening + deposits − withdrawals against the declared closing
 *   balance using exact decimal-string arithmetic from `normalize.ts`; no
 *   floating point ever touches a money value here.
 * - Never writes anything: no adjustment transactions, no ledger changes.
 * - A result is a review safeguard: `unbalanced` warns the reviewer to
 *   re-check the file before trusting the staged rows.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  decimalAbs,
  decimalAdd,
  decimalCompare,
  decimalSubtract,
  parseAmountCell,
} from "./normalize";
import type { StatementDetail } from "./queries";

export type ReconciliationStatus = "balanced" | "unbalanced" | "insufficient_data";

export interface StatementOverlap {
  id: string;
  fileName: string;
  statementFrom: string | null;
  statementTo: string | null;
}

export interface StatementReconciliation {
  status: ReconciliationStatus;
  /** Closed only when every parsed row has a computable amount. */
  difference: string | null;
  expectedClosing: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  depositsTotal: string;
  withdrawalsTotal: string;
  parsedCount: number;
  pendingCount: number;
  readyCount: number;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  errorCount: number;
  /** pending + error: rows the reviewer has not resolved yet. */
  unresolvedCount: number;
  /** Rows whose amounts cannot be counted; they block a balance check. */
  invalidLineCount: number;
  warnings: string[];
  overlappingStatements: StatementOverlap[];
}

/** Fallen-back statement period: declared dates, else the row date span. */
export function resolveStatementPeriod(detail: StatementDetail): {
  from: string | null;
  to: string | null;
} {
  if (detail.statement.statementFrom && detail.statement.statementTo) {
    return { from: detail.statement.statementFrom, to: detail.statement.statementTo };
  }

  const dates = detail.lines
    .map((line) => line.txnDate ?? line.valueDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  if (dates.length === 0) return { from: null, to: null };
  return { from: dates[0], to: dates[dates.length - 1] };
}

interface OverlapRow {
  id: string;
  fileName: string;
  statementFrom: string | null;
  statementTo: string | null;
}

/**
 * Other non-failed statements of the same account whose declared period
 * overlaps this statement's resolved period. Null periods produce no overlap
 * warning: there is nothing to compare against.
 */
export async function listOverlappingStatements(
  accountId: string,
  statementId: string,
  period: { from: string | null; to: string | null },
): Promise<StatementOverlap[]> {
  if (!period.from || !period.to) return [];

  const result = await db.execute(sql`
    SELECT
      s.id,
      s.file_name AS "fileName",
      to_char(s.statement_from, 'YYYY-MM-DD') AS "statementFrom",
      to_char(s.statement_to, 'YYYY-MM-DD') AS "statementTo"
    FROM bank_statements s
    WHERE s.id <> ${statementId}::uuid
      AND s.account_id = ${accountId}::uuid
      AND s.status NOT IN ('failed', 'cancelled')
      AND s.statement_from IS NOT NULL
      AND s.statement_to IS NOT NULL
      AND ${period.from}::date <= s.statement_to
      AND ${period.to}::date >= s.statement_from
    ORDER BY s.statement_from, s.created_at
    LIMIT 10
  `);

  return (result.rows as unknown as OverlapRow[]).map((row) => ({
    id: row.id,
    fileName: row.fileName,
    statementFrom: row.statementFrom,
    statementTo: row.statementTo,
  }));
}

/** One row is countable only when exactly one side holds a positive amount. */
function countableAmount(line: {
  withdrawalAmount: string | null;
  depositAmount: string | null;
}): { value: string; side: "withdrawal" | "deposit" } | null {
  const hasWithdrawal = line.withdrawalAmount !== null;
  const hasDeposit = line.depositAmount !== null;
  if (hasWithdrawal === hasDeposit) return null;
  const parsed = parseAmountCell(hasWithdrawal ? line.withdrawalAmount : line.depositAmount);
  if (!parsed.ok || parsed.negative || parsed.value === "0.00") return null;
  return { value: parsed.value, side: hasWithdrawal ? "withdrawal" : "deposit" };
}

function sum(all: string[], seed: string): string {
  return all.reduce((total, value) => decimalAdd(total, value), seed);
}

/** Builds the review summary: arithmetic plus row counts and warnings. */
export function reconcileStatementDetail(
  detail: StatementDetail,
  overlappingStatements: StatementOverlap[],
): StatementReconciliation {
  const { statement, lines } = detail;

  const parsedCount = lines.length;
  const counts = { pending: 0, ready: 0, imported: 0, skipped: 0, duplicate: 0, error: 0 };
  for (const line of lines) counts[line.status] += 1;

  const deposits: string[] = [];
  const withdrawals: string[] = [];
  let invalidLineCount = 0;
  for (const line of lines) {
    const amount = countableAmount(line);
    if (!amount) {
      invalidLineCount += 1;
      continue;
    }
    if (amount.side === "deposit") deposits.push(amount.value);
    else withdrawals.push(amount.value);
  }

  const depositsTotal = sum(deposits, "0.00");
  const withdrawalsTotal = sum(withdrawals, "0.00");

  const warnings: string[] = [];
  if (parsedCount === 0) warnings.push("No rows were parsed from this statement.");
  if (!statement.openingBalance) warnings.push("The opening balance is missing.");
  if (!statement.closingBalance) warnings.push("The closing balance is missing.");
  if (invalidLineCount > 0) {
    warnings.push(
      `${invalidLineCount} row${invalidLineCount === 1 ? "" : "s"} cannot be counted; they are excluded from the balance check.`,
    );
  }
  const unresolvedCount = counts.pending + counts.error;
  if (unresolvedCount > 0) {
    warnings.push(
      `${unresolvedCount} line${unresolvedCount === 1 ? "" : "s"} still need${unresolvedCount === 1 ? "s" : ""} review.`,
    );
  }
  const duplicateCount = counts.duplicate;
  if (duplicateCount > 0) {
    warnings.push(`${duplicateCount} row${duplicateCount === 1 ? "" : "s"} marked as duplicates.`);
  }
  if (overlappingStatements.length > 0) {
    warnings.push(
      `The period overlaps ${overlappingStatements.length} other statement${overlappingStatements.length === 1 ? "" : "s"} for this account.`,
    );
  }

  const missingInputs =
    !statement.openingBalance ||
    !statement.closingBalance ||
    invalidLineCount > 0 ||
    parsedCount === 0;

  let status: ReconciliationStatus = "insufficient_data";
  let expectedClosing: string | null = null;
  let difference: string | null = null;

  if (statement.openingBalance && statement.closingBalance && !missingInputs) {
    const movement = decimalSubtract(depositsTotal, withdrawalsTotal);
    expectedClosing = decimalAdd(statement.openingBalance, movement);
    difference = decimalSubtract(statement.closingBalance, expectedClosing);
    status = decimalCompare(difference, "0.00") === 0 ? "balanced" : "unbalanced";
    if (status === "unbalanced") {
      warnings.push(
        `The counted movement does not reach the closing balance (off by ₹${decimalAbs(difference)}).`,
      );
    }
  }

  return {
    status,
    difference,
    expectedClosing,
    openingBalance: statement.openingBalance,
    closingBalance: statement.closingBalance,
    depositsTotal,
    withdrawalsTotal,
    parsedCount,
    pendingCount: counts.pending,
    readyCount: counts.ready,
    importedCount: counts.imported,
    skippedCount: counts.skipped,
    duplicateCount: counts.duplicate,
    errorCount: counts.error,
    unresolvedCount,
    invalidLineCount,
    warnings,
    overlappingStatements,
  };
}
