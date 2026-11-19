/**
 * Workbook cell rules for the finance backup.
 *
 * The backup is a lossless text representation of the database: every value is
 * written as text so Excel never re-formats a date, trims a decimal, or adds a
 * thousands separator. Import normalizes through the same functions on the way
 * back in, which makes the data hash reproducible and keeps money exact.
 */

import { createHash } from "node:crypto";

export type ColumnKind =
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "timestamp"
  | "json";

export interface BackupColumn {
  /** Database column name, used as the Excel header. */
  name: string;
  /** Drizzle property name, used to read/write the row object. */
  prop: string;
  kind: ColumnKind;
  /** Decimal places for NUMERIC columns. */
  scale?: number;
  notNull: boolean;
}

export interface NormalizedSheet {
  sheet: string;
  headers: string[];
  rows: (string | null)[][];
}

export class BackupCellError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupCellError";
  }
}

function isBlank(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
}

export function normalizeText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  if (typeof raw === "string") return raw.length ? raw : null;
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") return String(raw);
  throw new BackupCellError("Expected text.");
}

export function normalizeInteger(raw: unknown): string | null {
  if (isBlank(raw)) return null;
  if (typeof raw === "boolean") throw new BackupCellError("Expected a whole number.");
  const text = String(raw).trim();
  if (!/^[+-]?\d+$/.test(text)) throw new BackupCellError("Expected a whole number.");
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new BackupCellError("Whole number is out of range.");
  return String(value);
}

/** Exact decimal text at the column's scale. Never rounds: extra non-zero digits are rejected. */
export function normalizeDecimal(raw: unknown, scale: number): string | null {
  if (isBlank(raw)) return null;
  if (typeof raw === "boolean") throw new BackupCellError("Expected an amount.");
  const source = typeof raw === "number" ? String(raw) : String(raw).trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(source)) {
    throw new BackupCellError("Expected an amount with digits only.");
  }

  const negative = source.startsWith("-");
  const unsigned = source.replace(/^[+-]/, "");
  const [wholeRaw, fractionRaw = ""] = unsigned.split(".");
  let fraction = fractionRaw;

  if (fraction.length > scale) {
    const extra = fraction.slice(scale);
    if (!/^0*$/.test(extra)) {
      throw new BackupCellError(`Amount has more than ${scale} decimal places.`);
    }
    fraction = fraction.slice(0, scale);
  }
  fraction = fraction.padEnd(scale, "0");

  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const digits = `${whole}${fraction}`;
  const isZero = /^0+$/.test(digits);
  const sign = negative && !isZero ? "-" : "";
  return scale > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

export function normalizeBoolean(raw: unknown): string | null {
  if (isBlank(raw)) return null;
  if (raw === true || raw === 1) return "true";
  if (raw === false || raw === 0) return "false";
  const text = String(raw).trim().toLowerCase();
  if (text === "true" || text === "1") return "true";
  if (text === "false" || text === "0") return "false";
  throw new BackupCellError("Expected true or false.");
}

function validIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

export function normalizeDate(raw: unknown): string | null {
  if (isBlank(raw)) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) throw new BackupCellError("Expected a date.");
    return raw.toISOString().slice(0, 10);
  }
  const text = String(raw).trim();
  if (validIsoDate(text)) return text;
  throw new BackupCellError("Expected a date in YYYY-MM-DD format.");
}

export function normalizeTimestamp(raw: unknown): string | null {
  if (isBlank(raw)) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) throw new BackupCellError("Expected a timestamp.");
    return raw.toISOString();
  }
  if (typeof raw === "number") {
    throw new BackupCellError("Expected an ISO timestamp, not an Excel serial number.");
  }
  const date = new Date(String(raw).trim());
  if (Number.isNaN(date.getTime())) throw new BackupCellError("Expected an ISO timestamp.");
  return date.toISOString();
}

export function normalizeJson(raw: unknown): string | null {
  if (isBlank(raw)) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new BackupCellError("Expected JSON.");
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    throw new BackupCellError("Expected JSON.");
  }
}

export function normalizeCell(kind: ColumnKind, raw: unknown, scale = 2): string | null {
  switch (kind) {
    case "integer":
      return normalizeInteger(raw);
    case "decimal":
      return normalizeDecimal(raw, scale);
    case "boolean":
      return normalizeBoolean(raw);
    case "date":
      return normalizeDate(raw);
    case "timestamp":
      return normalizeTimestamp(raw);
    case "json":
      return normalizeJson(raw);
    case "text":
    default:
      return normalizeText(raw);
  }
}

/** Serializes a database row cell through the same rules the importer applies. */
export function serializeCell(kind: ColumnKind, value: unknown, scale = 2): string | null {
  if (value === null || value === undefined) return null;
  return normalizeCell(kind, value, scale);
}

export function columnKind(columnType: string, dataType: string, scale?: number): ColumnKind {
  if (columnType === "PgTimestamp" || columnType === "PgTimestampString") return "timestamp";
  if (columnType === "PgDate" || columnType === "PgDateString") return "date";
  if (columnType === "PgNumeric") return "decimal";
  if (columnType === "PgJsonb" || columnType === "PgJson") return "json";
  if (columnType === "PgBoolean") return "boolean";
  if (
    columnType === "PgInteger" ||
    columnType === "PgSmallInt" ||
    columnType === "PgBigInt53" ||
    columnType === "PgSerial" ||
    columnType === "PgBigSerial"
  ) {
    return "integer";
  }
  if (dataType === "number") return "integer";
  if (dataType === "boolean") return "boolean";
  if (dataType === "json") return "json";
  return scale !== undefined ? "decimal" : "text";
}

export function canonicalDataHash(sheets: NormalizedSheet[]): string {
  const payload = sheets.map((sheet) => ({
    sheet: sheet.sheet,
    headers: sheet.headers,
    rows: sheet.rows,
  }));
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

/** Returns null when headers are exactly the expected set (order-independent). */
export function validateHeaders(expected: string[], actual: string[]): string | null {
  const cleaned = actual.map((header) => header.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const header of cleaned) {
    if (seen.has(header)) return `The column "${header}" appears twice.`;
    seen.add(header);
  }
  const missing = expected.filter((header) => !seen.has(header));
  if (missing.length) {
    return `Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`;
  }
  const unknown = cleaned.filter((header) => !expected.includes(header));
  if (unknown.length) {
    return `Unknown column${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`;
  }
  return null;
}

export function fileStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}-${value("hour")}${value("minute")}`;
}

export function normalizeNameKey(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
