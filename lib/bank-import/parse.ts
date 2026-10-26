import {
  classifyLine,
} from "./classify";
import {
  collapseWhitespace,
  detectStatementCurrency,
  fingerprintLine,
  isEmptyAmountPlaceholder,
  isIsoDate,
  normalizeNarration,
  normalizeReference,
  parseAmountCell,
  parseDateCell,
} from "./normalize";
import {
  reconcileStatement,
  validateLineForReady,
} from "./validate";
import { generateBusinessDescriptionForParsedLine } from "./business-description";
import {
  BankImportError,
  type Direction,
  type LineFlag,
  type ParsedLine,
  type ParsedPage,
  type ParsedStatement,
  type ParseOptions,
  type PageTable,
} from "./types";

const DEFAULT_MAX_ROWS = 5_000;
const DATE_TOKEN_RE =
  /^((?:\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4})|(?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}[\s/-]+[A-Za-z]{3,9}[\s/-]+\d{2,4}))\b/;

const CLASSIFICATION_FLAGS: ReadonlySet<LineFlag> = new Set<LineFlag>([
  "TRANSFER",
  "REFUND",
  "REVERSAL",
  "AMBIGUOUS_ENTRY",
  "CASH_MOVEMENT",
  "BANK_CHARGE",
]);

type ColumnField =
  | "txnDate"
  | "valueDate"
  | "narration"
  | "reference"
  | "withdrawal"
  | "deposit"
  | "closing"
  | "amount"
  | "type";

interface Header {
  cells: string[];
  fields: (ColumnField | null)[];
  index: Map<ColumnField, number>;
}

interface LeadingDate {
  token: string;
  rest: string;
}

function addFlag(flags: LineFlag[], flag: LineFlag): void {
  if (!flags.includes(flag)) flags.push(flag);
}

function splitCells(line: string): string[] {
  const normalized = line.replace(/\u00a0/g, " ");
  if (normalized.includes("\t")) {
    const cells = normalized.split("\t").map((cell) => cell.trim());
    return cells.some(Boolean) ? cells : [];
  }
  const trimmed = normalized.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s{2,}/).map((cell) => cell.trim());
}

