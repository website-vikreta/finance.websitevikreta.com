/**
 * Manual create, edit and soft delete of ledger transactions.
 *
 * Same rules as Finance AI confirmations (lib/transactions/persist.ts): exact amounts,
 * client find-or-create, one audit event per change inside the same DB transaction.
 * Deletes are soft (deleted_at / deleted_by) and can be restored from the audit log.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, transactions } from "@/lib/db/schema";
import { validateExtraction } from "@/lib/chatbot/validate";
import type { ExtractionResult } from "@/lib/chatbot/extract";
import {
  computeAmounts,
  computeCanonicalPayloadHash,
  confirmAndPersistTransaction,
  resolveCategoryId,
  resolveClientId,
  type PersistError,
} from "@/lib/transactions/persist";
import { duplicateMessage, findDuplicate } from "@/lib/transactions/duplicates";
import { toCategory } from "@/lib/transactions/categories";

export interface TransactionInput {
  type: "income" | "expense";
  amount: number;
  currency: "INR" | "USD";
  /** Required for USD, ignored for INR. */
  rate: number | null;
  /** Required for income. */
  client: string | null;
  /** Required for expenses. */
  description: string | null;
  /** Expense category (one of CATEGORIES); "Other" when missing. */
  category: string | null;
  /** YYYY-MM-DD */
  date: string;
}

/** `duplicate` marks a likely-duplicate warning: resubmitting with allowDuplicate saves anyway. */
export type ManageResult = { ok: true; id: string } | { ok: false; error: string; duplicate?: true };

const MAX_TEXT = 200;

/**
 * Validates untrusted form input (it arrives from the browser via a Server Action)
 * and turns it into the same draft shape Finance AI produces.
 */
export function toDraft(raw: unknown): { ok: true; draft: ExtractionResult; rate: number | null } | { ok: false; error: string } {
  const input = (raw ?? {}) as Partial<Record<keyof TransactionInput, unknown>>;
  const type = input.type === "income" || input.type === "expense" ? input.type : null;
  const currency = input.currency === "INR" || input.currency === "USD" ? input.currency : null;
  const amount = typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount > 0 ? input.amount : null;
  const rate = typeof input.rate === "number" && Number.isFinite(input.rate) && input.rate > 0 ? input.rate : null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_TEXT) : null);
  const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) && !Number.isNaN(Date.parse(input.date)) ? input.date : null;

  if (!type) return { ok: false, error: "Choose money in or money out." };
  if (amount === null) return { ok: false, error: "Enter an amount greater than zero." };
  if (!currency) return { ok: false, error: "Choose INR or USD." };
  if (currency === "USD" && rate === null) return { ok: false, error: "Enter the USD → INR rate you used." };
  if (!date) return { ok: false, error: "Pick the transaction date." };

  const draft: ExtractionResult = {
    type,
    original_amount: amount,
    original_currency: currency,
    client_name: type === "income" ? text(input.client) : null,
    expense_description: type === "expense" ? text(input.description) : null,
    txn_date: date,
    category: type === "expense" ? (toCategory(input.category) ?? "Other") : null,
  };
  const validation = validateExtraction(draft);
  if (!validation.complete) return { ok: false, error: validation.question ?? "Some details are missing." };

  return { ok: true, draft, rate: currency === "USD" ? rate : null };
}

function errorOf(result: PersistError | { ok: false; error: string }): ManageResult {
  return { ok: false, error: result.error };
}

const jsonSafe = (row: unknown) => JSON.parse(JSON.stringify(row));

async function duplicateWarning(draft: ExtractionResult, excludeId: string | null): Promise<ManageResult | null> {
  const dup = await findDuplicate(draft, excludeId);
  return dup ? { ok: false, error: duplicateMessage(dup), duplicate: true } : null;
}

export async function createManualTransaction(
  userId: string,
  raw: unknown,
  idempotencyKey: string,
  allowDuplicate = false,
  invoice?: { id: string; note: string },
): Promise<ManageResult> {
  const parsed = toDraft(raw);
  if (!parsed.ok) return parsed;
  const { draft, rate } = parsed;

  const warning = allowDuplicate ? null : await duplicateWarning(draft, null);
  if (warning) return warning;

  const result = await confirmAndPersistTransaction({
    userId,
    source: "manual",
    idempotencyKey: `manual-${idempotencyKey}`,
    invoiceId: invoice?.id,
    incomeNote: invoice?.note,
    draft,
    sessionState: {
      status: "READY_FOR_CONFIRMATION",
      currency: {
        original_amount: draft.original_amount as number,
        original_currency: draft.original_currency as "INR" | "USD",
        exchange_rate: rate,
        inr_amount: 0, // recomputed exactly by persistence
        exchange_rate_date: draft.txn_date as string,
      },
    },
  });
  return result.ok ? { ok: true, id: result.transaction.id as string } : errorOf(result);
}

