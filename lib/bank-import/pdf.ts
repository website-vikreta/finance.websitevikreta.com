import {
  FormatError,
  InvalidPDFException,
  PasswordException,
  PDFParse,
} from "pdf-parse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseStatementPages } from "./parse";
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

function rowToCells(row: PositionedRow, anchors: ColumnAnchors): string[] {
  const cells = ["", "", "", "", "", "", ""];
  const narrationReferenceBoundary = (anchors.narration + anchors.reference) / 2;
  const referenceValueDateBoundary = (anchors.reference + anchors.valueDate) / 2;

  for (const item of row.items) {
    const date = parseDateCell(item.text);
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

/**
 * Uses PDF.js text coordinates and the statement's printed header to preserve
 * empty cells and distinguish the three right-aligned money columns. This is
 * intentionally in-memory; only normalized staging fields leave this step.
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
      const anchors: ColumnAnchors | null = anchorsFromRows(rows) ?? statementAnchors;
      if (!anchors) continue;
      statementAnchors ??= anchors;

      const dateRowIndex = rows.findIndex((row) => row.items.some((item) => {
        const parsed = parseDateCell(item.text);
        return parsed.ok && near(item.x, anchors.txnDate, anchors.valueDate);
      }));
      if (dateRowIndex < 0) continue;

      const tableRows = [[
        "Transaction Date", "Narration", "Reference", "Value Date",
        "Withdrawal Amount", "Deposit Amount", "Closing Balance",
      ]];
      for (const row of rows.slice(dateRowIndex)) {
        tableRows.push(rowToCells(row, anchors));
      }
      extracted.push({ pageNumber, rows: tableRows });
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
    } catch {
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
