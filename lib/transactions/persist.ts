/**
 * Shared server-side transaction persistence service.
 *
 * Implements Phase 6: Connect explicit confirmation to PostgreSQL.
 *
 * Requirements:
 *   1. Authenticates manager session.
 *   2. Loads authoritative server-side draft and state.
 *   3. Verifies draft is complete and in READY_FOR_CONFIRMATION.
 *   4. Revalidates required fields, financial accuracy & precision limits.
 *   5. Resolves or creates client atomically for income transactions.
 *   6. Enforces exact BigInt minor units and Banker's Rounding (Half-Even).
 *   7. Atomic insert of transaction and immutable audit event within the same DB transaction.
 *   8. Idempotency protection: same key + same payload -> returns saved transaction;
 *      same key + different payload -> 409 conflict; different keys -> allow duplicate data.
 *   9. Non-destructive rollback on failure, keeping draft recoverable.
 */

import { db } from "@/lib/db";
import { appUsers, categories, clients, transactions, auditEvents } from "@/lib/db/schema";
import { toCategory } from "@/lib/transactions/categories";
import { eq, and, sql, isNull } from "drizzle-orm";
import { getDraft, getSession, setSession, type ChatSessionState } from "@/lib/chatbot/store";
import { validateExtraction } from "@/lib/chatbot/validate";
import {
  toMajorDecimal,
  convertUsdToInrDecimal,
  DecimalPrecisionError,
} from "@/lib/currency/precision";
import crypto from "crypto";
import type { ConfirmationTransaction } from "@/lib/chatbot/confirm";
import type { ExtractionResult } from "@/lib/chatbot/extract";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PersistConfirmationParams {
  userId: string;
  source?: "chatbot" | "manual";
  idempotencyKey?: string;
  draft?: ExtractionResult;
  sessionState?: ChatSessionState;
  /** Income that pays this invoice (Record payment). */
  invoiceId?: string;
  /** Description for an income row (e.g. "Invoice WV/2026-27/001"); expenses use the draft's. */
  incomeNote?: string;
}

export type PersistResult =
  | {
      ok: true;
      status: "CONFIRMED";
      transaction: ConfirmationTransaction;
      isDuplicate?: boolean;
    }
  | {
      ok: false;
      error: string;
      code:
        | "NOT_AUTHENTICATED"
        | "INCOMPLETE_DRAFT"
        | "INVALID_STATE"
        | "INVALID_DATA"
        | "PRECISION_ERROR"
        | "CONFLICT"
        | "DATABASE_ERROR";
      status: 400 | 401 | 409 | 500;
    };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Computes canonical payload SHA-256 hash across core financial fields.
 */
export function computeCanonicalPayloadHash(payload: {
  typeId: number;
  originalAmount: string;
  originalCurrency: string;
  amountInr: string;
  exchangeRate: string | null;
  clientName: string | null;
  description: string | null;
  txnDate: string;
  createdBy: string;
}): string {
  const canonicalString = JSON.stringify({
    typeId: payload.typeId,
    originalAmount: payload.originalAmount,
    originalCurrency: payload.originalCurrency,
    amountInr: payload.amountInr,
    exchangeRate: payload.exchangeRate,
    clientName: payload.clientName ? payload.clientName.trim().toLowerCase() : null,
    description: payload.description ? payload.description.trim() : null,
    txnDate: payload.txnDate,
    createdBy: payload.createdBy,
  });
  return crypto.createHash("sha256").update(canonicalString).digest("hex");
}

/**
 * Maps a database row to the strongly-typed ConfirmationTransaction.
 * Major units stored directly in PostgreSQL NUMERIC(18,2) are parsed as numbers
 * without duplicate minor-unit division.
 */
export function mapRowToConfirmationTransaction(
  row: typeof transactions.$inferSelect,
  category?: string | null,
): ConfirmationTransaction {
  return {
    id: row.id,
    type: row.typeId === 1 ? "income" : "expense",
    original_amount: Number(row.originalAmount),
    original_currency: row.originalCurrency as "INR" | "USD",
    client_name: row.clientNameSnapshot ?? null,
    expense_description: row.description ?? null,
    txn_date: row.txnDate,
    exchange_rate: row.exchangeRate ? Number(row.exchangeRate) : null,
    inr_amount: Number(row.amountInr),
    ...(category !== undefined ? { category } : {}),
  };
}

