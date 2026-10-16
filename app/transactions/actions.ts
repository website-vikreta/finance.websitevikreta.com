"use server";

import { refresh } from "next/cache";
import { requireAuthAction } from "@/lib/server-auth";
import {
  createManualTransaction,
  deleteTransaction,
  restoreTransaction,
  updateTransaction,
  type ManageResult,
} from "@/lib/transactions/manage";
import { createRecurring, recordPayment, startPaidRecurring, updateRecurring, setRecurringActive, stopRecurring, type RecurringResult } from "@/lib/transactions/recurring";
import { listClientBilling } from "@/lib/invoices/invoices";
import { MAX_MONTHS } from "@/lib/transactions/recurring-dates";

export async function listActiveClientsAction(): Promise<string[]> {
  const auth = await requireAuthAction();
  if (!auth.ok) return [];
  const rows = await listClientBilling();
  return rows.map((r) => r.name);
}

const NOT_SIGNED_IN: ManageResult = { ok: false, error: "Your session ended. Sign in again." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `requestId` is generated once per open form so a double submit saves one row.
 * `recurring` is set by "Mark paid": once the transaction saves, the bill records the payment
 * (a part payment keeps the same due date; settling it moves to the next one).
 * `repeat` ({ months: null = ongoing, or 2–60 }) turns a new expense into a monthly bill whose
 * first month is this expense. Either way it all saves in one DB transaction or not at all.
 */
export async function createTransactionAction(input: unknown, requestId: string, allowDuplicate?: unknown, recurring?: unknown, repeat?: unknown): Promise<ManageResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;
  if (typeof requestId !== "string" || !UUID.test(requestId)) return { ok: false, error: "Reload the page and try again." };

  const raw = recurring as { id?: unknown; due?: unknown; mode?: unknown } | undefined;
  const bill =
    typeof raw?.id === "string" && UUID.test(raw.id) && typeof raw.due === "string" && DATE.test(raw.due)
      ? { id: raw.id, due: raw.due, mode: raw.mode === "partial" ? ("partial" as const) : ("full" as const) }
      : null;
  const paid = input as { amount?: unknown; currency?: unknown; description?: unknown; category?: unknown; client?: unknown; date?: unknown };
  const userId = auth.session.userId;
  const months = (repeat as { months?: unknown } | undefined)?.months;
  if (repeat !== undefined && months !== null && !(Number.isInteger(months) && (months as number) >= 2 && (months as number) <= MAX_MONTHS)) {
    return { ok: false, error: `A bill can run for 2 to ${MAX_MONTHS} months.` };
  }

  // The bill moves on in the same DB transaction as the expense; if it can't, nothing is saved.
  const result = await createManualTransaction(
    userId,
    input,
    requestId,
    allowDuplicate === true,
    undefined,
    bill
      ? async (tx, transactionId) => {
          const res = await recordPayment(tx, userId, bill.id, bill.due, { amount: Number(paid.amount), currency: String(paid.currency) }, bill.mode, transactionId);
          return res.ok ? null : res.error;
        }
      : repeat !== undefined
        ? (tx, transactionId) => startPaidRecurring(tx, userId, transactionId, paid, typeof months === "number" ? months : null)
        : undefined,
  );
  if (result.ok) refresh();
  return result;
}

export async function updateTransactionAction(id: string, input: unknown, allowDuplicate?: unknown): Promise<ManageResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "This transaction no longer exists." };

  const result = await updateTransaction(auth.session.userId, id, input, allowDuplicate === true);
  if (result.ok) refresh();
  return result;
}

export async function deleteTransactionAction(id: string): Promise<ManageResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "This transaction no longer exists." };

  const result = await deleteTransaction(auth.session.userId, id);
  if (result.ok) refresh();
  return result;
}

export async function restoreTransactionAction(id: string): Promise<ManageResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "This transaction no longer exists." };

  const result = await restoreTransaction(auth.session.userId, id);
  if (result.ok) refresh();
  return result;
}

// ─── Recurring bills ─────────────────────────────────────────────────────────

const NOT_SIGNED_IN_RECURRING: RecurringResult = { ok: false, error: "Your session ended. Sign in again." };

export async function createRecurringAction(input: unknown): Promise<RecurringResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN_RECURRING;
  const result = await createRecurring(auth.session.userId, input);
  if (result.ok) refresh();
  return result;
}

export async function updateRecurringAction(id: string, input: unknown): Promise<RecurringResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN_RECURRING;
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "This bill no longer exists." };
  const result = await updateRecurring(auth.session.userId, id, input);
  if (result.ok) refresh();
  return result;
}

export async function setRecurringActiveAction(id: string, active: boolean): Promise<RecurringResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN_RECURRING;
  if (typeof id !== "string" || !UUID.test(id) || typeof active !== "boolean") return { ok: false, error: "This bill no longer exists." };
  const result = await setRecurringActive(auth.session.userId, id, active);
  if (result.ok) refresh();
  return result;
}

export async function stopRecurringAction(id: string): Promise<RecurringResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN_RECURRING;
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "This bill no longer exists." };
  const result = await stopRecurring(auth.session.userId, id);
  if (result.ok) refresh();
  return result;
}
