/**
 * Import backup: restore a workbook exported by lib/backup/export.ts.
 *
 * Rules:
 *  - One PostgreSQL transaction. Any failure rolls everything back.
 *  - Missing records are inserted with their original ids and relations.
 *  - Existing records are never overwritten. Natural-key matches are re-linked
 *    (a client matched by name, for example) so children point at the live row.
 *  - Empty company-profile/user fields may be completed, because that is how a
 *    full restore brings back the admin email, role and bank details.
 *  - A dry run performs the same work and always rolls back.
 */

import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { syncStatementForRestoredTransaction } from "@/lib/bank-import/statement-sync";
import {
  canonicalDataHash,
  normalizeCell,
  normalizeNameKey,
  validateHeaders,
  type NormalizedSheet,
} from "./format";
import {
  BACKUP_TABLES,
  columnsFor,
} from "./tables";
import { backupImportMessage } from "./report";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  MAX_BACKUP_BYTES,
  type BackupImportReport,
  type BackupIssue,
  type BackupTableReport,
} from "./types";
import { BackupFileError, readBackupWorkbook, type RawBackupWorkbook } from "./xlsx";
import { restoreTransactionRow } from "@/lib/transactions/manage";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ExistingUser = typeof schema.appUsers.$inferSelect;
type ExistingCategory = typeof schema.categories.$inferSelect;
type ExistingType = typeof schema.transactionTypes.$inferSelect;
type ExistingClient = typeof schema.clients.$inferSelect;
type ExistingRecurring = typeof schema.recurringExpenses.$inferSelect;
type ExistingInvoice = typeof schema.invoices.$inferSelect;
type ExistingTransaction = typeof schema.transactions.$inferSelect;
type ExistingBankAccount = typeof schema.bankAccounts.$inferSelect;

interface TableStat {
  inserted: number;
  restored: number;
  existing: number;
}

interface NormalizedRow {
  sheet: string;
  rowNumber: number;
  values: Record<string, string | null>;
}

interface ImportContext {
  tx: Tx;
  userId: string;
  stats: Map<string, TableStat>;
  linked: Map<string, number>;
  notes: Set<string>;
  warnings: Set<string>;
  maps: ExistingMaps;
}

interface ExistingMaps {
  users: Map<string, string>;
  usersByEmail: Map<string, string>;
  userRows: Map<string, ExistingUser>;
  categories: Map<string, string>;
  categoriesByName: Map<string, string>;
  categoryRows: Map<number, ExistingCategory>;
  types: Map<string, string>;
  typesByCode: Map<string, string>;
  typeRows: Map<number, ExistingType>;
  clients: Map<string, string>;
  clientRows: Map<string, ExistingClient>;
  clientsByNameActive: Map<string, string>;
  clientsByNameDeleted: Map<string, string>;
  recurring: Map<string, string>;
  recurringRows: Map<string, ExistingRecurring>;
  recurringBySignatureActive: Map<string, string>;
  recurringBySignatureDeleted: Map<string, string>;
  invoices: Map<string, string>;
  invoiceRows: Map<string, ExistingInvoice>;
  invoicesByNumber: Map<string, string>;
  invoicesByFySeq: Map<string, string>;
  invoiceItems: Map<string, string>;
  invoiceItemsByPosition: Map<string, string>;
  transactions: Map<string, string>;
  transactionRows: Map<string, ExistingTransaction>;
  transactionsByIdempotency: Map<string, string>;
  countedExistingTransactions: Set<string>;
  bankAccounts: Map<string, string>;
  bankAccountRows: Map<string, ExistingBankAccount>;
  bankAccountsByNameActive: Map<string, string>;
  bankAccountsByNameDeleted: Map<string, string>;
  statements: Map<string, string>;
  statementsBySha: Map<string, string>;
  lines: Map<string, string>;
  linesByPosition: Map<string, string>;
  linesByTransaction: Map<string, string>;
  auditIds: Set<string>;
  chatUserIds: Set<string>;
}

interface PreparedBackup {
  meta: Record<string, string>;
  sheets: Map<string, NormalizedRow[]>;
  normalized: NormalizedSheet[];
  warnings: string[];
  errors: BackupIssue[];
  exportedAt: string | null;
  formatVersion: number | null;
  integrity: "verified" | "modified";
}

class BackupRowError extends Error {
  constructor(
    readonly sheet: string,
    readonly rowNumber: number,
    message: string,
  ) {
    super(message);
    this.name = "BackupRowError";
  }
}

