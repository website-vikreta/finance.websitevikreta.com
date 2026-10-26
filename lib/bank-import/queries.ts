/**
 * Read-side queries for the bank-import screens.
 *
 * - Server only: imported by Server Components and route handlers, never by
 *   client code.
 * - Staging only: financial `transactions` are never joined into these rows.
 * - Dates/times are rendered in Asia/Kolkata, matching the ledger screens.
 */

import { asc, desc, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankAccounts } from "@/lib/db/schema";
import {
  type Classification,
  type LineFlag,
  type LineStatus,
  type SafeErrorCode,
  type StatementStatus,
} from "./types";

export type { Classification, StatementStatus };

export {
  CLASSIFICATION_LABELS,
  LINE_STATUS_LABELS,
  STATEMENT_STATUS_LABELS,
} from "./types";

export interface BankAccountRow {
  id: string;
  displayName: string;
  bankName: string | null;
  accountLast4: string | null;
  currency: string;
  isActive: boolean;
  createdAt: string;
}

export interface StatementSummary {
  id: string;
  accountId: string;
  accountName: string;
  fileName: string;
  status: StatementStatus;
  statementFrom: string | null;
  statementTo: string | null;
  pageCount: number;
  lineCount: number;
  pendingCount: number;
  readyCount: number;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  errorCount: number;
  withdrawalTotal: string;
  depositTotal: string;
  createdAt: string;
}

export interface StatementLineRow {
  id: string;
  pageNumber: number;
  rowNumber: number;
  txnDate: string | null;
  valueDate: string | null;
  narration: string | null;
  reference: string | null;
  /** Business-friendly description generated from narration; editable in review. */
  businessDescription?: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  closingBalance: string | null;
  direction: "deposit" | "withdrawal" | null;
  classification: Classification;
  status: LineStatus;
  flags: LineFlag[];
  errorCode: SafeErrorCode | null;
  /** Phase 3 review state. */
  fingerprint: string;
  clientId: string | null;
  categoryName: string | null;
  clientName: string | null;
  categoryId: number | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  skipReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  transactionId: string | null;
  importAttempt: number;
  /** True when the linked transaction exists and is live (not soft-deleted). */
  importLive: boolean;
}

export interface StatementDetail {
  statement: StatementSummary & {
    currency: string;
    fileSizeBytes: number;
    parserVersion: string | null;
    openingBalance: string | null;
    closingBalance: string | null;
    updatedAt: string;
  };
  account: BankAccountRow;
  lines: StatementLineRow[];
}

interface StatementRaw {
  id: string;
  accountId: string;
  accountName: string;
  fileName: string;
  status: string;
  statementFrom: string | null;
  statementTo: string | null;
  pageCount: number;
  lineCount: number | string;
  pendingCount: number | string;
  readyCount: number | string;
  importedCount?: number | string;
  skippedCount?: number | string;
  duplicateCount?: number | string;
  errorCount: number | string;
  withdrawalTotal: string | null;
  depositTotal: string | null;
  createdAt: string;
  updatedAt?: string;
  bankName?: string | null;
  accountLast4?: string | null;
  currency?: string;
  isActive?: boolean;
  fileSizeBytes?: number | string;
  parserVersion?: string | null;
  openingBalance?: string | null;
  closingBalance?: string | null;
  accountCreatedAt?: string;
}

interface StatementLineRaw
  extends Omit<
    StatementLineRow,
    | "flags"
    | "status"
    | "classification"
    | "direction"
    | "errorCode"
    | "categoryId"
    | "reviewedAt"
    | "importAttempt"
    | "importLive"
  > {
  flags: unknown;
  status: string;
  classification: string;
  direction: string | null;
  errorCode: string | null;
  categoryId: number | string | null;
  reviewedAt: string | null;
  importAttempt: number | string | null;
  importLive: boolean | null;
}

