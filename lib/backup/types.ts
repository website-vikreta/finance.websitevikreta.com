/**
 * Shared backup types. Safe to import from client components (type-only).
 */

export const BACKUP_FORMAT = "website-vikreta-finance-backup";
export const BACKUP_FORMAT_VERSION = 1;

/** Upload cap for a backup workbook. The real finance database is far smaller. */
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
export const MAX_BACKUP_ROWS_PER_SHEET = 100_000;
export const MAX_BACKUP_ROWS_TOTAL = 250_000;

export type BackupIntegrity = "verified" | "modified";

export interface BackupIssue {
  sheet: string;
  /** Excel row number (1 = header) when the issue belongs to a row. */
  row: number | null;
  message: string;
}

export interface BackupTableReport {
  sheet: string;
  label: string;
  /** Rows added to the database. */
  inserted: number;
  /** Soft-deleted rows brought back because the backup has them live. */
  restored: number;
  /** Rows already present and live in the database, deliberately left untouched. */
  existing: number;
}

export interface BackupRelationReport {
  label: string;
  count: number;
}

export interface BackupImportReport {
  ok: boolean;
  dryRun: boolean;
  rolledBack: boolean;
  fileName: string;
  exportedAt: string | null;
  importedAt: string;
  durationMs: number;
  integrity: BackupIntegrity;
  formatVersion: number | null;
  message: string;
  totals: {
    inserted: number;
    restored: number;
    existing: number;
    tables: number;
  };
  tables: BackupTableReport[];
  relations: BackupRelationReport[];
  notes: string[];
  warnings: string[];
  errors: BackupIssue[];
}

export interface BackupExportResult {
  bytes: Uint8Array;
  fileName: string;
  rowCount: number;
}
