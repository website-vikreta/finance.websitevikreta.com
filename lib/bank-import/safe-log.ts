/**
 * Safe structured logging for database operations in bank import.
 *
 * PostgreSQL error objects often contain sensitive information:
 * - Query strings with parameters
 * - Table rows or column values in error details ("Key (col)=(val) already exists")
 * - Constraint definitions and internal schema details
 *
 * This helper permits ONLY explicitly safe fields:
 * - The operation name
 * - An allowlisted 5-character PostgreSQL error code (e.g., 23505, 23503, 40001)
 *
 * Full error objects, stack traces, query parameters, narrations, amounts,
 * and database URLs are never logged.
 */

const PG_ERROR_CODE_REGEX = /^[0-9A-Za-z]{5}$/;
const SAFE_DB_CONSTRAINTS = new Set([
  "chk_bank_statement_lines_position",
  "chk_bank_statement_lines_amounts",
  "chk_bank_statement_lines_direction",
  "chk_bank_statement_lines_classification",
  "chk_bank_statement_lines_status",
  "chk_bank_statement_lines_ready",
  "chk_bank_statement_lines_imported",
  "chk_bank_statement_lines_fingerprint",
  "chk_bank_statement_lines_import_attempt",
  "uq_bank_statement_lines_position",
  "uq_bank_statement_lines_transaction",
  "uq_bank_statements_active_file_sha256",
  "bank_statement_lines_statement_id_bank_statements_id_fk",
  "bank_statement_lines_client_id_clients_client_id_fk",
  "bank_statement_lines_category_id_categories_id_fk",
  "bank_statement_lines_invoice_id_invoices_id_fk",
  "bank_statement_lines_transaction_id_transactions_id_fk",
  "bank_statement_lines_imported_category_id_categories_id_fk",
  "bank_statement_lines_reviewed_by_app_users_id_fk",
  "bank_statements_account_id_bank_accounts_id_fk",
  "bank_statements_created_by_app_users_id_fk",
]);

export interface SafeDbErrorPayload {
  operation: string;
  code: string;
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<object>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current) && chain.length < 4) {
    chain.push(current);
    seen.add(current);
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return chain;
}

/**
 * Extracts a safe PostgreSQL error code from an unknown error object.
 * Returns undefined if no safe alphanumeric 5-character code is present.
 */
export function extractSafePgCode(error: unknown): string | undefined {
  for (const candidate of errorChain(error)) {
    if (typeof candidate !== "object" || candidate === null || !("code" in candidate)) continue;
    const rawCode = (candidate as { code?: unknown }).code;
    if (typeof rawCode === "string" && PG_ERROR_CODE_REGEX.test(rawCode.trim())) {
      return rawCode.trim();
    }
  }
  return undefined;
}

/**
 * Formats a safe structured error payload containing only operation and code.
 */
export function formatSafeDbError(
  operation: string,
  error: unknown,
): SafeDbErrorPayload {
  const code = extractSafePgCode(error) ?? "UNKNOWN";
  return {
    operation,
    code,
  };
}

/**
 * Logs a database error safely to console.error with no sensitive detail.
 */
export function logSafeDbError(operation: string, error: unknown): void {
  const payload = formatSafeDbError(operation, error);
  console.error(`[bank-import] ${operation} failed`, payload);
}

export interface SafeDbConstraintPayload {
  code: string;
  constraint: string;
}

/** Returns only an allowlisted SQLSTATE and known bank-import constraint name. */
export function formatSafeDbConstraintError(error: unknown): SafeDbConstraintPayload {
  const code = extractSafePgCode(error) ?? "UNKNOWN";
  let constraint = "UNKNOWN";
  for (const nested of errorChain(error)) {
    if (typeof nested !== "object" || nested === null || !("constraint" in nested)) continue;
    const candidate = (nested as { constraint?: unknown }).constraint;
    if (typeof candidate === "string" && SAFE_DB_CONSTRAINTS.has(candidate)) {
      constraint = candidate;
      break;
    }
  }
  return { code, constraint };
}

/** Logs no SQL, values, error message, operation input, or connection detail. */
export function logSafeDbConstraintError(error: unknown, operation = "upload"): void {
  console.error(`[bank-import] ${operation} database failure`, formatSafeDbConstraintError(error));
}
