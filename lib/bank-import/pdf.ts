import {
  FormatError,
  InvalidPDFException,
  PasswordException,
  PDFParse,
} from "pdf-parse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseStatementPages } from "./parse";
import { isMetadataLine, isSummaryLine } from "./parse";
import { parseAmountCell, parseDateCell } from "./normalize";
import {
  BankImportError,
  type PageTable,
  type ParsedStatement,
  type PdfExtraction,
  type PdfExtractionOptions,
} from "./types";

export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_PAGES = 100;

type ColumnAnchors = {
  txnDate: number;
  narration: number;
  reference: number;
  valueDate: number;
  withdrawal: number;
  deposit: number;
  closing: number;
};

type PositionedItem = { text: string; x: number; right: number };
type PositionedRow = { y: number; items: PositionedItem[] };
type PdfTextItem = { str: string; transform: number[]; width: number };

function positionedRows(rawItems: unknown[]): PositionedRow[] {
  const grouped = new Map<number, PositionedItem[]>();
  for (const raw of rawItems) {
    const candidate = raw as Partial<PdfTextItem>;
    if (typeof candidate.str !== "string" || !candidate.str.trim() || !candidate.transform) continue;
    const x = candidate.transform[4];
    const y = candidate.transform[5];
    const width = candidate.width;
    if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number") continue;
    const key = Math.round(y * 2) / 2;
    const row = grouped.get(key) ?? [];
    row.push({ text: candidate.str.trim(), x, right: x + width });
    grouped.set(key, row);
  }
  return [...grouped.entries()]
    .map(([y, rowItems]) => ({ y, items: rowItems.sort((a, b) => a.x - b.x) }))
    .sort((a, b) => b.y - a.y);
}

function anchorsFromRows(rows: PositionedRow[]): ColumnAnchors | null {
  for (const row of rows) {
    const find = (pattern: RegExp): number | null =>
      row.items.find((item) => pattern.test(item.text))?.x ?? null;
    const txnDate = find(/^(?:date|txn\s*date|transaction\s*date)$/i);
    const narration = find(/narration|description|particulars|transaction\s*details/i);
    const reference = find(/chq|cheque|ref(?:erence)?/i);
    const valueDate = find(/value\s*(?:date|dt)/i);
    const withdrawal = find(/withdrawal|debit/i);
    const deposit = find(/deposit|credit/i);
    const closing = find(/closing\s*balance|running\s*balance/i);
    if (
      txnDate !== null && narration !== null && reference !== null && valueDate !== null &&
      withdrawal !== null && deposit !== null && closing !== null &&
      txnDate < narration && narration < reference && reference < valueDate &&
      valueDate < withdrawal && withdrawal < deposit && deposit < closing
    ) {
      return { txnDate, narration, reference, valueDate, withdrawal, deposit, closing };
    }
  }
  return null;
}

function near(value: number, left: number, right: number): boolean {
  return Math.abs(value - left) <= Math.abs(value - right);
}

/** Compact text of one positioned row (for furniture detection). */
function rowText(row: PositionedRow): string {
  return row.items.map((item) => item.text).join(" ");
}

/** True when the row's x anchor sits inside the `[left, right]` band. */
function withinBand(x: number, left: number, right: number): boolean {
  return x >= left && x <= right;
}

function rowToCells(row: PositionedRow, anchors: ColumnAnchors): string[] {
  const cells = ["", "", "", "", "", "", ""];
  const narrationReferenceBoundary = (anchors.narration + anchors.reference) / 2;
  const referenceValueDateBoundary = (anchors.reference + anchors.valueDate) / 2;

  for (const item of row.items) {
    // A date token that also parses as money ("1,003.00") is money, never a date.
    const date = parseAmountCell(item.text).ok ? { ok: false as const } : parseDateCell(item.text);
    if (date.ok) {
      const target = near(item.x, anchors.txnDate, anchors.valueDate) ? 0 : 3;
      cells[target] = [cells[target], item.text].filter(Boolean).join(" ");
      continue;
    }

    if (item.x >= anchors.valueDate - 8 && parseAmountCell(item.text).ok) {
      const column = item.right < anchors.deposit ? 4 : item.right < anchors.closing ? 5 : 6;
      cells[column] = [cells[column], item.text].filter(Boolean).join(" ");
      continue;
    }

    if (item.x < narrationReferenceBoundary) {
      cells[1] = [cells[1], item.text].filter(Boolean).join(" ");
    } else if (item.x < referenceValueDateBoundary) {
      cells[2] = [cells[2], item.text].filter(Boolean).join(" ");
    }
  }
  return cells;
}

