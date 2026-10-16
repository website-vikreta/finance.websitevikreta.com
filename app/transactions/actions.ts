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

const NOT_SIGNED_IN: ManageResult = { ok: false, error: "Your session ended. Sign in again." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `requestId` is generated once per open form so a double submit saves one row. */
export async function createTransactionAction(input: unknown, requestId: string, allowDuplicate?: unknown): Promise<ManageResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;
  if (typeof requestId !== "string" || !UUID.test(requestId)) return { ok: false, error: "Reload the page and try again." };

  const result = await createManualTransaction(auth.session.userId, input, requestId, allowDuplicate === true);
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
