/**
 * Phase 4 — bank-import financial persistence.
 *
 * - Own persistence path. It never calls the Finance AI confirmation service
 *   (lib/transactions/persist.ts reads chat-session state, auto-resolves
 *   clients, and falls back to the "Other" category) and it never reads or
 *   writes finance-AI chat-session rows.
 * - One line = one DB transaction. Transaction insert, transaction audit,
 *   invoice guard, and the line update commit or roll back atomically. A batch
 *   runs lines sequentially, so independently committed successes survive a
 *   later per-line failure.
 * - Eligibility follows the review state machine: only `ready` lines import,
 *   and an `imported` line imports again only when its transaction was
 *   soft-deleted (an explicit, audited replacement attempt).
 * - Idempotency keys are `bank-line:<line-id>:a<attempt>` with attempt =
 *   import_attempt + 1, refined inside the same DB transaction. A failed
 *   attempt rolls back, so the same key retries safely; an attempt consumed by
 *   a committed — even soft-deleted — transaction is never reused.
 * - Import audits never contain narration, amounts, references, or bank
 *   details. The transaction audit mirrors the existing `created` convention,
 *   because transactions legitimately carry their (reviewer-curated)
 *   description.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditEvents,
  bankStatementLines,
  transactions,
} from "@/lib/db/schema";
import { parseExactDecimalToBigInt } from "@/lib/currency/precision";
import { computeCanonicalPayloadHash } from "@/lib/transactions/persist";
import { normalizeNarration } from "./normalize";
import { validateLineForImport, validateImportDirection } from "./validate";
import { effectiveLineFlags } from "./review";
import type {
  Classification,
  LineFlag,
  LineStatus,
  StatementStatus,
} from "./types";
import { logSafeDbError } from "./safe-log";

// ─── Result shapes ───────────────────────────────────────────────────────────

export interface ImportLineSuccess {
  lineId: string;
  rowNumber: number;
  ok: true;
  transactionId: string;
  attempt: number;
  /** True when this replaced an import whose transaction was soft-deleted. */
  replacement: boolean;
}

export interface ImportLineFailure {
  lineId: string;
  rowNumber: number;
  ok: false;
  error: string;
}

export type ImportLineResult = ImportLineSuccess | ImportLineFailure;

export interface ImportBatchResult {
  ok: boolean;
  /** Batch-level error (unknown statement, wrong state, no lines). */
  error: string | null;
  requested: number;
  imported: number;
  failed: number;
  statementStatus: StatementStatus | null;
  results: ImportLineResult[];
}

export interface ImportInvoiceOption {
  id: string;
  /** Assigned invoice number (WV/2026-27/001). */
  number: string;
  /** Invoice total in its (INR) currency, canonical decimal string. */
  total: string;
  /** total − paid, canonical decimal string, always > 0. */
  outstanding: string;
}

// ─── Constants and small helpers ─────────────────────────────────────────────

/** Upper bound for one Import Selected action; keeps each action well under timeouts. */
export const MAX_IMPORT_BATCH = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND = "This statement line could not be found.";
const STATEMENT_NOT_IMPORTABLE = "This statement is no longer importable.";
const ALREADY_IMPORTED = "This line has already been imported.";
const CLIENT_UNAVAILABLE = "The selected client is no longer available. Choose another one.";
const CATEGORY_UNAVAILABLE = "The selected category is no longer available. Choose another one.";
const CURRENCY_UNSUPPORTED = "V1 supports INR account statements only.";

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Deterministic idempotency key for one import attempt of one line. */
export function computeImportKey(lineId: string, attempt: number): string {
  return `bank-line:${lineId}:a${attempt}`;
}

interface PaymentAmountCheckInput {
  /** Invoice total in major units ("1000.00"). */
  total: string;
  /** Sum of live payments so far, same currency ("250.00"). */
  paid: string;
  /** The candidate payment, same currency ("750.00"). */
  payment: string;
}

export type PaymentAmountCheck =
  | { ok: true; outstanding: string }
  | { ok: false; error: string };

/** Formats a scaled BigInt minor-unit value as a canonical decimal string. */
export function formatMinorUnits(value: bigint): string {
  const scaled = value % BigInt(100);
  const whole = value / BigInt(100);
  return `${whole}.${(scaled < BigInt(0) ? -scaled : scaled).toString().padStart(2, "0")}`;
}