/** Whether the row carries a genuine transaction date in the two date bands. */
function hasDateAtAnchor(row: PositionedRow, anchors: ColumnAnchors): boolean {
  return row.items.some(
    (item) =>
      withinBand(item.x, anchors.txnDate - 20, anchors.valueDate - 10) &&
      !parseAmountCell(item.text).ok &&
      parseDateCell(item.text).ok,
  );
}

/** Whether any of the three money columns holds a numeric token. */
function hasMoneyAtAnchor(row: PositionedRow, anchors: ColumnAnchors): boolean {
  return row.items.some(
    (item) =>
      item.x >= anchors.valueDate - 8 &&
      item.right <= anchors.closing + 40 &&
      parseAmountCell(item.text).ok,
  );
}

/** A narration y-row carries text in the narration/reference bands only. */
function rowHasNarrationText(row: PositionedRow, anchors: ColumnAnchors): boolean {
  return row.items.some(
    (item) =>
      item.x < anchors.withdrawal - 8 &&
      /[a-z0-9]/i.test(item.text) &&
      !parseAmountCell(item.text).ok &&
      !parseDateCell(item.text).ok,
  );
}

/** Caption rows (the printed column headings) never become transactions. */
function isColumnCaptionRow(row: PositionedRow): boolean {
  const KEYWORDS = [
    /narration/i, /chq|ref\.?|ref(?:erence)?\b/i, /value\s*(?:date|dt)/i,
    /withdrawal/i, /deposit/i, /balance/i, /txn\s*date|transaction\s*date/i,
  ];
  return row.items.filter((item) => KEYWORDS.some((pattern) => pattern.test(item.text))).length >= 4;
}

const HEADER_ROW = [
  "Transaction Date", "Narration", "Reference", "Value Date",
  "Withdrawal Amount", "Deposit Amount", "Closing Balance",
];

/**
 * Groups the page's positioned rows into one output row per transaction:
 *
 * - a transaction anchor is a y-row with a date in the date band and an
 *   amount or balance in the money bands;
 * - narration-only rows (this bank prints wrapped narration above and below
 *   the amount row) attach to the anchor they are vertically closest to, so a
 *   wrapped narration is never read as a separate transaction;
 * - rows beyond the attach radius stay separate review rows, so uncertain
 *   source content is never silently discarded;
 * - repeated page headers, metadata and footer furniture above the body and
 *   below the last transaction are dropped.
 */
