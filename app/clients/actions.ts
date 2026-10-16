"use server";

import { refresh } from "next/cache";
import { requireAuthAction } from "@/lib/server-auth";
import { createClient, deleteClient, updateClient, type Result } from "@/lib/clients/clients";

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

export async function deleteClientAction(id: string): Promise<Result> {
  const auth = await requireAuthAction();
  if (!auth.ok) return NOT_SIGNED_IN;
  if (typeof id !== "string" || !UUID.test(id)) return GONE;
  const result = await deleteClient(auth.session.userId, id);
  if (result.ok) refresh();
  return result;
}
