/**
 * Ledger ↔ staging sync for bank-import transactions.
 *
 * /transactions can delete or restore a transaction that a bank statement
 * import created. The staging line keeps its own record (status `imported`
 * with a link that may now be dead), so the statement page can still tell the
 * ledger's story per row. What must move is the statement's completeness
 * claim:
 *
 * - Deleting a bank-import transaction from the ledger demotes a `completed`
 *   statement back to `review`: the page returns to the review flow whose
 *   rows can be restored or re-imported, instead of claiming "Completed"
 *   while data is gone. Statements already in `review` / `importing` are
 *   already honest states and change nothing.
 * - Restoring it from "Recently deleted" re-livens the import; when no line
 *   is pending, ready or error any more, the statement completes again with
 *   the same predicate `finalizeStatement` uses.
 *
 * Both helpers run inside the caller's DB transaction, lock the statement
 * row, and audit the status change — pointer state only, never amounts,
 * narration or references. Wire failures bubble up: the caller's transaction
 * rolls back, so a ledger delete/restore never saves while its statement went
 * out of sync.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";
import { logSafeDbError } from "./safe-log";
import type { StatementStatus } from "./types";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface StatementUnresolvedCounts {
  pending: number;
  ready: number;
  error: number;
  /**
   * Imported rows whose ledger transaction was soft-deleted. They cannot be
   * called settled: the reviewer must restore the row or re-import it.
   */
  deadImports: number;
}

export type LedgerStatementSyncDecision =
  | { action: "demote"; from: "completed"; to: "review" }
  | { action: "promote"; from: StatementStatus; to: "completed" }
  | { action: "none" };

/**
 * Completeness predicate, mirroring `finalizeStatement`: a statement may claim
 * `completed` only when no line is pending, ready or error — and no imported
 * line lost its ledger transaction. Counting a dead import as settled would
 * let the page's reconcile immediately re-complete a reopened statement.
 */
export function canClaimComplete(counts: StatementUnresolvedCounts): boolean {
  return (
    counts.pending === 0 &&
    counts.ready === 0 &&
    counts.error === 0 &&
    counts.deadImports === 0
  );
}

/**
 * Pure sync policy so both directions stay answerable without a DB:
 * delete demotes only a `completed` claim; restore promotes only when the
 * statement is still open (`review` / `importing`) and fully settled again.
 */
export function ledgerStatementSyncDecision(
  current: StatementStatus,
  counts: StatementUnresolvedCounts,
  via: "ledger_delete" | "ledger_restore",
): LedgerStatementSyncDecision {
  if (via === "ledger_delete") {
    return current === "completed"
      ? { action: "demote", from: "completed", to: "review" }
      : { action: "none" };
  }
  if ((current === "review" || current === "importing") && canClaimComplete(counts)) {
    return { action: "promote", from: current, to: "completed" };
  }
  return { action: "none" };
}

interface StatementPointerRow {
  statementId: string;
  status: StatementStatus;
}

/**
 * Finds the statement(s) a staged line links to through this transaction and
 * locks the statement row, so the status change serializes against imports
 * and review actions. At most one line references a transaction
 * (uq_bank_statement_lines_transaction), but the loop stays cheap and safe.
 */
async function loadLinkedStatements(
  tx: DbTx,
  statementId: string,
): Promise<StatementPointerRow[]> {
  const result = await tx.execute(sql`
    SELECT s.id AS "statementId", s.status
    FROM bank_statement_lines l
    JOIN bank_statements s ON s.id = l.statement_id
    WHERE l.transaction_id = ${statementId}::uuid
    FOR UPDATE OF s
  `);
  return (result.rows as unknown as StatementPointerRow[]).map((row) => ({
    statementId: row.statementId,
    status: row.status as StatementStatus,
  }));
}

function normalizeCounts(raw: unknown): StatementUnresolvedCounts {
  const row = (raw ?? {}) as Record<string, unknown>;
  const number = (value: unknown) => (typeof value === "number" ? value : Number(value) || 0);
  return {
    pending: number(row.pendingCount),
    ready: number(row.readyCount),
    error: number(row.errorCount),
    deadImports: number(row.deadImportCount),
  };
}

/**
 * Reads every reason a statement cannot claim completeness in one query.
 * "Dead import" means the staging row still says `imported` but its ledger
 * transaction was soft-deleted — exactly the state the reopen flow exists for.
 */
