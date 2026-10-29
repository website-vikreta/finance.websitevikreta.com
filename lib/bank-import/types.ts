/**
 * Shared types for PDF bank-statement import.
 *
 * Phase 1 is parsing only. Nothing in this module writes a financial row.
 *
 * Phase 4 invariant (documented here for the later implementation):
 * - Import uses its own source-aware service, not the Finance AI confirmation
 *   path, and must never read or write chat-session state.
 * - The import-line row is locked and validated before the transaction insert.
 * - Transaction insert, audit event, invoice guard (when linked), and the
 *   import-line update must all run in one database transaction and commit or
 *   roll back together.
 * - A retry must never reuse an idempotency key owned by a soft-deleted row.
 *   The line's `import_attempt` produces `bank-line:<line-id>:a<attempt>`;
 *   only a failed transaction with no committed row may retry the same value.
 * - Transaction idempotency stays globally unique. A soft-deleted transaction
 *   keeps its key, so the new attempt gets a new key.
 */

export const LINE_STATUSES = [
  "pending",
  "ready",
  "imported",
  "skipped",
  "duplicate",
  "error",
] as const;

export type LineStatus = (typeof LINE_STATUSES)[number];

/** Statement workflow states; mirrors chk_bank_statements_status. */
export type StatementStatus = "review" | "importing" | "completed" | "failed" | "cancelled";

export const LINE_STATUS_LABELS: Record<LineStatus, string> = {
  pending: "Pending",
  ready: "Ready",
  imported: "Imported",
  skipped: "Skipped",
  duplicate: "Duplicate",
  error: "Error",
};

export const STATEMENT_STATUS_LABELS: Record<StatementStatus, string> = {
  review: "Review",
  importing: "Importing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  unclassified: "Unclassified",
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  refund: "Refund",
  reversal: "Reversal",
  other: "Other",
  non_business: "Non-business",
};

export const CLASSIFICATIONS = [
  "unclassified",
  "income",
  "expense",
  "transfer",
  "refund",
  "reversal",
  "other",
  "non_business",
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

export const DIRECTIONS = ["deposit", "withdrawal"] as const;

export type Direction = (typeof DIRECTIONS)[number];

/**
 * Parser flags are stored as JSON on the staging line. A line is never marked
 * ready while it has a blocking flag; review can clear the issue explicitly.
 */
export const LINE_FLAGS = [
  "INVALID_DATE",
  "AMBIGUOUS_DATE",
  "TWO_DIGIT_YEAR",
  "MISSING_DATE",
  "INVALID_VALUE_DATE",
  "MISSING_NARRATION",
  "INVALID_AMOUNT",
  "ZERO_AMOUNT",
  "NEGATIVE_AMOUNT",
  "MISSING_AMOUNT",
  "BOTH_AMOUNTS",
  "UNKNOWN_DIRECTION",
  "DIRECTION_CONFLICT",
  "INVALID_BALANCE",
  "BALANCE_MISMATCH",
  "COLUMN_COUNT_MISMATCH",
  "UNRECOGNIZED_ROW",
  "TRANSFER",
  "REFUND",
  "REVERSAL",
  "AMBIGUOUS_ENTRY",
  "CASH_MOVEMENT",
  "BANK_CHARGE",
] as const;

export type LineFlag = (typeof LINE_FLAGS)[number];

/**
 * Flags that keep a line out of `ready`. The parser sets them from content; the
 * review screen uses the same set to highlight rows, so validation and UI can
 * never disagree. (Client-safe: this module has no Node-only imports.)
 */
export const BLOCKING_LINE_FLAGS: ReadonlySet<LineFlag> = new Set<LineFlag>([
  "INVALID_DATE",
  "AMBIGUOUS_DATE",
  "TWO_DIGIT_YEAR",
  "MISSING_DATE",
  "INVALID_VALUE_DATE",
  "MISSING_NARRATION",
  "INVALID_AMOUNT",
  "ZERO_AMOUNT",
  "NEGATIVE_AMOUNT",
  "MISSING_AMOUNT",
  "BOTH_AMOUNTS",
  "UNKNOWN_DIRECTION",
  "DIRECTION_CONFLICT",
  "INVALID_BALANCE",
  "COLUMN_COUNT_MISMATCH",
  "UNRECOGNIZED_ROW",
  "TRANSFER",
  "REFUND",
  "REVERSAL",
  "AMBIGUOUS_ENTRY",
  "CASH_MOVEMENT",
]);

export const SAFE_ERROR_CODES = [
  "INVALID_INPUT",
  "FILE_TOO_LARGE",
  "NOT_A_PDF",
  "INVALID_PDF",
  "PASSWORD_REQUIRED",
  "WRONG_PASSWORD",
  "NO_TEXT_LAYER",
  "NO_HEADER",
  "NO_ROWS",
  "TOO_MANY_PAGES",
  "TOO_MANY_ROWS",
  "UNSUPPORTED_CURRENCY",
] as const;

export type SafeErrorCode = (typeof SAFE_ERROR_CODES)[number];

/** A safe, UI-facing error. It never carries statement text or a parser cause. */
export class BankImportError extends Error {
  readonly code: SafeErrorCode;

  constructor(code: SafeErrorCode, message: string) {
    super(message);
    this.name = "BankImportError";
    this.code = code;
  }
}

export interface ParsedLine {
  pageNumber: number;
  rowNumber: number;
  txnDate: string | null;
  valueDate: string | null;
  narration: string | null;
  reference: string | null;
  /** Business-friendly description generated from narration; editable in review. */
  businessDescription?: string;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  closingBalance: string | null;
  direction: Direction | null;
  classification: Classification;
  status: LineStatus;
  fingerprint: string;
  flags: LineFlag[];
  errorCode: SafeErrorCode | null;
}

export interface ParsedPage {
  pageNumber: number;
  text: string;
  /** Spatially extracted table rows for this page, when available. */
  tables?: string[][];
}

export interface TableCell {
  text: string;
  x: number;
  y: number;
}

export interface PageTable {
  pageNumber: number;
  rows: string[][];
}

export interface ParsedStatement {
  currency: "INR";
  pages: number;
  lines: ParsedLine[];
  statementFrom: string | null;
  statementTo: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  warnings: string[];
}

export interface ParseOptions {
  maxRows?: number;
}

export interface PdfExtractionOptions extends ParseOptions {
  maxBytes?: number;
  maxPages?: number;
  /** Kept in memory only. Never persist or log this value. */
  password?: string;
}

export interface PdfExtraction {
  pages: ParsedPage[];
  pageCount: number;
  text: string;
  tables: PageTable[];
}

export const PARSER_VERSION = "1.4.0";