function headerKey(cell: string): string {
  return cell
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldForHeaderCell(cell: string): ColumnField | null {
  const key = headerKey(cell);
  if (!key) return null;

  if (/\bvalue\s*(?:date|dt)\b/.test(key)) return "valueDate";
  if (/\b(?:date|txn date|transaction date|posting date|post date)\b/.test(key)) return "txnDate";
  if (/\b(?:narration|description|particulars|transaction details|details|remarks)\b/.test(key)) {
    return "narration";
  }
  if (/\b(?:chq|cheque|ref|reference)\b/.test(key)) return "reference";
  if (/\b(?:withdrawal|withdrawals|debit)\b/.test(key)) return "withdrawal";
  if (/\b(?:deposit|deposits|credit)\b/.test(key)) return "deposit";
  if (/\bopening\b/.test(key) && /\bbalance\b/.test(key)) return null;
  if (/\b(?:closing|running)\b/.test(key) && /\bbalance\b/.test(key)) return "closing";
  if (/\bbalance\b/.test(key)) return "closing";
  if (/\bamount\b/.test(key)) return "amount";
  if (/^(?:type|dr cr|cr dr|debit credit|credit debit)$/.test(key)) return "type";
  return null;
}

function relaxedHeader(line: string): Header | null {
  const key = headerKey(line);
  const hasDate = /\b(?:date|txn date|transaction date)\b/.test(key);
  const hasAmountSide = /\b(?:withdrawal|debit|deposit|credit|amount)\b/.test(key);
  const hasBalance = /\bbalance\b/.test(key);
  if (!hasDate || !hasAmountSide || !hasBalance) return null;
  if (leadingDateToken(line) || LOOKS_LIKE_AMOUNT_RE.test(line)) return null;
  // No safe column positions, so rows will be preserved as review rows.
  return { cells: [line], fields: [null], index: new Map() };
}

function detectHeader(line: string): Header | null {
  const cells = splitCells(line);
  if (cells.length < 3) return relaxedHeader(line);

  const fields = cells.map(fieldForHeaderCell);
  const index = new Map<ColumnField, number>();
  fields.forEach((field, position) => {
    if (field && !index.has(field)) index.set(field, position);
  });

  if (!index.has("txnDate")) return relaxedHeader(line);
  if (!index.has("withdrawal") && !index.has("deposit") && !index.has("amount")) {
    return relaxedHeader(line);
  }
  return { cells, fields, index };
}

function leadingDateToken(line: string): LeadingDate | null {
  const match = DATE_TOKEN_RE.exec(line.trim());
  if (!match) return null;
  return {
    token: match[1],
    rest: line.trim().slice(match[0].length).trim(),
  };
}

/**
 * The canonical statement flow of this bank, in print order:
 * `Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt.,
 * Closing Balance`. It is used only when a PDF never prints a heading row;
 * every date and amount must then hold at its own canonical slot for a row
 * to be mapped, and anything less stays pending for review.
 */
const CANONICAL_FIELD_ORDER: readonly ColumnField[] = [
  "txnDate",
  "narration",
  "reference",
  "valueDate",
  "withdrawal",
  "deposit",
  "closing",
];

/** Works for both text rows (`Header`) and table rows (`TableHeader`). */
function canonicalHeader(): {
  cells: string[];
  fields: (ColumnField | null)[];
  index: Map<ColumnField, number>;
} {
  const index = new Map<ColumnField, number>();
  CANONICAL_FIELD_ORDER.forEach((field, position) => {
    if (field && !index.has(field)) index.set(field, position);
  });
  return {
    cells: [
      "Transaction Date",
      "Narration",
      "Chq./Ref.No.",
      "Value Dt",
      "Withdrawal Amt.",
      "Deposit Amt.",
      "Closing Balance",
    ],
    fields: [...CANONICAL_FIELD_ORDER],
    index,
  };
}

/** Whether a row shows the full canonical column flow with a date in slot 0. */
function canonicalRowShape(cells: string[]): boolean {
  if (cells.length < CANONICAL_FIELD_ORDER.length) return false;
  if (!collapseWhitespace(cells[0] ?? "")) return false;
  return parseDateCell(collapseWhitespace(cells[0])).ok;
}

function parseMappedDate(
  raw: string | null,
  flags: LineFlag[],
  kind: "txnDate" | "valueDate",
): string | null {
  if (!raw || isEmptyAmountPlaceholder(raw)) return null;
  const parsed = parseDateCell(raw);
  if (!parsed.ok) {
    addFlag(flags, kind === "txnDate" ? "INVALID_DATE" : "INVALID_VALUE_DATE");
    return null;
  }
  if (parsed.ambiguous) addFlag(flags, "AMBIGUOUS_DATE");
  if (parsed.twoDigitYear) addFlag(flags, "TWO_DIGIT_YEAR");
  return parsed.value;
}

function parseBalance(raw: string | null, flags: LineFlag[]): string | null {
  if (!raw || isEmptyAmountPlaceholder(raw)) return null;
  const parsed = parseAmountCell(raw);
  if (!parsed.ok) {
    addFlag(flags, "INVALID_BALANCE");
    return null;
  }
  if (parsed.indicator === "dr" && !parsed.negative) {
    return `-${parsed.value}`;
  }
  return parsed.value;
}

function parseColumnAmount(
  raw: string | null,
  side: Direction,
  flags: LineFlag[],
): string | null {
  if (!raw || isEmptyAmountPlaceholder(raw)) return null;
  const parsed = parseAmountCell(raw);
  if (!parsed.ok) {
    addFlag(flags, "INVALID_AMOUNT");
    return null;
  }
  if (parsed.value === "0.00") {
    addFlag(flags, "ZERO_AMOUNT");
    return null;
  }
  if (parsed.negative) addFlag(flags, "NEGATIVE_AMOUNT");
  if (
    (side === "withdrawal" && parsed.indicator === "cr") ||
    (side === "deposit" && parsed.indicator === "dr")
  ) {
    addFlag(flags, "DIRECTION_CONFLICT");
  }
  return parsed.value;
}

function parseDirectionCell(raw: string | null): Direction | null {
  if (!raw) return null;
  const key = headerKey(raw);
  if (/\b(?:dr|debit|withdrawal|withdraw)\b/.test(key)) return "withdrawal";
  if (/\b(?:cr|credit|deposit)\b/.test(key)) return "deposit";
  return null;
}

function removeFlag(flags: LineFlag[], flag: LineFlag): void {
  const index = flags.indexOf(flag);
  if (index !== -1) flags.splice(index, 1);
}

function removeFlags(flags: LineFlag[], flagsToRemove: LineFlag[]): void {
  for (const flag of flagsToRemove) removeFlag(flags, flag);
}

/**
 * A value-date cell may fuse the date with the amount, e.g. `11/04/26-92.77`.
 * The date part stays a date; the trailing number carries its sign in this
 * bank's format (a minus marks a credited entry such as a reversal).
 */
const FUSED_DATE_AMOUNT_RE =
  /^(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4})-(\d[\d,]{0,15}(?:\.\d{1,2})?)$/;

/**
 * HDFC-style statements print dates as DD/MM/YY. Once any parsed date has a
 * day above 12, the day-first reading is proven for the whole statement; the
 * per-row ambiguity and two-digit-year flags are then noise, not uncertainty,
 * and are cleared together. Statements with no such proof keep their flags.
 */
function clearResolvedDateFlags(lines: ParsedLine[]): void {
  let dayFirstProven = false;
  for (const line of lines) {
    for (const iso of [line.txnDate, line.valueDate]) {
      if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number(iso.slice(8)) > 12) {
        dayFirstProven = true;
        break;
      }
    }
    if (dayFirstProven) break;
  }
  if (!dayFirstProven) return;
  for (const line of lines) {
    removeFlags(line.flags, ["AMBIGUOUS_DATE", "TWO_DIGIT_YEAR"]);
  }
}

function finalizeLine(line: ParsedLine): ParsedLine {
  line.flags = line.flags.filter((flag) => !CLASSIFICATION_FLAGS.has(flag));
  if (line.narration) {
    line.flags = line.flags.filter((flag) => flag !== "MISSING_NARRATION");
  }
  if (line.txnDate) {
    line.flags = line.flags.filter(
      (flag) => flag !== "MISSING_DATE" && flag !== "INVALID_DATE",
    );
  }
  if ((line.withdrawalAmount !== null) !== (line.depositAmount !== null)) {
    line.flags = line.flags.filter((flag) => flag !== "MISSING_AMOUNT");
  }

  const classification = classifyLine(line.direction, line.narration);
  line.classification = classification.classification;
  for (const flag of classification.flags) addFlag(line.flags, flag);

  line.fingerprint = fingerprintLine({
    txnDate: line.txnDate,
    valueDate: line.valueDate,
    narration: line.narration,
    reference: line.reference,
    withdrawalAmount: line.withdrawalAmount,
    depositAmount: line.depositAmount,
  });

  // Generate business description from narration
  line.businessDescription = generateBusinessDescriptionForParsedLine(
    line.narration,
    line.reference,
    line.withdrawalAmount,
    line.depositAmount,
    line.direction,
    line.classification,
    line.flags,
  );

  const validation = validateLineForReady(line);
  for (const flag of validation.ok ? [] : validation.flags) addFlag(line.flags, flag);
  line.status = validation.ok ? "ready" : "pending";
  line.errorCode = validation.ok ? null : validation.code;
  return line;
}

