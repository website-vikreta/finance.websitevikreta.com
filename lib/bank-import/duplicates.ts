/**
 * Phase 3 duplicate-candidate detection for staging review.
 *
 * - Reads `transactions` for candidate matches but NEVER modifies them; a
 *   candidate is a warning the reviewer decides on, not a proof.
 * - Uses the existing canonical fingerprint (content hash) for staging-level
 *   matches, plus date/direction/amount and normalized narration for
 *   transaction-level matches.
 * - No unique constraint on the fingerprint: identical bank entries are legal,
 *   so matching stays advisory.
 * - Safe labels only; statement narration is never logged.
 */

import { eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankStatementLines, bankStatements } from "@/lib/db/schema";
import type { StatementDetail } from "./queries";
import { normalizeNarration } from "./normalize";

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
 * Staging-level matches use the content fingerprint; transaction-level
 * matches use type/direction, exact amount (INR), and the parsed date.
 */
export async function findDuplicateCandidates(
  detail: StatementDetail,
): Promise<StatementDuplicateReport> {
  const statementId = detail.statement.id;
  const byLine: Record<string, LineDuplicateCandidate[]> = {};
  const fingerprints = [...new Set(detail.lines.map((line) => line.fingerprint))];

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