/**
 * Exact BigInt check that a payment fits the invoice balance.
 * Overpayment is rejected; an exact payoff is allowed.
 */
export function evaluateInvoicePayment(input: PaymentAmountCheckInput): PaymentAmountCheck {
  const total = parseExactDecimalToBigInt(input.total, 2);
  const paid = parseExactDecimalToBigInt(input.paid, 2);
  const payment = parseExactDecimalToBigInt(input.payment, 2);

  const remaining = total - paid;
  if (payment > remaining) {
    return {
      ok: false,
      error: "The import amount exceeds the invoice's outstanding balance.",
    };
  }
  return { ok: true, outstanding: formatMinorUnits(remaining - payment) };
}

/**
 * The audit-safe state of a line during import: status, classification,
 * mapping presence, and attempt counters only — never narration, amounts,
 * references, or bank details.
 */
function auditLineState(line: {
  status: LineStatus;
  classification: string;
  clientId: string | null;
  categoryId: number | null;
  invoiceId: string | null;
  transactionId: string | null;
  flags: LineFlag[];
  skipReason: string | null;
  reviewedBy: string | null;
  importAttempt: number;
}) {
  return {
    status: line.status,
    classification: line.classification,
    hasClient: line.clientId != null,
    hasCategory: line.categoryId != null,
    hasInvoice: line.invoiceId != null,
    hasLinkedTransaction: line.transactionId != null,
    flagCount: line.flags.length,
    hasSkipReason: line.skipReason != null,
    reviewedBy: line.reviewedBy,
    importAttempt: line.importAttempt,
  };
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface ImportLineRow {
  id: string;
  statementId: string;
  statementStatus: string;
  rowNumber: number;
  status: LineStatus;
  classification: Classification;
  txnDate: string | null;
  valueDate: string | null;
  narration: string | null;
  businessDescription: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  direction: "deposit" | "withdrawal" | null;
  flags: LineFlag[];
  clientId: string | null;
  categoryId: number | null;
  invoiceId: string | null;
  transactionId: string | null;
  importAttempt: number;
  skipReason: string | null;
  reviewedBy: string | null;
  accountCurrency: string;
}

const FLAG_PATTERN =
  /^(INVALID_DATE|AMBIGUOUS_DATE|TWO_DIGIT_YEAR|MISSING_DATE|INVALID_VALUE_DATE|MISSING_NARRATION|INVALID_AMOUNT|ZERO_AMOUNT|NEGATIVE_AMOUNT|MISSING_AMOUNT|BOTH_AMOUNTS|UNKNOWN_DIRECTION|DIRECTION_CONFLICT|INVALID_BALANCE|COLUMN_COUNT_MISMATCH|UNRECOGNIZED_ROW|TRANSFER|REFUND|REVERSAL|AMBIGUOUS_ENTRY|CASH_MOVEMENT|BANK_CHARGE)$/;

function mapFlag(value: unknown): LineFlag | null {
  return typeof value === "string" && FLAG_PATTERN.test(value) ? (value as LineFlag) : null;
}

function mapLineStatus(value: string): LineStatus | null {
  return (["pending", "ready", "imported", "skipped", "duplicate", "error"] as const).includes(
    value as LineStatus,
  )
    ? (value as LineStatus)
    : null;
}

/**
 * Loads one line with its statement and account currency and locks the line
 * and the statement rows. The WHERE clause proves statement/line ownership;
 * the lock serializes concurrent imports and review mutations on that line.
 */
async function loadImportLine(
  tx: DbTx,
  statementId: string,
  lineId: string,
): Promise<ImportLineRow | null> {
  const result = await tx.execute(sql`
    SELECT
      l.id,
      l.statement_id AS "statementId",
      s.status AS "statementStatus",
      l.row_number AS "rowNumber",
      l.status,
      l.classification,
      to_char(l.txn_date, 'YYYY-MM-DD') AS "txnDate",
      to_char(l.value_date, 'YYYY-MM-DD') AS "valueDate",
      l.narration,
      l.business_description AS "businessDescription",
      l.withdrawal_amount::text AS "withdrawalAmount",
      l.deposit_amount::text AS "depositAmount",
      l.direction,
      l.flags,
      l.client_id AS "clientId",
      l.category_id AS "categoryId",
      l.invoice_id AS "invoiceId",
      l.transaction_id AS "transactionId",
      l.import_attempt::int AS "importAttempt",
      l.skip_reason AS "skipReason",
      l.reviewed_by AS "reviewedBy",
      a.currency AS "accountCurrency"
    FROM bank_statement_lines l
    JOIN bank_statements s ON s.id = l.statement_id
    JOIN bank_accounts a ON a.id = s.account_id
    WHERE l.id = ${lineId}::uuid
      AND l.statement_id = ${statementId}::uuid
    FOR UPDATE OF l, s
  `);
  const raw = result.rows[0] as unknown as
    | (Omit<
        ImportLineRow,
        "status" | "flags" | "direction" | "classification" | "rowNumber" | "importAttempt"
      > & {
        status: string;
        classification: string;
        direction: string | null;
        flags: unknown;
        rowNumber: number | string;
        importAttempt: number | string;
      })
    | undefined;
  if (!raw) return null;
  const status = mapLineStatus(raw.status);
  if (!status) return null;
  return {
    ...raw,
    rowNumber: Number(raw.rowNumber),
    importAttempt: Number(raw.importAttempt),
    status,
    classification: raw.classification as Classification,
    direction: raw.direction === "deposit" || raw.direction === "withdrawal" ? raw.direction : null,
    flags: Array.isArray(raw.flags)
      ? (raw.flags.map(mapFlag).filter(Boolean) as LineFlag[])
      : [],
  };
}

// ─── Invoice guard ───────────────────────────────────────────────────────────

interface InvoiceGuardRow {
  number: string | null;
  clientId: string;
  currency: string;
  status: string;
  total: string;
  deletedAt: Date | null;
}

/**
 * Validates and locks the explicitly linked invoice inside the import
 * transaction. Mirrors lib/invoices/invoices.ts `recordPayment` rules (only
 * `sent`, same client, same currency, no overpayment) — plus a row lock, so
 * concurrent imports serialize instead of racing the balance check.
 */
async function lockAndValidateInvoice(
  tx: DbTx,
  invoiceId: string,
  clientId: string | null,
  amount: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const invoiceRows = await tx.execute(sql`
    SELECT number, client_id AS "clientId", currency, status,
           total::text AS total, deleted_at AS "deletedAt"
    FROM invoices
    WHERE id = ${invoiceId}::uuid
    FOR UPDATE
  `);
  const invoice = invoiceRows.rows[0] as unknown as InvoiceGuardRow | undefined;

  if (!invoice) {
    return { ok: false, error: "The linked invoice no longer exists." };
  }
  if (invoice.deletedAt != null) {
    return { ok: false, error: "The linked invoice was deleted." };
  }
  if (invoice.status !== "sent") {
    return {
      ok: false,
      error:
        invoice.status === "void"
          ? "This invoice is void."
          : "Issue the invoice before importing a payment.",
    };
  }
  if (invoice.currency !== "INR") {
    return {
      ok: false,
      error: "Only INR invoices can be paid from an INR statement import.",
    };
  }
  if (invoice.clientId !== clientId) {
    return { ok: false, error: "This invoice belongs to a different client." };
  }

  // Paid balance mirrors invoices.ts: same-currency income only, live rows.
  const paidRows = await tx.execute(sql`
    SELECT coalesce(sum(original_amount), 0)::text AS paid
    FROM transactions
    WHERE invoice_id = ${invoiceId}::uuid
      AND deleted_at IS NULL
      AND type_id = 1
      AND original_currency = ${invoice.currency}
  `);
  const paid = (paidRows.rows[0] as unknown as { paid: string } | undefined)?.paid ?? "0.00";

  const check = evaluateInvoicePayment({
    total: invoice.total,
    paid,
    payment: amount,
  });
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true };
}

