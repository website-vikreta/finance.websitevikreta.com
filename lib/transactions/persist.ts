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
import { appUsers, clients, transactions, auditEvents } from "@/lib/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { getDraft, getSession, setSession, type ChatSessionState } from "@/lib/chatbot/store";
import { validateExtraction } from "@/lib/chatbot/validate";
import {
  parseExactDecimalToBigInt,
  convertUsdToInrPaise,
  inrToPaise,
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
  const amountStr = draft.original_amount.toString();
  let originalAmount: string;
  let amountInr: string;
  let exchangeRate: string | null = null;
  let exchangeRateDate: string | null = null;
  let rateSource: string | null = null;

  try {
    if (draft.original_currency === "INR") {
      originalAmount = toMajorDecimal(amountStr);
      amountInr = originalAmount;
      exchangeRate = null;
      exchangeRateDate = null;
      rateSource = null;
    } else {
      // USD path
      const rateNum = session.currency?.exchange_rate;
      if (typeof rateNum !== "number" || !Number.isFinite(rateNum) || rateNum <= 0) {
        return {
          ok: false,
          error: "A valid positive exchange rate is required for USD transactions.",
          code: "INVALID_DATA",
          status: 400,
        };
      }

      const rateStr = rateNum.toString();
      originalAmount = toMajorDecimal(amountStr);
      amountInr = convertUsdToInrDecimal(amountStr, rateStr);
      exchangeRate = rateNum.toFixed(4);
      exchangeRateDate = session.currency?.exchange_rate_date || draft.txn_date;
      rateSource = "manual";
    }
  } catch (err) {
    if (err instanceof DecimalPrecisionError) {
      return {
        ok: false,
        error: err.message,
        code: "PRECISION_ERROR",
        status: 400,
      };
    }
    return {
      ok: false,
      error: "Invalid monetary or exchange rate precision.",
      code: "INVALID_DATA",
      status: 400,
    };
  }

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
        setSession(userId, {
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
      let clientId: string | null = null;
      let clientNameSnapshot: string | null = null;

      if (typeId === 1) {
        const clientName = draft.client_name!.trim();
        clientNameSnapshot = clientName;
        const normalized = clientName.toLowerCase();

        const [foundClient] = await tx
          .select()
          .from(clients)
          .where(
            and(
              isNull(clients.deletedAt),
              sql`lower(trim(both from ${clients.clientName})) = ${normalized}`,
            ),
          );

        if (foundClient) {
          clientId = foundClient.clientId;
        } else {
          try {
            const [newClient] = await tx
              .insert(clients)
              .values({ clientName })
              .returning();
            clientId = newClient.clientId;
          } catch (insertErr) {
            // Concurrent creation check
            if (isUniqueConstraintViolation(insertErr)) {
              const [recheckClient] = await tx
                .select()
                .from(clients)
                .where(
                  and(
                    isNull(clients.deletedAt),
                    sql`lower(trim(both from ${clients.clientName})) = ${normalized}`,
                  ),
                );
              if (recheckClient) {
                clientId = recheckClient.clientId;
              } else {
                throw insertErr;
              }
            } else {
              throw insertErr;
            }
          }
        }
      }

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
          description: typeId === 2 ? draft.expense_description!.trim() : null,
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

      return insertedTxn;
    });

    const confirmedTransaction = mapRowToConfirmationTransaction(savedTxn);

    // Update in-memory session only after DB commit succeeds
    setSession(userId, {
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
            setSession(userId, {
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