export async function updateTransaction(userId: string, id: string, raw: unknown, allowDuplicate = false): Promise<ManageResult> {
  const parsed = toDraft(raw);
  if (!parsed.ok) return parsed;
  const { draft, rate } = parsed;

  const warning = allowDuplicate ? null : await duplicateWarning(draft, id);
  if (warning) return warning;

  const money = computeAmounts(draft, rate);
  if (!money.ok) return errorOf(money);

  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)))
        .for("update");
      if (!before) return { ok: false, error: "This transaction no longer exists." } as ManageResult;

      const typeId = draft.type === "income" ? 1 : 2;
      const clientName = typeId === 1 ? (draft.client_name as string).trim() : null;
      const clientId = clientName ? await resolveClientId(tx, clientName) : null;
      const description = typeId === 2 ? (draft.expense_description as string).trim() : null;
      const categoryId = typeId === 2 ? (await resolveCategoryId(tx, draft.category)).id : null;

      const [after] = await tx
        .update(transactions)
        .set({
          typeId,
          clientId,
          clientNameSnapshot: clientName,
          originalAmount: money.originalAmount,
          originalCurrency: draft.original_currency as "INR" | "USD",
          amountInr: money.amountInr,
          exchangeRate: money.exchangeRate,
          exchangeRateDate: money.exchangeRateDate,
          rateSource: money.rateSource,
          description,
          categoryId,
          txnDate: draft.txn_date as string,
          payloadHash: computeCanonicalPayloadHash({
            typeId,
            originalAmount: money.originalAmount,
            originalCurrency: draft.original_currency as string,
            amountInr: money.amountInr,
            exchangeRate: money.exchangeRate,
            clientName,
            description,
            txnDate: draft.txn_date as string,
            createdBy: before.createdBy,
          }),
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, id))
        .returning();

      await tx.insert(auditEvents).values({
        entityType: "transaction",
        entityId: id,
        action: "updated",
        performedBy: userId,
        source: "manual",
        beforeState: jsonSafe(before),
        afterState: jsonSafe(after),
      });
      return { ok: true, id } as ManageResult;
    });
  } catch (err) {
    console.error("[updateTransaction] failed:", err);
    return { ok: false, error: "Couldn't save the change. Please try again." };
  }
}

export async function deleteTransaction(userId: string, id: string): Promise<ManageResult> {
  try {
    return await db.transaction(async (tx) => {
      const [deleted] = await tx
        .update(transactions)
        .set({ deletedAt: new Date(), deletedBy: userId, updatedAt: new Date() })
        .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)))
        .returning();
      if (!deleted) return { ok: false, error: "This transaction was already deleted." } as ManageResult;

      await tx.insert(auditEvents).values({
        entityType: "transaction",
        entityId: id,
        action: "deleted",
        performedBy: userId,
        source: "manual",
        beforeState: { deleted_at: null },
        afterState: { deleted_at: deleted.deletedAt },
      });
      return { ok: true, id } as ManageResult;
    });
  } catch (err) {
    console.error("[deleteTransaction] failed:", err);
    return { ok: false, error: "Couldn't delete it. Please try again." };
  }
}

export async function restoreTransaction(userId: string, id: string): Promise<ManageResult> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select().from(transactions).where(eq(transactions.id, id)).for("update");
      if (!row || row.deletedAt === null) return { ok: false, error: "This transaction isn't deleted." } as ManageResult;

      // The client may have been removed meanwhile; re-link income to an active client by name.
      const clientId = row.typeId === 1 && row.clientNameSnapshot ? await resolveClientId(tx, row.clientNameSnapshot) : row.clientId;

      const [restored] = await tx
        .update(transactions)
        .set({ deletedAt: null, deletedBy: null, clientId, updatedAt: new Date() })
        .where(eq(transactions.id, id))
        .returning();

      await tx.insert(auditEvents).values({
        entityType: "transaction",
        entityId: id,
        action: "restored",
        performedBy: userId,
        source: "manual",
        beforeState: { deleted_at: row.deletedAt },
        afterState: { deleted_at: null, client_id: restored.clientId },
      });
      return { ok: true, id } as ManageResult;
    });
  } catch (err) {
    console.error("[restoreTransaction] failed:", err);
    return { ok: false, error: "Couldn't restore it. Please try again." };
  }
}
