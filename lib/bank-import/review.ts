/**
 * Phase 3 staging-review mutations.
 *
 * - Reviewers classify lines and pick existing clients/categories; editing a
 *   line never creates, updates, or deletes a financial transaction.
 * - Every mutation re-validates on the server: the statement must still be
 *   under review, the line must belong to that statement, and referenced
 *   client/category IDs must exist in the database.
 * - Both the statement and the line are locked (`FOR UPDATE`) so concurrent
 *   review actions serialize instead of racing.
 * - Audit entries never include narration, amounts, or other statement text —
 *   only status, classification, mapping presence, and flag counts.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditEvents,
  bankStatementLines,
  bankStatements,
  categories,
  clients,
} from "@/lib/db/schema";
import {
  collapseWhitespace,
  fingerprintLine,
  normalizeNarration,
} from "./normalize";
import { validateLineForImport, validateImportDirection } from "./validate";
import {
  CLASSIFICATIONS,
  type Classification,
  type LineFlag,
  type LineStatus,
} from "./types";
import {
  formatSafeDbConstraintError,
  logSafeDbConstraintError,
  logSafeDbError,
} from "./safe-log";

export type ReviewResult = { ok: true } | { ok: false; error: string };

export function reviewSaveFailureMessage(error: unknown): string {
  const safeError = formatSafeDbConstraintError(error);
  if (safeError.code === "23514" && safeError.constraint === "chk_bank_statement_lines_amounts") {
    return "An admin needs to update bank import before this flagged amount can be saved. Try again after the update.";
  }
  return "Saving the review failed. Try again.";
}

export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_REASON_LENGTH = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lines a reviewer can still work on in Phase 3. */
const EDITABLE_STATUSES: ReadonlySet<LineStatus> = new Set<LineStatus>(["pending", "ready"]);
const REOPENABLE_STATUSES: ReadonlySet<LineStatus> = new Set<LineStatus>([
  "ready",
  "skipped",
  "duplicate",
]);

export interface ReviewLine {
  id: string;
  statementId: string;
  accountId: string;
  statementStatus: string;
  status: LineStatus;
  classification: Classification;
  txnDate: string | null;
  valueDate: string | null;
  narration: string | null;
  reference: string | null;
  /** Business-friendly description generated from narration; editable in review. */
  businessDescription?: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  direction: "deposit" | "withdrawal" | null;
  flags: LineFlag[];
  fingerprint: string;
  clientId: string | null;
  categoryId: number | null;
  invoiceId: string | null;
  skipReason: string | null;
  reviewedBy: string | null;
}

/** The audit-safe projection of a line: no narration, no amounts, no references. */
function auditLineState(line: ReviewLine) {
  return {
    status: line.status,
    classification: line.classification,
    hasClient: line.clientId != null,
    hasCategory: line.categoryId != null,
    hasInvoice: line.invoiceId != null,
    flagCount: line.flags.length,
    hasSkipReason: line.skipReason != null,
    reviewedBy: line.reviewedBy,
  };
}

interface LineRaw {
  id: string;
  statementId: string;
  accountId: string;
  statementStatus: string;
  status: string;
  classification: string;
  txnDate: string | null;
  valueDate: string | null;
  narration: string | null;
  reference: string | null,
  businessDescription: string | null,
  withdrawalAmount: string | null;
  depositAmount: string | null;
  direction: string | null;
  flags: unknown;
  fingerprint: string;
  clientId: string | null;
  categoryId: number | null;
  invoiceId: string | null;
  skipReason: string | null;
  reviewedBy: string | null;
}

function isLineFlag(value: unknown): value is LineFlag {
  return (
    typeof value === "string" &&
    /^(INVALID_DATE|AMBIGUOUS_DATE|TWO_DIGIT_YEAR|MISSING_DATE|INVALID_VALUE_DATE|MISSING_NARRATION|INVALID_AMOUNT|ZERO_AMOUNT|NEGATIVE_AMOUNT|MISSING_AMOUNT|BOTH_AMOUNTS|UNKNOWN_DIRECTION|DIRECTION_CONFLICT|INVALID_BALANCE|COLUMN_COUNT_MISMATCH|UNRECOGNIZED_ROW|TRANSFER|REFUND|REVERSAL|AMBIGUOUS_ENTRY|CASH_MOVEMENT|BANK_CHARGE)$/.test(
      value,
    )
  );
}

function isLineStatus(value: string): value is LineStatus {
  return ["pending", "ready", "imported", "skipped", "duplicate", "error"].includes(value);
}

function isClassification(value: string): value is Classification {
  return (CLASSIFICATIONS as readonly string[]).includes(value);
}

function mapRawLine(raw: LineRaw): ReviewLine | null {
  if (!isLineStatus(raw.status) || !isClassification(raw.classification)) return null;
  return {
    id: raw.id,
    statementId: raw.statementId,
    accountId: raw.accountId,
    statementStatus: raw.statementStatus,
    status: raw.status,
    classification: raw.classification,
    txnDate: raw.txnDate,
    valueDate: raw.valueDate,
    narration: raw.narration,
    reference: raw.reference,
    businessDescription: raw.businessDescription ?? null,
    withdrawalAmount: raw.withdrawalAmount,
    depositAmount: raw.depositAmount,
    direction: raw.direction === "deposit" || raw.direction === "withdrawal" ? raw.direction : null,
    flags: Array.isArray(raw.flags) ? raw.flags.filter(isLineFlag) : [],
    fingerprint: raw.fingerprint,
    clientId: raw.clientId,
    categoryId: raw.categoryId,
    invoiceId: raw.invoiceId,
    skipReason: raw.skipReason,
    reviewedBy: raw.reviewedBy,
  };
}