function mapSummary(raw: StatementRaw): StatementSummary {
  return {
    id: raw.id,
    accountId: raw.accountId,
    accountName: raw.accountName,
    fileName: raw.fileName,
    status: raw.status as StatementStatus,
    statementFrom: raw.statementFrom,
    statementTo: raw.statementTo,
    pageCount: Number(raw.pageCount) || 0,
    lineCount: Number(raw.lineCount) || 0,
    pendingCount: Number(raw.pendingCount) || 0,
    readyCount: Number(raw.readyCount) || 0,
    importedCount: Number(raw.importedCount ?? 0),
    skippedCount: Number(raw.skippedCount ?? 0),
    duplicateCount: Number(raw.duplicateCount ?? 0),
    errorCount: Number(raw.errorCount) || 0,
    withdrawalTotal: raw.withdrawalTotal ?? "0.00",
    depositTotal: raw.depositTotal ?? "0.00",
    createdAt: raw.createdAt,
  };
}

/** Saved bank accounts, newest first; names are unique among live accounts. */
export async function listBankAccounts(): Promise<BankAccountRow[]> {
  const rows = await db
    .select({
      id: bankAccounts.id,
      displayName: bankAccounts.displayName,
      bankName: bankAccounts.bankName,
      accountLast4: bankAccounts.accountLast4,
      currency: bankAccounts.currency,
      isActive: bankAccounts.isActive,
      createdAt: bankAccounts.createdAt,
    })
    .from(bankAccounts)
    .where(isNull(bankAccounts.deletedAt))
    .orderBy(desc(bankAccounts.createdAt), asc(bankAccounts.displayName));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString().slice(0, 10),
  }));
}

const STATEMENT_BASE_COLUMNS = sql`
    s.id,
    s.account_id AS "accountId",
    a.display_name AS "accountName",
    s.file_name AS "fileName",
    s.status,
    to_char(s.statement_from, 'YYYY-MM-DD') AS "statementFrom",
    to_char(s.statement_to, 'YYYY-MM-DD') AS "statementTo",
    s.page_count AS "pageCount",
    count(l.id)::int AS "lineCount",
    count(*) FILTER (WHERE l.status = 'pending')::int AS "pendingCount",
    count(*) FILTER (WHERE l.status = 'ready')::int AS "readyCount",
    count(*) FILTER (WHERE l.status = 'imported')::int AS "importedCount",
    count(*) FILTER (WHERE l.status = 'skipped')::int AS "skippedCount",
    count(*) FILTER (WHERE l.status = 'duplicate')::int AS "duplicateCount",
    count(*) FILTER (WHERE l.status = 'error')::int AS "errorCount",
    coalesce(sum(l.withdrawal_amount), 0)::numeric(18,2)::text AS "withdrawalTotal",
    coalesce(sum(l.deposit_amount), 0)::numeric(18,2)::text AS "depositTotal",
    to_char(s.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS "createdAt"
`;

const STATEMENT_FROM = sql`
  FROM bank_statements s
  JOIN bank_accounts a ON a.id = s.account_id
  LEFT JOIN bank_statement_lines l ON l.statement_id = s.id
`;

/** Live statement history. Failed submissions stay listed so the manager can see why. */
export async function listStatements(limit = 25): Promise<StatementSummary[]> {
  if (limit <= 0) return [];
  const result = await db.execute(sql`
    SELECT
      ${STATEMENT_BASE_COLUMNS}
    ${STATEMENT_FROM}
    GROUP BY s.id, a.display_name
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ${limit}
  `);
  return (result.rows as unknown as StatementRaw[]).map(mapSummary);
}

