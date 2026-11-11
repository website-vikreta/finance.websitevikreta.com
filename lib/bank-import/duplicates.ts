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
 * - Ledger matches use STRICT transaction identity only: exact transaction
 *   date, exact direction, exact minor-unit amount and the INR currency. The
 *   ±3-day heuristic window is gone — a different day is a different
 *   transaction, never a duplicate.
 * - Every ledger match is then weighed by the shared evidence rules in
 *   `duplicate-evidence.ts`: normalized Business Description containment or
 *   overlap, client/category corroboration, an ambiguity fold when several
 *   matches carry equal strength, and safe labels —
 *   `Duplicate · Manual Entry · date`, `Duplicate · Finance AI · date`,
 *   `Duplicate · Previous Statement · date`, `Duplicate Candidate · Same
 *   Statement · date`. Amount + date alone renders as a muted
 *   `Possible dup` advisory that never blocks an import.
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
import {
  evaluateTransactionCandidate,
  resolveAmbiguousCandidates,
  stagingBadgeLabel,
  transactionBadgeLabel,
  type TransactionCandidateEvidence,
} from "./duplicate-evidence";
import { formatPeriodRange } from "./period";

export type DuplicateKind =
  | "same_statement_row"
  | "other_statement_row"
  | "imported_before"
  | "transaction_exact";

/** strong = confirmed duplicate · review = needs a reviewer decision · possible = advisory only. */
export type DuplicateSeverity = "strong" | "review" | "possible";

export { ALREADY_IMPORTED_LABEL } from "./duplicate-evidence";