function reconstructTransactionRows(
  rows: PositionedRow[],
  anchors: ColumnAnchors,
): string[][] {
  type Candidate = { row: PositionedRow; kind: "anchor" | "narration" };
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const text = rowText(row);
    if (isSummaryLine(text) || isMetadataLine(text) || isColumnCaptionRow(row)) continue;
    if (hasDateAtAnchor(row, anchors) && hasMoneyAtAnchor(row, anchors)) {
      candidates.push({ row, kind: "anchor" });
    } else if (
      !hasDateAtAnchor(row, anchors) &&
      !hasMoneyAtAnchor(row, anchors) &&
      rowHasNarrationText(row, anchors)
    ) {
      candidates.push({ row, kind: "narration" });
    }
  }
  const anchorsOnly = candidates.filter((c) => c.kind === "anchor").map((c) => c.row);
  if (anchorsOnly.length === 0) return [];

  // Narration wraps are adjacent text lines. The line pitch bounds how far a
  // wrapped line can sit from its transaction row: one and a half line gaps.
  // A page whose candidates never wrap has no measurable pitch, so every
  // narration row stays unattached (kept for review) instead of being guessed.
  const lineGaps: number[] = [];
  for (let i = 1; i < candidates.length; i += 1) {
    lineGaps.push(Math.abs(candidates[i - 1].row.y - candidates[i].row.y));
  }
  lineGaps.sort((a, b) => a - b);
  const linePitch = lineGaps.length > 0 ? lineGaps[Math.floor(lineGaps.length / 2)] : 0;
  const attachRadius = linePitch > 0 ? linePitch * 1.5 : 0;
  const hasNarration = candidates.some((c) => c.kind === "narration");

  const narrationBlocks = new Map<PositionedRow, PositionedRow[]>();
  const unattached: PositionedRow[] = [];
  for (const candidate of candidates) {
    if (candidate.kind !== "narration") continue;
    // Rows before the first transaction or after the last one are page
    // furniture (captions, footers); only a wrapped continuation could sit
    // within the attach radius of a body anchor.
    let best: PositionedRow | null = null;
    let bestDistance = attachRadius;
    for (const anchor of anchorsOnly) {
      const distance = Math.abs(anchor.y - candidate.row.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = anchor;
      }
    }
    if (best) {
      const block = narrationBlocks.get(best) ?? [];
      block.push(candidate.row);
      narrationBlocks.set(best, block);
    } else {
      // Association is uncertain: the row is preserved for reviewer inspection
      // when the statement shows wrapped narration, and dropped as shell
      // otherwise (captions/footers of never-wrapping pages).
      if (hasNarration) unattached.push(candidate.row);
    }
  }

  const tableRows: string[][] = [[...HEADER_ROW]];
  for (const anchor of anchorsOnly) {
    // Print order for a block: lead narration above, the anchor row itself,
    // then continuation lines below. The transaction date always comes from
    // the anchor row; narration lines never carry it.
    const block = [...(narrationBlocks.get(anchor) ?? []), anchor].sort((a, b) => b.y - a.y);
    const cellsList = block.map((row) => rowToCells(row, anchors));
    const anchorIndex = block.indexOf(anchor);
    const merged = ["", "", "", "", "", "", ""];
    merged[0] = cellsList[anchorIndex][0] || cellsList.find((cells) => cells[0])?.[0] || "";
    for (const cells of cellsList) {
      for (let column = 1; column <= 6; column += 1) {
        if (cells[column]) {
          merged[column] = [merged[column], cells[column]].filter(Boolean).join(" ");
        }
      }
    }
    tableRows.push(merged);
  }
  // Uncertain association is never merged; it stays a flagged review row.
  for (const row of unattached.sort((a, b) => b.y - a.y)) {
    tableRows.push(rowToCells(row, anchors));
  }
  return tableRows;
}

/** Buckets nearby x values into clusters within `tolerance` pixels. */
function xClusters(values: number[], tolerance: number): Array<{ position: number; count: number }> {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: Array<{ position: number; count: number }> = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(value - last.position) <= tolerance) {
      last.count += 1;
      last.position = (last.position * (last.count - 1) + value) / last.count; // running mean
    } else {
      clusters.push({ position: value, count: 1 });
    }
  }
  return clusters;
}

/**
 * Derives column anchors from the page's own transaction geometry when a page
 * does not print (or clearly reuse) a heading row. Evidence must be strong:
 * two separated date clusters and three separated money clusters, with the
 * money columns in the canonical order (withdrawal, deposit, balance). This
 * keeps pages printed with different header punctuation or positions adaptive
 * instead of silently shifting values into wrong fields.
 */
