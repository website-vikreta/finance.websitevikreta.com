/**
 * Thin ExcelJS boundary. Everything else in lib/backup works with plain text
 * rows, so the workbook format (and the dependency) stays replaceable.
 *
 * The workbook is server-only: routes load it lazily inside lib/backup/xlsx.ts.
 */

import type { Workbook, Worksheet } from "exceljs";
import {
  MAX_BACKUP_ROWS_PER_SHEET,
  MAX_BACKUP_ROWS_TOTAL,
} from "./types";
import type { NormalizedSheet } from "./format";

type ExcelJSModule = typeof import("exceljs");

/** ExcelJS is CommonJS; tsx and webpack expose it differently. Accept both. */
async function loadExcelJS(): Promise<ExcelJSModule> {
  const loaded = (await import("exceljs")) as ExcelJSModule & { default?: ExcelJSModule };
  return loaded.default ?? loaded;
}

export class BackupFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFileError";
  }
}

export interface RawBackupSheet {
  sheet: string;
  headers: string[];
  rows: Array<{ rowNumber: number; cells: unknown[] }>;
}

export interface RawBackupWorkbook {
  meta: Record<string, string>;
  sheets: Map<string, RawBackupSheet>;
}

export interface BuildWorkbookInput {
  meta: Record<string, string>;
  readme: string[];
  sheets: NormalizedSheet[];
}

export async function buildBackupWorkbook(input: BuildWorkbookInput): Promise<Uint8Array> {
  const ExcelJS = await loadExcelJS();
  const workbook: Workbook = new ExcelJS.Workbook();
  workbook.creator = "Website Vikreta Finance";
  workbook.lastModifiedBy = "Website Vikreta Finance";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = false;

  const meta = workbook.addWorksheet("_meta", { properties: { defaultColWidth: 28 } });
  meta.addRow(["Key", "Value"]);
  for (const [key, value] of Object.entries(input.meta)) meta.addRow([key, value]);
  styleHeader(meta, 2);
  meta.getColumn(1).width = 24;
  meta.getColumn(2).width = 64;

  const readme = workbook.addWorksheet("_readme", { properties: { defaultColWidth: 96 } });
  for (const line of input.readme) readme.addRow([line]);
  readme.getColumn(1).width = 110;
  readme.getRow(1).font = { bold: true };

  for (const sheet of input.sheets) {
    const worksheet = workbook.addWorksheet(sheet.sheet, { properties: { defaultColWidth: 20 } });
    worksheet.addRow(sheet.headers);
    for (const row of sheet.rows) {
      const added = worksheet.addRow(row);
      added.eachCell({ includeEmpty: false }, (cell) => {
        // Text format keeps ISO dates, IDs, leading zeros and decimals exactly
        // as stored. Excel may still convert a cell when a person edits it;
        // import validates every value and never silently rounds.
        cell.numFmt = "@";
      });
    }
    styleHeader(worksheet, sheet.headers.length);
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    for (let index = 1; index <= sheet.headers.length; index += 1) {
      const header = sheet.headers[index - 1] ?? "";
      worksheet.getColumn(index).width = Math.min(48, Math.max(14, header.length + 4));
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

function styleHeader(worksheet: Worksheet, columnCount: number): void {
  const row = worksheet.getRow(1);
  row.font = { bold: true };
  row.height = 20;
  if (columnCount > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columnCount },
    };
  }
}

export async function readBackupWorkbook(bytes: Uint8Array): Promise<RawBackupWorkbook> {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new BackupFileError("This file is not an Excel workbook. Choose the .xlsx file downloaded from Export backup.");
  }

  const ExcelJS = await loadExcelJS();
  const workbook: Workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as never);
  } catch {
    throw new BackupFileError("This Excel workbook could not be read. It may be damaged or password-protected.");
  }

  const metaSheet = findSheet(workbook, "_meta");
  if (!metaSheet) {
    throw new BackupFileError("This is not a Finance backup file. Use the .xlsx file downloaded from Settings → Export backup.");
  }

  const meta = readKeyValueSheet(metaSheet);
  const sheets = new Map<string, RawBackupSheet>();
  let totalRows = 0;

  for (const worksheet of workbook.worksheets) {
    const name = worksheet.name.trim();
    if (name.startsWith("_")) continue;
    const headers = readHeaders(worksheet);
    if (!headers.length) continue;
    if (worksheet.rowCount - 1 > MAX_BACKUP_ROWS_PER_SHEET) {
      throw new BackupFileError(`The "${name}" sheet has too many rows. The limit is ${MAX_BACKUP_ROWS_PER_SHEET.toLocaleString("en-IN")}.`);
    }

    const rows: RawBackupSheet["rows"] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const cells: unknown[] = [];
      let hasValue = false;
      for (let column = 1; column <= headers.length; column += 1) {
        const value = unwrapCell(row.getCell(column).value);
        cells.push(value);
        if (value !== null && value !== undefined && String(value).trim() !== "") hasValue = true;
      }
      if (!hasValue) continue;
      rows.push({ rowNumber, cells });
      totalRows += 1;
      if (totalRows > MAX_BACKUP_ROWS_TOTAL) {
        throw new BackupFileError("This backup has too many rows to import at once. Split it into smaller exports.");
      }
    }

    sheets.set(name.toLowerCase(), { sheet: name, headers, rows });
  }

  return { meta, sheets };
}

function findSheet(workbook: Workbook, name: string): Worksheet | undefined {
  return workbook.worksheets.find((worksheet) => worksheet.name.trim().toLowerCase() === name.toLowerCase());
}

function readHeaders(worksheet: Worksheet): string[] {
  const row = worksheet.getRow(1);
  const headers: string[] = [];
  const lastCell = Math.max(row.cellCount, worksheet.columnCount);
  for (let column = 1; column <= lastCell; column += 1) {
    headers.push(String(unwrapCell(row.getCell(column).value) ?? "").trim());
  }
  // Trim trailing empty columns created by formatting.
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  return headers;
}

function readKeyValueSheet(worksheet: Worksheet): Record<string, string> {
  const meta: Record<string, string> = {};
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const key = String(unwrapCell(row.getCell(1).value) ?? "").trim();
    if (!key || key.toLowerCase() === "key") continue;
    const value = unwrapCell(row.getCell(2).value);
    meta[key] = value === null || value === undefined ? "" : String(value);
  }
  return meta;
}

/**
 * ExcelJS can return rich text, hyperlink and formula wrappers. Backups only
 * need the underlying value; formulas are read as their cached result, never
 * executed.
 */
function unwrapCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  if ("result" in record) return record.result ?? null;
  if (Array.isArray(record.richText)) {
    return record.richText
      .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
      .join("");
  }
  if ("text" in record) return record.text ?? null;
  if ("error" in record) return null;
  if ("formula" in record) return null;
  return null;
}