async function loadUnresolvedCounts(
  tx: DbTx,
  statementId: string,
): Promise<StatementUnresolvedCounts> {
  const countRows = await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE l.status = 'pending')::int AS "pendingCount",
      count(*) FILTER (WHERE l.status = 'ready')::int AS "readyCount",
      count(*) FILTER (WHERE l.status = 'error')::int AS "errorCount",
      count(*) FILTER (
        WHERE l.status = 'imported' AND t.deleted_at IS NOT NULL
      )::int AS "deadImportCount"
    FROM bank_statement_lines l
    LEFT JOIN transactions t ON t.id = l.transaction_id
    WHERE l.statement_id = ${statementId}::uuid
  `);
  return normalizeCounts(countRows.rows[0]);
}

/**
 * Moves a statement's status to match its line states — the predicate the
 * import batch uses to reach `completed`: no pending, ready or error line
 * may remain. `from` scopes the statuses the statement may leave, so each
 * writer only drives its own transitions; anything unresolved keeps the
 * statement in `review`. Callers run it inside their own transaction (the
 * caller's row locks serialise against concurrent import / review writes).
 */
export async function finalizeStatementStatuses(
  tx: DbTx,
  statementId: string,
  from: readonly StatementStatus[] = ["importing"],
): Promise<StatementStatus> {
  const counts = await loadUnresolvedCounts(tx, statementId);
  const complete = canClaimComplete(counts);
  const target: StatementStatus = complete ? "completed" : "review";
  const fromList = sql.join(
    from.map((status) => sql`${status}`),
    sql`, `,
  );

  const updated = await tx.execute(sql`
    UPDATE bank_statements
    SET status = ${target},
        completed_at = CASE WHEN ${complete} THEN coalesce(completed_at, now()) ELSE completed_at END,
        updated_at = now()
    WHERE id = ${statementId}::uuid AND status IN (${fromList})
    RETURNING status
  `);

  if ((updated.rows as unknown as { status: string }[]).length > 0) {
    return (updated.rows[0] as unknown as { status: string }).status as StatementStatus;
  }
  // The statement already left the allowed statuses; report its current truth.
  const head = await tx.execute(sql`
    SELECT status FROM bank_statements WHERE id = ${statementId}::uuid
  `);
  return ((head.rows[0] as unknown as { status?: string } | undefined)?.status ??
    "review") as StatementStatus;
}

/**
 * After a ledger transaction was soft-deleted (from /transactions), stop any
 * affected statement from claiming completeness. Audited as
 * `review_reopened` — the statement's own indicator that its imported data
 * changed outside the staging flow.
 */
export async function syncStatementForDeletedTransaction(
  tx: DbTx,
  userId: string,
  transactionId: string,
): Promise<void> {
  const statements = await loadLinkedStatements(tx, transactionId);

  for (const { statementId, status } of statements) {
    const decision = ledgerStatementSyncDecision(
      status,
      { pending: 0, ready: 0, error: 0, deadImports: 1 },
      "ledger_delete",
    );
    if (decision.action !== "demote") continue;

    await tx.execute(sql`
      UPDATE bank_statements
      SET status = 'review', updated_at = now()
      WHERE id = ${statementId}::uuid AND status = 'completed'
    `);

    await tx.insert(auditEvents).values({
      entityType: "bank_statement",
      entityId: statementId,
      action: "review_reopened",
      performedBy: userId,
      source: "manual",
      beforeState: { status: "completed" },
      afterState: { status: "review" },
      metadata: { transactionId, via: "ledger_delete" },
    });
  }
}

/**
 * After a ledger transaction was restored from "Recently deleted", re-completes
 * an affected statement when nothing remains unresolved — the same condition
 * the import batch uses to reach `completed`.
 */
export async function syncStatementForRestoredTransaction(
  tx: DbTx,
  userId: string,
  transactionId: string,
): Promise<void> {
  const statements = await loadLinkedStatements(tx, transactionId);

  for (const { statementId, status } of statements) {
    if (status !== "review" && status !== "importing") continue;

    const counts = await loadUnresolvedCounts(tx, statementId);

    const decision = ledgerStatementSyncDecision(status, counts, "ledger_restore");
    if (decision.action !== "promote") continue;

    await tx.execute(sql`
      UPDATE bank_statements
      SET status = 'completed',
          completed_at = CASE WHEN completed_at IS NULL THEN now() ELSE completed_at END,
          updated_at = now()
      WHERE id = ${statementId}::uuid AND status IN ('review', 'importing')
    `);

    await tx.insert(auditEvents).values({
      entityType: "bank_statement",
      entityId: statementId,
      action: "statement_completed",
      performedBy: userId,
      source: "manual",
      beforeState: { status },
      afterState: { status: "completed" },
      metadata: { transactionId, via: "ledger_restore" },
    });
  }
}

/**
 * Reopens a `completed` statement whose imported ledger rows were deleted
 * from /transactions before the ledger-sync existed. Audited like the
 * automatic demote. Returns safe errors instead of throwing — it is an
 * explicit rescue action the manager triggers from the statement page, not a
 * side effect.
 */
export async function reopenStatementWithDeadImports(
  userId: string,
  statementId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await db.transaction(async (tx) => {
      const headRows = await tx.execute(sql`
        SELECT status FROM bank_statements WHERE id = ${statementId}::uuid FOR UPDATE
      `);
      const status = (headRows.rows[0] as unknown as { status?: string } | undefined)?.status;
      if (!status) return { ok: false, error: "This statement could not be found." };
      if (status !== "completed") {
        return { ok: false, error: "Only a completed statement can be reopened here." };
      }

      const deadRows = await tx.execute(sql`
        SELECT count(*)::int AS dead
        FROM bank_statement_lines l
        JOIN transactions t ON t.id = l.transaction_id
        WHERE l.statement_id = ${statementId}::uuid
          AND l.status = 'imported'
          AND t.deleted_at IS NOT NULL
      `);
      const dead = Number(
        (deadRows.rows[0] as unknown as { dead?: number } | undefined)?.dead ?? 0,
      );
      if (dead === 0) {
        return { ok: false, error: "Every import of this statement is live again." };
      }

      await tx.execute(sql`
        UPDATE bank_statements
        SET status = 'review', updated_at = now()
        WHERE id = ${statementId}::uuid AND status = 'completed'
      `);

      await tx.insert(auditEvents).values({
        entityType: "bank_statement",
        entityId: statementId,
        action: "review_reopened",
        performedBy: userId,
        source: "bank_import",
        beforeState: { status: "completed" },
        afterState: { status: "review" },
        metadata: { via: "manual_reopen", deadImports: dead },
      });

      return { ok: true };
    });
  } catch (error) {
    logSafeDbError("reopenStatement", error);
    return { ok: false, error: "The statement could not be reopened. Try again." };
  }
}