/** Read-only statement detail used by the review screen. */
export async function getStatementDetail(id: string): Promise<StatementDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

  const headResult = await db.execute(sql`
    SELECT
      ${STATEMENT_BASE_COLUMNS},
      a.bank_name AS "bankName",
      a.account_last4 AS "accountLast4",
      a.currency,
      a.is_active AS "isActive",
      to_char(a.created_at, 'YYYY-MM-DD') AS "accountCreatedAt",
      s.file_size_bytes AS "fileSizeBytes",
      s.parser_version AS "parserVersion",
      s.opening_balance::text AS "openingBalance",
      s.closing_balance::text AS "closingBalance",
      to_char(s.updated_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS "updatedAt"
    ${STATEMENT_FROM}
    WHERE s.id = ${id}::uuid
    GROUP BY s.id, a.id
    LIMIT 1
  `);
  const head = headResult.rows[0] as unknown as StatementRaw | undefined;
  if (!head) return null;

  const lineResult = await db.execute(sql`
    SELECT
      l.id,
      l.page_number AS "pageNumber",
      l.row_number AS "rowNumber",
      to_char(l.txn_date, 'YYYY-MM-DD') AS "txnDate",
      to_char(l.value_date, 'YYYY-MM-DD') AS "valueDate",
      l.narration,
      l.reference,
      l.business_description AS "businessDescription",
      l.withdrawal_amount::text AS "withdrawalAmount",
      l.deposit_amount::text AS "depositAmount",
      l.closing_balance::text AS "closingBalance",
      l.direction,
      l.classification,
      l.status,
      l.flags,
      l.error_code AS "errorCode",
      l.fingerprint,
      l.client_id AS "clientId",
      c.client_name AS "clientName",
      l.category_id AS "categoryId",
      cat.name AS "categoryName",
      l.skip_reason AS "skipReason",
      l.reviewed_by AS "reviewedBy",
      to_char(l.reviewed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS "reviewedAt",
      l.invoice_id AS "invoiceId",
      inv.number AS "invoiceNumber",
      l.import_attempt::int AS "importAttempt",
      l.transaction_id AS "transactionId",
      -- Review-workspace pointer state only: the review table needs to know
      -- whether the linked transaction is still live. Staging rows never join
      -- into dashboard, ledger, client, report, or export queries.
      (t.deleted_at IS NULL) AS "importLive"
    FROM bank_statement_lines l
    LEFT JOIN clients c ON c.client_id = l.client_id
    LEFT JOIN categories cat ON cat.id = l.category_id
    LEFT JOIN invoices inv ON inv.id = l.invoice_id
    LEFT JOIN transactions t ON t.id = l.transaction_id
    WHERE l.statement_id = ${id}::uuid
    ORDER BY l.page_number, l.row_number
  `);

  const lines = (lineResult.rows as unknown as StatementLineRaw[]).map<StatementLineRow>((line) => ({
    ...line,
    direction: line.direction as "deposit" | "withdrawal" | null,
    classification: line.classification as Classification,
    status: line.status as LineStatus,
    flags: Array.isArray(line.flags) ? (line.flags as LineFlag[]) : [],
    errorCode: (line.errorCode as SafeErrorCode | null) ?? null,
    categoryId: line.categoryId == null ? null : Number(line.categoryId),
    reviewedAt: line.reviewedAt ?? null,
    transactionId: line.transactionId ?? null,
    invoiceId: line.invoiceId ?? null,
    invoiceNumber: line.invoiceNumber ?? null,
    importAttempt: line.importAttempt == null ? 0 : Number(line.importAttempt),
    importLive: line.importLive == null ? false : Boolean(line.importLive),
    businessDescription: line.businessDescription ?? null,
  }));

  return {
    statement: {
      ...mapSummary(head),
      currency: head.currency ?? "INR",
      fileSizeBytes: Number(head.fileSizeBytes) || 0,
      parserVersion: head.parserVersion ?? null,
      openingBalance: head.openingBalance ?? null,
      closingBalance: head.closingBalance ?? null,
      updatedAt: head.updatedAt ?? head.createdAt,
    },
    account: {
      id: head.accountId,
      displayName: head.accountName,
      bankName: head.bankName ?? null,
      accountLast4: head.accountLast4 ?? null,
      currency: head.currency ?? "INR",
      isActive: head.isActive ?? true,
      createdAt: String(head.accountCreatedAt).slice(0, 10),
    },
    lines,
  };
}
