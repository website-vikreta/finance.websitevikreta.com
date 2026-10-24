"use server";
/**
 * Bank-import Server Actions.
 *
 * Account creation and Phase 3 staging review are staging writes; statement
 * parsing goes through the upload route. Phase 4 adds the one place staging
 * rows become financial transactions: importLinesAction calls the dedicated
 * import service, which revalidates and re-locks every line before writing.
 */

import { refresh } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAuthAction } from "@/lib/server-auth";
import { canManageBankImports } from "@/lib/bank-import/policy";
import { createBankAccount, type WriteResult } from "@/lib/bank-import/persistence";
import { auditEvents } from "@/lib/db/schema";
import { createClient, searchClients } from "@/lib/bank-import/review";
import { logSafeDbError } from "@/lib/bank-import/safe-log";
import { deleteTransaction } from "@/lib/transactions/manage";
import {
  listIncomeInvoiceOptions,
  restoreImportedLine,
  importStatementLines,
  type ImportBatchResult,
  type ImportInvoiceOption,
} from "@/lib/bank-import/import";
import {
  markLineDuplicate,
  markLineReady,
  reopenLine,
  skipLine,
  updateLineReview,
  type ReviewResult,
} from "@/lib/bank-import/review";

type Result = WriteResult<string>;

const NOT_SIGNED_IN: Result = {
  ok: false,
  error: "Your session ended. Sign in again.",
};

const NOT_APPROVED: Result = {
  ok: false,
  error: "You do not have access to bank imports.",
};

const NOT_SIGNED_IN_REVIEW: ReviewResult = {
  ok: false,
  error: "Your session ended. Sign in again.",
};

const NOT_APPROVED_REVIEW: ReviewResult = {
  ok: false,
  error: "You do not have access to bank imports.",
};

export async function createBankAccountAction(input: unknown): Promise<Result> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;

  const approved = await canManageBankImports(auth.session.userId);
  if (!approved) return NOT_APPROVED;

  const result = await createBankAccount(auth.session.userId, input);
  if (result.ok) refresh();
  return result;
}

// ─── Phase 3 staging-review actions ──────────────────────────────────────────

async function guardReview(): Promise<
  { ok: true; userId: string } | { ok: false; result: ReviewResult }
> {
  const auth = await requireAuthAction();
  if (!auth.ok) return { ok: false, result: NOT_SIGNED_IN_REVIEW };

  const approved = await canManageBankImports(auth.session.userId);
  if (!approved) return { ok: false, result: NOT_APPROVED_REVIEW };

  return { ok: true, userId: auth.session.userId };
}

export async function updateLineReviewAction(
  statementId: string,
  lineId: string,
  input: unknown,
): Promise<ReviewResult> {
  const guard = await guardReview();
  if (!guard.ok) return guard.result;

  const result = await updateLineReview(guard.userId, statementId, lineId, input);
  if (result.ok) refresh();
  return result;
}

export async function markLineReadyAction(
  statementId: string,
  lineId: string,
): Promise<ReviewResult> {
  const guard = await guardReview();
  if (!guard.ok) return guard.result;

  const result = await markLineReady(guard.userId, statementId, lineId);
  if (result.ok) refresh();
  return result;
}

export async function skipLineAction(
  statementId: string,
  lineId: string,
  reason: unknown,
): Promise<ReviewResult> {
  const guard = await guardReview();
  if (!guard.ok) return guard.result;

  const result = await skipLine(guard.userId, statementId, lineId, reason);
  if (result.ok) refresh();
  return result;
}

export async function markLineDuplicateAction(
  statementId: string,
  lineId: string,
  note: unknown = null,
): Promise<ReviewResult> {
  const guard = await guardReview();
  if (!guard.ok) return guard.result;

  const result = await markLineDuplicate(guard.userId, statementId, lineId, note);
  if (result.ok) refresh();
  return result;
}

export async function reopenLineAction(
  statementId: string,
  lineId: string,
): Promise<ReviewResult> {
  const guard = await guardReview();
  if (!guard.ok) return guard.result;

  const result = await reopenLine(guard.userId, statementId, lineId);
  if (result.ok) refresh();
  return result;
}

// ─── Phase 4 import actions ──────────────────────────────────────────────────

async function guardBankImport(): Promise<
  { ok: true; userId: string } | { ok: false; reason: string }
> {
  const auth = await requireAuthAction();
  if (!auth.ok) return { ok: false, reason: "Your session ended. Sign in again." };

  const approved = await canManageBankImports(auth.session.userId);
  if (!approved) return { ok: false, reason: "You do not have access to bank imports." };

  return { ok: true, userId: auth.session.userId };
}

function failedBatch(error: string): ImportBatchResult {
  return {
    ok: false,
    error,
    requested: 0,
    imported: 0,
    failed: 0,
    statementStatus: null,
    results: [],
  };
}

/**
 * Imports the selected, reviewer-approved lines. Each line commits
 * independently; per-line failures leave the successful ones in place.
 */
export async function importLinesAction(
  statementId: string,
  lineIds: unknown,
): Promise<ImportBatchResult> {
  const guard = await guardBankImport();
  if (!guard.ok) return failedBatch(guard.reason);

  const result = await importStatementLines(guard.userId, statementId, lineIds);
  // Any batch attempt moves the statement state (review → importing), so the
  // server data refreshes even when every line was rejected.
  if (result.ok || result.statementStatus !== null) refresh();
  return result;
}

/** Returns an already-imported line (dead transaction) to review. */
export async function restoreImportAction(
  statementId: string,
  lineId: string,
): Promise<ReviewResult> {
  const guard = await guardBankImport();
  if (!guard.ok) return { ok: false, error: guard.reason };

  const result = await restoreImportedLine(guard.userId, statementId, lineId);
  if (result.ok) refresh();
  return result;
}