/**
 * Loads and locks one line together with its statement. The join in the WHERE
 * clause enforces statement/line ownership; `FOR UPDATE OF` serializes two
 * reviewers acting on the same line.
 */
async function loadReviewLine(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  statementId: string,
  lineId: string,
): Promise<ReviewLine | null> {
  const result = await tx.execute(sql`
    SELECT
      l.id,
      l.statement_id AS "statementId",
      s.account_id AS "accountId",
      s.status AS "statementStatus",
      l.status,
      l.classification,
      to_char(l.txn_date, 'YYYY-MM-DD') AS "txnDate",
      to_char(l.value_date, 'YYYY-MM-DD') AS "valueDate",
      l.narration,
      l.reference,
      l.business_description AS "businessDescription",
      l.withdrawal_amount::text AS "withdrawalAmount",
      l.deposit_amount::text AS "depositAmount",
      l.direction,
      l.flags,
      l.fingerprint,
      l.client_id AS "clientId",
      l.category_id AS "categoryId",
      l.invoice_id AS "invoiceId",
      l.skip_reason AS "skipReason",
      l.reviewed_by AS "reviewedBy"
    FROM bank_statement_lines l
    JOIN bank_statements s ON s.id = l.statement_id
    WHERE l.id = ${lineId}::uuid
      AND l.statement_id = ${statementId}::uuid
    FOR UPDATE OF l, s
  `);
  const raw = result.rows[0] as unknown as LineRaw | undefined;
  return raw ? mapRawLine(raw) : null;
}

// ─── Review input parsing ────────────────────────────────────────────────────

export interface ReviewLinePatch {
  classification?: Classification;
  description?: string | null;
  /** Business-friendly description; editable by reviewer, separate from narration. */
  businessDescription?: string | null;
  clientId?: string | null;
  categoryId?: number | null;
  /** Optional explicit invoice link; income lines only, validated at save. */
  invoiceId?: string | null;
}

export type ReviewPatchResult = { ok: true; value: ReviewLinePatch } | { ok: false; error: string };

/** Parses the client-supplied review shape; no database access. */
export function parseReviewLinePatch(raw: unknown): ReviewPatchResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "The review payload could not be read." };
  }
  const value = raw as Record<string, unknown>;
  const patch: ReviewLinePatch = {};

  if (value.classification !== undefined) {
    if (typeof value.classification !== "string" || !isClassification(value.classification)) {
      return { ok: false, error: "Choose a supported classification." };
    }
    patch.classification = value.classification;
  }

  if (value.description !== undefined) {
    const rawDescription = value.description;
    if (rawDescription !== null && typeof rawDescription !== "string") {
      return { ok: false, error: "The description has to be text." };
    }
    if (rawDescription === null) {
      patch.description = null;
    } else {
      const description = normalizeNarration(rawDescription);
      if (description && description.length > MAX_DESCRIPTION_LENGTH) {
        return {
          ok: false,
          error: `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`,
        };
      }
      patch.description = description;
    }
  }

  if (value.businessDescription !== undefined) {
    const rawBusinessDescription = value.businessDescription;
    if (rawBusinessDescription !== null && typeof rawBusinessDescription !== "string") {
      return { ok: false, error: "The business description has to be text." };
    }
    if (rawBusinessDescription === null) {
      patch.businessDescription = null;
    } else {
      const businessDescription = collapseWhitespace(rawBusinessDescription);
      if (businessDescription && businessDescription.length > MAX_DESCRIPTION_LENGTH) {
        return {
          ok: false,
          error: `Keep the business description under ${MAX_DESCRIPTION_LENGTH} characters.`,
        };
      }
      patch.businessDescription = businessDescription;
    }
  }

  if (value.clientId !== undefined) {
    if (value.clientId !== null && (typeof value.clientId !== "string" || !UUID_RE.test(value.clientId))) {
      return { ok: false, error: "The client could not be matched. Choose it again." };
    }
    patch.clientId = value.clientId === null ? null : value.clientId.toLowerCase();
  }

  if (value.categoryId !== undefined) {
    if (value.categoryId === null) {
      patch.categoryId = null;
    } else {
      const parsed =
        typeof value.categoryId === "number"
          ? value.categoryId
          : typeof value.categoryId === "string"
            ? Number.parseInt(value.categoryId, 10)
            : Number.NaN;
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, error: "The category could not be matched. Choose it again." };
      }
      patch.categoryId = parsed;
    }
  }

  if (value.invoiceId !== undefined) {
    if (value.invoiceId === null) {
      patch.invoiceId = null;
    } else if (typeof value.invoiceId !== "string" || !UUID_RE.test(value.invoiceId)) {
      return { ok: false, error: "The invoice could not be matched. Choose it again." };
    } else {
      patch.invoiceId = value.invoiceId.toLowerCase();
    }
  }

  return { ok: true, value: patch };
}

