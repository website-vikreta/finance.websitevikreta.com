/**
 * Phase 3 statement reconciliation (informational only).
 *
 * - Checks opening + deposits − withdrawals (+ any movement derived from the
 *   printed balance chain) against the declared closing balance using exact
 *   decimal-string arithmetic from `normalize.ts`; no floating point ever
 *   touches a money value here.
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
import type { StatementDetail, StatementLineRow } from "./queries";
import { effectiveStatementPeriod } from "./period";

export type ReconciliationStatus = "balanced" | "unbalanced" | "insufficient_data";

export interface StatementOverlap {
  id: string;
  fileName: string;
  statementFrom: string | null;
  statementTo: string | null;
}

export interface StatementReconciliation {
  status: ReconciliationStatus;
  /** Closed when the counted + chain-derived movement reaches the closing balance. */
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
  /** Rows whose amounts cannot be counted and whose movement no printed chain can supply. */
  invalidLineCount: number;
  /** Signed movement of rows derived from the printed balance chain (exact source data). */
  derivedMovement: string;
  /** How many rows contribute through the chain-derived movement. */
  derivedMovementCount: number;
  warnings: string[];
  /** Non-error notes, e.g. which value was reconstructed from row balances. */
  notes: string[];
  overlappingStatements: StatementOverlap[];
}

/**
 * Statement period used by reconciliation: the dates the uploaded rows cover,
 * falling back to the printed header period only when no row has a usable date.
 */