/** Open INR invoices of one client for the review picker (safe option labels). */
export async function listInvoiceOptionsAction(
  clientId: string,
): Promise<ImportInvoiceOption[]> {
  const guard = await guardBankImport();
  if (!guard.ok) return [];

  return listIncomeInvoiceOptions(clientId);
}

// ─── Client management ────────────────────────────────────────────────────────

export async function createClientAction(
  clientName: unknown,
): Promise<{ ok: true; clientId: string; created: boolean } | { ok: false; error: string }> {
  const guard = await guardReview();
  if (!guard.ok) return { ok: false, error: "Your session ended. Sign in again." };

  if (typeof clientName !== "string" || !clientName.trim()) {
    return { ok: false, error: "Client name is required." };
  }

  try {
    return await db.transaction(async (tx) => {
      return createClient(tx, guard.userId, clientName);
    });
  } catch (error) {
    logSafeDbError("createClient", error);
    return { ok: false, error: "The client could not be created. Try again." };
  }
}

export async function searchClientsAction(
  query: unknown,
): Promise<{ value: string; label: string }[]> {
  const guard = await guardReview();
  if (!guard.ok) return [];

  if (typeof query !== "string") return [];
  return searchClients(query);
}

// ─── Statement deletion ──────────────────────────────────────────────────────

type DeleteStatementResult =
  | { ok: true; deleted: boolean }
  | { ok: false; error: string; blocked?: boolean };

async function guardStatementDelete(): Promise<{
  ok: true; userId: string;
} | { ok: false; error: string }> {
  const auth = await requireAuthAction();
  if (!auth.ok) return { ok: false, error: "Your session ended. Sign in again." };
  const approved = await canManageBankImports(auth.session.userId);
  if (!approved) return { ok: false, error: "You do not have access to bank imports." };
  return { ok: true, userId: auth.session.userId };
}

/**
 * Deletes a statement and its staging lines.
 *
 * Safe deletion rules:
 * - Imported transactions are soft-deleted first (`deleteTransaction`,
 *   source "bank_import"): they move to "Recently deleted" and can be
 *   restored from there, with their audit history preserved. A blocked
 *   deletion (e.g. a recurring-bill payment) aborts with the specific reason
 *   before any staging data is touched.
 * - Then staging lines + the statement are deleted in one DB transaction.
 * - Audit history is always preserved.
 */
export async function deleteStatementAction(
  statementId: unknown,
): Promise<DeleteStatementResult> {
  const guard = await guardStatementDelete();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (typeof statementId !== "string") {
    return { ok: false, error: "This statement could not be resolved." };
  }

  try {
    // 1) Undo the financial side: every imported transaction is soft-deleted
    //    (moved to Recently deleted, restorable) before staging rows vanish.
    const imported = await db.execute(sql`
      SELECT transaction_id AS "txId"
      FROM bank_statement_lines
      WHERE statement_id = ${statementId}::uuid AND transaction_id IS NOT NULL
    `);
    const importedTxIds = (imported.rows as unknown as { txId: string }[]).map(
      (entry) => entry.txId,
    );
    for (const txId of importedTxIds) {
      const result = await deleteTransaction(guard.userId, txId, "bank_import");
      if (!result.ok && result.error !== "This transaction was already deleted.") {
        return { ok: false, error: result.error, blocked: true };
      }
    }

    // 2) Delete the staging rows + the statement in one DB transaction.
    const result = await db.transaction(async (tx) => {
      // Load the statement with its line counts.
      const stmt = await tx.execute(sql`
        SELECT
          s.id,
          s.file_name AS "fileName",
          s.account_id AS "accountId",
          s.statement_from AS "statementFrom",
          s.statement_to AS "statementTo",
          count(l.id) AS "lineCount",
          count(*) FILTER (WHERE l.status = 'imported') AS "importedCount",
          count(*) FILTER (WHERE l.status = 'skipped') AS "skippedCount",
          count(*) FILTER (WHERE l.status = 'pending') AS "pendingCount"
        FROM bank_statements s
        LEFT JOIN bank_statement_lines l ON l.statement_id = s.id
        WHERE s.id = ${statementId}::uuid
        GROUP BY s.id
      `);
      const row = stmt.rows[0] as unknown as {
        id: string;
        fileName: string;
        accountId: string;
        statementFrom: Date | null;
        statementTo: Date | null;
        lineCount: string;
        importedCount: string;
        skippedCount: string;
        pendingCount: string;
      } | undefined;

      if (!row) {
        return { ok: false, error: "This statement could not be found." } as DeleteStatementResult;
      }

      // Delete staging lines first (FK constraint), then the statement record.
      await tx.execute(sql`
        DELETE FROM bank_statement_lines
        WHERE statement_id = ${statementId}::uuid
      `);
      await tx.execute(sql`
        DELETE FROM bank_statements
        WHERE id = ${statementId}::uuid
      `);

      // Record a minimal audit event for the deletion.
      await tx.insert(auditEvents).values({
        entityType: "bank_statement",
        entityId: statementId,
        action: "deleted",
        performedBy: guard.userId,
        source: "bank_import",
        afterState: {
          fileName: row.fileName,
          accountId: row.accountId,
          lineCount: Number(row.lineCount ?? 0),
          importedTransactionsDeleted: importedTxIds.length,
        },
      });

      return { ok: true, deleted: true } as DeleteStatementResult;
    });
    if (!result.ok) return result;
    refresh();
    return result;
  } catch (error) {
    logSafeDbError("deleteStatement", error);
    return { ok: false, error: "The statement could not be deleted. Try again." };
  }
}