function anchorsFromGeometry(rows: PositionedRow[]): ColumnAnchors | null {
  const dateXs: number[] = [];
  const moneyRights: number[] = [];
  let moneyRows = 0;
  for (const row of rows) {
    let rowMoney = 0;
    for (const item of row.items) {
      if (parseAmountCell(item.text).ok) continue;
      if (parseDateCell(item.text).ok) {
        dateXs.push(item.x);
        continue;
      }
      if (/^\d[\d,]*(?:\.\d{2})?$/.test(item.text)) {
        moneyRights.push(item.right);
        rowMoney += 1;
      }
    }
    if (rowMoney >= 2) moneyRows += 1;
  }
  if (moneyRows < 3 || dateXs.length < 4) return null;

  const dateClusters = xClusters(dateXs, 20).filter((c) => c.count >= 3);
  const moneyClusters = xClusters(moneyRights, 20).filter((c) => c.count >= 3);
  if (dateClusters.length < 2 || moneyClusters.length !== 3) return null;
  if (dateClusters[1].position - dateClusters[0].position < 60) return null;
  if (moneyClusters[1].position - moneyClusters[0].position < 40) return null;

  const txnDate = dateClusters[0].position;
  const valueDate = dateClusters[1].position;
  // Money columns are right-aligned; their printed right edges order the
  // withdrawal, deposit and balance bands.
  const withdrawalRight = moneyClusters[0].position;
  const closingRight = moneyClusters[2].position;
  const narrRefBoundary = txnDate + (valueDate - txnDate) * 0.55;
  return {
    txnDate,
    narration: txnDate + 20,
    reference: narrRefBoundary,
    valueDate,
    withdrawal: withdrawalRight - 60,
    deposit: withdrawalRight + 60,
    closing: closingRight - 40,
  };
}

/**
 * Uses PDF.js text coordinates and the statement's printed header to preserve
 * empty cells and distinguish the three right-aligned money columns. Pages
 * without a heading row reuse the statement anchors and may fall back to
 * their own geometry. Output is one row per genuine transaction; narration
 * wrapping and page furniture are resolved here so downstream parsing stays
 * deterministic.
 */
