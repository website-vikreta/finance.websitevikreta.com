/**
 * Phase 3 duplicate-candidate detection for staging review.
 *
 * - Reads `transactions` for candidate matches but NEVER modifies them; a
 *   candidate is a warning the reviewer decides on, not a proof.
 * - Staging-level matches come in two passes:
 *   1. exact content fingerprint (same file row, another file, or an
 *      already-imported line from Phase 4) — as before;
 *   2. canonical reference + transaction date + signed amount + direction,
 *      restricted to the same bank account, for rows the bank prints
 *      differently across statements (case, separators, zero padding) so an
 *      overlapping period cannot hide behind formatting. Different signed
 *      amounts, a different direction for the same magnitude (e.g. a printed
 *      reversal next to the credit it cancels), and zero-amount placeholder
 *      rows never match.
 * - Transaction-level matches use type/direction/amount and normalized
 *   narration as before.
 * - No unique constraint on the fingerprint: identical bank entries are legal,
 *   so matching stays advisory.
 * - Safe labels only; statement narration and reference values are never logged.
 */

import { eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankStatementLines, bankStatements } from "@/lib/db/schema";
import type { StatementDetail } from "./queries";
import {
  canonicalReferenceKey,
  decimalAdd,
  decimalCompare,
  decimalNegate,
  normalizeNarration,
} from "./normalize";

export type DuplicateKind =
  | "same_statement_row"
  | "other_statement_row"
  | "imported_before"
  | "transaction_exact"
  | "transaction_near";

export type DuplicateSeverity = "strong" | "possible";

export interface LineDuplicateCandidate {
  kind: DuplicateKind;
  severity: DuplicateSeverity;
  /** Reviewer-facing description of the match. No narration text. */
  label: string;
  /** Matched date (staging or transaction), ISO or null. */
  when: string | null;
  /** Matched amount in major units (canonical decimal string). */
  amount: string | null;
}

export interface StatementDuplicateReport {
  byLine: Record<string, LineDuplicateCandidate[]>;
  /** Distinct lines that have at least one candidate. */
  flaggedLineIds: string[];
}

const MIN_LABEL_LENGTH = 6;

interface StagingMatchRaw {
  id: string;
  statementId: string;
  fileName: string;
  status: string;
  transactionId: string | null;
  txnDate: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  fingerprint: string;
}

/**
 * Rows fetched for the canonical-reference pass: same shape as the fingerprint
 * pass plus the printed reference. Only used in memory; never logged.
 */
interface CanonicalStagingMatchRaw {
  id: string;
  statementId: string;
  fileName: string;
  status: string;
  transactionId: string | null;
  txnDate: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  reference: string | null;
}

/** The ideal shape of any staging row (detail line or fetched match). */
interface StagingRowLike {
  txnDate: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  reference: string | null;
}

const KEY_SEPARATOR = "\u0000";

/**
 * Match key for the canonical staging pass. Two rows are candidates exactly
 * when their keys are equal non-null strings. The key is null whenever any
 * component is missing or the signed movement is zero: a placeholder row
 * (0.00 in the shown column with nothing in the other) carries no amount to
 * compare, and a row without reference or transaction date must not be treated
 * as a duplicate of another under-formatted row purely because both lack data.
 *
 * Movement per column: a withdrawal moves money out (negated), a deposit
 * moves money in. With direction being part of the key, only rows printed in
 * the same direction can match; a printed reversal keeps its own key even
 * when it shares reference, date and magnitude with the entry it cancels.
 */
export function stagingCanonicalMatchKey(row: StagingRowLike): string | null {
  const referenceKey = canonicalReferenceKey(row.reference);
  if (!referenceKey || !row.txnDate) return null;

  const withdrawal = row.withdrawalAmount;
  const deposit = row.depositAmount;
  if (withdrawal !== null && deposit !== null) return null; // ambiguous both-columns row
  let movement: string;
  if (withdrawal !== null) {
    movement = decimalNegate(withdrawal);
  } else if (deposit !== null) {
    movement = deposit;
  } else {
    return null; // no amount on either printed column
  }
  if (decimalCompare(movement, "0.00") === 0) return null;
  const direction = withdrawal !== null ? "withdrawal" : "deposit";
  // A second normalize pass canonicalizes the movement string (padding,
  // "-0.00" → "0.00") so string equality inside the key stays an exact
  // minor-unit comparison.
  return [
    referenceKey,
    row.txnDate,
    direction,
    decimalAdd(movement, "0.00"),
  ].join(KEY_SEPARATOR);
}

interface TransactionMatchRaw {
  lineId: string;
  transactionId: string;
  txnDate: string;
  amountInr: string;
  currency: string;
  description: string | null;
  clientNameSnapshot: string | null;
  clientName: string | null;
  sameDate: boolean;
}

function amountOf(line: {
  withdrawalAmount: string | null;
  depositAmount: string | null;
}): string | null {
  return line.withdrawalAmount ?? line.depositAmount;
}