function fallbackRow(
  raw: string,
  pageNumber: number,
  rowNumber: number,
): ParsedLine | null {
  const leading = leadingDateToken(raw);
  if (!leading) return null;

  const flags: LineFlag[] = ["UNRECOGNIZED_ROW"];
  const parsedTxn = parseDateCell(leading.token);
  const txnDate = parsedTxn.ok ? parsedTxn.value : null;
  if (!parsedTxn.ok) addFlag(flags, "INVALID_DATE");
  if (parsedTxn.ok && parsedTxn.ambiguous) addFlag(flags, "AMBIGUOUS_DATE");
  if (parsedTxn.ok && parsedTxn.twoDigitYear) addFlag(flags, "TWO_DIGIT_YEAR");

  const second = leadingDateToken(leading.rest);
  const parsedValue = second ? parseDateCell(second.token) : null;
  if (parsedValue && !parsedValue.ok) addFlag(flags, "INVALID_VALUE_DATE");
  if (parsedValue?.ok && parsedValue.ambiguous) addFlag(flags, "AMBIGUOUS_DATE");
  if (parsedValue?.ok && parsedValue.twoDigitYear) addFlag(flags, "TWO_DIGIT_YEAR");
  const valueDate = parsedValue?.ok ? parsedValue.value : null;

  const narration = normalizeNarration(second ? second.rest : leading.rest);
  if (!narration) addFlag(flags, "MISSING_NARRATION");
  addFlag(flags, "MISSING_AMOUNT");

  return finalizeLine({
    pageNumber,
    rowNumber,
    txnDate,
    valueDate,
    narration,
    reference: null,
    businessDescription: "",
    withdrawalAmount: null,
    depositAmount: null,
    closingBalance: null,
    direction: null,
    classification: "unclassified",
    status: "pending",
    fingerprint: "",
    flags,
    errorCode: null,
  });
}

const LOOKS_LIKE_AMOUNT_RE =
  /(?:\b\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?\b|\b\d+\.\d{2}\b)/;

/**
 * Preserves a tabular row whose date cell is empty. It cannot be mapped safely
 * by column position, so the whole row is kept for manual review instead of
 * being appended to the previous narration or silently dropped.
 */
function missingDateRow(
  raw: string,
  pageNumber: number,
  rowNumber: number,
): ParsedLine {
  const flags: LineFlag[] = [
    "MISSING_DATE",
    "UNRECOGNIZED_ROW",
    "MISSING_AMOUNT",
  ];
  const narration = normalizeNarration(raw);
  if (!narration) addFlag(flags, "MISSING_NARRATION");
  return finalizeLine({
    pageNumber,
    rowNumber,
    txnDate: null,
    valueDate: null,
    narration,
    reference: null,
    businessDescription: "",
    withdrawalAmount: null,
    depositAmount: null,
    closingBalance: null,
    direction: null,
    classification: "unclassified",
    status: "pending",
    fingerprint: "",
    flags,
    errorCode: null,
  });
}

function looksLikeMissingDateRow(line: string): boolean {
  return line.includes("\t") && LOOKS_LIKE_AMOUNT_RE.test(line);
}