/**
 * Flags that the reviewer can clear by editing content. Only a filled
 * description clears MISSING_NARRATION; date/amount flags cannot be fixed in
 * review and must be handled by re-uploading a corrected statement.
 */
export function effectiveLineFlags(
  line: Pick<ReviewLine, "narration" | "flags">,
): LineFlag[] {
  const narration = normalizeNarration(line.narration);
  if (!narration) return line.flags;
  return line.flags.filter((flag) => flag !== "MISSING_NARRATION");
}

export interface LineEligibility {
  ready: boolean;
  blockers: string[];
}

/** Human-readable import gate for a line; mirrors the server-side validation. */
export function evaluateLineEligibility(line: ReviewLine): LineEligibility {
  if (line.status === "imported") {
    return { ready: false, blockers: ["This line was already imported; review is closed."] };
  }
  if (line.status === "error") {
    return {
      ready: false,
      blockers: ["This line does not parse. Upload a corrected statement to replace it."],
    };
  }
  if (line.status === "skipped") {
    return { ready: false, blockers: ["Skipped during review."] };
  }
  if (line.status === "duplicate") {
    return { ready: false, blockers: ["Marked as a duplicate during review."] };
  }

  const result = validateLineForImport({
    txnDate: line.txnDate,
    valueDate: line.valueDate,
    narration: line.narration,
    withdrawalAmount: line.withdrawalAmount,
    depositAmount: line.depositAmount,
    direction: line.direction,
    classification: line.classification,
    flags: effectiveLineFlags(line),
    clientId: line.clientId,
    categoryId: line.categoryId,
  });
  if (!result.ok) return { ready: false, blockers: [result.reason] };

  const directionError = validateImportDirection(line.direction, line.classification);
  if (directionError) return { ready: false, blockers: [directionError] };

  return { ready: true, blockers: [] };
}

// ─── Mapping helpers ─────────────────────────────────────────────────────────

const CLIENT_UNAVAILABLE = "The selected client is no longer available. Choose another one.";
const CATEGORY_UNAVAILABLE = "The selected category is no longer available. Choose another one.";
const INVOICE_UNAVAILABLE = "The selected invoice is no longer available. Choose another one.";

export function mappingForClassification(
  classification: Classification,
  current: { clientId: string | null; categoryId: number | null; invoiceId: string | null },
  patch: ReviewLinePatch,
): {
  ok: true;
  clientId: string | null;
  categoryId: number | null;
  invoiceId: string | null;
} | { ok: false; error: string } {
  if (classification === "income") {
    if (patch.categoryId !== undefined && patch.categoryId !== null) {
      return { ok: false, error: "Income lines do not take an expense category." };
    }
    const clientId = patch.clientId !== undefined ? patch.clientId : current.clientId;
    const invoiceId = patch.invoiceId !== undefined ? patch.invoiceId : current.invoiceId;
    return { ok: true, clientId, categoryId: null, invoiceId };
  }
  if (classification === "expense") {
    if (patch.clientId !== undefined && patch.clientId !== null) {
      return { ok: false, error: "Expense lines do not take a client." };
    }
    if (patch.invoiceId !== undefined && patch.invoiceId !== null) {
      return { ok: false, error: "Only income lines link to an invoice." };
    }
    const categoryId = patch.categoryId !== undefined ? patch.categoryId : current.categoryId;
    return { ok: true, clientId: null, categoryId, invoiceId: null };
  }
  if (patch.clientId !== undefined && patch.clientId !== null) {
    return { ok: false, error: "Only income lines take a client." };
  }
  if (patch.categoryId !== undefined && patch.categoryId !== null) {
    return { ok: false, error: "Only expense lines take a category." };
  }
  if (patch.invoiceId !== undefined && patch.invoiceId !== null) {
    return { ok: false, error: "Only income lines link to an invoice." };
  }
  return { ok: true, clientId: null, categoryId: null, invoiceId: null };
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function assertClientExists(tx: DbTx, clientId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: clients.clientId })
    .from(clients)
    .where(and(eq(clients.clientId, clientId), isNull(clients.deletedAt)))
    .limit(1);
  return Boolean(row);
}

async function assertCategoryExists(tx: DbTx, categoryId: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  return Boolean(row);
}

/**
 * Save-time invoice check for an income review patch. The import re-checks
 * everything inside its own transaction (with a row lock and the live
 * balance); this only stops a line from being saved with a broken link.
 */
async function validateInvoiceForReview(
  tx: DbTx,
  invoiceId: string,
  clientId: string,
): Promise<string | null> {
  const result = await tx.execute(sql`
    SELECT
      i.status,
      i.currency,
      i.deleted_at AS "deletedAt",
      i.client_id AS "invoiceClientId",
      (i.total - coalesce((
        SELECT sum(t.original_amount)
        FROM transactions t
        WHERE t.invoice_id = i.id
          AND t.deleted_at IS NULL
          AND t.type_id = 1
          AND t.original_currency = i.currency
      ), 0)) > 0 AS "hasOutstanding"
    FROM invoices i
    WHERE i.id = ${invoiceId}::uuid
  `);
  const invoice = result.rows[0] as unknown as
    | {
        status: string;
        currency: string;
        deletedAt: Date | null;
        invoiceClientId: string;
        hasOutstanding: boolean;
      }
    | undefined;
  if (!invoice || invoice.deletedAt != null) return INVOICE_UNAVAILABLE;
  if (invoice.status === "void") return "This invoice is void.";
  if (invoice.status !== "sent") {
    return "Issue the invoice before linking it to a payment.";
  }
  if (invoice.currency !== "INR") {
    return "Only INR invoices can be linked to an INR statement import.";
  }
  if (invoice.invoiceClientId !== clientId) {
    return "This invoice belongs to a different client.";
  }
  if (!invoice.hasOutstanding) {
    return "This invoice has no outstanding balance.";
  }
  return null;
}