export interface LineDuplicateCandidate {
  kind: DuplicateKind;
  severity: DuplicateSeverity;
  /** Reviewer-facing description of the match. No narration text. */
  label: string;
  /** Longer tooltip detail: source, origin statement, evidence — never narration. */
  detail: string;
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
  statementFrom: string | null;
  statementTo: string | null;
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
  statementFrom: string | null;
  statementTo: string | null;
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
  source: string | null;
  description: string | null;
  transactionClientId: string | null;
  transactionCategoryId: number | null;
  clientNameSnapshot: string | null;
  clientName: string | null;
  lineClientId: string | null;
  lineCategoryId: number | null;
  originFileName: string | null;
  originStatementFrom: string | null;
  originStatementTo: string | null;
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

/** Detail text for a staging-only pair; no narration is ever embedded. */
function stagingDetail(
  kind: "same_statement_row" | "other_statement_row" | "imported_before",
  fileName: string | null,
  originFrom: string | null,
  originTo: string | null,
  byReference: boolean,
): string {
  const how = byReference
    ? "The same reference, date, amount and direction appear twice."
    : "The same row content appears twice.";
  if (kind === "same_statement_row") {
    return byReference
      ? "Another row in this statement has the same reference, date, amount and direction."
      : "Another row in this statement has the same content.";
  }
  const range = formatPeriodRange(originFrom, originTo);
  const period = range ? ` (statement ${range})` : "";
  if (kind === "other_statement_row") {
    return `${how} Already staged in ${fileName ?? "an earlier statement"}${period}.
Import was never completed there; resolve which upload is kept in review.`;
  }
  return `${how} Already imported from ${fileName ?? "an earlier statement"}${period}.`;
}

/**
 * Collects duplicate candidates for every line of one statement.
 * Staging-level matches use the exact content fingerprint plus the canonical
 * reference pass (same account, folding print differences); ledger matches use
 * strict identity (exact date, direction, amount, INR) weighed by the shared
 * evidence rules and relabeled by transaction source.
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
  const lineById = new Map(detail.lines.map((line) => [line.id, line]));

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
        statementFrom: sql<string | null>`coalesce(
          (SELECT to_char(min(coalesce(m.txn_date, m.value_date)), 'YYYY-MM-DD')
           FROM bank_statement_lines m
           WHERE m.statement_id = ${bankStatements.id}),
          to_char(${bankStatements.statementFrom}, 'YYYY-MM-DD')
        )`,
        statementTo: sql<string | null>`coalesce(
          (SELECT to_char(max(coalesce(m.txn_date, m.value_date)), 'YYYY-MM-DD')
           FROM bank_statement_lines m
           WHERE m.statement_id = ${bankStatements.id}),
          to_char(${bankStatements.statementTo}, 'YYYY-MM-DD')
        )`,
      })
      .from(bankStatementLines)
      .innerJoin(bankStatements, eq(bankStatements.id, bankStatementLines.statementId))
      .where(inArray(bankStatementLines.fingerprint, fingerprints))) as StagingMatchRaw[];

    for (const match of matches) {
      for (const line of detail.lines) {
        if (line.fingerprint !== match.fingerprint) continue;
        if (match.id === line.id) continue;
        fingerprintPairs.add(`${match.id}\u0000${line.id}`);
        pushStagingCandidate(
          byLine,
          statementId,
          line,
          match,
          "same_content",
        );
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
        statementFrom: sql<string | null>`coalesce(
          (SELECT to_char(min(coalesce(m.txn_date, m.value_date)), 'YYYY-MM-DD')
           FROM bank_statement_lines m
           WHERE m.statement_id = ${bankStatements.id}),
          to_char(${bankStatements.statementFrom}, 'YYYY-MM-DD')
        )`,
        statementTo: sql<string | null>`coalesce(
          (SELECT to_char(max(coalesce(m.txn_date, m.value_date)), 'YYYY-MM-DD')
           FROM bank_statement_lines m
           WHERE m.statement_id = ${bankStatements.id}),
          to_char(${bankStatements.statementTo}, 'YYYY-MM-DD')
        )`,
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
        const matchedLine = lineById.get(lineId);
        if (!matchedLine) continue;
        pushStagingCandidate(byLine, statementId, matchedLine, match, "canonical");
      }
    }
  }

  // 2. Ledger matches on STRICT identity only: exact transaction date, exact
  //    direction, exact INR amount. Anything else is a different transaction
  //    and never a duplicate. The scanned lines' own statement lines are
  //    excluded (a line's own import cannot flag itself); source wording is
  //    weighed afterwards by the shared evidence rules.
  const result = await db.execute(sql`
    SELECT
      l.id AS "lineId",
      t.id AS "transactionId",
      to_char(t.txn_date, 'YYYY-MM-DD') AS "txnDate",
      t.source,
      t.description,
      t.client_id AS "transactionClientId",
      t.category_id AS "transactionCategoryId",
      t.client_name_snapshot AS "clientNameSnapshot",
      c.client_name AS "clientName",
      l.client_id AS "lineClientId",
      l.category_id AS "lineCategoryId",
      o.file_name AS "originFileName",
      coalesce(
        (SELECT to_char(min(coalesce(origin.txn_date, origin.value_date)), 'YYYY-MM-DD')
         FROM bank_statement_lines origin
         WHERE origin.statement_id = o.id),
        to_char(o.statement_from, 'YYYY-MM-DD')
      ) AS "originStatementFrom",
      coalesce(
        (SELECT to_char(max(coalesce(origin.txn_date, origin.value_date)), 'YYYY-MM-DD')
         FROM bank_statement_lines origin
         WHERE origin.statement_id = o.id),
        to_char(o.statement_to, 'YYYY-MM-DD')
      ) AS "originStatementTo",
      l.withdrawal_amount::text AS "withdrawal",
      l.deposit_amount::text AS "deposit"
    FROM bank_statement_lines l
    JOIN transactions t
      ON t.deleted_at IS NULL
     AND t.original_currency = 'INR'
     AND (l.withdrawal_amount IS NULL OR l.deposit_amount IS NULL)
     AND l.txn_date IS NOT NULL
     AND t.type_id = (CASE WHEN l.withdrawal_amount IS NOT NULL THEN 2 ELSE 1 END)
     AND t.amount_inr = COALESCE(l.withdrawal_amount, l.deposit_amount)
     AND t.txn_date = l.txn_date
     AND NOT EXISTS (
       SELECT 1 FROM bank_statement_lines own
       WHERE own.transaction_id = t.id AND own.statement_id = l.statement_id
     )
    LEFT JOIN clients c ON c.client_id = t.client_id
    LEFT JOIN bank_statement_lines ol ON ol.transaction_id = t.id
    LEFT JOIN bank_statements o ON o.id = ol.statement_id
    WHERE l.statement_id = ${statementId}::uuid
  `);
  const transactionMatches = result.rows as unknown as TransactionMatchRaw[];

  for (const match of transactionMatches) {
    const line = lineById.get(match.lineId);
    if (!line) continue;

    const direction =
      line.withdrawalAmount != null ? ("withdrawal" as const) : ("deposit" as const);

    const evidence = evaluateTransactionCandidate({
      lineBusinessDescription: line.businessDescription ?? null,
      lineNarration: line.narration,
      lineClientId: match.lineClientId ?? null,
      lineCategoryId: match.lineCategoryId ?? null,
      lineDirection: direction,
      transaction: {
        source: match.source,
        description: match.description,
        clientNameSnapshot: match.clientNameSnapshot,
        clientName: match.clientName,
        clientId: match.transactionClientId,
        categoryId: match.transactionCategoryId == null ? null : Number(match.transactionCategoryId),
        txnDate: match.txnDate,
        originFileName: match.originFileName,
        originStatementFrom: match.originStatementFrom,
        originStatementTo: match.originStatementTo,
      },
    });

    // A near-dated candidate with wording agreement used to surface here via a
    // ±3-day window; strict identity now excludes it — different day, different
    // transaction. The narration containment check below only remains for
    // same-day rows whose wording would upgrade an otherwise advisory match.
    const wordingAgrees = narrationMatches(line.narration, (match.clientNameSnapshot ?? match.clientName ?? match.description) ?? "");
    if (evidence.severity === "possible" && wordingAgrees) {
      // Same-day, same-amount, same direction — wording agrees with the ledger
      // entry, but the normalized Business Description evidence was weaker.
      // Keep it visible as a stronger-sounding advisory, never a hard trigger.
      push(byLine, line.id, {
        kind: "transaction_exact",
        severity: "possible",
        label: transactionBadgeLabel({
          source: match.source,
          when: match.txnDate,
          severity: "possible",
          originFileName: match.originFileName,
        }),
        detail:
          evidence.detail +
          " The narration wording overlaps the recorded entry; review or import as appropriate.",
        when: match.txnDate,
        amount: amountOf(line),
      });
      continue;
    }

    push(byLine, line.id, {
      kind: "transaction_exact",
      severity: evidence.severity,
      label: evidence.label,
      detail: evidence.detail,
      when: evidence.when,
      amount: amountOf(line),
    });
  }

  // Fold ambiguity: several equally strong matches mean the reviewer decides.
  for (const [lineId, candidates] of Object.entries(byLine)) {
    const evidence = candidates
      .filter((c) => c.kind === "transaction_exact")
      .map<TransactionCandidateEvidence>((c) => ({
        severity: c.severity,
        label: c.label,
        detail: c.detail,
        when: c.when,
        amount: c.amount,
      }));
    const resolved = resolveAmbiguousCandidates(evidence);
    const other = candidates.filter((c) => c.kind !== "transaction_exact");
    byLine[lineId] = [
      ...other,
      ...resolved.map((entry, index) => {
        const original = evidence[index];
        return {
          kind: "transaction_exact" as DuplicateKind,
          severity: entry.severity,
          label: entry.label,
          detail: entry.detail,
          when: entry.when,
          amount: original.amount,
        };
      }),
    ];
  }

  const flaggedLineIds = Object.keys(byLine).sort();
  return { byLine, flaggedLineIds };
}

/** Builds one staging-pair candidate card from a fingerprint/canonical match. */
function pushStagingCandidate(
  byLine: Record<string, LineDuplicateCandidate[]>,
  statementId: string,
  line: { id: string; txnDate: string | null; withdrawalAmount: string | null; depositAmount: string | null },
  match: StagingMatchRaw | CanonicalStagingMatchRaw,
  variant: "same_content" | "canonical",
): void {
  const byReference = variant === "canonical";
  if (match.statementId === statementId) {
    push(byLine, line.id, {
      kind: "same_statement_row",
      severity: "strong",
      label: stagingBadgeLabel("same_statement_row", line.txnDate),
      detail: stagingDetail("same_statement_row", null, null, null, byReference),
      when: line.txnDate,
      amount: amountOf(line),
    });
    return;
  }
  if (match.transactionId) {
    push(byLine, line.id, {
      kind: "imported_before",
      severity: "strong",
      label: stagingBadgeLabel("imported_before", match.txnDate),
      detail: stagingDetail("imported_before", match.fileName, match.statementFrom, match.statementTo, byReference),
      when: match.txnDate,
      amount: match.withdrawalAmount ?? match.depositAmount,
    });
    return;
  }
  push(byLine, line.id, {
    kind: "other_statement_row",
    severity: "strong",
    label: stagingBadgeLabel("other_statement_row", match.txnDate),
    detail: stagingDetail("other_statement_row", match.fileName, match.statementFrom, match.statementTo, byReference),
    when: match.txnDate,
    amount: match.withdrawalAmount ?? match.depositAmount,
  });
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

// ─── One-line candidate finder (import gate + review decisions) ──────────────

interface SingleLineShape {
  lineId: string;
  statementId: string;
  txnDate: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  narration: string | null;
  businessDescription: string | null;
  clientId: string | null;
  categoryId: number | null;
}

type SqlExecutor = Pick<typeof db, "execute">;

/**
 * Ledger duplicate evidence for ONE statement line, using the same strict
 * identity and shared evidence rules as the full-statement scan. Runs on any
 * SQL executor so the import gate and the review-decision mutation can call
 * it inside their own DB transaction and see exactly what would commit.
 */
export async function findLedgerCandidatesForLine(
  executor: SqlExecutor,
  line: SingleLineShape,
): Promise<TransactionCandidateEvidence[]> {
  if (!line.txnDate) return [];
  if (line.withdrawalAmount == null && line.depositAmount == null) return [];
  if (line.withdrawalAmount != null && line.depositAmount != null) return [];

  const result = await executor.execute(sql`
    SELECT
      t.id AS "transactionId",
      to_char(t.txn_date, 'YYYY-MM-DD') AS "txnDate",
      t.source,
      t.description,
      t.client_id AS "transactionClientId",
      t.category_id AS "transactionCategoryId",
      t.client_name_snapshot AS "clientNameSnapshot",
      c.client_name AS "clientName",
      o.file_name AS "originFileName",
      coalesce(
        (SELECT to_char(min(coalesce(origin.txn_date, origin.value_date)), 'YYYY-MM-DD')
         FROM bank_statement_lines origin
         WHERE origin.statement_id = o.id),
        to_char(o.statement_from, 'YYYY-MM-DD')
      ) AS "originStatementFrom",
      coalesce(
        (SELECT to_char(max(coalesce(origin.txn_date, origin.value_date)), 'YYYY-MM-DD')
         FROM bank_statement_lines origin
         WHERE origin.statement_id = o.id),
        to_char(o.statement_to, 'YYYY-MM-DD')
      ) AS "originStatementTo"
    FROM transactions t
    LEFT JOIN clients c ON c.client_id = t.client_id
    LEFT JOIN bank_statement_lines ol ON ol.transaction_id = t.id
    LEFT JOIN bank_statements o ON o.id = ol.statement_id
    WHERE t.deleted_at IS NULL
      AND t.original_currency = 'INR'
      AND t.type_id = ${line.withdrawalAmount != null ? 2 : 1}
      AND t.amount_inr = ${line.withdrawalAmount ?? line.depositAmount}::numeric
      AND t.txn_date = ${line.txnDate}::date
      AND NOT EXISTS (
        SELECT 1 FROM bank_statement_lines own
        WHERE own.transaction_id = t.id
          AND own.statement_id = ${line.statementId}::uuid
      )
  `);
  const rows = result.rows as unknown as Array<{
    transactionId: string;
    txnDate: string;
    source: string | null;
    description: string | null;
    transactionClientId: string | null;
    transactionCategoryId: number | null;
    clientNameSnapshot: string | null;
    clientName: string | null;
    originFileName: string | null;
    originStatementFrom: string | null;
    originStatementTo: string | null;
  }>;

  const direction = line.withdrawalAmount != null ? ("withdrawal" as const) : ("deposit" as const);
  return resolveAmbiguousCandidates(
    rows.map((row) =>
      evaluateTransactionCandidate({
        lineBusinessDescription: line.businessDescription ?? null,
        lineNarration: line.narration,
        lineClientId: line.clientId,
        lineCategoryId: line.categoryId,
        lineDirection: direction,
        transaction: {
          source: row.source,
          description: row.description,
          clientNameSnapshot: row.clientNameSnapshot,
          clientName: row.clientName,
          clientId: row.transactionClientId,
          categoryId: row.transactionCategoryId == null ? null : Number(row.transactionCategoryId),
          txnDate: row.txnDate,
          originFileName: row.originFileName,
          originStatementFrom: row.originStatementFrom,
          originStatementTo: row.originStatementTo,
        },
      }),
    ),
  );
}

/** Re-exported so import-time surfaces share one vocabulary. */
export { transactionBadgeLabel };