function parseRow(
  raw: string,
  header: Header,
  pageNumber: number,
  rowNumber: number,
): ParsedLine {
  const flags: LineFlag[] = [];
  const cells = splitCells(raw);

  // A compact/single-cell line is not safe to map by column position. Keep it
  // as a review row rather than guessing which number is the amount.
  if (cells.length < 2 || header.cells.length < 3) {
    const fallback = fallbackRow(raw, pageNumber, rowNumber);
    if (fallback) return fallback;
  }

  const width = header.cells.length;
  const padded = cells.slice();
  const aligned = padded.length === width;
  if (padded.length > width) {
    const extras = padded.slice(width).filter((cell) => cell.length > 0);
    if (extras.length > 0) addFlag(flags, "COLUMN_COUNT_MISMATCH");
    padded.length = width;
  }
  // A short row can mean a trailing blank column or a collapsed middle column.
  // Both are unsafe to align by position, so keep the row for review.
  if (padded.length < width) addFlag(flags, "COLUMN_COUNT_MISMATCH");
  while (padded.length < width) padded.push("");

  const get = (field: ColumnField): string => {
    const position = header.index.get(field);
    return position == null ? "" : (padded[position] ?? "").trim();
  };

  const leading = leadingDateToken(raw);
  let txnRaw = get("txnDate");
  let valueRaw = get("valueDate");

  if (!txnRaw && leading) txnRaw = leading.token;
  if (!valueRaw && txnRaw) {
    const txnParts = leadingDateToken(txnRaw);
    if (txnParts) {
      const second = leadingDateToken(txnParts.rest);
      if (second) valueRaw = second.token;
    }
  }
  if (!valueRaw && leading) {
    const second = leadingDateToken(leading.rest);
    if (second) valueRaw = second.token;
  }

  // A value-date cell may fuse the date with the amount (`11/04/26-92.77`).
  if (valueRaw) {
    const fused = FUSED_DATE_AMOUNT_RE.exec(valueRaw);
    if (fused) {
      valueRaw = fused[1];
      addFlag(flags, "COLUMN_COUNT_MISMATCH");
    }
  }

  // A cell may contain both dates when PDF extraction collapses two columns.
  if (txnRaw) {
    const txnParts = leadingDateToken(txnRaw);
    if (txnParts && leadingDateToken(txnParts.rest)) txnRaw = txnParts.token;
  }

  if (!txnRaw) addFlag(flags, "MISSING_DATE");
  const txnDate = parseMappedDate(txnRaw, flags, "txnDate");
  const valueDate = parseMappedDate(valueRaw, flags, "valueDate");

  const narration = normalizeNarration(stripStatementFooter(get("narration")));
  if (!narration) addFlag(flags, "MISSING_NARRATION");
  const reference = normalizeReference(get("reference"));
  const closingBalance = aligned ? parseBalance(get("closing"), flags) : null;

  let withdrawalAmount: string | null = null;
  let depositAmount: string | null = null;
  let direction: Direction | null = null;

  const withdrawalRaw = get("withdrawal");
  const depositRaw = get("deposit");
  const singleRaw = get("amount");

  const hasTwoAmountColumns = header.index.has("withdrawal") || header.index.has("deposit");

  if (!aligned) {
    addFlag(flags, "MISSING_AMOUNT");
  } else if (hasTwoAmountColumns) {
    withdrawalAmount = parseColumnAmount(withdrawalRaw, "withdrawal", flags);
    depositAmount = parseColumnAmount(depositRaw, "deposit", flags);

    if (withdrawalAmount !== null && depositAmount !== null) {
      // Both source amount columns carry a value, so direction is unresolved.
      addFlag(flags, "BOTH_AMOUNTS");
    } else if (withdrawalAmount !== null) {
      direction = "withdrawal";
    } else if (depositAmount !== null) {
      direction = "deposit";
    } else {
      addFlag(flags, "MISSING_AMOUNT");
    }
  } else if (singleRaw && !isEmptyAmountPlaceholder(singleRaw)) {
    const parsed = parseAmountCell(singleRaw);
    if (!parsed.ok) {
      addFlag(flags, "INVALID_AMOUNT");
      addFlag(flags, "MISSING_AMOUNT");
    } else if (parsed.value === "0.00") {
      addFlag(flags, "ZERO_AMOUNT");
      addFlag(flags, "MISSING_AMOUNT");
    } else {
      const typeDirection = parseDirectionCell(get("type"));
      const signDirection: Direction | null = parsed.negative ? "withdrawal" : null;
      const indicatorDirection: Direction | null =
        parsed.indicator === "dr" ? "withdrawal" : parsed.indicator === "cr" ? "deposit" : null;
      const candidates = [typeDirection, indicatorDirection, signDirection].filter(
        (candidate): candidate is Direction => candidate !== null,
      );
      const unique = [...new Set(candidates)];
      if (unique.length > 1) addFlag(flags, "DIRECTION_CONFLICT");
      direction = unique[0] ?? null;
      if (!direction) {
        addFlag(flags, "UNKNOWN_DIRECTION");
        addFlag(flags, "MISSING_AMOUNT");
      } else {
        const amount = parsed.value;
        if (direction === "withdrawal") withdrawalAmount = amount;
        else depositAmount = amount;
      }
    }
  } else {
    addFlag(flags, "MISSING_AMOUNT");
  }

  return finalizeLine({
    pageNumber,
    rowNumber,
    txnDate,
    valueDate,
    narration,
    reference,
    businessDescription: "",
    withdrawalAmount,
    depositAmount,
    closingBalance,
    direction,
    classification: "unclassified",
    status: "pending",
    fingerprint: "",
    flags,
    errorCode: null,
  });
}

// ─── Table-aware parsing ──────────────────────────────────────────────────────

interface TableHeader {
  cells: string[];
  fields: (ColumnField | null)[];
  index: Map<ColumnField, number>;
}

function detectTableHeader(cells: string[]): TableHeader | null {
  if (cells.length < 3) return null;

  const fields = cells.map((cell) => fieldForHeaderCell(cell));
  const index = new Map<ColumnField, number>();
  fields.forEach((field, position) => {
    if (field && !index.has(field)) index.set(field, position);
  });

  if (!index.has("txnDate")) return null;
  if (!index.has("withdrawal") && !index.has("deposit") && !index.has("amount")) {
    return null;
  }
  return { cells, fields, index };
}

function parseTableAmount(
  raw: string | null | undefined,
  side: Direction,
  flags: LineFlag[],
): string | null {
  if (!raw) return null;
  const trimmed = collapseWhitespace(raw);
  if (!trimmed || isEmptyAmountPlaceholder(trimmed)) return null;
  return parseColumnAmount(trimmed, side, flags);
}