// ─── Per-line import ─────────────────────────────────────────────────────────

/** Reads whether a linked transaction is live (not soft-deleted). */
async function linkedTransactionIsLive(
  tx: DbTx,
  transactionId: string | null,
): Promise<boolean> {
  if (!transactionId) return false;
  const rows = await tx.execute(sql`
    SELECT id FROM transactions
    WHERE id = ${transactionId}::uuid AND deleted_at IS NULL
    LIMIT 1
  `);
  return rows.rows.length > 0;
}

async function importOneLine(
  userId: string,
  statementId: string,
  lineId: string,
): Promise<ImportLineResult> {
  try {
    return await db.transaction(async (tx): Promise<ImportLineResult> => {
      const line = await loadImportLine(tx, statementId, lineId);
      if (!line) {
        return { lineId, rowNumber: 0, ok: false, error: NOT_FOUND };
      }

      if (line.statementStatus !== "review" && line.statementStatus !== "importing") {
        return {
          lineId: line.id,
          rowNumber: line.rowNumber,
          ok: false,
          error: STATEMENT_NOT_IMPORTABLE,
        };
      }

      if (line.accountCurrency !== "INR") {
        return {
          lineId: line.id,
          rowNumber: line.rowNumber,
          ok: false,
          error: CURRENCY_UNSUPPORTED,
        };
      }

      // Only `ready` lines import; an already-imported line imports again only
      // when its transaction was soft-deleted (replacement attempt).
      let replacement = false;
      if (line.status === "imported") {
        const liveImport = await linkedTransactionIsLive(tx, line.transactionId);
        if (liveImport) {
          return {
            lineId: line.id,
            rowNumber: line.rowNumber,
            ok: false,
            error: ALREADY_IMPORTED,
          };
        }
        replacement = true;
      } else if (line.status !== "ready") {
        const pendingReasons: Record<Exclude<LineStatus, "ready" | "imported">, string> = {
          pending: "Classify this line and mark it ready before importing.",
          skipped: "This line was skipped during review. Reopen it and mark it ready to import.",
          duplicate: "This line is marked as a duplicate. Reopen it and mark it ready to import.",
          error: "This row could not be parsed; upload a corrected statement to replace it.",
        };
        return {
          lineId: line.id,
          rowNumber: line.rowNumber,
          ok: false,
          error: pendingReasons[line.status as Exclude<LineStatus, "ready" | "imported">],
        };
      }

      // Classification must agree with the money direction.
      const directionError = validateImportDirection(line.direction, line.classification);
      if (directionError) {
        return { lineId: line.id, rowNumber: line.rowNumber, ok: false, error: directionError };
      }

      // Full server-side revalidation right before the insert.
      const validation = validateLineForImport({
        txnDate: line.txnDate,
        valueDate: line.valueDate,
        narration: line.narration,
        withdrawalAmount: line.withdrawalAmount,
        depositAmount: line.depositAmount,
        direction: line.direction,
        classification: line.classification as "income" | "expense",
        flags: effectiveLineFlags({ narration: line.narration, flags: line.flags }),
        clientId: line.clientId,
        categoryId: line.categoryId,
      });
      if (!validation.ok) {
        return { lineId: line.id, rowNumber: line.rowNumber, ok: false, error: validation.reason };
      }

      const amount =
        line.direction === "withdrawal" ? line.withdrawalAmount : line.depositAmount;
      if (amount == null) {
        return {
          lineId: line.id,
          rowNumber: line.rowNumber,
          ok: false,
          error: "Exactly one withdrawal or deposit amount is required.",
        };
      }

      const typeId = line.direction === "withdrawal" ? 2 : 1;
      const isIncome = typeId === 1;

      // Income: the client must exist and stay alive until this row commits.
      // Locking the client row closes the soft-delete race and yields the
      // client-name snapshot in one read.
      let clientName: string | null = null;
      if (isIncome && line.clientId) {
        const clientRows = await tx.execute(sql`
          SELECT client_name FROM clients
          WHERE client_id = ${line.clientId}::uuid AND deleted_at IS NULL
          FOR UPDATE
        `);
        const client = clientRows.rows[0] as { client_name: string } | undefined;
        if (!client) {
          return {
            lineId: line.id,
            rowNumber: line.rowNumber,
            ok: false,
            error: CLIENT_UNAVAILABLE,
          };
        }
        clientName = client.client_name;
      }
      // Expense: the mapped category must exist (categories are never deleted);
      // a missing mapping is already rejected by validateLineForImport above.
      if (!isIncome && line.categoryId != null) {
        const exists = (
          await tx.execute(sql`SELECT 1 FROM categories WHERE id = ${line.categoryId} LIMIT 1`)
        ).rows.length;
        if (!exists) {
          return {
            lineId: line.id,
            rowNumber: line.rowNumber,
            ok: false,
            error: CATEGORY_UNAVAILABLE,
          };
        }
      }

      // Optional explicit invoice link (income only; never inferred).
      if (line.invoiceId) {
        if (!isIncome) {
          return {
            lineId: line.id,
            rowNumber: line.rowNumber,
            ok: false,
            error: "Only income lines link to an invoice.",
          };
        }
        const invoice = await lockAndValidateInvoice(tx, line.invoiceId, line.clientId, amount);
        if (!invoice.ok) {
          return { lineId: line.id, rowNumber: line.rowNumber, ok: false, error: invoice.error };
        }
      }

      // Idempotency attempt: pick the first attempt whose key has no committed
      // transaction. Soft-deleted owners push the attempt forward; a live owner
      // under the held line lock means committed state the line row does not
      // reflect — refuse rather than double-import.
      let attempt = line.importAttempt;
      let chosenKey: string | null = null;
      for (let guard = 0; guard < 8; guard += 1) {
        const candidate = attempt + 1;
        const key = computeImportKey(lineId, candidate);
        const existing = await tx
          .select({ id: transactions.id, deletedAt: transactions.deletedAt })
          .from(transactions)
          .where(eq(transactions.idempotencyKey, key))
          .limit(1);
        const holder = existing[0];
        if (!holder) {
          chosenKey = key;
          attempt = candidate;
          break;
        }
        if (holder.deletedAt != null) {
          attempt = candidate; // consumed by a soft-deleted row; move forward
          continue;
        }
        return {
          lineId: line.id,
          rowNumber: line.rowNumber,
          ok: false,
          error: "A transaction for this import attempt already exists.",
        };
      }
      if (!chosenKey) {
        return {
          lineId: line.id,
          rowNumber: line.rowNumber,
          ok: false,
          error: "The import could not allocate a fresh idempotency key. Try again.",
        };
      }

      const description = line.businessDescription ?? normalizeNarration(line.narration) ?? null;
      const payloadHash = computeCanonicalPayloadHash({
        typeId,
        originalAmount: amount,
        originalCurrency: "INR",
        amountInr: amount,
        exchangeRate: null,
        clientName: isIncome ? clientName : null,
        description,
        txnDate: line.txnDate ?? "",
        createdBy: userId,
      });

      const [inserted] = await tx
        .insert(transactions)
        .values({
          typeId,
          clientId: isIncome ? line.clientId : null,
          clientNameSnapshot: isIncome ? clientName : null,
          originalAmount: amount,
          originalCurrency: "INR",
          amountInr: amount,
          // INR rule: exchange-rate metadata stays NULL and amountInr is the original amount.
          description,
          categoryId: isIncome ? null : line.categoryId,
          invoiceId: isIncome ? line.invoiceId : null,
          // validateLineForImport passed: txnDate is a valid ISO date.
          txnDate: line.txnDate as string,
          source: "bank_import",
          status: "confirmed",
          idempotencyKey: chosenKey,
          payloadHash,
          createdBy: userId,
        })
        .returning({ id: transactions.id });

      await tx.insert(auditEvents).values({
        entityType: "transaction",
        entityId: inserted.id,
        action: "created",
        performedBy: userId,
        source: "bank_import",
        afterState: {
          id: inserted.id,
          typeId,
          clientId: isIncome ? line.clientId : null,
          clientNameSnapshot: isIncome ? clientName : null,
          originalAmount: amount,
          originalCurrency: "INR",
          amountInr: amount,
          description,
          categoryId: isIncome ? null : line.categoryId,
          invoiceId: isIncome ? line.invoiceId : null,
          txnDate: line.txnDate,
          source: "bank_import",
          status: "confirmed",
          idempotencyKey: chosenKey,
          payloadHash,
          createdBy: userId,
        },
        metadata: {
          idempotencyKey: chosenKey,
          clientName: isIncome ? clientName : null,
        },
      });

      const afterLine = {
        ...line,
        status: "imported" as LineStatus,
        importAttempt: attempt,
      };
      await tx
        .update(bankStatementLines)
        .set({
          status: "imported",
          transactionId: inserted.id,
          importedPayloadHash: payloadHash,
          importedCategoryId: isIncome ? null : line.categoryId,
          importAttempt: attempt,
          importedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bankStatementLines.id, line.id));

      await tx.insert(auditEvents).values({
        entityType: "bank_statement_line",
        entityId: line.id,
        action: replacement ? "import_replaced" : "imported",
        performedBy: userId,
        source: "bank_import",
        beforeState: auditLineState(line),
        afterState: auditLineState(afterLine),
        metadata: {
          transactionId: inserted.id,
          attempt,
          replacement,
          hasInvoice: line.invoiceId != null,
          statementId,
        },
      });

      return {
        lineId: line.id,
        rowNumber: line.rowNumber,
        ok: true,
        transactionId: inserted.id,
        attempt,
        replacement,
      };
    });
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "23505") {
      return {
        lineId,
        rowNumber: 0,
        ok: false,
        error: "A transaction for this import attempt already exists. Try again.",
      };
    }
    if (code === "23503") {
      return {
        lineId,
        rowNumber: 0,
        ok: false,
        error: "A referenced record is no longer available. Refresh and try again.",
      };
    }
    if (code === "23514") {
      return {
        lineId,
        rowNumber: 0,
        ok: false,
        error: "The database rejected the import payload.",
      };
    }
    logSafeDbError("import", error);
    return {
      lineId,
      rowNumber: 0,
      ok: false,
      error: "The import failed. Retrying this row is safe.",
    };
  }
}