export function resolveStatementPeriod(detail: StatementDetail): {
  from: string | null;
  to: string | null;
} {
  return effectiveStatementPeriod(detail.statement, detail.lines);
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

  // Compare the same effective ranges the screens show: the row coverage of
  // each statement, falling back to its printed header period. This keeps old
  // statements (including one-page extracts) from claiming false overlaps.
  const result = await db.execute(sql`
    SELECT
      p.id,
      p.file_name AS "fileName",
      p.range_from AS "statementFrom",
      p.range_to AS "statementTo"
    FROM (
      SELECT
        s.id,
        s.file_name,
        s.created_at,
        to_char(
          coalesce(min(coalesce(l.txn_date, l.value_date)), s.statement_from),
          'YYYY-MM-DD'
        ) AS range_from,
        to_char(
          coalesce(max(coalesce(l.txn_date, l.value_date)), s.statement_to),
          'YYYY-MM-DD'
        ) AS range_to
      FROM bank_statements s
      LEFT JOIN bank_statement_lines l ON l.statement_id = s.id
      WHERE s.id <> ${statementId}::uuid
        AND s.account_id = ${accountId}::uuid
        AND s.status NOT IN ('failed', 'cancelled')
      GROUP BY s.id
    ) p
    WHERE p.range_from IS NOT NULL
      AND p.range_to IS NOT NULL
      AND ${period.from}::date <= p.range_to::date
      AND ${period.to}::date >= p.range_from::date
    ORDER BY p.range_from::date, p.created_at
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

interface BalanceChainRow {
  pageNumber: number;
  rowNumber: number;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  closingBalance: string | null;
}

/**
 * Walks the rows in page/row order and attributes each row's movement to the
 * balance check. Countable rows contribute their own amount; a row whose
 * amount cells cannot be counted still prints a closing balance, and two
 * consecutive printed balances pin that row's movement exactly
 * (`balance = previous printed balance + this row's movement`). That is the
 * same printed-chain evidence the opening / closing derivation already uses —
 * it counts source data, never a guess.
 *
 * A derivation is only taken while the chain is dense since the last printed
 * balance: a countable row WITHOUT a printed balance has its movement counted
 * from the amount already, and deriving a span over it would count it twice.
 * Such spans are excluded (`excludedLineCount`) like before.
 */
function classifyMovements(lines: StatementLineRow[] | BalanceChainRow[]): {
  deposits: string[];
  withdrawals: string[];
  /** Signed total movement of rows derived from the printed balance chain. */
  derivedMovement: string;
  derivedCount: number;
  /** Rows whose movement is unavailable from either evidence. */
  excludedCount: number;
} {
  const sorted = [...lines].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.rowNumber - b.rowNumber,
  );
  const deposits: string[] = [];
  const withdrawals: string[] = [];
  let derivedMovement = "0.00";
  let derivedCount = 0;
  let excludedCount = 0;
  let lastPrinted: string | null = null;
  let chainCountedWithoutPrint = false;

  for (const line of sorted) {
    const amount = countableAmount(line);
    if (amount) {
      if (amount.side === "deposit") deposits.push(amount.value);
      else withdrawals.push(amount.value);
      if (line.closingBalance) {
        lastPrinted = line.closingBalance;
        chainCountedWithoutPrint = false;
      } else {
        chainCountedWithoutPrint = true;
      }
      continue;
    }

    if (line.closingBalance && lastPrinted !== null && !chainCountedWithoutPrint) {
      derivedMovement = decimalAdd(
        derivedMovement,
        decimalSubtract(line.closingBalance, lastPrinted),
      );
      derivedCount += 1;
      lastPrinted = line.closingBalance;
    } else {
      excludedCount += 1;
    }
    if (line.closingBalance) {
      lastPrinted = line.closingBalance;
      chainCountedWithoutPrint = false;
    }
  }

  return { deposits, withdrawals, derivedMovement, derivedCount, excludedCount };
}

/**
 * Reconstructs an opening / closing balance from the per-row printed balances
 * when the statement metadata has none of its own:
 *
 * - Opening: the statement's FIRST row only, when it carries a printed
 *   balance and a countable movement — `opening = balance − (deposit −
 *   withdrawal)`. A later row would only know its own before-row balance,
 *   which is not the statement opening.
 * - Closing: the last row that carries a printed balance, declared by the
 *   statement itself on every row.
 *
 * Only used for display and the balance check — nothing is written back, so
 * rows keep their source of truth and staged statements benefit without a
 * re-upload.
 */
export function deriveBalancesFromRows(
  lines: BalanceChainRow[],
): { opening: string | null; closing: string | null } {
  const sorted = [...lines].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.rowNumber - b.rowNumber,
  );

  let opening: string | null = null;
  const first = sorted[0];
  if (first && first.closingBalance) {
    const amount = countableAmount(first);
    if (amount) {
      opening =
        amount.side === "deposit"
          ? decimalSubtract(first.closingBalance, amount.value)
          : decimalAdd(first.closingBalance, amount.value);
    }
  }

  let closing: string | null = null;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].closingBalance) {
      closing = sorted[index].closingBalance;
      break;
    }
  }

  return { opening, closing };
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

  const movements = classifyMovements(lines);
  const depositsTotal = sum(movements.deposits, "0.00");
  const withdrawalsTotal = sum(movements.withdrawals, "0.00");
  const derivedMovement = movements.derivedMovement;
  const derivedMovementCount = movements.derivedCount;
  const invalidLineCount = movements.excludedCount;

  // Declared state first; the row balance chain only fills what is missing.
  const derivedBalances =
    statement.openingBalance && statement.closingBalance
      ? { opening: null, closing: null }
      : deriveBalancesFromRows(lines);
  const openingBalance = statement.openingBalance ?? derivedBalances.opening;
  const closingBalance = statement.closingBalance ?? derivedBalances.closing;

  const warnings: string[] = [];
  const notes: string[] = [];
  if (parsedCount === 0) warnings.push("No rows were parsed from this statement.");
  if (openingBalance && !statement.openingBalance) {
    notes.push("Opening balance derived from the first row's printed balance.");
  }
  if (closingBalance && !statement.closingBalance) {
    notes.push("Declared closing taken from the last row's printed balance.");
  }
  if (!openingBalance) warnings.push("The opening balance is missing.");
  if (!closingBalance) warnings.push("The closing balance is missing.");
  if (invalidLineCount > 0) {
    warnings.push(
      `${invalidLineCount} row${invalidLineCount === 1 ? "" : "s"} cannot be counted; they are excluded from the balance check.`,
    );
  }
  if (derivedMovementCount > 0) {
    notes.push(
      `Movement of ${derivedMovementCount} row${derivedMovementCount === 1 ? "" : "s"} taken from the printed balance chain (${decimalAbs(derivedMovement)} net); their amount cells are not countable.`,
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

  const missingInputs = !openingBalance || !closingBalance || parsedCount === 0;

  let status: ReconciliationStatus = "insufficient_data";
  let expectedClosing: string | null = null;
  let difference: string | null = null;

  if (openingBalance && closingBalance && !missingInputs) {
    const movement = decimalAdd(
      decimalSubtract(depositsTotal, withdrawalsTotal),
      derivedMovement,
    );
    expectedClosing = decimalAdd(openingBalance, movement);
    difference = decimalSubtract(closingBalance, expectedClosing);
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
    openingBalance,
    closingBalance,
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
    derivedMovement,
    derivedMovementCount,
    warnings,
    notes,
    overlappingStatements,
  };
}