function parseTableRow(
  cells: string[],
  header: TableHeader,
  pageNumber: number,
  rowNumber: number,
): ParsedLine {
  const flags: LineFlag[] = [];

  const get = (field: ColumnField): string => {
    const position = header.index.get(field);
    return position == null ? "" : (cells[position] ?? "").trim();
  };

  const txnRaw = get("txnDate");
  let valueRaw = get("valueDate");

  // A value-date cell may fuse the date with the amount (`11/04/26-92.77`).
  if (valueRaw) {
    const fused = FUSED_DATE_AMOUNT_RE.exec(valueRaw);
    if (fused) {
      valueRaw = fused[1];
      addFlag(flags, "COLUMN_COUNT_MISMATCH");
    }
  }

  if (!txnRaw) addFlag(flags, "MISSING_DATE");
  const txnDate = parseMappedDate(txnRaw || null, flags, "txnDate");
  const valueDate = parseMappedDate(valueRaw || null, flags, "valueDate");

  const narration = normalizeNarration(stripStatementFooter(get("narration")));
  if (!narration) addFlag(flags, "MISSING_NARRATION");
  const reference = normalizeReference(get("reference"));
  const closingBalance = parseBalance(get("closing") || null, flags);

  let withdrawalAmount: string | null = null;
  let depositAmount: string | null = null;
  let direction: Direction | null = null;

  const hasTwoAmountColumns =
    header.index.has("withdrawal") || header.index.has("deposit");

  if (hasTwoAmountColumns) {
    withdrawalAmount = parseTableAmount(get("withdrawal"), "withdrawal", flags);
    depositAmount = parseTableAmount(get("deposit"), "deposit", flags);

    if (withdrawalAmount !== null && depositAmount !== null) {
      // Both source amount columns carry values, so direction cannot be
      // chosen from one source side. Keep both values for review.
      addFlag(flags, "BOTH_AMOUNTS");
    } else if (withdrawalAmount !== null) {
      direction = "withdrawal";
    } else if (depositAmount !== null) {
      direction = "deposit";
    } else {
      addFlag(flags, "MISSING_AMOUNT");
    }
  } else {
    const singleRaw = get("amount");
    if (singleRaw && !isEmptyAmountPlaceholder(singleRaw)) {
      const parsed = parseAmountCell(singleRaw);
      if (!parsed.ok) {
        addFlag(flags, "INVALID_AMOUNT");
        addFlag(flags, "MISSING_AMOUNT");
      } else if (parsed.value === "0.00") {
        addFlag(flags, "ZERO_AMOUNT");
        addFlag(flags, "MISSING_AMOUNT");
      } else {
        const typeDirection = parseDirectionCell(get("type"));
        const signDirection: Direction | null = parsed.negative ? "withdrawal" : null;
        const indicatorDirection: Direction | null =
          parsed.indicator === "dr" ? "withdrawal" : parsed.indicator === "cr" ? "deposit" : null;
        const candidates = [typeDirection, indicatorDirection, signDirection].filter(
          (candidate): candidate is Direction => candidate !== null,
        );
        const unique = [...new Set(candidates)];
        if (unique.length > 1) addFlag(flags, "DIRECTION_CONFLICT");
        direction = unique[0] ?? null;
        if (!direction) {
          addFlag(flags, "UNKNOWN_DIRECTION");
          addFlag(flags, "MISSING_AMOUNT");
        } else {
          const amount = parsed.negative ? parsed.value.slice(1) : parsed.value;
          if (direction === "withdrawal") withdrawalAmount = amount;
          else depositAmount = amount;
        }
      }
    } else {
      addFlag(flags, "MISSING_AMOUNT");
    }
  }

  const { classification, flags: classFlags } = classifyLine(direction, narration);
  for (const flag of classFlags) addFlag(flags, flag);

  const fingerprint = fingerprintLine({
    txnDate,
    valueDate,
    narration,
    reference,
    withdrawalAmount,
    depositAmount,
  });

  const validation = validateLineForReady({
    txnDate,
    valueDate,
    narration,
    withdrawalAmount,
    depositAmount,
    direction,
    classification,
    flags,
  });
  for (const flag of validation.ok ? [] : validation.flags) addFlag(flags, flag);

  const businessDescription = generateBusinessDescriptionForParsedLine(
    narration,
    reference,
    withdrawalAmount,
    depositAmount,
    direction,
    classification,
    flags,
  );

  return {
    pageNumber,
    rowNumber,
    txnDate,
    valueDate,
    narration,
    reference,
    businessDescription,
    withdrawalAmount,
    depositAmount,
    closingBalance,
    direction,
    classification,
    status: validation.ok ? "ready" : "pending",
    fingerprint,
    flags,
    errorCode: validation.ok ? null : validation.code,
  };
}

function parseTableData(table: PageTable, pageNumber: number): ParsedLine[] {
  const lines: ParsedLine[] = [];
  let header: TableHeader | null = null;
  let rowNumber = 0;
  let lastLine: ParsedLine | null = null;
  let footerStarted = false;

  for (const cells of table.rows) {
    if (cells.length === 0) continue;

    // Check if this row is a table header.
    const detected = detectTableHeader(cells);
    if (detected) {
      header = detected;
      lastLine = null;
      footerStarted = false;
      continue;
    }

    if (footerStarted) continue;

    if (!header) {
      // A statement that never prints a heading row: rows showing the full
      // canonical flow are mapped by their canonical positions; the shell
      // around the table (bank details, titles) never becomes transactions.
      if (canonicalRowShape(cells)) {
        header = canonicalHeader();
        lastLine = null;
      } else {
        continue;
      }
    }

    // Bank details, page headings, and footer disclaimers are never rows.
    const rowText = cells.filter((cell) => cell && cell.trim()).join(" ");
    const hasTransactionDate = parseDateCell(tableCellAt(header, "txnDate", cells)).ok;
    if (
      !hasTransactionDate &&
      (isSummaryLine(rowText) || isMetadataLine(rowText) || isFooterLine(rowText))
    ) {
      if (isSummaryLine(rowText) || isFooterLine(rowText)) footerStarted = true;
      continue;
    }

    const hasAmountColumns =
      header.index.has("withdrawal") ||
      header.index.has("deposit") ||
      header.index.has("amount");

    // A wrapped row's continuation has an empty date cell and no amounts.
    // Its text/reference joins the transaction it follows on the same page;
    // it never becomes a transaction of its own. When the association is
    // uncertain (amounts present, or the first line is not a real
    // transaction), the row is kept as a flagged review row instead.
    if (
      hasAmountColumns &&
      !hasTransactionDate &&
      amountCellsEmpty(header, cells)
    ) {
      const narrationCell = tableCellAt(header, "narration", cells);
      const referenceCell = tableCellAt(header, "reference", cells);
      if (!narrationCell && !referenceCell) continue;
      if (lastLine && lastLine.txnDate) {
        mergeTableContinuation(lastLine, header, cells);
        continue;
      }
    }

    rowNumber += 1;
    const parsed = parseTableRow(cells, header, pageNumber, rowNumber);
    lines.push(parsed);
    lastLine = parsed;
    if (hasStatementFooterMarker(rowText)) footerStarted = true;
  }

  return lines;
}