// ─── Batch runner ────────────────────────────────────────────────────────────

/**
 * Imports the selected lines. Batch-level state changes (review → importing,
 * then importing → completed / back to review) are separate small transactions
 * so a crash between them is recoverable: an `importing` statement accepts
 * further imports and is finalized again by the next batch.
 */
export async function importStatementLines(
  userId: string,
  rawStatementId: unknown,
  rawLineIds: unknown,
): Promise<ImportBatchResult> {
  const empty = (error: string, requested = 0): ImportBatchResult => ({
    ok: false,
    error,
    requested,
    imported: 0,
    failed: 0,
    statementStatus: null,
    results: [],
  });

  if (!isUuid(rawStatementId)) return empty("This statement could not be resolved.");
  if (!Array.isArray(rawLineIds) || rawLineIds.length === 0) {
    return empty("Select at least one line to import.");
  }
  if (rawLineIds.length > MAX_IMPORT_BATCH) {
    return empty(`Import at most ${MAX_IMPORT_BATCH} rows per batch.`);
  }
  const statementId = rawStatementId;
  const lineIds = [...new Set(rawLineIds)];
  if (lineIds.some((id) => !isUuid(id))) {
    return empty("Some selected rows could not be resolved. Refresh and try again.");
  }

  // Batch gate: the statement exists, the account is live, INR, and the
  // statement is in an importable state. Marking `importing` over an already
  // `importing` row is a no-op (crash recovery resumes cleanly).
  const gate = await db.execute(sql`
    UPDATE bank_statements s
    SET status = 'importing', updated_at = now()
    FROM bank_accounts a
    WHERE s.id = ${statementId}::uuid
      AND s.account_id = a.id
      AND a.deleted_at IS NULL
      AND a.currency = 'INR'
      AND s.status IN ('review', 'importing')
    RETURNING s.status
  `);
  if (gate.rows.length === 0) {
    const heads = await db.execute(sql`
      SELECT s.status FROM bank_statements s WHERE s.id = ${statementId}::uuid
    `);
    const head = heads.rows[0] as unknown as { status: string } | undefined;
    return {
      ok: false,
      error: head ? "This statement is no longer importable." : "This statement could not be found.",
      requested: lineIds.length,
      imported: 0,
      failed: 0,
      statementStatus: (head?.status as StatementStatus) ?? null,
      results: [],
    };
  }

  const results: ImportLineResult[] = [];
  for (const lineId of lineIds) {
    results.push(await importOneLine(userId, statementId, lineId));
  }

  const imported = results.filter((result) => result.ok).length;
  const statementStatus = await finalizeStatement(statementId);

  return {
    ok: true,
    error: null,
    requested: lineIds.length,
    imported,
    failed: results.length - imported,
    statementStatus,
    results,
  };
}

