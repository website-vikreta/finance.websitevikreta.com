/**
 * Server-side persistence for bank-import staging data.
 *
 * - Adds a bank account (display metadata only; never a bank credential).
 * - Persists one parsed statement and all of its lines in one DB transaction.
 * - Never inserts, updates, restores, or deletes financial transactions.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appUsers,
  auditEvents,
  bankAccounts,
  bankStatementLines,
  bankStatements,
} from "@/lib/db/schema";
import { PARSER_VERSION, type ParsedLine, type ParsedStatement } from "./types";
import { logSafeDbConstraintError } from "./safe-log";

export type WriteResult<T> = { ok: true; value: T } | { ok: false; error: string };

interface AccountInput {
  displayName: string;
  bankName: string | null;
  last4: string | null;
}

export function parseBankAccount(raw: unknown): AccountInput | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const displayName = (value.displayName ?? value.name ?? "").toString().trim();
  if (!displayName || displayName.length > 120) return null;

  const bankName = (value.bankName ?? "").toString().trim() || null;
  if (bankName && bankName.length > 120) return null;

  const last4 = (value.last4 ?? "").toString().trim() || null;
  if (last4 && !/^\d{4}$/.test(last4)) return null;

  return { displayName, bankName, last4 };
}

/** Creates display metadata and audits the write. No bank credentials are stored. */
export async function createBankAccount(
  userId: string,
  raw: unknown,
): Promise<WriteResult<string>> {
  if (typeof userId !== "string" || !userId) {
    return { ok: false, error: "Your session ended. Sign in again." };
  }
  const account = parseBankAccount(raw);
  if (!account) {
    return {
      ok: false,
      error: "Enter a display name, at most 120 characters, and only four digits for the account.",
    };
  }

  try {
    return await db.transaction(async (tx) => {
    // Ensure the session user exists in app_users so FKs stay valid. Roles are
    // managed elsewhere; conflicts are left untouched.
    await tx
      .insert(appUsers)
      .values({ id: userId, role: "manager", isActive: true })
      .onConflictDoNothing();

    const [created] = await tx
      .insert(bankAccounts)
      .values({
        displayName: account.displayName,
        bankName: account.bankName,
        accountLast4: account.last4,
        createdBy: userId,
      })
      .returning({ id: bankAccounts.id });

    await tx.insert(auditEvents).values({
      entityType: "bank_account",
      entityId: created.id,
      action: "created",
      performedBy: userId,
      source: "bank_import",
      afterState: account,
    });

    return { ok: true, value: created.id };
  });
  } catch (error) {
    if ((error as { code?: string } | undefined)?.code === "23505") {
      return { ok: false, error: "A bank account with that name already exists." };
    }
    return { ok: false, error: "That bank account could not be created. Try again." };
  }
}

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string } | undefined)?.code;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export interface PersistStatementInput {
  accountId: string;
  userId: string;
  fileName: string;
  fileSha256: string;
  fileSizeBytes: number;
  parsed: ParsedStatement;
}

export type PersistStatementResult = { statementId: string; lineCount: number };

/**
 * Persists one statement and all of its lines in a single DB transaction.
 * The statement row goes in as `review` directly, so the active-file unique
 * index rejects a concurrent duplicate inside the transaction, and a failed
 * line insert rolls the statement back completely.
 */
/** Pure insert mapping for one staging line — exported for offline regression tests. */
export function statementLineValues(
  statementId: string,
  line: ParsedLine,
): typeof bankStatementLines.$inferInsert {
  return {
    statementId,
    pageNumber: line.pageNumber,
    rowNumber: line.rowNumber,
    txnDate: line.txnDate,
    valueDate: line.valueDate,
    narration: line.narration,
    reference: line.reference,
    businessDescription: line.businessDescription ?? null,
    withdrawalAmount: line.withdrawalAmount,
    depositAmount: line.depositAmount,
    closingBalance: line.closingBalance,
    direction: line.direction,
    classification: line.classification,
    status: line.status,
    fingerprint: line.fingerprint,
    flags: line.flags,
    errorCode: line.errorCode,
  };
}