/** Whether every amount slot of a table row is empty or a placeholder. */
function amountCellsEmpty(header: TableHeader, cells: string[]): boolean {
  return (
    !hasAmountValue(tableCellAt(header, "withdrawal", cells)) &&
    !hasAmountValue(tableCellAt(header, "deposit", cells)) &&
    !hasAmountValue(tableCellAt(header, "amount", cells))
  );
}

/**
 * Joins a wrapped continuation row into the transaction it follows. Text
 * fields only: narration is appended, and a missing reference is filled.
 * Amounts, dates and balances of the anchor stay untouched; the row is
 * re-validated so its status stays truthful.
 */
function mergeTableContinuation(
  line: ParsedLine,
  header: TableHeader,
  cells: string[],
): void {
  const narrationAddition = normalizeNarration(tableCellAt(header, "narration", cells) || "");
  const referenceAddition = normalizeReference(tableCellAt(header, "reference", cells) || null);
  if (narrationAddition) {
    line.narration = line.narration ? `${line.narration} ${narrationAddition}` : narrationAddition;
  }
  if (referenceAddition && !line.reference) {
    line.reference = referenceAddition;
  }
  const updated = finalizeLine(line);
  line.classification = updated.classification;
  line.status = updated.status;
  line.errorCode = updated.errorCode;
  line.fingerprint = updated.fingerprint;
  line.flags = updated.flags;
  line.businessDescription = updated.businessDescription;
}

function isSummaryLine(line: string): boolean {
  const key = collapseWhitespace(line).toLowerCase();
  const compact = compactStatementText(key);
  if (/^pageno(?:\d+(?:of\d+)?)?$/.test(compact)) return true;
  return /^(?:page\s+\d+|opening\s+balance|closing\s+balance|total\b|grand\s+total|brought\s+forward|carried\s+forward|end\s+of\s+statement|generated\s+on|this\s+is\s+a\s+computer|continued\b|statement\s+summary)/.test(
    key,
  );
}

function isMetadataLine(line: string): boolean {
  const key = collapseWhitespace(line).toLowerCase();
  const compact = compactStatementText(key);
  if (compact.startsWith("stateaccountbranchgstn")) return true;
  if (compact.startsWith("registeredofficeaddress")) return true;
  return /^(?:account|a\/c|ifsc|branch|customer|statement|period|currency|address|email|phone|gst|pan|nominee|joint|scheme|product|registered\s+office|corporate\s+office|state\s*[:\-]|city\s*[:\-])/.test(
    key,
  );
}

const STATEMENT_FOOTER_MARKERS = [
  "closingbalanceincludesfundsearmarkedforholdandunclearedfunds",
  "contentsofthisstatementwillbeconsideredcorrect",
  "theaddressonthisstatementisthatonrecordwiththebank",
  "stateaccountbranchgstn",
  "hdfcbankgstinnumberdetailsareavailableat",
  "registeredofficeaddresshdfcbankhouse",
] as const;

function compactStatementText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * PDF text extraction can remove every space from HDFC's repeated page footer.
 * Match its stable wording after compacting punctuation and whitespace so it
 * cannot be mistaken for transaction narration or a wrapped transaction row.
 */
function hasStatementFooterMarker(value: string): boolean {
  const compact = compactStatementText(value);
  return STATEMENT_FOOTER_MARKERS.some((marker) => compact.includes(marker));
}

/** Removes a footer suffix that PDF.js may place in the same narration cell. */
function stripStatementFooter(value: string): string {
  const compact = compactStatementText(value);
  let markerIndex = -1;
  for (const marker of STATEMENT_FOOTER_MARKERS) {
    const index = compact.indexOf(marker);
    if (index >= 0 && (markerIndex < 0 || index < markerIndex)) markerIndex = index;
  }
  if (markerIndex < 0) return value;

  // Keep the index into the original text while removing only separators.
  let compactIndex = 0;
  let originalIndex = value.length;
  for (let index = 0; index < value.length; index += 1) {
    if (!/[a-z0-9]/i.test(value[index])) continue;
    if (compactIndex === markerIndex) {
      originalIndex = index;
      break;
    }
    compactIndex += 1;
  }

  let prefix = value.slice(0, originalIndex).trimEnd();
  const compactPrefix = compactStatementText(prefix);
  const bankNameIndex = compactPrefix.lastIndexOf("hdfcbanklimited");
  if (bankNameIndex >= 0 && compactPrefix.length - (bankNameIndex + "hdfcbanklimited".length) <= 4) {
    let seen = 0;
    for (let index = 0; index < prefix.length; index += 1) {
      if (!/[a-z0-9]/i.test(prefix[index])) continue;
      if (seen === bankNameIndex) {
        prefix = prefix.slice(0, index).trimEnd();
        break;
      }
      seen += 1;
    }
  }
  return prefix.replace(/[\s*]+$/g, "");
}

