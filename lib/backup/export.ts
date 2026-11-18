/**
 * Export backup: every row of every finance table in one Excel workbook.
 *
 * Read-only. Money, dates, IDs and JSON are written as exact text; no display
 * formatting runs here. The workbook is self-describing so the importer can
 * verify the format, the row counts and a SHA-256 hash of the data.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import { canonicalDataHash, fileStamp, serializeCell, type NormalizedSheet } from "./format";
import { BACKUP_TABLES, columnsFor } from "./tables";
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, type BackupExportResult } from "./types";
import { buildBackupWorkbook } from "./xlsx";

const README = [
  "Website Vikreta Finance — full backup",
  "",
  "What this file is",
  "One text-lossless copy of every record in the finance database: members, clients, categories, transactions, recurring expenses, invoices and items, bank accounts, statements and statement rows, company profile, audit log and Finance AI sessions.",
  "",
  "How to restore",
  "Settings → Data → Import backup. Choose this .xlsx file. The import runs as one database transaction and only adds records that are missing from the target database. Existing records are never overwritten. A report shows what was added and how records were linked.",
  "",
  "What is not included",
  "Database connection strings and other environment secrets are never exported. Member sign-in hashes are included so member accounts survive a full restore; the primary admin password still comes from the server environment.",
  "",
  "Security",
  "This workbook contains company financial records, bank details and member password hashes. Store it somewhere private and access-controlled. Delete old copies you no longer need.",
  "",
  "Do not edit the data sheets",
  "Each sheet is a direct table export. Import validates headers and every value. If the file is edited, the integrity line in _meta reads modified; unreadable values are reported instead of guessed.",
];

export async function buildBackupExport(userId: string): Promise<BackupExportResult> {
  // One read-only repeatable-read snapshot. A write that lands mid-export
  // (for example an invoice and then its items) can never leave a torn backup.
  const snapshot = await db.transaction(
    async (tx) => {
      const [user] = await tx
        .select({ email: appUsers.email })
        .from(appUsers)
        .where(eq(appUsers.id, userId))
        .limit(1);

      const sheets: NormalizedSheet[] = [];
      const tableMeta: Array<{ sheet: string; label: string; rows: number; columns: number }> = [];
      const rowCounts: Record<string, number> = {};
      let totalRows = 0;

      for (const spec of BACKUP_TABLES) {
        const columns = columnsFor(spec);
        const rows = (await tx.select().from(spec.table)) as unknown as Record<string, unknown>[];

        const normalizedRows = rows
          .map((row) => columns.map((column) => serializeCell(column.kind, row[column.prop], column.scale)))
          .sort((left, right) => String(left[0] ?? "").localeCompare(String(right[0] ?? ""), "en"));

        sheets.push({
          sheet: spec.sheet,
          headers: columns.map((column) => column.name),
          rows: normalizedRows,
        });
        rowCounts[spec.sheet] = normalizedRows.length;
        tableMeta.push({
          sheet: spec.sheet,
          label: spec.label,
          rows: normalizedRows.length,
          columns: columns.length,
        });
        totalRows += normalizedRows.length;
      }

      return { sheets, tableMeta, rowCounts, totalRows, exportedBy: user?.email ?? userId };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );

  const exportedAt = new Date().toISOString();
  const dataHash = canonicalDataHash(snapshot.sheets);
  const meta: Record<string, string> = {
    format: BACKUP_FORMAT,
    formatVersion: String(BACKUP_FORMAT_VERSION),
    app: "finance.websitevikreta.com",
    exportedAt,
    exportedBy: snapshot.exportedBy,
    timeZone: "Asia/Kolkata",
    dataHash,
    rowCounts: JSON.stringify(snapshot.rowCounts),
    tables: JSON.stringify(snapshot.tableMeta),
    notes: "Text-lossless export. Import only adds records missing from the target database.",
  };

  const bytes = await buildBackupWorkbook({ meta, readme: README, sheets: snapshot.sheets });
  return {
    bytes,
    fileName: `finance-backup-${fileStamp()}.xlsx`,
    rowCount: snapshot.totalRows,
  };
}


