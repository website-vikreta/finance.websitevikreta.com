"use server";

import { refresh } from "next/cache";
import { requireAuthAction } from "@/lib/server-auth";
import { deleteDraft, issueInvoice, recordPayment, saveDraft, voidInvoice, type Result } from "@/lib/invoices/invoices";
import type { ManageResult } from "@/lib/transactions/manage";

const NOT_SIGNED_IN = { ok: false as const, error: "Your session ended. Sign in again." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GONE = { ok: false as const, error: "This invoice no longer exists." };

async function run(id: string | null, fn: (userId: string) => Promise<Result>): Promise<Result> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;
  if (id !== null && (typeof id !== "string" || !UUID.test(id))) return GONE;
  const result = await fn(auth.session.userId);
  if (result.ok) refresh();
  return result;
}

/** `id` null creates a draft. */
export async function saveDraftAction(id: string | null, input: unknown): Promise<Result> {
  return run(id, (userId) => saveDraft(userId, id, input));
}

export async function issueInvoiceAction(id: string): Promise<Result> {
  return run(id, (userId) => issueInvoice(userId, id));
}

export async function voidInvoiceAction(id: string): Promise<Result> {
  return run(id, (userId) => voidInvoice(userId, id));
}

export async function deleteDraftAction(id: string): Promise<Result> {
  return run(id, (userId) => deleteDraft(userId, id));
}

/** `requestId` is generated once per open payment form so a double submit records one payment. */
export async function recordPaymentAction(id: string, input: unknown, requestId: string): Promise<ManageResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;
  if (typeof id !== "string" || !UUID.test(id)) return GONE;
  if (typeof requestId !== "string" || !UUID.test(requestId)) return { ok: false, error: "Reload the page and try again." };
  const result = await recordPayment(auth.session.userId, id, input, requestId);
  if (result.ok) refresh();
  return result;
}
