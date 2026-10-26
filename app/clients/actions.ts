"use server";

import { refresh } from "next/cache";
import { requireAuthAction } from "@/lib/server-auth";
import {
  createClient,
  permanentlyDeleteClient,
  clientDeletionScope,
  type ClientDeletionScope,
  type Result,
  updateClient,
} from "@/lib/clients/clients";

const NOT_SIGNED_IN = { ok: false as const, error: "Your session ended. Sign in again." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GONE = { ok: false as const, error: "This client no longer exists." };

export async function createClientAction(input: unknown): Promise<Result> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;
  const result = await createClient(auth.session.userId, input);
  if (result.ok) refresh();
  return result;
}

export async function updateClientAction(id: string, input: unknown): Promise<Result> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;
  if (typeof id !== "string" || !UUID.test(id)) return GONE;
  const result = await updateClient(auth.session.userId, id, input);
  if (result.ok) refresh();
  return result;
}

/**
 * Permanently deletes one client and its dependent records (server action).
 *
 * `confirmationName` must exactly match the client's name — the strong confirmation
 * required because this operation is irreversible. Counts and existence are always
 * re-verified on the server; the browser is never trusted.
 */
export async function deleteClientAction(id: string, confirmationName: string): Promise<Result> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;
  if (typeof id !== "string" || !UUID.test(id)) return GONE;
  if (typeof confirmationName !== "string" || !confirmationName.trim()) {
    return { ok: false, error: "Enter the client name to confirm." };
  }
  const result = await permanentlyDeleteClient(auth.session.userId, id, confirmationName);
  if (result.ok) refresh();
  return result;
}

/**
 * Authoritative preview of the deletion scope for the confirmation dialog.
 * Computed on the server; never derived from browser-supplied counts.
 */
export async function clientDeletionPreviewAction(
  id: string,
): Promise<{ ok: true; scope: ClientDeletionScope } | { ok: false; error: string }> {
  const auth = await requireAuthAction();
  if (!auth.ok) return { ok: false, error: NOT_SIGNED_IN.error };
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: GONE.error };
  const scope = await clientDeletionScope(id);
  if (!scope) return { ok: false, error: GONE.error };
  return { ok: true, scope };
}