// ─── Mutations ───────────────────────────────────────────────────────────────

const STATEMENT_NOT_REVIEWABLE = "This statement can no longer be reviewed.";
const LINE_NOT_FOUND = "This statement line could not be found.";
const IMPORTED_LOCKED = "Imported lines can no longer be changed.";
const ERROR_LOCKED = "This line does not parse; review is not available for it.";
const NEEDS_REOPEN = "Reopen this line before changing the review decision.";

function transitionError(line: ReviewLine, action: "edit" | "decide"): string | null {
  if (line.status === "imported") return IMPORTED_LOCKED;
  if (line.status === "error") return ERROR_LOCKED;
  if (action === "edit" && !EDITABLE_STATUSES.has(line.status)) return NEEDS_REOPEN;
  if (action === "decide" && !EDITABLE_STATUSES.has(line.status)) return NEEDS_REOPEN;
  if (line.statementStatus !== "review") return STATEMENT_NOT_REVIEWABLE;
  return null;
}

/**
 * Applies the reviewer's mapping/description/classification patch.
 *
 * It never promotes a line to `ready`. It only downgrades `ready` -> `pending`
 * when the new content no longer validates for import.
 */
export async function updateLineReview(
  userId: string,
  statementId: string,
  lineId: string,
  raw: unknown,
): Promise<ReviewResult> {
  if (!UUID_RE.test(statementId) || !UUID_RE.test(lineId)) {
    return { ok: false, error: "This statement line could not be resolved." };
  }

  try {
    return await db.transaction(async (tx) => {
      const line = await loadReviewLine(tx, statementId, lineId);
      if (!line) return { ok: false, error: LINE_NOT_FOUND } satisfies ReviewResult;

      const locked = transitionError(line, "edit");
      if (locked) return { ok: false, error: locked } satisfies ReviewResult;

      const parsed = parseReviewLinePatch(raw);
      if (!parsed.ok) return parsed satisfies ReviewResult;
      const patch = parsed.value;

      const classification = patch.classification ?? line.classification;

      const mapping = mappingForClassification(classification, line, patch);
      if (!mapping.ok) return { ok: false, error: mapping.error } satisfies ReviewResult;

      if (mapping.clientId) {
        const exists = await assertClientExists(tx, mapping.clientId);
        if (!exists) return { ok: false, error: CLIENT_UNAVAILABLE } satisfies ReviewResult;
      }
      if (mapping.categoryId != null) {
        const exists = await assertCategoryExists(tx, mapping.categoryId);
        if (!exists) return { ok: false, error: CATEGORY_UNAVAILABLE } satisfies ReviewResult;
      }
      if (mapping.invoiceId) {
        if (!mapping.clientId) {
          return {
            ok: false,
            error: "Select a client before linking an invoice.",
          } satisfies ReviewResult;
        }
        const invoiceError = await validateInvoiceForReview(
          tx,
          mapping.invoiceId,
          mapping.clientId,
        );
        if (invoiceError) return { ok: false, error: invoiceError } satisfies ReviewResult;
      }

      const description =
        patch.description !== undefined
          ? patch.description === null
            ? null
            : normalizeNarration(patch.description)
          : line.narration;

      const narrationChanged =
        patch.description !== undefined && normalizeNarration(description) !== normalizeNarration(line.narration);

      const businessDescription =
        patch.businessDescription !== undefined
          ? patch.businessDescription === null
            ? null
            : collapseWhitespace(patch.businessDescription)
          : line.businessDescription;

      const nextLine: ReviewLine = {
        ...line,
        classification,
        narration: description,
        businessDescription,
        clientId: mapping.clientId,
        categoryId: mapping.categoryId,
        invoiceId: mapping.invoiceId,
        fingerprint: narrationChanged
          ? fingerprintLine({
              txnDate: line.txnDate,
              valueDate: line.valueDate,
              narration: description,
              reference: line.reference,
              withdrawalAmount: line.withdrawalAmount,
              depositAmount: line.depositAmount,
            })
          : line.fingerprint,
      };

      const wasReady = line.status === "ready";
      const stillValid = validateLineForImport({
        txnDate: nextLine.txnDate,
        valueDate: nextLine.valueDate,
        narration: nextLine.narration,
        withdrawalAmount: nextLine.withdrawalAmount,
        depositAmount: nextLine.depositAmount,
        direction: nextLine.direction,
        classification: nextLine.classification,
        flags: effectiveLineFlags(nextLine),
        clientId: nextLine.clientId,
        categoryId: nextLine.categoryId,
      }).ok;

      const nextStatus: LineStatus = wasReady ? (stillValid ? "ready" : "pending") : line.status;
      const reviewer = wasReady
        ? stillValid
          ? { reviewedBy: userId, reviewedAt: new Date() }
          : { reviewedBy: null, reviewedAt: null }
        : { reviewedBy: line.reviewedBy, reviewedAt: null };

      await tx
        .update(bankStatementLines)
        .set({
          classification: nextLine.classification,
          clientId: nextLine.clientId,
          categoryId: nextLine.categoryId,
          invoiceId: nextLine.invoiceId,
          narration: nextLine.narration,
          businessDescription: nextLine.businessDescription,
          fingerprint: nextLine.fingerprint,
          status: nextStatus,
          ...(wasReady
            ? { reviewedBy: reviewer.reviewedBy, reviewedAt: reviewer.reviewedAt }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(bankStatementLines.id, line.id));

      await tx
        .update(bankStatements)
        .set({ updatedAt: new Date() })
        .where(eq(bankStatements.id, statementId));

      await tx.insert(auditEvents).values({
        entityType: "bank_statement_line",
        entityId: line.id,
        action: wasReady && !stillValid ? "review_invalidated" : "review_updated",
        performedBy: userId,
        source: "bank_import",
        beforeState: auditLineState(line),
        afterState: auditLineState({ ...nextLine, status: nextStatus }),
      });

      return { ok: true } satisfies ReviewResult;
    });
  } catch (error) {
    logSafeDbConstraintError(error, "review update");
    return { ok: false, error: reviewSaveFailureMessage(error) };
  }
}

/**
 * Marks a validated line as `ready` for the Phase 4 import. A `ready` line that
 * no longer validates is demoted instead of being re-confirmed.
 */
export async function markLineReady(
  userId: string,
  statementId: string,
  lineId: string,
): Promise<ReviewResult> {
  if (!UUID_RE.test(statementId) || !UUID_RE.test(lineId)) {
    return { ok: false, error: "This statement line could not be resolved." };
  }

  try {
    return await db.transaction(async (tx) => {
      const line = await loadReviewLine(tx, statementId, lineId);
      if (!line) return { ok: false, error: LINE_NOT_FOUND } satisfies ReviewResult;

      const blocked = transitionError(line, "decide");
      if (blocked) return { ok: false, error: blocked } satisfies ReviewResult;

      if (line.clientId) {
        const exists = await assertClientExists(tx, line.clientId);
        if (!exists) return { ok: false, error: CLIENT_UNAVAILABLE } satisfies ReviewResult;
      }
      if (line.categoryId != null) {
        const exists = await assertCategoryExists(tx, line.categoryId);
        if (!exists) return { ok: false, error: CATEGORY_UNAVAILABLE } satisfies ReviewResult;
      }

      const validation = validateLineForImport({
        txnDate: line.txnDate,
        valueDate: line.valueDate,
        narration: line.narration,
        withdrawalAmount: line.withdrawalAmount,
        depositAmount: line.depositAmount,
        direction: line.direction,
        classification: line.classification,
        flags: effectiveLineFlags(line),
        clientId: line.clientId,
        categoryId: line.categoryId,
      });

      if (!validation.ok) {
        if (line.status === "ready") {
          await tx
            .update(bankStatementLines)
            .set({
              status: "pending",
              reviewedBy: null,
              reviewedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(bankStatementLines.id, line.id));
          await tx.insert(auditEvents).values({
            entityType: "bank_statement_line",
            entityId: line.id,
            action: "review_invalidated",
            performedBy: userId,
            source: "bank_import",
            beforeState: auditLineState(line),
            afterState: auditLineState({ ...line, status: "pending", reviewedBy: null }),
          });
          return { ok: true } satisfies ReviewResult;
        }
        return { ok: false, error: validation.reason } satisfies ReviewResult;
      }

      if (line.status === "ready") return { ok: true } satisfies ReviewResult;

      await tx
        .update(bankStatementLines)
        .set({ status: "ready", reviewedBy: userId, reviewedAt: new Date(), updatedAt: new Date() })
        .where(eq(bankStatementLines.id, line.id));

      await tx
        .update(bankStatements)
        .set({ updatedAt: new Date() })
        .where(eq(bankStatements.id, statementId));

      await tx.insert(auditEvents).values({
        entityType: "bank_statement_line",
        entityId: line.id,
        action: "ready_marked",
        performedBy: userId,
        source: "bank_import",
        beforeState: auditLineState(line),
        afterState: auditLineState({ ...line, status: "ready", reviewedBy: userId }),
      });

      return { ok: true } satisfies ReviewResult;
    });
  } catch (error) {
    logSafeDbError("markLineReady", error);
    return { ok: false, error: "Marking the line ready failed. Try again." };
  }
}

/** Skips a line with a required reason; the reason is stored in skip_reason. */
export async function skipLine(
  userId: string,
  statementId: string,
  lineId: string,
  rawReason: unknown,
): Promise<ReviewResult> {
  if (!UUID_RE.test(statementId) || !UUID_RE.test(lineId)) {
    return { ok: false, error: "This statement line could not be resolved." };
  }
  if (typeof rawReason !== "string") {
    return { ok: false, error: "Add a reason for skipping this line." };
  }
  const reason = normalizeNarration(rawReason);
  if (!reason) return { ok: false, error: "Add a reason for skipping this line." };
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `Keep the reason under ${MAX_REASON_LENGTH} characters.` };
  }

  try {
    return await db.transaction(async (tx) => {
      const line = await loadReviewLine(tx, statementId, lineId);
      if (!line) return { ok: false, error: LINE_NOT_FOUND } satisfies ReviewResult;

      const blocked = transitionError(line, "decide");
      if (blocked) return { ok: false, error: blocked } satisfies ReviewResult;

      if (line.status === "skipped") {
        return { ok: false, error: "This line is already skipped. Reopen it to change the decision." } satisfies ReviewResult;
      }

      await tx
        .update(bankStatementLines)
        .set({
          status: "skipped",
          skipReason: reason,
          reviewedBy: userId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bankStatementLines.id, line.id));

      await tx
        .update(bankStatements)
        .set({ updatedAt: new Date() })
        .where(eq(bankStatements.id, statementId));

      await tx.insert(auditEvents).values({
        entityType: "bank_statement_line",
        entityId: line.id,
        action: "skipped",
        performedBy: userId,
        source: "bank_import",
        beforeState: auditLineState(line),
        afterState: auditLineState({ ...line, status: "skipped", reviewedBy: userId }),
        metadata: { reason },
      });

      return { ok: true } satisfies ReviewResult;
    });
  } catch (error) {
    logSafeDbError("skipLine", error);
    return { ok: false, error: "Skipping the line failed. Try again." };
  }
}

/**
 * Records the reviewer's explicit duplicate decision. This only changes the
 * staging row; duplicate candidates are warnings and no financial data moves.
 */
export async function markLineDuplicate(
  userId: string,
  statementId: string,
  lineId: string,
  rawNote: unknown = null,
): Promise<ReviewResult> {
  if (!UUID_RE.test(statementId) || !UUID_RE.test(lineId)) {
    return { ok: false, error: "This statement line could not be resolved." };
  }
  let note: string | null = null;
  if (rawNote != null) {
    if (typeof rawNote !== "string") {
      return { ok: false, error: "The duplicate note has to be text." };
    }
    note = normalizeNarration(rawNote);
    if (note && note.length > MAX_REASON_LENGTH) {
      return { ok: false, error: `Keep the note under ${MAX_REASON_LENGTH} characters.` };
    }
  }

  try {
    return await db.transaction(async (tx) => {
      const line = await loadReviewLine(tx, statementId, lineId);
      if (!line) return { ok: false, error: LINE_NOT_FOUND } satisfies ReviewResult;

      const blocked = transitionError(line, "decide");
      if (blocked) return { ok: false, error: blocked } satisfies ReviewResult;

      if (line.status === "duplicate") {
        return {
          ok: false,
          error: "This line is already marked as a duplicate. Reopen it to change the decision.",
        } satisfies ReviewResult;
      }

      await tx
        .update(bankStatementLines)
        .set({
          status: "duplicate",
          skipReason: note,
          reviewedBy: userId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bankStatementLines.id, line.id));

      await tx
        .update(bankStatements)
        .set({ updatedAt: new Date() })
        .where(eq(bankStatements.id, statementId));

      await tx.insert(auditEvents).values({
        entityType: "bank_statement_line",
        entityId: line.id,
        action: "duplicate_marked",
        performedBy: userId,
        source: "bank_import",
        beforeState: auditLineState(line),
        afterState: auditLineState({ ...line, status: "duplicate", reviewedBy: userId }),
      });

      return { ok: true } satisfies ReviewResult;
    });
  } catch (error) {
    logSafeDbError("markLineDuplicate", error);
    return { ok: false, error: "Marking the duplicate failed. Try again." };
  }
}

// ─── Bulk duplicate marking ──────────────────────────────────────────────────

/** Upper bound for one bulk Duplicate action; mirrors the import batch cap. */
export const MAX_DUPLICATE_BATCH = 100;

/**
 * Shared note stored on rows marked duplicate through the selection buttons.
 * Visible to the reviewer in place of a per-row note, which stays editable via
 * Reopen → review editor.
 */
export const BULK_DUPLICATE_NOTE = "Selected as duplicate in review";

export interface BulkDuplicateFailure {
  lineId: string;
  rowNumber: number;
  error: string;
}

export interface BulkDuplicateResult {
  ok: boolean;
  /** Batch-level error (unknown statement, wrong state, no lines). */
  error: string | null;
  requested: number;
  marked: number;
  alreadyDuplicate: number;
  failed: number;
  statementStatus: string | null;
  failures: BulkDuplicateFailure[];
}

/**
 * Decides what the bulk duplicate action can do with one selected row.
 * Pure policy, shared by the server action and the offline checks:
 * pending/ready rows become duplicates, rows already marked stay untouched,
 * everything else needs its existing review path (reopen or import flow).
 */
export function bulkDuplicateDecision(
  lineStatus: LineStatus,
  statementStatus: string,
): { action: "mark" } | { action: "skip" } | { action: "reject"; error: string } {
  if (statementStatus !== "review") {
    return { action: "reject", error: STATEMENT_NOT_REVIEWABLE };
  }
  if (lineStatus === "pending" || lineStatus === "ready") return { action: "mark" };
  if (lineStatus === "duplicate") return { action: "skip" };
  if (lineStatus === "imported") return { action: "reject", error: IMPORTED_LOCKED };
  if (lineStatus === "error") return { action: "reject", error: ERROR_LOCKED };
  return { action: "reject", error: NEEDS_REOPEN };
}

interface BulkDupLineRaw {
  id: string;
  rowNumber: number | string;
  status: string;
  statementStatus: string;
  classification: string;
  flags: unknown;
  clientId: string | null;
  categoryId: number | null;
  invoiceId: string | null;
  skipReason: string | null;
  reviewedBy: string | null;
}

/**
 * Marks many selected lines as `duplicate` in one pass. One transaction locks
 * the statement and every requested line, so a second reviewer running the
 * same action serializes instead of racing. Each marked line gets its own
 * audit event; the decision is staging-only, no data moves anywhere.
 */
export async function markLinesDuplicate(
  userId: string,
  rawStatementId: unknown,
  rawLineIds: unknown,
): Promise<BulkDuplicateResult> {
  const emptyBatch = (error: string, requested = 0): BulkDuplicateResult => ({
    ok: false,
    error,
    requested,
    marked: 0,
    alreadyDuplicate: 0,
    failed: 0,
    statementStatus: null,
    failures: [],
  });

  if (typeof rawStatementId !== "string" || !UUID_RE.test(rawStatementId)) {
    return emptyBatch("This statement could not be resolved.");
  }
  if (!Array.isArray(rawLineIds) || rawLineIds.length === 0) {
    return emptyBatch("Select at least one row to mark as duplicate.");
  }
  if (rawLineIds.length > MAX_DUPLICATE_BATCH) {
    return emptyBatch(
      `Mark at most ${MAX_DUPLICATE_BATCH} rows as duplicate per batch.`,
      rawLineIds.length,
    );
  }
  const deduped = [...new Set(rawLineIds)];
  if (deduped.some((id) => typeof id !== "string" || !UUID_RE.test(id))) {
    return emptyBatch(
      "Some selected rows could not be resolved. Refresh and try again.",
      rawLineIds.length,
    );
  }

  try {
    return await db.transaction(async (tx) => {
      // Lock the requested lines together with their statement in one
      // statement, mirroring `loadReviewLine`'s `FOR UPDATE OF l, s` ordering.
      const loaded = await tx
        .select({
          id: bankStatementLines.id,
          rowNumber: bankStatementLines.rowNumber,
          status: bankStatementLines.status,
          statementStatus: bankStatements.status,
          classification: bankStatementLines.classification,
          flags: bankStatementLines.flags,
          clientId: bankStatementLines.clientId,
          categoryId: bankStatementLines.categoryId,
          invoiceId: bankStatementLines.invoiceId,
          skipReason: bankStatementLines.skipReason,
          reviewedBy: bankStatementLines.reviewedBy,
        })
        .from(bankStatementLines)
        .innerJoin(bankStatements, eq(bankStatements.id, bankStatementLines.statementId))
        .where(
          and(
            eq(bankStatementLines.statementId, rawStatementId),
            inArray(bankStatementLines.id, deduped),
          ),
        )
        .for("update", { of: [bankStatementLines, bankStatements] });
      const rows = loaded as unknown as BulkDupLineRaw[];
      if (rows.length === 0) {
        return emptyBatch("This statement could not be found.", deduped.length);
      }
      // Every line of one statement shares the same statement status.
      const statementStatus = rows[0].statementStatus;

      const byId = new Map(rows.map((row) => [row.id, row]));
      const failures: BulkDuplicateFailure[] = [];
      const now = new Date();
      let marked = 0;
      let alreadyDuplicate = 0;

      for (const lineId of deduped) {
        const row = byId.get(lineId);
        if (!row) {
          failures.push({
            lineId,
            rowNumber: 0,
            error: LINE_NOT_FOUND,
          });
          continue;
        }

        const decision = bulkDuplicateDecision(row.status as LineStatus, statementStatus);
        if (decision.action === "reject") {
          failures.push({ lineId, rowNumber: Number(row.rowNumber), error: decision.error });
          continue;
        }
        if (decision.action === "skip") {
          alreadyDuplicate += 1;
          continue;
        }

        await tx
          .update(bankStatementLines)
          .set({
            status: "duplicate",
            skipReason: BULK_DUPLICATE_NOTE,
            reviewedBy: userId,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(eq(bankStatementLines.id, row.id));

        await tx.insert(auditEvents).values({
          entityType: "bank_statement_line",
          entityId: row.id,
          action: "duplicate_marked",
          performedBy: userId,
          source: "bank_import",
          beforeState: {
            status: row.status,
            classification: row.classification,
            hasClient: row.clientId != null,
            hasCategory: row.categoryId != null,
            hasInvoice: row.invoiceId != null,
            flagCount: Array.isArray(row.flags) ? row.flags.length : 0,
            hasSkipReason: row.skipReason != null,
            reviewedBy: row.reviewedBy,
          },
          afterState: {
            status: "duplicate",
            classification: row.classification,
            hasClient: row.clientId != null,
            hasCategory: row.categoryId != null,
            hasInvoice: row.invoiceId != null,
            flagCount: Array.isArray(row.flags) ? row.flags.length : 0,
            hasSkipReason: true,
            reviewedBy: userId,
          },
          metadata: { reason: BULK_DUPLICATE_NOTE, bulkSelection: true },
        });

        marked += 1;
      }

      if (marked > 0) {
        await tx
          .update(bankStatements)
          .set({ updatedAt: now })
          .where(eq(bankStatements.id, rawStatementId));
      }

      return {
        ok: true,
        error: null,
        requested: deduped.length,
        marked,
        alreadyDuplicate,
        failed: failures.length,
        statementStatus: null,
        failures,
      } satisfies BulkDuplicateResult;
    });
  } catch (error) {
    logSafeDbError("markLinesDuplicate", error);
    return emptyBatch("Marking the duplicates failed. Try again.", deduped.length);
  }
}

/**
 * Reopens a review decision: ready, skipped, and duplicate lines go back to
 * pending. Error and imported lines are terminal in Phase 3.
 */
export async function reopenLine(
  userId: string,
  statementId: string,
  lineId: string,
): Promise<ReviewResult> {
  if (!UUID_RE.test(statementId) || !UUID_RE.test(lineId)) {
    return { ok: false, error: "This statement line could not be resolved." };
  }

  try {
    return await db.transaction(async (tx) => {
      const line = await loadReviewLine(tx, statementId, lineId);
      if (!line) return { ok: false, error: LINE_NOT_FOUND } satisfies ReviewResult;

      if (line.status === "imported") return { ok: false, error: IMPORTED_LOCKED } satisfies ReviewResult;
      if (line.status === "error") return { ok: false, error: ERROR_LOCKED } satisfies ReviewResult;
      if (line.status === "pending") return { ok: false, error: "This line is already pending review." } satisfies ReviewResult;
      if (!REOPENABLE_STATUSES.has(line.status)) {
        return { ok: false, error: NEEDS_REOPEN } satisfies ReviewResult;
      }
      if (line.statementStatus !== "review") {
        return { ok: false, error: STATEMENT_NOT_REVIEWABLE } satisfies ReviewResult;
      }

      await tx
        .update(bankStatementLines)
        .set({
          status: "pending",
          skipReason: null,
          reviewedBy: null,
          reviewedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(bankStatementLines.id, line.id));

      await tx
        .update(bankStatements)
        .set({ updatedAt: new Date() })
        .where(eq(bankStatements.id, statementId));

      await tx.insert(auditEvents).values({
        entityType: "bank_statement_line",
        entityId: line.id,
        action: "reopened",
        performedBy: userId,
        source: "bank_import",
        beforeState: auditLineState(line),
        afterState: auditLineState({ ...line, status: "pending", reviewedBy: null }),
      });

      return { ok: true } satisfies ReviewResult;
    });
  } catch (error) {
    logSafeDbError("reopenLine", error);
    return { ok: false, error: "Reopening the line failed. Try again." };
  }
}

// ─── Review picker options (read-only) ───────────────────────────────────────

export interface ReviewOption {
  value: string;
  label: string;
}

/** Active clients and existing categories for the review pickers. */
export async function listReviewOptions(): Promise<{
  clients: ReviewOption[];
  categories: ReviewOption[];
}> {
  const [clientRows, categoryRows] = await Promise.all([
    db
      .select({ value: clients.clientId, label: clients.clientName })
      .from(clients)
      .where(isNull(clients.deletedAt))
      .orderBy(asc(clients.clientName)),
    db
      .select({ value: categories.id, label: categories.name })
      .from(categories)
      .orderBy(asc(categories.name)),
  ]);

  return {
    clients: clientRows.map((row) => ({ value: row.value, label: row.label })),
    categories: categoryRows.map((row) => ({ value: String(row.value), label: row.label })),
  };
}

/** Search active clients by name for the dynamic client selector. */
export async function searchClients(query: string): Promise<ReviewOption[]> {
  const normalized = collapseWhitespace(query).trim();
  if (!normalized) return [];
  const rows = await db
    .select({ value: clients.clientId, label: clients.clientName })
    .from(clients)
    .where(isNull(clients.deletedAt))
    .orderBy(asc(clients.clientName));
  const lower = normalized.toLowerCase();
  return rows
    .filter((row) => row.label.toLowerCase().includes(lower))
    .map((row) => ({ value: row.value, label: row.label ?? "" }));
}

/** Create a new client during the confirmed import transaction. */
export async function createClient(
  tx: DbTx,
  userId: string,
  clientName: string,
): Promise<{ ok: true; clientId: string; created: boolean } | { ok: false; error: string }> {
  const normalized = collapseWhitespace(clientName).trim();
  if (!normalized) {
    return { ok: false, error: "Client name is required." };
  }

  // Resolve the matching active client in SQL. Limiting an unfiltered client
  // query first can miss an existing match and make the unique index reject
  // the attempted insert.
  const [match] = await tx
    .select({ value: clients.clientId })
    .from(clients)
    .where(
      and(
        sql`lower(trim(both from regexp_replace(${clients.clientName}, '[[:space:]]+', ' ', 'g'))) = ${normalized.toLowerCase()}`,
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  if (match) {
    return { ok: true, clientId: match.value, created: false };
  }

  const [created] = await tx
    .insert(clients)
    .values({
      clientName: normalized,
      country: "India",
    })
    .returning({ id: clients.clientId });

  await tx.insert(auditEvents).values({
    entityType: "client",
    entityId: created.id,
    action: "created",
    performedBy: userId,
    source: "bank_import",
    afterState: { clientName: normalized },
  });

  return { ok: true, clientId: created.id, created: true };
}
