import { createHash } from "node:crypto";

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WS_RE = /[\s\u00a0]+/g;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INTEGER_DIGITS = 16;

export type DateParseResult =
  | { ok: true; value: string; ambiguous: boolean; twoDigitYear: boolean }
  | { ok: false; code: "INVALID_DATE" };

export type AmountParseResult =
  | { ok: true; value: string; negative: boolean; indicator: "cr" | "dr" | null }
  | { ok: false; code: "INVALID_AMOUNT" };

export function collapseWhitespace(value: string): string {
  return value.replace(WS_RE, " ").trim();
}

/**
 * Detects placeholder markers used in bank statement tables for empty values,
 * such as em dash (—), en dash (–), hyphen (-), double dash (--), NIL, N/A, or dot (.).
 */
export function isEmptyAmountPlaceholder(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  const text = raw.replace(/\u00a0/g, " ").trim();
  if (!text) return true;
  return /^(?:[-–—]{1,2}|nil|n\/?a|\.)$/i.test(text);
}

/** Narration is display/review text, not a financial value. */
export function normalizeNarration(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = collapseWhitespace(value);
  return normalized.length > 0 ? normalized : null;
}

export function normalizeReference(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = collapseWhitespace(value);
  if (!normalized || isEmptyAmountPlaceholder(normalized)) return null;
  return normalized.slice(0, 120);
}

export function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

function daysInMonth(year: number, month: number): number {
  // Calendar-only check; no timezone or financial arithmetic.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  if (day > daysInMonth(year, month)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parses the date formats common to Indian bank statements without silently
 * swapping day and month. Numeric dates are read as DD/MM (the Indian
 * convention); a date that could also be MM/DD is returned as a candidate and
 * marked ambiguous so validation keeps it out of `ready`.
 */
export function parseDateCell(raw: string | null | undefined): DateParseResult {
  if (raw == null) return { ok: false, code: "INVALID_DATE" };
  const value = collapseWhitespace(raw);
  if (!value) return { ok: false, code: "INVALID_DATE" };

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) {
    const parsed = toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return parsed
      ? { ok: true, value: parsed, ambiguous: false, twoDigitYear: false }
      : { ok: false, code: "INVALID_DATE" };
  }

  const numeric = /^(\d{1,2})\s*([/.-])\s*(\d{1,2})\s*\2\s*(\d{2,4})$/.exec(value);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[3]);
    const rawYear = numeric[4];
    const twoDigitYear = rawYear.length === 2;
    const year = twoDigitYear ? 2000 + Number(rawYear) : Number(rawYear);
    const parsed = toIsoDate(year, month, day);
    return parsed
      ? {
          ok: true,
          value: parsed,
          ambiguous: day <= 12 && month <= 12,
          twoDigitYear,
        }
      : { ok: false, code: "INVALID_DATE" };
  }

  const named = /^(\d{1,2})[\s/-]+([A-Za-z]{3,9})[\s/-]+(\d{2,4})$/.exec(value);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2].toLowerCase()];
    const rawYear = named[3];
    const twoDigitYear = rawYear.length === 2;
    const year = twoDigitYear ? 2000 + Number(rawYear) : Number(rawYear);
    const parsed = month ? toIsoDate(year, month, day) : null;
    return parsed
      ? { ok: true, value: parsed, ambiguous: false, twoDigitYear }
      : { ok: false, code: "INVALID_DATE" };
  }

  return { ok: false, code: "INVALID_DATE" };
}

/**
 * Parses a money cell into a canonical decimal string. This function never
 * converts to Number. Comma grouping, currency prefixes, Cr/Dr suffixes,
 * parentheses and a leading/trailing minus are supported.
 */
export function parseAmountCell(raw: string | null | undefined): AmountParseResult {
  if (raw == null) return { ok: false, code: "INVALID_AMOUNT" };
  let text = raw.replace(/\u00a0/g, " ").trim();
  if (!text) return { ok: false, code: "INVALID_AMOUNT" };

  let negative = false;
  let indicator: "cr" | "dr" | null = null;

  const indicatorMatch = /\s*(cr|dr)\.?\s*$/i.exec(text);
  if (indicatorMatch) {
    indicator = indicatorMatch[1].toLowerCase() as "cr" | "dr";
    text = text.slice(0, indicatorMatch.index).trim();
  }

  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (/-\s*$/.test(text)) {
    negative = true;
    text = text.replace(/-\s*$/, "").trim();
  }
  if (/^[-+]/.test(text)) {
    negative = text.startsWith("-");
    text = text.slice(1).trim();
  }

  text = text
    .replace(/^(?:INR|RS\.?|₹)\s*/i, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");

  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return { ok: false, code: "INVALID_AMOUNT" };

  const [integerPart, fractionPart = ""] = text.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "");
  if (integer.length > MAX_INTEGER_DIGITS) return { ok: false, code: "INVALID_AMOUNT" };
  const fraction = fractionPart.padEnd(2, "0");
  const value = `${negative ? "-" : ""}${integer}.${fraction}`;
  return { ok: true, value, negative, indicator };
}

function toMinorUnits(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Invalid canonical decimal");
  const fraction = (match[3] ?? "").padEnd(2, "0");
  const magnitude = BigInt(`${match[2]}${fraction}`);
  return match[1] === "-" ? -magnitude : magnitude;
}

function fromMinorUnits(value: bigint): string {
  const negative = value < BigInt(0);
  const magnitude = negative ? -value : value;
  const integer = magnitude / BigInt(100);
  const fraction = (magnitude % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${integer.toString()}.${fraction}`;
}

/** Exact decimal string arithmetic scaled to two places. Never uses floats. */
export function decimalAdd(left: string, right: string): string {
  return fromMinorUnits(toMinorUnits(left) + toMinorUnits(right));
}

export function decimalSubtract(left: string, right: string): string {
  return fromMinorUnits(toMinorUnits(left) - toMinorUnits(right));
}

export function decimalCompare(left: string, right: string): -1 | 0 | 1 {
  const a = toMinorUnits(left);
  const b = toMinorUnits(right);
  return a === b ? 0 : a > b ? 1 : -1;
}

export function decimalAbs(value: string): string {
  const minor = toMinorUnits(value);
  return fromMinorUnits(minor < BigInt(0) ? -minor : minor);
}

export function decimalIsZero(value: string): boolean {
  return toMinorUnits(value) === BigInt(0);
}

export type CurrencyDetection =
  | { currency: "INR"; declared: boolean }
  | { currency: "UNSUPPORTED" };

/**
 * V1 accepts INR only. A currency declaration in the statement header wins;
 * explicit unsupported currency markers are rejected rather than assumed.
 */
export function detectStatementCurrency(text: string): CurrencyDetection {
  const header = text.split(/\r?\n/).slice(0, 30).join("\n");
  if (/\b(?:USD|EUR|GBP|AED|SGD|AUD|CAD|CHF|JPY)\b|[$€£¥]/i.test(header)) {
    return { currency: "UNSUPPORTED" };
  }
  if (/\bINR\b|₹|\bRs\.?\b/i.test(header)) return { currency: "INR", declared: true };
  return { currency: "INR", declared: false };
}

export function fingerprintLine(fields: {
  txnDate: string | null;
  valueDate: string | null;
  narration: string | null;
  reference: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
}): string {
  const canonical = JSON.stringify({
    txnDate: fields.txnDate,
    valueDate: fields.valueDate,
    narration: normalizeNarration(fields.narration),
    reference: normalizeReference(fields.reference),
    withdrawalAmount: fields.withdrawalAmount,
    depositAmount: fields.depositAmount,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