class DryRunComplete extends Error {
  constructor(readonly report: BackupImportReport) {
    super("dry run complete");
    this.name = "DryRunComplete";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

export async function importBackup(options: {
  bytes: Uint8Array;
  fileName: string;
  userId: string;
  dryRun?: boolean;
}): Promise<BackupImportReport> {
  const startedAt = Date.now();
  const fileName = options.fileName.replace(/[\\/\r\n"]/g, "_").slice(0, 160) || "backup.xlsx";
  const dryRun = options.dryRun === true;

  if (options.bytes.length > MAX_BACKUP_BYTES) {
    return failureReport({
      fileName,
      dryRun,
      durationMs: Date.now() - startedAt,
      integrity: "modified",
      formatVersion: null,
      exportedAt: null,
      message: "This file is larger than 25 MB. Export a fresh backup and try again.",
    });
  }

  let raw: RawBackupWorkbook;
  try {
    raw = await readBackupWorkbook(options.bytes);
  } catch (error) {
    const message = error instanceof BackupFileError ? error.message : "This backup could not be read.";
    return failureReport({
      fileName,
      dryRun,
      durationMs: Date.now() - startedAt,
      integrity: "modified",
      formatVersion: null,
      exportedAt: null,
      message,
    });
  }

  const prepared = prepareBackup(raw);
  if (prepared.errors.length) {
    return {
      ...failureReport({
        fileName,
        dryRun,
        durationMs: Date.now() - startedAt,
        integrity: prepared.integrity,
        formatVersion: prepared.formatVersion,
        exportedAt: prepared.exportedAt,
        message: "Nothing was imported. Fix the issues below and try again.",
        warnings: prepared.warnings,
      }),
      errors: prepared.errors,
    };
  }

  const stats = new Map<string, TableStat>();
  for (const spec of BACKUP_TABLES) stats.set(spec.sheet, { inserted: 0, restored: 0, existing: 0 });
  const linked = new Map<string, number>();
  const notes = new Set<string>();
  const warnings = new Set(prepared.warnings);

  let ctx: ImportContext | null = null;
  try {
    const report = await db.transaction(
      async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('finance.backup.import'))`);
        ctx = await loadContext(tx, options.userId, stats, linked, notes, warnings);

        await importUsers(ctx, prepared.sheets.get("app_users") ?? []);
        await importCategories(ctx, prepared.sheets.get("categories") ?? []);
        await importTransactionTypes(ctx, prepared.sheets.get("transaction_types") ?? []);
        await importClients(ctx, prepared.sheets.get("clients") ?? []);
        await importRecurring(ctx, prepared.sheets.get("recurring_expenses") ?? []);
        await importInvoices(ctx, prepared.sheets.get("invoices") ?? []);
        await importInvoiceItems(ctx, prepared.sheets.get("invoice_items") ?? []);
        await importTransactions(ctx, prepared.sheets.get("transactions") ?? []);
        await importBankAccounts(ctx, prepared.sheets.get("bank_accounts") ?? []);
        await importBankStatements(ctx, prepared.sheets.get("bank_statements") ?? []);
        await importBankStatementLines(ctx, prepared.sheets.get("bank_statement_lines") ?? []);
        await restoreDeadBankImports(ctx);
        await importCompanyProfile(ctx, prepared.sheets.get("company_profile") ?? []);
        await importAuditEvents(ctx, prepared.sheets.get("audit_events") ?? []);
        await importChatSessions(ctx, prepared.sheets.get("chat_sessions") ?? []);

        const result = buildReport({
          ctx,
          fileName,
          dryRun,
          startedAt,
          integrity: prepared.integrity,
          formatVersion: prepared.formatVersion,
          exportedAt: prepared.exportedAt,
        });

        if (dryRun) throw new DryRunComplete(result);

        await tx.insert(schema.auditEvents).values({
          entityType: "backup",
          entityId: randomUUID(),
          action: "restored",
          performedBy: options.userId,
          source: "manual",
          afterState: {
            fileName,
            formatVersion: prepared.formatVersion,
            integrity: prepared.integrity,
            inserted: result.totals.inserted,
            restored: result.totals.restored,
            existing: result.totals.existing,
            tables: result.tables.filter((table) => table.inserted > 0 || table.restored > 0),
          },
          metadata: { tool: "settings.import_backup" },
        });

        return result;
      },
      { isolationLevel: "repeatable read" },
    );

    return report;
  } catch (error) {
    if (error instanceof DryRunComplete) return error.report;

    if (error instanceof BackupRowError) {
      if (!ctx) return failureReport({ fileName, dryRun, durationMs: Date.now() - startedAt, integrity: prepared.integrity, formatVersion: prepared.formatVersion, exportedAt: prepared.exportedAt, message: "Nothing was imported. The transaction was rolled back." });
      const issue: BackupIssue = { sheet: error.sheet, row: error.rowNumber, message: error.message };
      return buildFailure(ctx, {
        fileName,
        dryRun,
        startedAt,
        integrity: prepared.integrity,
        formatVersion: prepared.formatVersion,
        exportedAt: prepared.exportedAt,
        issue,
      });
    }

    const code = safeErrorCode(error);
    console.error("[backup] import failed", code ?? "unknown");
    const message =
      code === "42P01"
        ? "The database is missing a table. Run the latest migrations, then import again. Nothing was changed."
        : code === "23505"
          ? "A record in this backup conflicts with a unique value in the database. Nothing was changed."
          : "The database rejected this backup. Nothing was changed. Export a fresh backup and try again.";

    if (!ctx) {
      return failureReport({ fileName, dryRun, durationMs: Date.now() - startedAt, integrity: prepared.integrity, formatVersion: prepared.formatVersion, exportedAt: prepared.exportedAt, message });
    }
    return buildFailure(ctx, {
      fileName,
      dryRun,
      startedAt,
      integrity: prepared.integrity,
      formatVersion: prepared.formatVersion,
      exportedAt: prepared.exportedAt,
      issue: { sheet: "backup", row: null, message },
    });
  }
}

function prepareBackup(raw: RawBackupWorkbook): PreparedBackup {
  const warnings: string[] = [];
  const errors: BackupIssue[] = [];
  const meta = raw.meta;
  const format = (meta.format ?? "").trim();
  const versionNumber = Number(meta.formatVersion);
  const formatVersion = Number.isInteger(versionNumber) ? versionNumber : null;
  const exportedAt = typeof meta.exportedAt === "string" && meta.exportedAt.trim() ? meta.exportedAt.trim() : null;

  if (format !== BACKUP_FORMAT) {
    errors.push({
      sheet: "_meta",
      row: null,
      message: "This is not a Finance backup. Use the .xlsx file downloaded from Settings → Export backup.",
    });
    return { meta, sheets: new Map(), normalized: [], warnings, errors, exportedAt, formatVersion, integrity: "modified" };
  }
  if (formatVersion === null || formatVersion < 1) {
    errors.push({ sheet: "_meta", row: null, message: "The backup format version is missing or invalid." });
    return { meta, sheets: new Map(), normalized: [], warnings, errors, exportedAt, formatVersion, integrity: "modified" };
  }
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    errors.push({
      sheet: "_meta",
      row: null,
      message: "This backup was made by a newer version of the app. Update the app before importing it.",
    });
    return { meta, sheets: new Map(), normalized: [], warnings, errors, exportedAt, formatVersion, integrity: "modified" };
  }

  const sheets = new Map<string, NormalizedRow[]>();
  const normalized: NormalizedSheet[] = [];

  for (const spec of BACKUP_TABLES) {
    const columns = columnsFor(spec);
    const expected = columns.map((column) => column.name);
    const sheet = raw.sheets.get(spec.sheet.toLowerCase());

    if (!sheet) {
      errors.push({ sheet: spec.sheet, row: null, message: `The "${spec.sheet}" sheet is missing. Use a full backup exported from Settings.` });
      continue;
    }

    const headerError = validateHeaders(expected, sheet.headers);
    if (headerError) {
      errors.push({ sheet: spec.sheet, row: 1, message: headerError });
      continue;
    }

    const headerIndex = new Map(sheet.headers.map((header, index) => [header.trim(), index]));
    const rows: NormalizedRow[] = [];

    for (const rawRow of sheet.rows) {
      if (errors.length >= 50) break;
      const values: Record<string, string | null> = {};
      let rowBroken = false;

      for (const column of columns) {
        const index = headerIndex.get(column.name);
        const rawValue = index === undefined ? null : rawRow.cells[index];
        try {
          values[column.prop] = normalizeCell(column.kind, rawValue, column.scale);
        } catch (error) {
          rowBroken = true;
          if (errors.length < 50) {
            errors.push({
              sheet: spec.sheet,
              row: rawRow.rowNumber,
              message: `${column.name}: ${error instanceof Error ? error.message : "Invalid value."}`,
            });
          }
        }
      }

      if (!rowBroken) rows.push({ sheet: spec.sheet, rowNumber: rawRow.rowNumber, values });
    }

    sheets.set(spec.sheet, rows);
    normalized.push({
      sheet: spec.sheet,
      headers: expected,
      rows: rows.map((row) => columns.map((column) => row.values[column.prop] ?? null)),
    });
  }

  let integrity: "verified" | "modified" = "modified";
  if (meta.dataHash) {
    integrity = canonicalDataHash(normalized) === meta.dataHash.trim() ? "verified" : "modified";
  }
  if (integrity === "modified") {
    warnings.push(
      meta.dataHash
        ? "The workbook changed after export (for example, it was re-saved in Excel). Every row was validated before import."
        : "This backup has no data hash. Every row was validated before import.",
    );
  }

  return { meta, sheets, normalized, warnings, errors, exportedAt, formatVersion, integrity };
}

async function loadContext(
  tx: Tx,
  userId: string,
  stats: Map<string, TableStat>,
  linked: Map<string, number>,
  notes: Set<string>,
  warnings: Set<string>,
): Promise<ImportContext> {
  const maps: ExistingMaps = {
    users: new Map(),
    usersByEmail: new Map(),
    userRows: new Map(),
    categories: new Map(),
    categoriesByName: new Map(),
    categoryRows: new Map(),
    types: new Map(),
    typesByCode: new Map(),
    typeRows: new Map(),
    clients: new Map(),
    clientRows: new Map(),
    clientsByNameActive: new Map(),
    clientsByNameDeleted: new Map(),
    recurring: new Map(),
    recurringRows: new Map(),
    recurringBySignatureActive: new Map(),
    recurringBySignatureDeleted: new Map(),
    invoices: new Map(),
    invoiceRows: new Map(),
    invoicesByNumber: new Map(),
    invoicesByFySeq: new Map(),
    invoiceItems: new Map(),
    invoiceItemsByPosition: new Map(),
    transactions: new Map(),
    transactionRows: new Map(),
    transactionsByIdempotency: new Map(),
    countedExistingTransactions: new Set(),
    bankAccounts: new Map(),
    bankAccountRows: new Map(),
    bankAccountsByNameActive: new Map(),
    bankAccountsByNameDeleted: new Map(),
    statements: new Map(),
    statementsBySha: new Map(),
    lines: new Map(),
    linesByPosition: new Map(),
    linesByTransaction: new Map(),
    auditIds: new Set(),
    chatUserIds: new Set(),
  };

  for (const user of await tx.select().from(schema.appUsers)) {
    maps.users.set(user.id, user.id);
    maps.userRows.set(user.id, user);
    if (user.email) maps.usersByEmail.set(user.email.toLowerCase(), user.id);
  }
  for (const category of await tx.select().from(schema.categories)) {
    maps.categories.set(String(category.id), String(category.id));
    maps.categoriesByName.set(normalizeNameKey(category.name), String(category.id));
    maps.categoryRows.set(category.id, category);
  }
  for (const type of await tx.select().from(schema.transactionTypes)) {
    maps.types.set(String(type.id), String(type.id));
    maps.typesByCode.set(type.code, String(type.id));
    maps.typeRows.set(type.id, type);
  }
  for (const client of await tx.select().from(schema.clients)) {
    maps.clients.set(client.clientId, client.clientId);
    maps.clientRows.set(client.clientId, client);
    const key = normalizeNameKey(client.clientName);
    if (client.deletedAt) {
      if (!maps.clientsByNameDeleted.has(key)) maps.clientsByNameDeleted.set(key, client.clientId);
    } else if (!maps.clientsByNameActive.has(key)) {
      maps.clientsByNameActive.set(key, client.clientId);
    }
  }
  for (const bill of await tx.select().from(schema.recurringExpenses)) {
    maps.recurring.set(bill.id, bill.id);
    maps.recurringRows.set(bill.id, bill);
    const key = recurringSignature(bill.description, String(bill.categoryId), bill.originalAmount, bill.originalCurrency, String(bill.anchorDay), bill.clientId);
    if (bill.deletedAt) {
      if (!maps.recurringBySignatureDeleted.has(key)) maps.recurringBySignatureDeleted.set(key, bill.id);
    } else if (!maps.recurringBySignatureActive.has(key)) {
      maps.recurringBySignatureActive.set(key, bill.id);
    }
  }
  for (const invoice of await tx.select().from(schema.invoices)) {
    maps.invoices.set(invoice.id, invoice.id);
    maps.invoiceRows.set(invoice.id, invoice);
    if (invoice.number) maps.invoicesByNumber.set(invoice.number, invoice.id);
    if (invoice.fy && invoice.seq !== null) maps.invoicesByFySeq.set(`${invoice.fy}:${invoice.seq}`, invoice.id);
  }
  for (const item of await tx.select().from(schema.invoiceItems)) {
    maps.invoiceItems.set(item.id, item.id);
    maps.invoiceItemsByPosition.set(`${item.invoiceId}:${item.position}`, item.id);
  }
  for (const txn of await tx.select().from(schema.transactions)) {
    maps.transactions.set(txn.id, txn.id);
    maps.transactionRows.set(txn.id, txn);
    maps.transactionsByIdempotency.set(txn.idempotencyKey, txn.id);
  }
  for (const account of await tx.select().from(schema.bankAccounts)) {
    maps.bankAccounts.set(account.id, account.id);
    maps.bankAccountRows.set(account.id, account);
    const key = normalizeNameKey(account.displayName);
    if (account.deletedAt) {
      if (!maps.bankAccountsByNameDeleted.has(key)) maps.bankAccountsByNameDeleted.set(key, account.id);
    } else if (!maps.bankAccountsByNameActive.has(key)) {
      maps.bankAccountsByNameActive.set(key, account.id);
    }
  }
  for (const statement of await tx.select().from(schema.bankStatements)) {
    maps.statements.set(statement.id, statement.id);
    // Mirrors uq_bank_statements_active_file_sha256: failed/cancelled rows do
    // not reserve their hash, so a good restore may insert the completed one.
    if (statement.status !== "failed" && statement.status !== "cancelled") {
      maps.statementsBySha.set(statement.fileSha256, statement.id);
    }
  }
  for (const line of await tx.select().from(schema.bankStatementLines)) {
    maps.lines.set(line.id, line.id);
    maps.linesByPosition.set(`${line.statementId}:${line.pageNumber}:${line.rowNumber}`, line.id);
    if (line.transactionId) maps.linesByTransaction.set(line.transactionId, line.id);
  }
  // Audit and chat rows have no natural key. Loading their keys here avoids
  // one failed INSERT round trip per already-present row (the previous audit
  // sheet alone cost ~30 seconds on a real 799-row backup).
  for (const event of await tx.select({ id: schema.auditEvents.id }).from(schema.auditEvents)) {
    maps.auditIds.add(event.id);
  }
  for (const chat of await tx.select({ userId: schema.chatSessions.userId }).from(schema.chatSessions)) {
    maps.chatUserIds.add(chat.userId);
  }

  return { tx, userId, stats, linked, notes, warnings, maps };
}

function buildReport(input: {
  ctx: ImportContext;
  fileName: string;
  dryRun: boolean;
  startedAt: number;
  integrity: "verified" | "modified";
  formatVersion: number | null;
  exportedAt: string | null;
}): BackupImportReport {
  const tables = tableReports(input.ctx.stats);
  const inserted = tables.reduce((sum, table) => sum + table.inserted, 0);
  const restored = tables.reduce((sum, table) => sum + table.restored, 0);
  const existing = tables.reduce((sum, table) => sum + table.existing, 0);
  const relations = [...input.ctx.linked.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const message = backupImportMessage({
    dryRun: input.dryRun,
    inserted,
    restored,
    existing,
  });

  return {
    ok: true,
    dryRun: input.dryRun,
    rolledBack: input.dryRun,
    fileName: input.fileName,
    exportedAt: input.exportedAt,
    importedAt: new Date().toISOString(),
    durationMs: Date.now() - input.startedAt,
    integrity: input.integrity,
    formatVersion: input.formatVersion,
    message,
    totals: { inserted, restored, existing, tables: tables.length },
    tables,
    relations,
    notes: [...input.ctx.notes],
    warnings: [...input.ctx.warnings],
    errors: [],
  };
}

function buildFailure(
  ctx: ImportContext,
  input: {
    fileName: string;
    dryRun: boolean;
    startedAt: number;
    integrity: "verified" | "modified";
    formatVersion: number | null;
    exportedAt: string | null;
    issue: BackupIssue;
  },
): BackupImportReport {
  const tables = tableReports(ctx.stats);
  const existing = tables.reduce((sum, table) => sum + table.existing, 0);
  return {
    ok: false,
    dryRun: input.dryRun,
    rolledBack: true,
    fileName: input.fileName,
    exportedAt: input.exportedAt,
    importedAt: new Date().toISOString(),
    durationMs: Date.now() - input.startedAt,
    integrity: input.integrity,
    formatVersion: input.formatVersion,
    message: "Nothing was imported. The transaction was rolled back.",
    totals: { inserted: 0, restored: 0, existing, tables: tables.length },
    tables: tables.map((table) => ({ ...table, inserted: 0, restored: 0 })),
    relations: [...ctx.linked.entries()].map(([label, count]) => ({ label, count })),
    notes: [...ctx.notes],
    warnings: [...ctx.warnings],
    errors: [input.issue],
  };
}

function failureReport(input: {
  fileName: string;
  dryRun: boolean;
  durationMs: number;
  integrity: "verified" | "modified";
  formatVersion: number | null;
  exportedAt: string | null;
  message: string;
  warnings?: string[];
  errorCode?: string;
}): BackupImportReport {
  return {
    ok: false,
    dryRun: input.dryRun,
    rolledBack: false,
    fileName: input.fileName,
    exportedAt: input.exportedAt,
    importedAt: new Date().toISOString(),
    durationMs: input.durationMs,
    integrity: input.integrity,
    formatVersion: input.formatVersion,
    message: input.message,
    totals: { inserted: 0, restored: 0, existing: 0, tables: 0 },
    tables: [],
    relations: [],
    notes: [],
    warnings: input.warnings ?? [],
    errors: [{ sheet: "backup", row: null, message: input.message }],
  };
}

function tableReports(stats: Map<string, TableStat>): BackupTableReport[] {
  return BACKUP_TABLES.map((spec) => {
    const stat = stats.get(spec.sheet) ?? { inserted: 0, restored: 0, existing: 0 };
    return { sheet: spec.sheet, label: spec.label, inserted: stat.inserted, restored: stat.restored, existing: stat.existing };
  });
}

function safeErrorCode(error: unknown): string | null {
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: { code?: unknown } }).cause?.code;
  return typeof cause === "string" ? cause : null;
}

// ─── Row helpers ────────────────────────────────────────────────────────────

function fail(row: NormalizedRow, field: string, message: string): never {
  throw new BackupRowError(row.sheet, row.rowNumber, `${field}: ${message}`);
}

function rawValue(row: NormalizedRow, prop: string): string | null {
  return row.values[prop] ?? null;
}

function text(row: NormalizedRow, prop: string): string | null {
  const value = rawValue(row, prop);
  return value === null ? null : value;
}

function trimmed(row: NormalizedRow, prop: string): string | null {
  const value = text(row, prop);
  if (value === null) return null;
  const result = value.trim();
  return result.length ? result : null;
}

function requiredTrimmed(row: NormalizedRow, prop: string, field = prop): string {
  const value = trimmed(row, prop);
  if (!value) fail(row, field, "is required.");
  return value;
}

function uuid(row: NormalizedRow, prop: string, field = prop, required = true): string | null {
  const value = required ? requiredTrimmed(row, prop, field) : trimmed(row, prop);
  if (value === null) return null;
  if (!UUID_RE.test(value)) fail(row, field, "is not a valid id.");
  return value.toLowerCase();
}

function timestamp(row: NormalizedRow, prop: string, fallback: Date | null = null): Date | null {
  const value = text(row, prop);
  if (value === null) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(row, prop, "is not a valid timestamp.");
  return date;
}

function dateText(row: NormalizedRow, prop: string, required = false): string | null {
  const value = text(row, prop);
  if (value === null && required) fail(row, prop, "is required.");
  return value;
}

function decimal(row: NormalizedRow, prop: string, required = false): string | null {
  const value = text(row, prop);
  if (value === null && required) fail(row, prop, "is required.");
  return value;
}

function booleanValue(row: NormalizedRow, prop: string, fallback: boolean | null = null): boolean | null {
  const value = text(row, prop);
  if (value === null) return fallback;
  return value === "true";
}

function jsonValue(row: NormalizedRow, prop: string, required = false): unknown {
  const value = text(row, prop);
  if (value === null) {
    if (required) fail(row, prop, "is required.");
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    fail(row, prop, "is not valid JSON.");
  }
}

function jsonArray(row: NormalizedRow, prop: string): string[] {
  const value = jsonValue(row, prop);
  if (value === null) return [];
  if (!Array.isArray(value)) fail(row, prop, "must be a JSON array.");
  return value.map((item) => String(item));
}

function oneOf(row: NormalizedRow, prop: string, allowed: readonly string[], fallback?: string): string {
  const value = trimmed(row, prop) ?? fallback ?? null;
  if (!value) fail(row, prop, "is required.");
  if (!allowed.includes(value)) {
    fail(row, prop, `must be one of ${allowed.join(", ")}.`);
  }
  return value;
}

function positiveDecimal(value: string): boolean {
  return !value.startsWith("-") && !/^0(?:\.0+)?$/.test(value);
}

function nonNegativeDecimal(value: string): boolean {
  return !value.startsWith("-");
}

function assertSha(row: NormalizedRow, prop: string, required = true): string | null {
  const value = required ? requiredTrimmed(row, prop) : trimmed(row, prop);
  if (value === null) return null;
  if (!SHA256_RE.test(value)) fail(row, prop, "must be a 64-character SHA-256 hash.");
  return value.toLowerCase();
}

function ref(
  ctx: ImportContext,
  row: NormalizedRow,
  map: Map<string, string>,
  value: string | null,
  label: string,
  field: string,
  required = false,
): string | null {
  if (value === null) {
    if (required) fail(row, field, `is required (linked ${label}).`);
    return null;
  }
  const key = value.trim();
  if (!key) {
    if (required) fail(row, field, `is required (linked ${label}).`);
    return null;
  }
  const mapped = map.get(key);
  if (!mapped) {
    fail(row, field, `references a ${label} that is missing from both this database and the backup.`);
  }
  if (mapped !== key) {
    ctx.linked.set(label, (ctx.linked.get(label) ?? 0) + 1);
  }
  return mapped;
}

function stat(ctx: ImportContext, sheet: string) {
  const value = ctx.stats.get(sheet);
  if (!value) throw new Error(`Unknown backup sheet ${sheet}`);
  return value;
}

/** One audit row for a soft-deleted record that a backup brought back. */
async function auditRestore(
  ctx: ImportContext,
  entityType: string,
  entityId: string,
  deletedAt: Date,
): Promise<void> {
  await ctx.tx.insert(schema.auditEvents).values({
    entityType,
    entityId,
    action: "restored",
    performedBy: ctx.userId,
    source: "manual",
    beforeState: { deleted_at: deletedAt.toISOString() },
    afterState: { deleted_at: null },
    metadata: { tool: "settings.import_backup" },
  });
}

function recurringSignature(
  description: string | null,
  categoryId: string,
  amount: string,
  currency: string,
  anchorDay: string,
  clientId: string | null,
): string {
  return [
    normalizeNameKey(description),
    categoryId,
    amount,
    currency,
    anchorDay,
    clientId ?? "",
  ].join("|");
}

function insertFail(row: NormalizedRow, description: string): never {
  fail(row, "id", `${description} changed while this import was running. Nothing was saved. Try again.`);
}

// ─── Import steps ───────────────────────────────────────────────────────────

async function importUsers(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "app_users");
  for (const row of rows) {
    const id = requiredTrimmed(row, "id");
    const email = trimmed(row, "email")?.toLowerCase() ?? null;
    const role = oneOf(row, "role", ["manager", "admin", "viewer"], "manager");
    const isActive = booleanValue(row, "isActive", true) ?? true;
    const passwordHash = text(row, "passwordHash");
    const createdAt = timestamp(row, "createdAt", new Date()) as Date;
    const updatedAt = timestamp(row, "updatedAt", createdAt) as Date;

    const existingId = ctx.maps.users.get(id) ?? (email ? ctx.maps.usersByEmail.get(email) : undefined);
    if (existingId) {
      ctx.maps.users.set(id, existingId);
      const existing = ctx.maps.userRows.get(existingId);
      if (existing) {
        const updates: Partial<typeof schema.appUsers.$inferInsert> = {};
        let completed = 0;
        if (!existing.email && email) {
          updates.email = email;
          completed += 1;
        }
        if (existingId === "admin" && role === "admin" && existing.role !== "admin") {
          updates.role = "admin";
          completed += 1;
        }
        if (!existing.passwordHash && passwordHash) {
          updates.passwordHash = passwordHash;
          completed += 1;
        }
        if (completed > 0) {
          await ctx.tx.update(schema.appUsers).set({ ...updates, updatedAt: new Date() }).where(eq(schema.appUsers.id, existingId));
          ctx.notes.add(`Completed ${completed} empty member detail${completed === 1 ? "" : "s"} from the backup.`);
        }
      }
      statRow.existing += 1;
      continue;
    }

    await ctx.tx.insert(schema.appUsers).values({
      id,
      email,
      role,
      isActive,
      passwordHash,
      createdAt,
      updatedAt,
    }).returning({ id: schema.appUsers.id });
    ctx.maps.users.set(id, id);
    ctx.maps.userRows.set(id, {
      id,
      email,
      role,
      isActive,
      passwordHash,
      createdAt,
      updatedAt,
    });
    if (email) ctx.maps.usersByEmail.set(email, id);
    statRow.inserted += 1;
  }
}

async function importCategories(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "categories");
  for (const row of rows) {
    const backupId = requiredTrimmed(row, "id");
    const name = requiredTrimmed(row, "name");
    const nameKey = normalizeNameKey(name);
    const createdAt = timestamp(row, "createdAt", new Date()) as Date;
    const numericId = Number(backupId);
    if (!Number.isInteger(numericId) || numericId <= 0) fail(row, "id", "is not a valid category id.");

    const byName = ctx.maps.categoriesByName.get(nameKey);
    if (byName) {
      ctx.maps.categories.set(backupId, byName);
      statRow.existing += 1;
      continue;
    }

    const currentId = ctx.maps.categories.get(backupId);
    const current = currentId ? ctx.maps.categoryRows.get(Number(currentId)) : undefined;
    const canUseId = !current;
    const values: typeof schema.categories.$inferInsert = {
      ...(canUseId ? { id: numericId } : {}),
      name,
      createdAt,
    };

    const [inserted] = await ctx.tx.insert(schema.categories).values(values).onConflictDoNothing().returning({ id: schema.categories.id });
    if (!inserted) insertFail(row, "The category list");

    ctx.maps.categories.set(backupId, String(inserted.id));
    ctx.maps.categories.set(String(inserted.id), String(inserted.id));
    ctx.maps.categoriesByName.set(nameKey, String(inserted.id));
    ctx.maps.categoryRows.set(inserted.id, { id: inserted.id, name, createdAt });
    statRow.inserted += 1;
  }

  if (statRow.inserted > 0) {
    await ctx.tx.execute(sql`select setval(pg_get_serial_sequence('categories', 'id'), coalesce((select max(id) from categories), 1), true)`);
  }
}

async function importTransactionTypes(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "transaction_types");
  for (const row of rows) {
    const id = Number(requiredTrimmed(row, "id"));
    if (!Number.isInteger(id) || id <= 0) fail(row, "id", "is not a valid transaction type id.");
    const code = requiredTrimmed(row, "code");
    const displayName = requiredTrimmed(row, "displayName");
    const description = text(row, "description");
    const createdAt = timestamp(row, "createdAt", new Date()) as Date;

    const byCode = ctx.maps.typesByCode.get(code);
    if (byCode) {
      ctx.maps.types.set(String(id), byCode);
      statRow.existing += 1;
      continue;
    }
    if (ctx.maps.types.get(String(id))) {
      fail(row, "id", `already belongs to transaction type "${ctx.maps.typeRows.get(id)?.code ?? id}".`);
    }

    await ctx.tx.insert(schema.transactionTypes).values({ id, code, displayName, description, createdAt });
    ctx.maps.types.set(String(id), String(id));
    ctx.maps.typesByCode.set(code, String(id));
    ctx.maps.typeRows.set(id, { id, code, displayName, description, createdAt });
    statRow.inserted += 1;
  }
}

async function importClients(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "clients");
  for (const row of rows) {
    const id = uuid(row, "clientId") as string;
    const name = requiredTrimmed(row, "clientName");
    const deletedAt = timestamp(row, "deletedAt");
    const deleted = Boolean(deletedAt);
    const nameKey = normalizeNameKey(name);

    const byId = ctx.maps.clients.get(id);
    const byIdRow = byId ? ctx.maps.clientRows.get(byId) : undefined;
    const byNameActive = ctx.maps.clientsByNameActive.get(nameKey);
    const byNameDeleted = ctx.maps.clientsByNameDeleted.get(nameKey);

    if (!deleted) {
      // Prefer a live record. A live namesake wins over restoring a deleted id,
      // so the active-name unique index can never be violated.
      const liveId = byIdRow && !byIdRow.deletedAt ? byId : byNameActive;
      if (liveId) {
        ctx.maps.clients.set(id, liveId);
        statRow.existing += 1;
        continue;
      }
      if (byId && byIdRow?.deletedAt) {
        await ctx.tx
          .update(schema.clients)
          .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
          .where(eq(schema.clients.clientId, byId));
        await auditRestore(ctx, "client", byId, byIdRow.deletedAt);
        ctx.maps.clients.set(id, byId);
        ctx.maps.clientRows.set(byId, { ...byIdRow, deletedAt: null, deletedBy: null, updatedAt: new Date() });
        ctx.maps.clientsByNameDeleted.delete(nameKey);
        ctx.maps.clientsByNameActive.set(nameKey, byId);
        statRow.restored += 1;
        continue;
      }
    } else {
      const existingId = byId ?? byNameDeleted;
      if (existingId) {
        ctx.maps.clients.set(id, existingId);
        statRow.existing += 1;
        continue;
      }
    }

    const createdAt = timestamp(row, "createdAt", new Date()) as Date;
    const updatedAt = timestamp(row, "updatedAt", createdAt) as Date;
    await ctx.tx.insert(schema.clients).values({
      clientId: id,
      clientName: name,
      email: trimmed(row, "email"),
      billingAddress: text(row, "billingAddress"),
      state: trimmed(row, "state"),
      country: trimmed(row, "country") ?? "India",
      gstin: trimmed(row, "gstin"),
      createdAt,
      updatedAt,
      deletedAt,
      deletedBy: ref(ctx, row, ctx.maps.users, trimmed(row, "deletedBy"), "member", "deletedBy"),
    }).returning({ id: schema.clients.clientId });

    ctx.maps.clients.set(id, id);
    if (!deleted) ctx.maps.clientsByNameActive.set(nameKey, id);
    else ctx.maps.clientsByNameDeleted.set(nameKey, id);
    statRow.inserted += 1;
  }
}

async function importRecurring(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "recurring_expenses");
  for (const row of rows) {
    const id = uuid(row, "id") as string;
    const description = requiredTrimmed(row, "description");
    const categoryId = ref(ctx, row, ctx.maps.categories, trimmed(row, "categoryId"), "category", "categoryId", true) as string;
    const originalAmount = decimal(row, "originalAmount", true) as string;
    if (!positiveDecimal(originalAmount)) fail(row, "originalAmount", "must be greater than zero.");
    const originalCurrency = oneOf(row, "originalCurrency", ["INR", "USD"]);
    const anchorDay = Number(requiredTrimmed(row, "anchorDay"));
    if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) fail(row, "anchorDay", "must be between 1 and 31.");
    const nextDue = dateText(row, "nextDue", true) as string;
    const paidThisPeriod = decimal(row, "paidThisPeriod") ?? "0.00";
    if (!nonNegativeDecimal(paidThisPeriod)) fail(row, "paidThisPeriod", "cannot be negative.");
    const isActive = booleanValue(row, "isActive", true) ?? true;
    const createdBy = ref(ctx, row, ctx.maps.users, trimmed(row, "createdBy"), "member", "createdBy", true) as string;
    const clientId = ref(ctx, row, ctx.maps.clients, trimmed(row, "clientId"), "client", "clientId");
    const endDate = dateText(row, "endDate");
    const deletedAt = timestamp(row, "deletedAt");

    const signature = recurringSignature(description, categoryId, originalAmount, originalCurrency, String(anchorDay), clientId);
    const byId = ctx.maps.recurring.get(id);
    const byIdRow = byId ? ctx.maps.recurringRows.get(byId) : undefined;
    const activeSignature = ctx.maps.recurringBySignatureActive.get(signature);
    const deletedSignature = ctx.maps.recurringBySignatureDeleted.get(signature);

    if (!deletedAt) {
      const liveId = byIdRow && !byIdRow.deletedAt ? byId : activeSignature;
      if (liveId) {
        ctx.maps.recurring.set(id, liveId);
        statRow.existing += 1;
        continue;
      }
      if (byId && byIdRow?.deletedAt) {
        await ctx.tx
          .update(schema.recurringExpenses)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(schema.recurringExpenses.id, byId));
        await auditRestore(ctx, "recurring_expense", byId, byIdRow.deletedAt);
        ctx.maps.recurring.set(id, byId);
        ctx.maps.recurringRows.set(byId, { ...byIdRow, deletedAt: null, updatedAt: new Date() });
        ctx.maps.recurringBySignatureDeleted.delete(signature);
        ctx.maps.recurringBySignatureActive.set(signature, byId);
        statRow.restored += 1;
        continue;
      }
    } else {
      const existingId = byId ?? deletedSignature;
      if (existingId) {
        ctx.maps.recurring.set(id, existingId);
        statRow.existing += 1;
        continue;
      }
    }

    const createdAt = timestamp(row, "createdAt", new Date()) as Date;
    const updatedAt = timestamp(row, "updatedAt", createdAt) as Date;
    await ctx.tx.insert(schema.recurringExpenses).values({
      id,
      description,
      categoryId: Number(categoryId),
      originalAmount,
      originalCurrency,
      anchorDay,
      nextDue,
      paidThisPeriod,
      isActive,
      createdBy,
      createdAt,
      updatedAt,
      endDate,
      clientId,
      deletedAt,
    }).returning({ id: schema.recurringExpenses.id });

    ctx.maps.recurring.set(id, id);
    if (!deletedAt) ctx.maps.recurringBySignatureActive.set(signature, id);
    else ctx.maps.recurringBySignatureDeleted.set(signature, id);
    statRow.inserted += 1;
  }
}

async function importInvoices(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "invoices");
  for (const row of rows) {
    const id = uuid(row, "id") as string;
    const status = oneOf(row, "status", ["draft", "sent", "void"]);
    const clientId = ref(ctx, row, ctx.maps.clients, uuid(row, "clientId", "clientId"), "client", "clientId", true) as string;
    const number = trimmed(row, "number");
    const fy = trimmed(row, "fy");
    const seqRaw = trimmed(row, "seq");
    const seq = seqRaw === null ? null : Number(seqRaw);
    if (seq !== null && (!Number.isInteger(seq) || seq <= 0)) fail(row, "seq", "must be a positive whole number.");
    const currency = oneOf(row, "currency", ["INR", "USD"]);
    const issueDate = dateText(row, "issueDate", true) as string;
    const dueDate = dateText(row, "dueDate", true) as string;
    if (dueDate < issueDate) fail(row, "dueDate", "cannot be before the issue date.");
    const taxType = oneOf(row, "taxType", ["cgst_sgst", "igst", "none"]);
    const gstRate = decimal(row, "gstRate", true) as string;
    if (!nonNegativeDecimal(gstRate)) fail(row, "gstRate", "cannot be negative.");
    const subtotal = decimal(row, "subtotal", true) as string;
    const total = decimal(row, "total", true) as string;
    if (!positiveDecimal(subtotal) || !positiveDecimal(total)) fail(row, "subtotal", "must be greater than zero.");
    const cgst = decimal(row, "cgst") ?? "0.00";
    const sgst = decimal(row, "sgst") ?? "0.00";
    const igst = decimal(row, "igst") ?? "0.00";
    const billToName = requiredTrimmed(row, "billToName");
    const createdBy = ref(ctx, row, ctx.maps.users, trimmed(row, "createdBy"), "member", "createdBy", true) as string;
    const deletedAt = timestamp(row, "deletedAt");

    if (status === "draft" && number !== null) fail(row, "number", "must be empty while the invoice is a draft.");
    if (status !== "draft" && number === null) fail(row, "number", "is required once an invoice is issued.");
    if (number !== null && number.length > 40) fail(row, "number", "is too long.");
    if (fy !== null && fy.length > 7) fail(row, "fy", "is too long.");

    const fyKey = fy && seq !== null ? `${fy}:${seq}` : null;
    const candidates = [
      ctx.maps.invoices.get(id),
      number ? ctx.maps.invoicesByNumber.get(number) : undefined,
      fyKey ? ctx.maps.invoicesByFySeq.get(fyKey) : undefined,
    ].filter((value): value is string => Boolean(value));

    if (!deletedAt) {
      const liveId = candidates.find((candidate) => !ctx.maps.invoiceRows.get(candidate)?.deletedAt);
      if (liveId) {
        ctx.maps.invoices.set(id, liveId);
        statRow.existing += 1;
        continue;
      }
      const restoreId = candidates[0];
      const restoreRow = restoreId ? ctx.maps.invoiceRows.get(restoreId) : undefined;
      if (restoreId && restoreRow?.deletedAt) {
        await ctx.tx
          .update(schema.invoices)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(schema.invoices.id, restoreId));
        await auditRestore(ctx, "invoice", restoreId, restoreRow.deletedAt);
        ctx.maps.invoices.set(id, restoreId);
        ctx.maps.invoiceRows.set(restoreId, { ...restoreRow, deletedAt: null, updatedAt: new Date() });
        if (number) ctx.maps.invoicesByNumber.set(number, restoreId);
        if (fyKey) ctx.maps.invoicesByFySeq.set(fyKey, restoreId);
        statRow.restored += 1;
        continue;
      }
    } else if (candidates.length > 0) {
      ctx.maps.invoices.set(id, candidates[0]);
      statRow.existing += 1;
      continue;
    }

    const createdAt = timestamp(row, "createdAt", new Date()) as Date;
    const updatedAt = timestamp(row, "updatedAt", createdAt) as Date;
    const seller = jsonValue(row, "seller");
    await ctx.tx.insert(schema.invoices).values({
      id,
      number,
      fy,
      seq,
      status,
      clientId,
      billToName,
      billToAddress: text(row, "billToAddress"),
      billToState: trimmed(row, "billToState"),
      billToCountry: trimmed(row, "billToCountry") ?? "India",
      billToGstin: trimmed(row, "billToGstin"),
      billToEmail: trimmed(row, "billToEmail"),
      currency,
      issueDate,
      dueDate,
      taxType,
      gstRate,
      subtotal,
      cgst,
      sgst,
      igst,
      total,
      notes: text(row, "notes"),
      terms: text(row, "terms"),
      seller,
      sentAt: timestamp(row, "sentAt"),
      voidedAt: timestamp(row, "voidedAt"),
      createdBy,
      createdAt,
      updatedAt,
      deletedAt,
    }).returning({ id: schema.invoices.id });

    ctx.maps.invoices.set(id, id);
    if (number) ctx.maps.invoicesByNumber.set(number, id);
    if (fyKey) ctx.maps.invoicesByFySeq.set(fyKey, id);
    statRow.inserted += 1;
  }
}

async function importInvoiceItems(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "invoice_items");
  for (const row of rows) {
    const id = uuid(row, "id") as string;
    const invoiceId = ref(ctx, row, ctx.maps.invoices, uuid(row, "invoiceId", "invoiceId"), "invoice", "invoiceId", true) as string;
    const position = Number(requiredTrimmed(row, "position"));
    if (!Number.isInteger(position) || position <= 0) fail(row, "position", "must be a positive whole number.");
    const description = requiredTrimmed(row, "description");
    const quantity = decimal(row, "quantity", true) as string;
    const rate = decimal(row, "rate", true) as string;
    const amount = decimal(row, "amount", true) as string;
    if (!positiveDecimal(quantity)) fail(row, "quantity", "must be greater than zero.");
    if (!nonNegativeDecimal(rate)) fail(row, "rate", "cannot be negative.");

    const positionKey = `${invoiceId}:${position}`;
    const existingId = ctx.maps.invoiceItems.get(id) ?? ctx.maps.invoiceItemsByPosition.get(positionKey);
    if (existingId) {
      ctx.maps.invoiceItems.set(id, existingId);
      statRow.existing += 1;
      continue;
    }

    await ctx.tx.insert(schema.invoiceItems).values({
      id,
      invoiceId,
      position,
      description,
      quantity,
      rate,
      amount,
    }).returning({ id: schema.invoiceItems.id });
    ctx.maps.invoiceItems.set(id, id);
    ctx.maps.invoiceItemsByPosition.set(positionKey, id);
    statRow.inserted += 1;
  }
}

async function importTransactions(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "transactions");
  const pending: Array<typeof schema.transactions.$inferInsert> = [];
  const flush = async () => {
    if (!pending.length) return;
    await ctx.tx.insert(schema.transactions).values(pending);
    statRow.inserted += pending.length;
    pending.length = 0;
  };

  for (const row of rows) {
    const id = uuid(row, "id") as string;
    const typeIdRaw = ref(ctx, row, ctx.maps.types, trimmed(row, "typeId"), "transaction type", "typeId", true) as string;
    const typeId = Number(typeIdRaw);
    const type = ctx.maps.typeRows.get(typeId);
    if (!type) fail(row, "typeId", "does not match a transaction type in this database.");
    const clientId = ref(ctx, row, ctx.maps.clients, uuid(row, "clientId", "clientId", false), "client", "clientId");
    const originalAmount = decimal(row, "originalAmount", true) as string;
    const amountInr = decimal(row, "amountInr", true) as string;
    if (!positiveDecimal(originalAmount) || !positiveDecimal(amountInr)) fail(row, "originalAmount", "must be greater than zero.");
    const currency = oneOf(row, "originalCurrency", ["INR", "USD"]);
    const exchangeRate = decimal(row, "exchangeRate");
    const exchangeRateDate = dateText(row, "exchangeRateDate");
    const rateSource = trimmed(row, "rateSource");
    if (currency === "INR") {
      if (exchangeRate !== null || exchangeRateDate !== null || rateSource !== null) fail(row, "exchangeRate", "must be empty for INR.");
      if (amountInr !== originalAmount) fail(row, "amountInr", "must equal the original amount for INR.");
    } else {
      if (!exchangeRate || !positiveDecimal(exchangeRate)) fail(row, "exchangeRate", "is required for USD.");
      if (!exchangeRateDate) fail(row, "exchangeRateDate", "is required for USD.");
      if (rateSource !== "manual") fail(row, "rateSource", "must be manual for USD.");
    }

    const description = text(row, "description");
    if (type.code === "income" && typeId !== 1) fail(row, "typeId", "income must map to transaction type 1 in this database.");
    if (type.code === "expense" && typeId !== 2) fail(row, "typeId", "expense must map to transaction type 2 in this database.");
    if (type.code === "income" && !clientId) fail(row, "clientId", "is required for income.");
    if (type.code === "expense" && (!description || !description.trim())) fail(row, "description", "is required for expenses.");
    const source = oneOf(row, "source", ["chatbot", "manual", "bank_import"]);
    oneOf(row, "status", ["confirmed"]);
    const txnDate = dateText(row, "txnDate", true) as string;
    const categoryId = ref(ctx, row, ctx.maps.categories, trimmed(row, "categoryId"), "category", "categoryId");
    const invoiceId = ref(ctx, row, ctx.maps.invoices, uuid(row, "invoiceId", "invoiceId", false), "invoice", "invoiceId");
    const recurringId = ref(ctx, row, ctx.maps.recurring, uuid(row, "recurringId", "recurringId", false), "recurring expense", "recurringId");
    const recurringDue = dateText(row, "recurringDue");
    const recurringSettled = booleanValue(row, "recurringSettled");
    if ((recurringId === null) !== (recurringDue === null) || (recurringId === null) !== (recurringSettled === null)) {
      fail(row, "recurringId", "must be set together with recurringDue and recurringSettled, or left empty together.");
    }
    const createdBy = ref(ctx, row, ctx.maps.users, trimmed(row, "createdBy"), "member", "createdBy", true) as string;
    const idempotencyKey = requiredTrimmed(row, "idempotencyKey");
    if (idempotencyKey.length > 255) fail(row, "idempotencyKey", "is too long.");
    const payloadHash = requiredTrimmed(row, "payloadHash");
    if (payloadHash.length > 64) fail(row, "payloadHash", "is too long.");
    const deletedAt = timestamp(row, "deletedAt");

    const existingId = ctx.maps.transactions.get(id) ?? ctx.maps.transactionsByIdempotency.get(idempotencyKey);
    if (existingId) {
      ctx.maps.transactions.set(id, existingId);
      const existingRow = ctx.maps.transactionRows.get(existingId);
      if (!deletedAt && existingRow?.deletedAt) {
        const restored = await restoreTransactionRow(ctx.tx, ctx.userId, existingId);
        if (!restored.ok) fail(row, "id", restored.error);
        ctx.maps.transactionRows.set(existingId, { ...existingRow, deletedAt: null, deletedBy: null });
        statRow.restored += 1;
      } else {
        statRow.existing += 1;
        ctx.maps.countedExistingTransactions.add(existingId);
      }
      continue;
    }

    const createdAt = timestamp(row, "createdAt", new Date()) as Date;
    const updatedAt = timestamp(row, "updatedAt", createdAt) as Date;
    const deletedBy = ref(ctx, row, ctx.maps.users, trimmed(row, "deletedBy"), "member", "deletedBy");
    const clientNameSnapshot = text(row, "clientNameSnapshot");
    const numericCategoryId = categoryId === null ? null : Number(categoryId);

    pending.push({
      id,
      typeId,
      clientId,
      clientNameSnapshot,
      originalAmount,
      originalCurrency: currency,
      amountInr,
      exchangeRate,
      exchangeRateDate,
      rateSource,
      description,
      categoryId: numericCategoryId,
      invoiceId,
      recurringId,
      recurringDue,
      recurringSettled,
      txnDate,
      source,
      status: "confirmed",
      idempotencyKey,
      payloadHash,
      createdBy,
      deletedAt,
      deletedBy,
      createdAt,
      updatedAt,
    });
    if (pending.length >= 250) await flush();

    ctx.maps.transactions.set(id, id);
    ctx.maps.transactionsByIdempotency.set(idempotencyKey, id);
    ctx.maps.transactionRows.set(id, {
      id,
      typeId,
      clientId,
      clientNameSnapshot,
      originalAmount,
      originalCurrency: currency,
      amountInr,
      exchangeRate,
      exchangeRateDate,
      rateSource,
      description,
      categoryId: numericCategoryId,
      invoiceId,
      recurringId,
      recurringDue,
      recurringSettled,
      txnDate,
      source,
      status: "confirmed",
      idempotencyKey,
      payloadHash,
      createdBy,
      deletedAt,
      deletedBy,
      createdAt,
      updatedAt,
    });
  }
  await flush();
}

async function importBankAccounts(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "bank_accounts");
  for (const row of rows) {
    const id = uuid(row, "id") as string;
    const displayName = requiredTrimmed(row, "displayName");
    const deletedAt = timestamp(row, "deletedAt");
    const nameKey = normalizeNameKey(displayName);
    const byId = ctx.maps.bankAccounts.get(id);
    const byIdRow = byId ? ctx.maps.bankAccountRows.get(byId) : undefined;
    const byNameActive = ctx.maps.bankAccountsByNameActive.get(nameKey);
    const byNameDeleted = ctx.maps.bankAccountsByNameDeleted.get(nameKey);

    if (!deletedAt) {
      const liveId = byIdRow && !byIdRow.deletedAt ? byId : byNameActive;
      if (liveId) {
        ctx.maps.bankAccounts.set(id, liveId);
        statRow.existing += 1;
        continue;
      }
      if (byId && byIdRow?.deletedAt) {
        await ctx.tx
          .update(schema.bankAccounts)
          .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
          .where(eq(schema.bankAccounts.id, byId));
        await auditRestore(ctx, "bank_account", byId, byIdRow.deletedAt);
        ctx.maps.bankAccounts.set(id, byId);
        ctx.maps.bankAccountRows.set(byId, { ...byIdRow, deletedAt: null, deletedBy: null, updatedAt: new Date() });
        ctx.maps.bankAccountsByNameDeleted.delete(nameKey);
        ctx.maps.bankAccountsByNameActive.set(nameKey, byId);
        statRow.restored += 1;
        continue;
      }
    } else {
      const existingId = byId ?? byNameDeleted;
      if (existingId) {
        ctx.maps.bankAccounts.set(id, existingId);
        statRow.existing += 1;
        continue;
      }
    }

    const last4 = trimmed(row, "accountLast4");
    if (last4 !== null && !/^\d{4}$/.test(last4)) fail(row, "accountLast4", "must be exactly 4 digits.");
    const currency = oneOf(row, "currency", ["INR", "USD"], "INR");
    const createdBy = ref(ctx, row, ctx.maps.users, trimmed(row, "createdBy"), "member", "createdBy", true) as string;
    const createdAt = timestamp(row, "createdAt", new Date()) as Date;
    const updatedAt = timestamp(row, "updatedAt", createdAt) as Date;
    await ctx.tx.insert(schema.bankAccounts).values({
      id,
      displayName,
      bankName: trimmed(row, "bankName"),
      accountLast4: last4,
      currency,
      isActive: booleanValue(row, "isActive", true) ?? true,
      createdBy,
      createdAt,
      updatedAt,
      deletedAt,
      deletedBy: ref(ctx, row, ctx.maps.users, trimmed(row, "deletedBy"), "member", "deletedBy"),
    }).returning({ id: schema.bankAccounts.id });

    ctx.maps.bankAccounts.set(id, id);
    if (deletedAt) ctx.maps.bankAccountsByNameDeleted.set(nameKey, id);
    else ctx.maps.bankAccountsByNameActive.set(nameKey, id);
    statRow.inserted += 1;
  }
}

async function importBankStatements(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "bank_statements");
  for (const row of rows) {
    const id = uuid(row, "id") as string;
    const accountId = ref(ctx, row, ctx.maps.bankAccounts, uuid(row, "accountId", "accountId"), "bank account", "accountId", true) as string;
    const fileName = requiredTrimmed(row, "fileName");
    const fileSha256 = assertSha(row, "fileSha256") as string;
    const fileSizeBytes = Number(requiredTrimmed(row, "fileSizeBytes"));
    const pageCount = Number(requiredTrimmed(row, "pageCount"));
    if (!Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0) fail(row, "fileSizeBytes", "must be greater than zero.");
    if (!Number.isInteger(pageCount) || pageCount <= 0) fail(row, "pageCount", "must be greater than zero.");
    const statementFrom = dateText(row, "statementFrom");
    const statementTo = dateText(row, "statementTo");
    if (statementFrom && statementTo && statementFrom > statementTo) fail(row, "statementTo", "cannot be before the start date.");
    const status = oneOf(row, "status", ["review", "importing", "completed", "failed", "cancelled"]);
    const createdBy = ref(ctx, row, ctx.maps.users, trimmed(row, "createdBy"), "member", "createdBy", true) as string;

    const existingId = ctx.maps.statements.get(id) ?? ctx.maps.statementsBySha.get(fileSha256);
    if (existingId) {
      ctx.maps.statements.set(id, existingId);
      statRow.existing += 1;
      continue;
    }

    const createdAt = timestamp(row, "createdAt", new Date()) as Date;
    const updatedAt = timestamp(row, "updatedAt", createdAt) as Date;
    await ctx.tx.insert(schema.bankStatements).values({
      id,
      accountId,
      fileName,
      fileSha256,
      fileSizeBytes,
      pageCount,
      statementFrom,
      statementTo,
      openingBalance: decimal(row, "openingBalance"),
      closingBalance: decimal(row, "closingBalance"),
      status,
      parserVersion: trimmed(row, "parserVersion"),
      errorCode: trimmed(row, "errorCode"),
      createdBy,
      createdAt,
      updatedAt,
      completedAt: timestamp(row, "completedAt"),
    }).returning({ id: schema.bankStatements.id });

    ctx.maps.statements.set(id, id);
    if (status !== "failed" && status !== "cancelled") {
      ctx.maps.statementsBySha.set(fileSha256, id);
    }
    statRow.inserted += 1;
  }
}

/**
 * Bank statement lines keep `status = imported` when the ledger row is deleted;
 * the statement page then shows "Import deleted". A backup import is meant to
 * make that data usable again, so restore every still-deleted transaction that
 * an imported staging row still owns. The shared transaction restore path also
 * redoes any recurring payment and re-completes the owning statement.
 */
async function restoreDeadBankImports(ctx: ImportContext): Promise<void> {
  const result = await ctx.tx.execute(sql`
    select distinct
      t.id as "id",
      t.deleted_at as "deletedAt",
      t.type_id as "typeId",
      t.recurring_id as "recurringId",
      t.recurring_due as "recurringDue",
      t.client_id as "clientId",
      t.client_name_snapshot as "clientNameSnapshot",
      l.statement_id as "statementId"
    from bank_statement_lines l
    join transactions t on t.id = l.transaction_id
    where l.status = 'imported' and t.deleted_at is not null
  `);
  interface DeadImport {
    id: string;
    deletedAt: Date;
    typeId: number;
    recurringId: string | null;
    recurringDue: string | null;
    clientId: string | null;
    clientNameSnapshot: string | null;
    statementId: string;
  }
  const rows = (result.rows as unknown as DeadImport[]).filter((row) => Boolean(row.id));
  if (!rows.length) return;

  const byTransaction = new Map<string, DeadImport>();
  const statements = new Map<string, string>();
  for (const row of rows) {
    if (!byTransaction.has(row.id)) byTransaction.set(row.id, row);
    if (!statements.has(row.statementId)) statements.set(row.statementId, row.id);
  }

  const simple: DeadImport[] = [];
  const full: DeadImport[] = [];
  for (const row of byTransaction.values()) {
    const nameKey = row.clientNameSnapshot ? normalizeNameKey(row.clientNameSnapshot) : "";
    const activeClient = nameKey ? ctx.maps.clientsByNameActive.get(nameKey) : undefined;
    const needsClientRelink = row.typeId === 1 && Boolean(row.clientNameSnapshot) && activeClient !== row.clientId;
    if (row.recurringId || row.recurringDue || needsClientRelink) full.push(row);
    else simple.push(row);
  }

  let restored = 0;
  const failures: string[] = [];
  const statRow = stat(ctx, "transactions");
  const markRestored = (id: string) => {
    const row = ctx.maps.transactionRows.get(id);
    if (row) ctx.maps.transactionRows.set(id, { ...row, deletedAt: null, deletedBy: null });
    // A deleted transaction that was already present was counted as "existing"
    // earlier in the import. It is now restored, so move the count across.
    if (ctx.maps.countedExistingTransactions.delete(id)) statRow.existing = Math.max(0, statRow.existing - 1);
    statRow.restored += 1;
    restored += 1;
  };

  if (simple.length > 0) {
    await ctx.tx
      .update(schema.transactions)
      .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
      .where(inArray(schema.transactions.id, simple.map((row) => row.id)));
    await ctx.tx.insert(schema.auditEvents).values(
      simple.map((row) => ({
        entityType: "transaction",
        entityId: row.id,
        action: "restored",
        performedBy: ctx.userId,
        source: "manual",
        beforeState: { deleted_at: row.deletedAt instanceof Date ? row.deletedAt.toISOString() : String(row.deletedAt) },
        afterState: { deleted_at: null, client_id: row.clientId },
        metadata: { tool: "settings.import_backup", via: "bank_import_restore" },
      })),
    );
    for (const row of simple) markRestored(row.id);
  }

  for (const row of full) {
    const outcome = await restoreTransactionRow(ctx.tx, ctx.userId, row.id);
    if (!outcome.ok) {
      failures.push(outcome.error ?? "unknown error");
      continue;
    }
    markRestored(row.id);
  }

  // One statement sync after every row is live: it sees the final line states
  // and can complete a statement that previously showed "Import deleted".
  for (const transactionId of statements.values()) {
    await syncStatementForRestoredTransaction(ctx.tx, ctx.userId, transactionId);
  }

  if (restored > 0) {
    ctx.notes.add(
      `Restored ${restored} bank-imported transaction${restored === 1 ? "" : "s"} that the ledger still marked deleted.`,
    );
  }
  if (failures.length > 0) {
    ctx.warnings.add(
      `${failures.length} bank-imported transaction${failures.length === 1 ? " was" : "s were"} left deleted: ${failures[0]}`,
    );
  }
}

async function importBankStatementLines(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "bank_statement_lines");
  const pending: Array<typeof schema.bankStatementLines.$inferInsert> = [];
  const flush = async () => {
    if (!pending.length) return;
    await ctx.tx.insert(schema.bankStatementLines).values(pending);
    statRow.inserted += pending.length;
    pending.length = 0;
  };

  for (const row of rows) {
    const id = uuid(row, "id") as string;
    const statementId = ref(ctx, row, ctx.maps.statements, uuid(row, "statementId", "statementId"), "statement", "statementId", true) as string;
    const pageNumber = Number(requiredTrimmed(row, "pageNumber"));
    const rowNumber = Number(requiredTrimmed(row, "rowNumber"));
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) fail(row, "pageNumber", "must be a positive whole number.");
    if (!Number.isInteger(rowNumber) || rowNumber <= 0) fail(row, "rowNumber", "must be a positive whole number.");
    const status = oneOf(row, "status", ["pending", "ready", "imported", "skipped", "duplicate", "error"]);
    const classification = oneOf(row, "classification", ["unclassified", "income", "expense", "transfer", "refund", "reversal", "other", "non_business"]);
    const direction = trimmed(row, "direction");
    if (direction !== null && !["deposit", "withdrawal"].includes(direction)) fail(row, "direction", "must be deposit or withdrawal.");
    const fingerprint = assertSha(row, "fingerprint") as string;
    const flags = jsonArray(row, "flags");
    const withdrawal = decimal(row, "withdrawalAmount");
    const deposit = decimal(row, "depositAmount");
    const narration = text(row, "narration");
    const txnDate = dateText(row, "txnDate");
    const transactionId = ref(ctx, row, ctx.maps.transactions, uuid(row, "transactionId", "transactionId", false), "transaction", "transactionId");
    const importedAt = timestamp(row, "importedAt");
    const importAttempt = Number(requiredTrimmed(row, "importAttempt"));
    if (!Number.isInteger(importAttempt) || importAttempt < 0) fail(row, "importAttempt", "must be zero or a positive whole number.");

    if (withdrawal !== null && !positiveDecimal(withdrawal) && !(status === "pending" && flags.includes(withdrawal.startsWith("-") ? "NEGATIVE_AMOUNT" : "ZERO_AMOUNT"))) {
      fail(row, "withdrawalAmount", "a non-positive amount must be a pending row with the matching flag.");
    }
    if (deposit !== null && !positiveDecimal(deposit) && !(status === "pending" && flags.includes(deposit.startsWith("-") ? "NEGATIVE_AMOUNT" : "ZERO_AMOUNT"))) {
      fail(row, "depositAmount", "a non-positive amount must be a pending row with the matching flag.");
    }
    if (status === "ready") {
      if (!txnDate) fail(row, "txnDate", "is required for a ready row.");
      if (!narration || !narration.trim()) fail(row, "narration", "is required for a ready row.");
      if ((withdrawal === null) === (deposit === null)) fail(row, "withdrawalAmount", "exactly one amount is required for a ready row.");
      if (withdrawal !== null && !positiveDecimal(withdrawal)) fail(row, "withdrawalAmount", "must be greater than zero for a ready row.");
      if (deposit !== null && !positiveDecimal(deposit)) fail(row, "depositAmount", "must be greater than zero for a ready row.");
    }
    if (status === "imported") {
      if (!transactionId) fail(row, "transactionId", "is required for an imported row.");
      if (!importedAt) fail(row, "importedAt", "is required for an imported row.");
    } else if (transactionId !== null) {
      fail(row, "transactionId", "must be empty unless the row is imported.");
    }

    const positionKey = `${statementId}:${pageNumber}:${rowNumber}`;
    const existingId =
      ctx.maps.lines.get(id) ??
      ctx.maps.linesByPosition.get(positionKey) ??
      (transactionId ? ctx.maps.linesByTransaction.get(transactionId) : undefined);
    if (existingId) {
      ctx.maps.lines.set(id, existingId);
      statRow.existing += 1;
      continue;
    }

    const createdAt = timestamp(row, "createdAt", new Date()) as Date;
    const updatedAt = timestamp(row, "updatedAt", createdAt) as Date;
    const clientId = ref(ctx, row, ctx.maps.clients, uuid(row, "clientId", "clientId", false), "client", "clientId");
    const categoryId = ref(ctx, row, ctx.maps.categories, trimmed(row, "categoryId"), "category", "categoryId");
    const invoiceId = ref(ctx, row, ctx.maps.invoices, uuid(row, "invoiceId", "invoiceId", false), "invoice", "invoiceId");
    const importedCategoryId = ref(ctx, row, ctx.maps.categories, trimmed(row, "importedCategoryId"), "category", "importedCategoryId");
    const reviewedBy = ref(ctx, row, ctx.maps.users, trimmed(row, "reviewedBy"), "member", "reviewedBy");

    pending.push({
      id,
      statementId,
      pageNumber,
      rowNumber,
      txnDate,
      valueDate: dateText(row, "valueDate"),
      narration,
      reference: trimmed(row, "reference"),
      businessDescription: text(row, "businessDescription"),
      withdrawalAmount: withdrawal,
      depositAmount: deposit,
      closingBalance: decimal(row, "closingBalance"),
      direction,
      classification,
      status,
      clientId,
      categoryId: categoryId === null ? null : Number(categoryId),
      invoiceId,
      transactionId,
      importedPayloadHash: trimmed(row, "importedPayloadHash"),
      importedCategoryId: importedCategoryId === null ? null : Number(importedCategoryId),
      importAttempt,
      fingerprint,
      flags,
      errorCode: trimmed(row, "errorCode"),
      skipReason: trimmed(row, "skipReason"),
      reviewedBy,
      reviewedAt: timestamp(row, "reviewedAt"),
      importedAt,
      createdAt,
      updatedAt,
    });
    if (pending.length >= 250) await flush();

    ctx.maps.lines.set(id, id);
    ctx.maps.linesByPosition.set(positionKey, id);
    if (transactionId) ctx.maps.linesByTransaction.set(transactionId, id);
  }
  await flush();
}

async function importCompanyProfile(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  if (!rows.length) return;
  if (rows.length > 1) ctx.warnings.add("The company profile sheet had more than one row; only the first was used.");
  const row = rows[0];
  const statRow = stat(ctx, "company_profile");
  const fields = [
    "legalName",
    "address",
    "state",
    "gstin",
    "pan",
    "email",
    "phone",
    "bankName",
    "accountName",
    "accountNumber",
    "ifsc",
    "swiftCode",
    "upiId",
    "invoicePrefix",
    "defaultGstRate",
    "defaultTerms",
  ] as const;

  const legalName = requiredTrimmed(row, "legalName");
  const address = requiredTrimmed(row, "address");
  const state = requiredTrimmed(row, "state");
  const updatedBy = ref(ctx, row, ctx.maps.users, trimmed(row, "updatedBy"), "member", "updatedBy");

  const [existing] = await ctx.tx.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)).limit(1);
  if (existing) {
    const changes: Record<string, string> = {};
    for (const field of fields) {
      const current = existing[field];
      const incoming = field === "defaultGstRate" ? decimal(row, field) : text(row, field);
      if ((current === null || current === "") && incoming !== null && incoming !== "") {
        changes[field] = incoming;
      }
    }
    if (Object.keys(changes).length) {
      await ctx.tx.update(schema.companyProfile).set({ ...changes, updatedBy: ctx.userId, updatedAt: new Date() } as Partial<typeof schema.companyProfile.$inferInsert>).where(eq(schema.companyProfile.id, 1));
      ctx.notes.add(`Filled ${Object.keys(changes).length} empty company profile field${Object.keys(changes).length === 1 ? "" : "s"} from the backup.`);
      await ctx.tx.insert(schema.auditEvents).values({
        entityType: "company_profile",
        entityId: "1",
        action: "merged_from_backup",
        performedBy: ctx.userId,
        source: "manual",
        afterState: { filledFields: Object.keys(changes) },
        metadata: { tool: "settings.import_backup" },
      });
    }
    statRow.existing += 1;
    return;
  }

  const createdAt = timestamp(row, "updatedAt", new Date()) as Date;
  await ctx.tx.insert(schema.companyProfile).values({
    id: 1,
    legalName,
    address,
    state,
    gstin: trimmed(row, "gstin"),
    pan: trimmed(row, "pan"),
    email: trimmed(row, "email"),
    phone: trimmed(row, "phone"),
    bankName: trimmed(row, "bankName"),
    accountName: trimmed(row, "accountName"),
    accountNumber: trimmed(row, "accountNumber"),
    ifsc: trimmed(row, "ifsc"),
    swiftCode: trimmed(row, "swiftCode"),
    upiId: trimmed(row, "upiId"),
    invoicePrefix: trimmed(row, "invoicePrefix") ?? "WV",
    defaultGstRate: decimal(row, "defaultGstRate") ?? "18.00",
    defaultTerms: text(row, "defaultTerms"),
    updatedBy: updatedBy ?? ctx.userId,
    updatedAt: createdAt,
  }).returning({ id: schema.companyProfile.id });
  statRow.inserted += 1;
}

async function importAuditEvents(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "audit_events");
  const pending: Array<typeof schema.auditEvents.$inferInsert> = [];

  const flush = async () => {
    if (!pending.length) return;
    const inserted = await ctx.tx
      .insert(schema.auditEvents)
      .values(pending)
      .onConflictDoNothing()
      .returning({ id: schema.auditEvents.id });
    statRow.inserted += inserted.length;
    statRow.existing += pending.length - inserted.length;
    pending.length = 0;
  };

  for (const row of rows) {
    const id = uuid(row, "id") as string;
    if (ctx.maps.auditIds.has(id)) {
      statRow.existing += 1;
      continue;
    }
    const entityType = requiredTrimmed(row, "entityType");
    const entityId = requiredTrimmed(row, "entityId");
    const action = requiredTrimmed(row, "action");
    const source = requiredTrimmed(row, "source");
    const performedBy = ref(ctx, row, ctx.maps.users, trimmed(row, "performedBy"), "member", "performedBy", true) as string;
    const createdAt = timestamp(row, "createdAt", new Date()) as Date;

    ctx.maps.auditIds.add(id);
    pending.push({
      id,
      entityType,
      entityId,
      action,
      performedBy,
      source,
      beforeState: jsonValue(row, "beforeState"),
      afterState: jsonValue(row, "afterState"),
      metadata: jsonValue(row, "metadata"),
      createdAt,
    });
    if (pending.length >= 250) await flush();
  }
  await flush();
}

async function importChatSessions(ctx: ImportContext, rows: NormalizedRow[]): Promise<void> {
  const statRow = stat(ctx, "chat_sessions");
  for (const row of rows) {
    const userId = ref(ctx, row, ctx.maps.users, trimmed(row, "userId"), "member", "userId", true) as string;
    if (ctx.maps.chatUserIds.has(userId)) {
      statRow.existing += 1;
      continue;
    }
    const draft = jsonValue(row, "draft", true);
    const session = jsonValue(row, "session", true);
    const updatedAt = timestamp(row, "updatedAt", new Date()) as Date;
    const [inserted] = await ctx.tx.insert(schema.chatSessions).values({
      userId,
      draft,
      session,
      updatedAt,
    }).onConflictDoNothing().returning({ userId: schema.chatSessions.userId });
    if (inserted) {
      ctx.maps.chatUserIds.add(userId);
      statRow.inserted += 1;
    } else {
      statRow.existing += 1;
    }
  }
}