/**
 * Checks whether an error is a PostgreSQL unique constraint violation.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as Record<string, unknown>;
  if (rec.code === "23505") return true;
  const cause = rec.cause && typeof rec.cause === "object" ? (rec.cause as Record<string, unknown>) : undefined;
  if (cause && cause.code === "23505") return true;
  const msg = typeof rec.message === "string" ? rec.message : "";
  return msg.includes("unique") || msg.includes("duplicate key");
}

// ─── Core Persistence Service ────────────────────────────────────────────────

export type PersistError = Extract<PersistResult, { ok: false }>;

export type Amounts = {
  ok: true;
  originalAmount: string;
  amountInr: string;
  exchangeRate: string | null;
  exchangeRateDate: string | null;
  rateSource: string | null;
};

/**
 * Exact NUMERIC strings for a draft: INR is stored as-is; USD converts with the
 * manager-entered rate using half-even rounding (lib/currency/precision.ts).
 */
export function computeAmounts(
  draft: ExtractionResult,
  rate: number | null,
  rateDate?: string | null,
): Amounts | PersistError {
  try {
    const amountStr = String(draft.original_amount);
    const originalAmount = toMajorDecimal(amountStr);
    if (draft.original_currency === "INR") {
      return { ok: true, originalAmount, amountInr: originalAmount, exchangeRate: null, exchangeRateDate: null, rateSource: null };
    }
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      return {
        ok: false,
        error: "A valid positive exchange rate is required for USD transactions.",
        code: "INVALID_DATA",
        status: 400,
      };
    }
    return {
      ok: true,
      originalAmount,
      amountInr: convertUsdToInrDecimal(amountStr, rate.toString()),
      exchangeRate: rate.toFixed(4),
      exchangeRateDate: rateDate || draft.txn_date,
      rateSource: "manual",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof DecimalPrecisionError ? err.message : "Invalid monetary or exchange rate precision.",
      code: err instanceof DecimalPrecisionError ? "PRECISION_ERROR" : "INVALID_DATA",
      status: 400,
    };
  }
}

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The active client with this name, ignoring case and outer spaces; null if there is none. */
export async function findClient(tx: DbTx, clientName: string): Promise<{ id: string; name: string } | null> {
  const [found] = await tx
    .select({ id: clients.clientId, name: clients.clientName })
    .from(clients)
    .where(and(isNull(clients.deletedAt), sql`lower(trim(both from ${clients.clientName})) = ${clientName.trim().toLowerCase()}`));
  return found ?? null;
}

/** Income creates its client if new; an expense's client tag only links to an existing client. */
export async function linkClient(tx: DbTx, typeId: number, name: string | null | undefined): Promise<{ clientId: string | null; clientNameSnapshot: string | null }> {
  const trimmed = name?.trim();
  if (!trimmed) return { clientId: null, clientNameSnapshot: null };
  if (typeId === 1) return { clientId: await resolveClientId(tx, trimmed), clientNameSnapshot: trimmed };
  const found = await findClient(tx, trimmed);
  return { clientId: found?.id ?? null, clientNameSnapshot: found?.name ?? null };
}

/** Finds the active client by normalised name, or creates it (race-safe on the unique index). */
export async function resolveClientId(tx: DbTx, clientName: string): Promise<string> {
  const normalized = clientName.trim().toLowerCase();
  const find = async () => {
    const [found] = await tx
      .select()
      .from(clients)
      .where(and(isNull(clients.deletedAt), sql`lower(trim(both from ${clients.clientName})) = ${normalized}`));
    return found?.clientId ?? null;
  };

  const existing = await find();
  if (existing) return existing;
  try {
    const [created] = await tx.insert(clients).values({ clientName: clientName.trim() }).returning();
    return created.clientId;
  } catch (err) {
    if (!isUniqueConstraintViolation(err)) throw err;
    const recheck = await find();
    if (!recheck) throw err;
    return recheck;
  }
}

/** Category id for an expense: the named category if it is one of ours, else "Other". */
export async function resolveCategoryId(tx: DbTx, name: string | null | undefined): Promise<{ id: number; name: string }> {
  const wanted = toCategory(name) ?? "Other";
  const [row] = await tx.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.name, wanted));
  if (!row) throw new Error(`Category "${wanted}" is missing; run the migrations.`);
  return row;
}

/**
 * Persists an explicitly confirmed transaction into PostgreSQL with full atomicity,
 * Banker's Rounding, client resolution, and duplicate protection.
 */