/**
 * Footer content (URLs, contacts, disclaimers) is statement furniture. It must
 * never be appended to a narration and never become a transaction.
 */
function isFooterLine(line: string): boolean {
  const key = collapseWhitespace(line).toLowerCase();
  return hasStatementFooterMarker(line) || /\bhttps?:\/\/|\bwww\.|@[a-z0-9-]+\.[a-z]{2,}\b|\bcustomer\s+(?:care|service|support)\b|\btoll\s*free\b|\bregistered\s+office\b|\bmembers\s+closing\b|\bterms\s+(?:and\s+conditions|of\s+use)\b|\bthis\s+is\s+an\s+(?:electronic|automated)\b|\bdo\s+not\/?copies\b/.test(
    key,
  );
}

/** Reads one mapped cell without shifting positions for empty columns. */
function tableCellAt(
  header: TableHeader,
  field: ColumnField,
  cells: string[],
): string {
  const position = header.index.get(field);
  return position == null ? "" : (cells[position] ?? "").trim();
}

/** Whether a cell holds a real number rather than a placeholder or narrated text. */
function hasAmountValue(raw: string): boolean {
  if (!raw || isEmptyAmountPlaceholder(raw)) return false;
  return LOOKS_LIKE_AMOUNT_RE.test(raw);
}

function appendContinuation(line: ParsedLine, raw: string): void {
  const addition = normalizeNarration(raw);
  if (!addition) return;
  const existing = line.narration ? `${line.narration} ${addition}` : addition;
  line.narration = existing;
  const updated = finalizeLine(line);
  line.classification = updated.classification;
  line.status = updated.status;
  line.errorCode = updated.errorCode;
  line.fingerprint = updated.fingerprint;
  line.flags = updated.flags;
  line.businessDescription = updated.businessDescription;
}

/**
 * Closing balances are never used to derive transaction amounts or sides.
 * They are kept per row for display and reach `reconcileStatement`, which
 * checks the declared opening/closing balance as an advisory statement-level
 * warning only. A row whose side cannot be established from its amount
 * columns stays pending for review instead of being "signed" from the
 * balance trail.
 */
interface StatementMetadata {
  from: string | null;
  to: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
}

function parseStatementMetadata(text: string): StatementMetadata {
  const header = text.split(/\r?\n/).slice(0, 60).join("\n");
  const amount = "(-?\\d[\\d,]*(?:\\.\\d{1,2})?)";

  const period =
    /(?:statement\s+(?:period|from)|period|from)\s*[:\-]?\s*(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s/-]+[A-Za-z]{3,9}[\s/-]+\d{2,4})\s*(?:to|till|through|-)\s*(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s/-]+[A-Za-z]{3,9}[\s/-]+\d{2,4})/i.exec(
      header,
    );
  const from = period ? parseDateCell(period[1]) : null;
  const to = period ? parseDateCell(period[2]) : null;

  const openingMatch = new RegExp(
    `\\bopening\\s+balance\\b[^\\d\\n-]{0,24}${amount}`,
    "i",
  ).exec(header);
  const closingMatch = new RegExp(
    `\\bclosing\\s+balance\\b[^\\d\\n-]{0,24}${amount}`,
    "i",
  ).exec(header);
  const opening = openingMatch ? parseAmountCell(openingMatch[1]) : null;
  const closing = closingMatch ? parseAmountCell(closingMatch[1]) : null;

  return {
    from: from?.ok ? from.value : null,
    to: to?.ok ? to.value : null,
    openingBalance: opening?.ok ? opening.value : null,
    closingBalance: closing?.ok ? closing.value : null,
  };
}

function normalizePages(
  input: string | ParsedPage[],
): ParsedPage[] {
  if (typeof input === "string") {
    const pages = input.split(/\f/);
    return pages.map((text, index) => ({ pageNumber: index + 1, text }));
  }
  return input.length > 0
    ? input
    : [{ pageNumber: 1, text: "" }];
}

/**
 * Parses extracted statement text. It never guesses a date/amount side: rows
 * that cannot be mapped are preserved with flags and left out of `ready`.
 */