export async function persistStatement(
  input: unknown,
): Promise<WriteResult<PersistStatementResult>> {
  const value = input as Partial<PersistStatementInput> | null;
  if (!value || typeof value.accountId !== "string" || !value.accountId) {
    return { ok: false, error: "Choose a bank account." };
  }
  if (typeof value.userId !== "string" || !value.userId) {
    return { ok: false, error: "Your session ended. Sign in again." };
  }
  if (!value.fileName || !value.fileName.trim()) {
    return { ok: false, error: "This statement has no file name." };
  }
  if (typeof value.fileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.fileSha256)) {
    return { ok: false, error: "The uploaded PDF could not be fingerprinted." };
  }
  if (typeof value.fileSizeBytes !== "number" || value.fileSizeBytes <= 0) {
    return { ok: false, error: "The uploaded file is empty." };
  }
  if (!value.parsed || typeof value.parsed !== "object" || value.parsed.pages < 1) {
    return { ok: false, error: "This statement has no pages to review." };
  }
  if (!Array.isArray(value.parsed.lines) || value.parsed.lines.length === 0) {
    return { ok: false, error: "This statement has no rows to review." };
  }

  const accountId = value.accountId;
  const userId = value.userId;
  const fileName = value.fileName.trim();
  const fileSha256 = value.fileSha256;
  const fileSizeBytes = value.fileSizeBytes;
  const parsed = value.parsed;

  try {
    return await db.transaction(async (tx) => {
      // Fast duplicate pre-check. The active unique index races this for safety.
      const [existing] = await tx
        .select({ id: bankStatements.id })
        .from(bankStatements)
        .where(
          and(
            eq(bankStatements.fileSha256, fileSha256),
            sql`${bankStatements.status} NOT IN ('failed', 'cancelled')`,
          ),
        )
        .limit(1);
      if (existing) {
        return { ok: false as const, error: "A live statement with this PDF already exists." };
      }

      const [account] = await tx
        .select({ currency: bankAccounts.currency })
        .from(bankAccounts)
        .where(and(eq(bankAccounts.id, accountId), isNull(bankAccounts.deletedAt)))
        .limit(1);
      if (!account) {
        return { ok: false as const, error: "This bank account is no longer available." };
      }
      if (account.currency !== "INR") {
        return { ok: false as const, error: "V1 accepts INR statements only." };
      }

      const [created] = await tx
        .insert(bankStatements)
        .values({
          accountId,
          fileName,
          fileSha256,
          fileSizeBytes,
          pageCount: parsed.pages,
          statementFrom: parsed.statementFrom,
          statementTo: parsed.statementTo,
          openingBalance: parsed.openingBalance,
          closingBalance: parsed.closingBalance,
          status: "review",
          parserVersion: PARSER_VERSION,
          createdBy: userId,
        })
        .returning({ id: bankStatements.id });

      for (const group of chunk(parsed.lines, 250)) {
        await tx
          .insert(bankStatementLines)
          .values(group.map((line) => statementLineValues(created.id, line)));
      }

      await tx.insert(auditEvents).values({
        entityType: "bank_statement",
        entityId: created.id,
        action: "created",
        performedBy: userId,
        source: "bank_import",
        afterState: {
          accountId,
          fileName,
          fileSha256,
          pageCount: parsed.pages,
          lineCount: parsed.lines.length,
        },
      });

      return {
        ok: true as const,
        value: { statementId: created.id, lineCount: parsed.lines.length },
      };
    });
  } catch (error) {
    logSafeDbConstraintError(error);
    if (pgCode(error) === "23505") {
      // Lost the concurrent unique race; the winning upload owns the statement.
      return { ok: false, error: "A live statement with this PDF already exists." };
    }
    if (pgCode(error) === "23503") {
      return { ok: false, error: "Choose a bank account that is still active." };
    }
    if (pgCode(error) === "23514") {
      return { ok: false, error: "The parser produced a value the database rejects." };
    }
    return { ok: false, error: "The statement could not be saved. Try again." };
  }
}