export async function confirmAndPersistTransaction(
  params: PersistConfirmationParams,
): Promise<PersistResult> {
  const { userId } = params;

  // 1. Authentication check
  if (!userId || typeof userId !== "string" || !userId.trim()) {
    return {
      ok: false,
      error: "Authentication required to confirm transaction.",
      code: "NOT_AUTHENTICATED",
      status: 401,
    };
  }

  // 2. Load authoritative server-side draft and state
  const draft = params.draft ?? getDraft(userId);
  const session = params.sessionState ?? getSession(userId);
  // Manual entries must not overwrite the manager's in-progress chat session.
  const rememberInChat = (state: ChatSessionState) => {
    if (params.source !== "manual") setSession(userId, state);
  };

  // 3. State machine verification
  if (session.status !== "READY_FOR_CONFIRMATION") {
    // If already confirmed in this session, check if we have the saved transaction
    if (session.status === "CONFIRMED" && session.confirmedTransaction) {
      return {
        ok: true,
        status: "CONFIRMED",
        transaction: session.confirmedTransaction,
        isDuplicate: true,
      };
    }

    if (session.status === "AWAITING_EXCHANGE_RATE") {
      return {
        ok: false,
        error: "Cannot confirm: USD exchange rate required first.",
        code: "INVALID_STATE",
        status: 400,
      };
    }

    return {
      ok: false,
      error: `Cannot confirm: current status is "${session.status}". Send a complete transaction message first.`,
      code: "INVALID_STATE",
      status: 400,
    };
  }

  // 4. Revalidate required fields
  const validation = validateExtraction(draft);
  if (!validation.complete) {
    return {
      ok: false,
      error: validation.question || "Transaction draft is incomplete.",
      code: "INCOMPLETE_DRAFT",
      status: 400,
    };
  }

  // Basic type assertions
  if (draft.type !== "income" && draft.type !== "expense") {
    return {
      ok: false,
      error: 'Transaction type must be "income" or "expense".',
      code: "INVALID_DATA",
      status: 400,
    };
  }

  const typeId = draft.type === "income" ? 1 : 2;

  if (typeof draft.original_amount !== "number" || !Number.isFinite(draft.original_amount) || draft.original_amount <= 0) {
    return {
      ok: false,
      error: "Original amount must be a positive number.",
      code: "INVALID_DATA",
      status: 400,
    };
  }

  if (draft.original_currency !== "INR" && draft.original_currency !== "USD") {
    return {
      ok: false,
      error: 'Original currency must be "INR" or "USD".',
      code: "INVALID_DATA",
      status: 400,
    };
  }

  if (!draft.txn_date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.txn_date)) {
    return {
      ok: false,
      error: "Transaction date must be in YYYY-MM-DD format.",
      code: "INVALID_DATA",
      status: 400,
    };
  }

  if (typeId === 1 && (!draft.client_name || !draft.client_name.trim())) {
    return {
      ok: false,
      error: "Client name is required for income transactions.",
      code: "INVALID_DATA",
      status: 400,
    };
  }

  if (typeId === 2 && (!draft.expense_description || !draft.expense_description.trim())) {
    return {
      ok: false,
      error: "Description is required for expense transactions.",
      code: "INVALID_DATA",
      status: 400,
    };
  }

  // 5. Monetary precision and exact arithmetic
  const money = computeAmounts(draft, session.currency?.exchange_rate ?? null, session.currency?.exchange_rate_date);
  if (!money.ok) return money;
  const { originalAmount, amountInr, exchangeRate, exchangeRateDate, rateSource } = money;

  // 6. Idempotency key and payload hash
  const idempotencyKey =
    params.idempotencyKey ||
    session.idempotencyKey ||
    `chat-${userId}-${draft.txn_date}-${typeId}-${draft.original_currency}-${originalAmount}-${Date.now()}`;

  const payloadHash = computeCanonicalPayloadHash({
    typeId,
    originalAmount,
    originalCurrency: draft.original_currency,
    amountInr,
    exchangeRate,
    clientName: typeId === 1 ? draft.client_name : null,
    description: typeId === 2 ? draft.expense_description : null,
    txnDate: draft.txn_date,
    createdBy: userId,
  });

  // 7. Check for existing idempotency key before attempting insert
  try {
    const [existingTxn] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.idempotencyKey, idempotencyKey));

    if (existingTxn) {
      if (existingTxn.payloadHash === payloadHash) {
        const confirmedTransaction = mapRowToConfirmationTransaction(existingTxn);
        rememberInChat({
          status: "CONFIRMED",
          currency: session.currency,
          idempotencyKey,
          confirmedTransaction,
        });
        return {
          ok: true,
          status: "CONFIRMED",
          transaction: confirmedTransaction,
          isDuplicate: true,
        };
      } else {
        return {
          ok: false,
          error: "Idempotency key collision: key already used for a different transaction.",
          code: "CONFLICT",
          status: 409,
        };
      }
    }
  } catch (dbErr) {
    console.error("[confirmAndPersistTransaction] Database error during idempotency check:", dbErr);
    return {
      ok: false,
      error: "Database error occurred while checking transaction idempotency. Please try again.",
      code: "DATABASE_ERROR",
      status: 500,
    };
  }

  // 8. Atomic insertion in PostgreSQL transaction
  try {
    const savedTxn = await db.transaction(async (tx) => {
      // Ensure user anchor exists in app_users
      await tx
        .insert(appUsers)
        .values({ id: userId, role: "manager", isActive: true })
        .onConflictDoNothing();

      // Resolve client if income
      const clientNameSnapshot = typeId === 1 ? draft.client_name!.trim() : null;
      const clientId = clientNameSnapshot ? await resolveClientId(tx, clientNameSnapshot) : null;
      const category = typeId === 2 ? await resolveCategoryId(tx, draft.category) : null;

      // Insert transaction
      const [insertedTxn] = await tx
        .insert(transactions)
        .values({
          typeId,
          clientId,
          clientNameSnapshot,
          originalAmount,
          originalCurrency: draft.original_currency as "INR" | "USD",
          amountInr,
          exchangeRate,
          exchangeRateDate,
          rateSource,
          description: typeId === 2 ? draft.expense_description!.trim() : (params.incomeNote ?? null),
          categoryId: category?.id ?? null,
          invoiceId: params.invoiceId ?? null,
          txnDate: draft.txn_date as string,
          source: params.source || "chatbot",
          status: "confirmed",
          idempotencyKey,
          payloadHash,
          createdBy: userId,
        })
        .returning();

      // Insert audit event
      const safeAfterState = JSON.parse(
        JSON.stringify(insertedTxn, (_k, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      );

      await tx.insert(auditEvents).values({
        entityType: "transaction",
        entityId: insertedTxn.id,
        action: "created",
        performedBy: userId,
        source: params.source || "chatbot",
        afterState: safeAfterState,
        metadata: {
          idempotencyKey,
          clientName: clientNameSnapshot,
        },
      });

      const rejected = await params.onSaved?.(tx, insertedTxn.id);
      if (rejected) throw new SaveRejected(rejected);

      return { ...insertedTxn, categoryName: category?.name ?? null };
    });

    const confirmedTransaction = mapRowToConfirmationTransaction(savedTxn, savedTxn.categoryName);

    // Update in-memory session only after DB commit succeeds
    rememberInChat({
      status: "CONFIRMED",
      currency: session.currency,
      idempotencyKey,
      confirmedTransaction,
    });

    return {
      ok: true,
      status: "CONFIRMED",
      transaction: confirmedTransaction,
    };
  } catch (err: unknown) {
    if (err instanceof SaveRejected) return { ok: false, error: err.message, code: "CONFLICT", status: 409 };
    // Handle concurrent duplicate insertion
    if (isUniqueConstraintViolation(err)) {
      try {
        const [recheckTxn] = await db
          .select()
          .from(transactions)
          .where(eq(transactions.idempotencyKey, idempotencyKey));

        if (recheckTxn) {
          if (recheckTxn.payloadHash === payloadHash) {
            const confirmedTransaction = mapRowToConfirmationTransaction(recheckTxn);
            rememberInChat({
              status: "CONFIRMED",
              currency: session.currency,
              idempotencyKey,
              confirmedTransaction,
            });
            return {
              ok: true,
              status: "CONFIRMED",
              transaction: confirmedTransaction,
              isDuplicate: true,
            };
          } else {
            return {
              ok: false,
              error: "Idempotency key collision: key already used for a different transaction.",
              code: "CONFLICT",
              status: 409,
            };
          }
        }
      } catch {
        // Fall through to general error
      }
    }

    console.error("[confirmAndPersistTransaction] Persistence failed:", err);

    return {
      ok: false,
      error: "Database error occurred while persisting transaction. Please try again.",
      code: "DATABASE_ERROR",
      status: 500,
    };
  }
}