export function parseStatementText(
  input: string | ParsedPage[],
  options: ParseOptions = {},
): ParsedStatement {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const pages = normalizePages(input);
  const text = pages.map((page) => page.text).join("\n");
  if (!text.trim()) {
    throw new BankImportError("NO_TEXT_LAYER", "No text layer was found in the PDF.");
  }

  const currency = detectStatementCurrency(text);
  if (currency.currency === "UNSUPPORTED") {
    throw new BankImportError(
      "UNSUPPORTED_CURRENCY",
      "This statement uses a currency other than INR. V1 accepts INR statements only.",
    );
  }

  const warnings: string[] = [];
  if (!currency.declared) warnings.push("CURRENCY_NOT_DECLARED");

  const metadata = parseStatementMetadata(text);
  const lines: ParsedLine[] = [];
  let header: Header | null = null;
  let seenHeader = false;
  let impliedHeaderUsed = false;
  let lastLine: ParsedLine | null = null;

  for (const page of pages) {
    // When spatial table data is available, use it for column-aligned parsing.
    // This preserves empty cells and prevents closing-balance/amount misalignment.
    if (page.tables && page.tables.length > 0) {
      const tableLines = parseTableData(
        { pageNumber: page.pageNumber, rows: page.tables },
        page.pageNumber,
      );
      for (const line of tableLines) {
        lines.push(line);
        if (lines.length > maxRows) {
          throw new BankImportError(
            "TOO_MANY_ROWS",
            `This statement has more than ${maxRows.toLocaleString("en-IN")} rows. Split the PDF and try again.`,
          );
        }
      }
      // Still scan text for statement metadata (opening/closing balance, period).
      const pageLines = page.text.replace(/\r/g, "").split("\n");
      for (const raw of pageLines) {
        const line = raw.replace(/\u00a0/g, " ").trimEnd();
        if (!line.trim()) continue;
        if (isSummaryLine(line)) continue;
        if (isMetadataLine(line)) continue;
      }
      seenHeader = true;
      continue;
    }

    const pageLines = page.text.replace(/\r/g, "").split("\n");
    let rowNumber = 0;
    let footerStarted = false;
    lastLine = null;

    for (const raw of pageLines) {
      const line = raw.replace(/\u00a0/g, " ").trimEnd();
      if (!line.trim()) continue;

      const detectedHeader = detectHeader(line);
      if (detectedHeader) {
        header = detectedHeader;
        seenHeader = true;
        lastLine = null;
        footerStarted = false;
        continue;
      }

      if (footerStarted) continue;

      if (isSummaryLine(line)) {
        footerStarted = true;
        continue;
      }

      if (!header) {
        // Statements without a heading row: rows that carry the full
        // canonical column flow (Date, Narration, Chq./Ref.No., Value Dt,
        // Withdrawal Amt., Deposit Amt., Closing Balance) are mapped by
        // position, and the mapping itself is recorded as a warning. The
        // shell before the first header never becomes rows.
        if (canonicalRowShape(splitCells(line))) {
          header = canonicalHeader();
          seenHeader = true;
          lastLine = null;
          footerStarted = false;
          impliedHeaderUsed = true;
        } else {
          continue;
        }
      }

      const leading = leadingDateToken(line);
      if (!leading) {
        if (isMetadataLine(line) || isFooterLine(line)) {
          if (isFooterLine(line)) footerStarted = true;
          continue;
        }
        if (looksLikeMissingDateRow(line)) {
          rowNumber += 1;
          // A tabbed row with amounts but no date still has mappable columns
          // (three cells or more). Its real amount fields are extracted and
          // held for review under MISSING_DATE; only ultra-compact lines
          // become free-text review rows.
          const cells = splitCells(line);
          const parsed =
            cells.length >= 3
              ? parseRow(line, header, page.pageNumber, rowNumber)
              : missingDateRow(line, page.pageNumber, rowNumber);
          lines.push(parsed);
          lastLine = parsed;
          if (lines.length > maxRows) {
            throw new BankImportError(
              "TOO_MANY_ROWS",
              `This statement has more than ${maxRows.toLocaleString("en-IN")} rows. Split the PDF and try again.`,
            );
          }
          continue;
        }
        // A continuation line only joins a real transaction; stray text that
        // follows an unmapped review row is never merged into it.
        if (lastLine && lastLine.txnDate) appendContinuation(lastLine, line);
        continue;
      }

      rowNumber += 1;
      const parsed = parseRow(line, header, page.pageNumber, rowNumber);
      lines.push(parsed);
      lastLine = parsed;
      if (hasStatementFooterMarker(line)) footerStarted = true;
      if (lines.length > maxRows) {
        throw new BankImportError(
          "TOO_MANY_ROWS",
          `This statement has more than ${maxRows.toLocaleString("en-IN")} rows. Split the PDF and try again.`,
        );
      }
    }
  }

  if (!seenHeader) {
    throw new BankImportError(
      "NO_HEADER",
      "The statement columns could not be identified. This PDF format is not supported yet.",
    );
  }
  if (impliedHeaderUsed) {
    warnings.push("HEADER_IMPLIED");
  }
  if (lines.length === 0) {
    throw new BankImportError("NO_ROWS", "No transaction rows were found in this statement.");
  }

  // Row-level ambiguity is resolved only once the whole statement is known:
  // the DD/MM reading is proven statement-wide. Amount sides are never
  // assigned from closing-balance arithmetic; rows that cannot map their
  // columns stay flagged for review. Status is re-based on the resolved
  // flags afterwards, so proven dates never hold a row in stale `pending`.
  clearResolvedDateFlags(lines);
  for (const line of lines) finalizeLine(line);

  const transactionDates = lines
    .map((line) => line.txnDate)
    .filter(isIsoDate)
    .sort();
  let statementFrom = metadata.from;
  let statementTo = metadata.to;
  if (!statementFrom && transactionDates.length > 0) {
    statementFrom = transactionDates[0];
    warnings.push("STATEMENT_PERIOD_DERIVED");
  }
  if (!statementTo && transactionDates.length > 0) {
    statementTo = transactionDates[transactionDates.length - 1];
    if (!warnings.includes("STATEMENT_PERIOD_DERIVED")) {
      warnings.push("STATEMENT_PERIOD_DERIVED");
    }
  }

  const reconciliation = reconcileStatement(
    lines,
    metadata.openingBalance,
    metadata.closingBalance,
  );
  if (reconciliation.checked && !reconciliation.ok) {
    warnings.push("BALANCE_MISMATCH");
  } else if (!reconciliation.checked) {
    warnings.push("RECONCILIATION_NOT_CHECKED");
  }

  return {
    currency: "INR",
    pages: pages.length,
    lines,
    statementFrom,
    statementTo,
    openingBalance: metadata.openingBalance,
    closingBalance: metadata.closingBalance,
    warnings: [...new Set(warnings)],
  };
}

/** Type-safe helper used by tests and PDF extraction. */
export function parseStatementPages(
  pages: ParsedPage[],
  options: ParseOptions = {},
): ParsedStatement {
  return parseStatementText(pages, options);
}