/** Whether either text contains the other once whitespace is collapsed. */
function narrationMatches(narration: string | null, label: string): boolean {
  const a = normalizeNarration(narration)?.toLowerCase() ?? "";
  const b = label.trim().toLowerCase();
  if (!a || b.length < MIN_LABEL_LENGTH) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Collects duplicate candidates for every line of one statement.
 * Staging-level matches use the exact content fingerprint plus the canonical
 * reference pass (same account, folding print differences); transaction-level
 * matches use type/direction, exact amount (INR), and the parsed date.
 */
export async function findDuplicateCandidates(
  detail: StatementDetail,
): Promise<StatementDuplicateReport> {
  const statementId = detail.statement.id;
  const byLine: Record<string, LineDuplicateCandidate[]> = {};
  const fingerprints = [...new Set(detail.lines.map((line) => line.fingerprint))];
  // Staging pairs already covered by an exact-fingerprint candidate; the
  // canonical pass skips them so one matched pair never yields two cards.
  const fingerprintPairs = new Set<string>();

  // 1. Staging lines sharing a fingerprint (same file row, another file, or an
  //    already-imported line from Phase 4).
  if (fingerprints.length > 0) {
    const matches = (await db
      .select({
        id: bankStatementLines.id,
        statementId: bankStatementLines.statementId,
        fileName: bankStatements.fileName,
        status: bankStatementLines.status,
        transactionId: bankStatementLines.transactionId,
        txnDate: bankStatementLines.txnDate,
        withdrawalAmount: bankStatementLines.withdrawalAmount,
        depositAmount: bankStatementLines.depositAmount,
        fingerprint: bankStatementLines.fingerprint,
      })
      .from(bankStatementLines)
      .innerJoin(bankStatements, eq(bankStatements.id, bankStatementLines.statementId))
      .where(inArray(bankStatementLines.fingerprint, fingerprints))) as StagingMatchRaw[];

    for (const match of matches) {
      for (const line of detail.lines) {
        if (line.fingerprint !== match.fingerprint) continue;
        if (match.id === line.id) continue;
        fingerprintPairs.add(`${match.id}\u0000${line.id}`);
        if (match.statementId === statementId) {
          push(byLine, line.id, {
            kind: "same_statement_row",
            severity: "strong",
            label: "Another row in this statement has the same content.",
            when: line.txnDate,
            amount: line.withdrawalAmount ?? line.depositAmount,
          });
        } else if (match.transactionId) {
          push(byLine, line.id, {
            kind: "imported_before",
            severity: "strong",
            label: `The same row was already imported from ${match.fileName}.`,
            when: match.txnDate,
            amount: match.withdrawalAmount ?? match.depositAmount,
          });
        } else {
          push(byLine, line.id, {
            kind: "other_statement_row",
            severity: "strong",
            label: `The same row is already staged in ${match.fileName}.`,
            when: match.txnDate,
            amount: match.withdrawalAmount ?? match.depositAmount,
          });
        }
      }
    }
  }

  // 1b. Canonical-reference pass: the same bank entry printed differently in
  //     another statement (case, separators, zero-padded reference) never
  //     shares a fingerprint. Restricted to the same bank account, and keyed
  //     by canonical reference + date + signed amount + direction. The query
  //     only narrows candidate rows by identity columns SQL can compare
  //     exactly; the canonical fold runs here so SQL and review never
  //     disagree about what a "same reference" is.
  {
    const canonicalMatches = (await db
      .select({
        id: bankStatementLines.id,
        statementId: bankStatementLines.statementId,
        fileName: bankStatements.fileName,
        status: bankStatementLines.status,
        transactionId: bankStatementLines.transactionId,
        txnDate: bankStatementLines.txnDate,
        withdrawalAmount: bankStatementLines.withdrawalAmount,
        depositAmount: bankStatementLines.depositAmount,
        reference: bankStatementLines.reference,
      })
      .from(bankStatementLines)
      .innerJoin(bankStatements, eq(bankStatements.id, bankStatementLines.statementId))
      .where(sql`(
            ${bankStatements.accountId} = ${detail.statement.accountId}::uuid
            AND ${bankStatementLines.reference} IS NOT NULL
            AND ${bankStatementLines.txnDate} IS NOT NULL
            AND ${bankStatementLines.txnDate} IN (
              SELECT other.txn_date FROM bank_statement_lines other
              WHERE other.statement_id = ${statementId}::uuid
                AND other.txn_date IS NOT NULL
            )
          )`)) as CanonicalStagingMatchRaw[];

    // Group detail lines by their canonical match key so each fetched row is
    // compared against candidate lines with one map lookup.
    const linesByKey = new Map<string, string[]>();
    for (const line of detail.lines) {
      const key = stagingCanonicalMatchKey(line);
      if (!key) continue;
      const ids = linesByKey.get(key) ?? [];
      ids.push(line.id);
      linesByKey.set(key, ids);
    }

    for (const match of canonicalMatches) {
      const matchKey = stagingCanonicalMatchKey(match);
      if (!matchKey) continue;
      const lineIds = linesByKey.get(matchKey) ?? [];
      for (const lineId of lineIds) {
        if (match.id === lineId) continue;
        if (fingerprintPairs.has(`${match.id}\u0000${lineId}`)) continue;
        const matchedLine = detail.lines.find((line) => line.id === lineId);
        if (!matchedLine) continue;
        if (match.statementId === statementId) {
          push(byLine, lineId, {
            kind: "same_statement_row",
            severity: "strong",
            label: "Another row in this statement has the same reference, date, amount and direction.",
            when: matchedLine.txnDate,
            amount: matchedLine.withdrawalAmount ?? matchedLine.depositAmount,
          });
        } else if (match.transactionId) {
          push(byLine, lineId, {
            kind: "imported_before",
            severity: "strong",
            label: `A row with the same reference, date, amount and direction was already imported from ${match.fileName}.`,
            when: match.txnDate,
            amount: match.withdrawalAmount ?? match.depositAmount,
          });
        } else {
          push(byLine, lineId, {
            kind: "other_statement_row",
            severity: "strong",
            label: `A row with the same reference, date, amount and direction is already staged in ${match.fileName}.`,
            when: match.txnDate,
            amount: match.withdrawalAmount ?? match.depositAmount,
          });
        }
      }
    }
  }

  // 2. Financial transactions matching on type/direction + exact INR amount
  //    within a ±3 day window. Text comparison is done here with the shared
  //    normalization so SQL and review never disagree.
  const result = await db.execute(sql`
    SELECT
      l.id AS "lineId",
      t.id AS "transactionId",
      to_char(t.txn_date, 'YYYY-MM-DD') AS "txnDate",
      t.amount_inr::text AS "amountInr",
      t.original_currency AS "currency",
      t.description,
      t.client_name_snapshot AS "clientNameSnapshot",
      c.client_name AS "clientName",
      (t.txn_date = l.txn_date) AS "sameDate"
    FROM bank_statement_lines l
    JOIN transactions t
      ON t.deleted_at IS NULL
     AND (l.withdrawal_amount IS NULL OR l.deposit_amount IS NULL)
     AND l.txn_date IS NOT NULL
     AND t.type_id = (CASE WHEN l.withdrawal_amount IS NOT NULL THEN 2 ELSE 1 END)
     AND t.amount_inr = COALESCE(l.withdrawal_amount, l.deposit_amount)
     AND t.txn_date BETWEEN (l.txn_date - INTERVAL '3 days') AND (l.txn_date + INTERVAL '3 days')
     AND NOT EXISTS (
       SELECT 1 FROM bank_statement_lines own
       WHERE own.transaction_id = t.id AND own.statement_id = l.statement_id
     )
    LEFT JOIN clients c ON c.client_id = t.client_id
    WHERE l.statement_id = ${statementId}::uuid
  `);
  const transactionMatches = result.rows as unknown as TransactionMatchRaw[];

  for (const match of transactionMatches) {
    const line = detail.lines.find((candidate) => candidate.id === match.lineId);
    if (!line) continue;

    const transactionLabel =
      line.direction === "deposit"
        ? normalizeNarration(match.clientNameSnapshot ?? match.clientName ?? match.description)
        : normalizeNarration(match.description ?? match.clientNameSnapshot ?? match.clientName);

    const candidate: LineDuplicateCandidate = {
      kind: match.sameDate ? "transaction_exact" : "transaction_near",
      severity: match.sameDate ? "strong" : "possible",
      label: match.sameDate
        ? `A recorded ${match.currency === "USD" ? "USD payment" : "payment"} for this amount is dated ${match.txnDate}.`
        : narrationMatches(line.narration, transactionLabel ?? "")
          ? `A recorded ${match.currency === "USD" ? "USD payment" : "payment"} for this amount is dated ${match.txnDate} with similar wording.`
          : "",
      when: match.txnDate,
      amount: amountOf(line),
    };
    if (!candidate.label) continue; // near matches need wording agreement
    push(byLine, line.id, candidate);
  }

  const flaggedLineIds = Object.keys(byLine).sort();
  return { byLine, flaggedLineIds };
}

function push(
  byLine: Record<string, LineDuplicateCandidate[]>,
  lineId: string,
  candidate: LineDuplicateCandidate,
): void {
  const existing = byLine[lineId] ?? [];
  if (existing.some((item) => item.kind === candidate.kind && item.label === candidate.label)) return;
  byLine[lineId] = [...existing, candidate];
}

/** Total number of duplicate candidates across the statement. */
export function duplicateCandidateCount(report: StatementDuplicateReport): number {
  return Object.values(report.byLine).reduce((total, list) => total + list.length, 0);
}