async function extractSpatialTables(
  bytes: Uint8Array,
  password: string | undefined,
  maxPages: number,
): Promise<PageTable[]> {
  const task = getDocument({
    data: Uint8Array.from(bytes),
    ...(password ? { password } : {}),
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    if (document.numPages > maxPages) {
      await document.destroy();
      return [];
    }

    const extracted: PageTable[] = [];
    let statementAnchors: ColumnAnchors | null = null;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const rows = positionedRows(content.items);
      await page.cleanup();

      let anchors = anchorsFromRows(rows);
      anchors ??= statementAnchors;
      let tableRows = anchors ? reconstructTransactionRows(rows, anchors) : [];
      if (tableRows.length <= 1 && (anchors === statementAnchors || anchors === null)) {
        const geometryAnchors = anchorsFromGeometry(rows);
        if (geometryAnchors) {
          const retry = reconstructTransactionRows(rows, geometryAnchors);
          if (retry.length > tableRows.length) tableRows = retry;
        }
      }
      if (anchors) statementAnchors ??= anchors;
      if (tableRows.length > 1) {
        extracted.push({ pageNumber, rows: tableRows });
      }
    }
    await document.destroy();
    return extracted;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw error;
  }
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 5) return false;
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function asBytes(data: Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * Maps library errors to safe codes. The native message is never returned,
 * because it can contain paths or document fragments.
 */
export function mapPdfError(error: unknown): BankImportError {
  if (error instanceof BankImportError) return error;

  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (error instanceof PasswordException || name === "PasswordException") {
    if (/no password|password required|need password|password not (?:given|provided)/.test(message)) {
      return new BankImportError("PASSWORD_REQUIRED", "This PDF needs a password.");
    }
    return new BankImportError("WRONG_PASSWORD", "The PDF password is incorrect.");
  }

  if (
    error instanceof InvalidPDFException ||
    error instanceof FormatError ||
    name === "InvalidPDFException" ||
    name === "FormatError"
  ) {
    return new BankImportError("INVALID_PDF", "This file is not a readable PDF.");
  }

  return new BankImportError("INVALID_PDF", "This file is not a readable PDF.");
}

/**
 * Extracts text from a PDF. The original bytes are not retained, and the
 * parser is always destroyed in `finally`.
 */
export async function extractPdfText(
  data: Uint8Array,
  options: PdfExtractionOptions = {},
): Promise<PdfExtraction> {
  const bytes = asBytes(data);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  if (bytes.byteLength === 0) {
    throw new BankImportError("INVALID_INPUT", "The uploaded file is empty.");
  }
  if (bytes.byteLength > maxBytes) {
    throw new BankImportError(
      "FILE_TOO_LARGE",
      `This PDF is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    );
  }
  if (!hasPdfMagic(bytes)) {
    throw new BankImportError("NOT_A_PDF", "The uploaded file is not a PDF.");
  }

  let parser: PDFParse | null = null;
  try {
    // pdf-parse transfers the input buffer to its worker. Copy after the size
    // checks so the caller's bytes (for hashing/retry metadata) stay intact.
    const parserBytes = Uint8Array.from(bytes);
    parser = new PDFParse({
      data: parserBytes,
      ...(options.password ? { password: options.password } : {}),
      verbosity: 0,
      stopAtErrors: true,
    });

    const info = await parser.getInfo();
    const pageCount = info.total;
    if (pageCount < 1) {
      throw new BankImportError("INVALID_PDF", "This PDF has no pages.");
    }
    if (pageCount > maxPages) {
      throw new BankImportError(
        "TOO_MANY_PAGES",
        `This PDF has more than ${maxPages} pages. Split it and try again.`,
      );
    }

    const result = await parser.getText({
      pageJoiner: "",
      cellSeparator: "\t",
      cellThreshold: 1,
      itemJoiner: "\t",
      lineEnforce: true,
    });

    const pages = result.pages.map((page) => ({
      pageNumber: page.num,
      text: page.text,
    }));
    const text = pages.map((page) => page.text).join("\n");

    if (!text.trim()) {
      throw new BankImportError(
        "NO_TEXT_LAYER",
        "No text layer was found. Scanned or image-only statements are not supported yet.",
      );
    }

    // Geometry is the source of truth when the PDF has no drawn table grid.
    let tables: PageTable[] = [];
    try {
      tables = await extractSpatialTables(bytes, options.password, maxPages);
    } catch (error) {
      // A PDF.js runtime failure keeps text-based parsing as the fallback.
      // Code defects are programming errors and must surface instead of
      // silently degrading every statement to the unpositioned path.
      const name = error instanceof Error ? error.name : "";
      const rethrowable = new Set([
        "ReferenceError", "TypeError", "RangeError", "SyntaxError", "EvalError", "InternalError",
      ]);
      if (rethrowable.has(name)) throw error;
      tables = [];
    }
    if (tables.length === 0) {
      try {
        const tableResult = await parser.getTable();
        tables = (tableResult.pages ?? []).map((pageTable) => ({
          pageNumber: pageTable.num,
          rows: pageTable.tables.flatMap((tableArray) => tableArray),
        }));
      } catch {
        // Table extraction is optional; text-based parsing remains the fallback.
        tables = [];
      }
    }

    return { pages, pageCount, text, tables };
  } catch (error) {
    throw mapPdfError(error);
  } finally {
    if (parser) {
      // A cleanup failure must never replace the safe parse error.
      await parser.destroy().catch(() => undefined);
    }
  }
}

/** Server-side pipeline: PDF bytes -> extracted text -> normalized staging rows. */
export async function parseBankStatementPdf(
  data: Uint8Array,
  options: PdfExtractionOptions = {},
): Promise<ParsedStatement> {
  const extraction = await extractPdfText(data, options);
  const pagesWithTables = extraction.pages.map((page) => ({
    ...page,
    tables: extraction.tables.find((table) => table.pageNumber === page.pageNumber)?.rows,
  }));
  return parseStatementPages(pagesWithTables, { maxRows: options.maxRows });
}