/**
 * Finalizes a batch: a statement is `completed` only when no lines remain
 * pending, ready, or error — any unresolved row keeps it in `review` so the
 * statement status always matches its line states.
 */
export async function finalizeStatement(statementId: string): Promise<StatementStatus> {
  const counts = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'pending')::int AS "pendingCount",
      count(*) FILTER (WHERE status = 'ready')::int AS "readyCount",
      count(*) FILTER (WHERE status = 'error')::int AS "errorCount"
    FROM bank_statement_lines
    WHERE statement_id = ${statementId}::uuid
  `)).rows[0] as unknown as
    | { pendingCount: number; readyCount: number; errorCount: number }
    | undefined;

  const complete =
    !!counts &&
    Number(counts.pendingCount) === 0 &&
    Number(counts.readyCount) === 0 &&
    Number(counts.errorCount) === 0;

  const target: string = complete ? "completed" : "review";
  const updated = await db.execute(sql`
    UPDATE bank_statements
    SET status = ${target},
        completed_at = CASE WHEN ${complete} THEN coalesce(completed_at, now()) ELSE completed_at END,
        updated_at = now()
    WHERE id = ${statementId}::uuid AND status = 'importing'
    RETURNING status
  `);

  const status = (updated.rows[0] as unknown as { status?: string } | undefined)?.status;
  return (status as StatementStatus) ?? "importing";
}

// ─── Audited restoration ─────────────────────────────────────────────────────

/**
 * Returns an imported line (whose transaction was soft-deleted) to `pending`
 * so the reviewer can remap and re-import through the ordinary review flow.
 * The link to the soft-deleted transaction is cleared to satisfy the line
 * check constraint; the consumed idempotency key is left behind and the next
 * import attempt automatically moves forward. Audited without narration or
 * amounts.
 */
export async function restoreImportedLine(
  userId: string,
  statementId: string,
  lineId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUuid(statementId) || !isUuid(lineId)) {
    return { ok: false, error: "This statement line could not be resolved." };
  }

  try {
    return await db.transaction(async (tx) => {
      const line = await loadImportLine(tx, statementId, lineId);
      if (!line) return { ok: false, error: NOT_FOUND };

      if (line.statementStatus !== "review" && line.statementStatus !== "importing") {
        return { ok: false, error: STATEMENT_NOT_IMPORTABLE };
      }
      if (line.status !== "imported") {
        return { ok: false, error: "Only imported lines can be restored." };
      }
      if (await linkedTransactionIsLive(tx, line.transactionId)) {
        return { ok: false, error: ALREADY_IMPORTED };
      }

      await tx
        .update(bankStatementLines)
        .set({
          status: "pending",
          transactionId: null,
          importedPayloadHash: null,
          importedCategoryId: null,
          importedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(bankStatementLines.id, line.id));

      await tx.insert(auditEvents).values({
        entityType: "bank_statement_line",
        entityId: line.id,
        action: "import_restored",
        performedBy: userId,
        source: "bank_import",
        beforeState: auditLineState(line),
        afterState: auditLineState({ ...line, status: "pending" as LineStatus }),
        metadata: {
          transactionId: line.transactionId,
          attempt: line.importAttempt,
          statementId,
        },
      });

      return { ok: true };
    });
  } catch (error) {
    logSafeDbError("restore", error);
    return { ok: false, error: "Restoring the line failed. Try again." };
  }
}

// ─── Read-side helpers ───────────────────────────────────────────────────────

/**
 * Open INR invoices of one client for the review picker. Outstanding balances
 * follow invoices.ts: same-currency live income only; only invoices with a
 * positive outstanding balance are offered.
 */
export async function listIncomeInvoiceOptions(
  rawClientId: unknown,
): Promise<ImportInvoiceOption[]> {
  if (!isUuid(rawClientId)) return [];
  const clientId = rawClientId as string;

  const rows = (await db.execute(sql`
    SELECT i.id, i.number, i.total::text AS total, coalesce((
      SELECT sum(t.original_amount)
      FROM transactions t
      WHERE t.invoice_id = i.id
        AND t.deleted_at IS NULL
        AND t.type_id = 1
        AND t.original_currency = i.currency
    ), 0)::text AS paid
    FROM invoices i
    JOIN clients c ON c.client_id = i.client_id AND c.deleted_at IS NULL
    WHERE i.client_id = ${clientId}::uuid
      AND i.status = 'sent'
      AND i.currency = 'INR'
      AND i.deleted_at IS NULL
    ORDER BY i.due_date, i.created_at
  `)) as unknown as { rows: Array<{ id: string; number: string | null; total: string; paid: string }> };

  const options: ImportInvoiceOption[] = [];
  for (const row of rows.rows) {
    const remaining =
      parseExactDecimalToBigInt(row.total, 2) - parseExactDecimalToBigInt(row.paid, 2);
    if (remaining <= BigInt(0)) continue; // fully paid invoice
    options.push({
      id: row.id,
      number: row.number ?? "Unnumbered",
      total: row.total,
      outstanding: formatMinorUnits(remaining),
    });
  }
  return options;
}
