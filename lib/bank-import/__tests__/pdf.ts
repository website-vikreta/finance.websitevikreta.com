/**
 * Phase 1 PDF checks. The PDFs are generated in-memory so no customer file is
 * stored in the repository.
 *
 * Run: npm run test:bank-import
 */
import assert from "node:assert/strict";
import {
  InvalidPDFException,
  PasswordException,
} from "pdf-parse";
import {
  DEFAULT_MAX_BYTES,
  extractPdfText,
  mapPdfError,
  parseBankStatementPdf,
} from "../pdf";
import { BankImportError } from "../types";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function escapePdfString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/—/g, "\x97")
    .replace(/–/g, "\x96");
}

/**
 * Minimal valid PDF with one page and Helvetica text. Columns are drawn as
 * separate positioned cells so the extractor can preserve the table gaps.
 * This is synthetic test data only; it never contains a real bank statement.
 */
function makeTextPdf(lines: string[]): Uint8Array {
  return makePagedTextPdf([lines]);
}

function makePagedTextPdf(pages: string[][]): Uint8Array {
  const columnX = [20, 80, 230, 300, 365, 445, 525];
  const fontObject = 3 + pages.length * 2;
  const pageObjects = pages.map((_, index) => 3 + index * 2);
  const contentObjects = pages.map((_, index) => 4 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjects.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];

  pages.forEach((lines, index) => {
    const content: string[] = ["BT", "/F1 7 Tf"];
    let y = 740;
    for (const line of lines) {
      const cells = line.includes("\t") ? line.split("\t") : [line];
      cells.forEach((cell, cellIndex) => {
        const trimmed = cell ? cell.trim() : "";
        if (!trimmed) return;
        const x = cells.length === 1 ? columnX[0] : (columnX[cellIndex] ?? 20);
        content.push(`1 0 0 1 ${x} ${y} Tm (${escapePdfString(trimmed)}) Tj`);
      });
      y -= 16;
    }
    content.push("ET");
    const stream = content.join("\n");

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObjects[index]} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof BankImportError, `expected BankImportError, got ${String(error)}`);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`expected BankImportError ${code}`);
}

const STATEMENT_LINES = [
  "ACME BANK",
  "Statement Period: 13/04/2026 to 30/04/2026",
  "Opening Balance: 10,000.00",
  "Date\tNarration\tAmount\tClosing Balance",
  "13/04/2026\tOFFICE RENT\t1,000.00 Dr\t9,000.00",
  "Closing Balance: 9,000.00",
];

async function run(): Promise<void> {
  const pdf = makeTextPdf(STATEMENT_LINES);
  const extraction = await extractPdfText(pdf);
  assert.equal(extraction.pageCount, 1);
  assert.equal(extraction.pages.length, 1);
  assert.equal(extraction.tables.length, 1, "coordinate extraction works without drawn table borders");
  assert.ok(extraction.text.includes("ACME BANK"));
  assert.ok(extraction.text.includes("OFFICE RENT"));
  ok("pdf: extracts text from a valid PDF");

  const parsed = await parseBankStatementPdf(pdf);
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].txnDate, "2026-04-13");
  assert.equal(parsed.lines[0].narration, "OFFICE RENT");
  assert.equal(parsed.lines[0].withdrawalAmount, "1000.00");
  assert.equal(parsed.lines[0].status, "ready");
  ok("pdf: parsed statement lines flow through the normalized parser");

  const blank = makeTextPdf([]);
  await expectCode(extractPdfText(blank), "NO_TEXT_LAYER");
  ok("pdf: image-only/no-text PDF returns a safe code");

  await expectCode(extractPdfText(new Uint8Array(Buffer.from("not a pdf"))), "NOT_A_PDF");
  ok("pdf: non-PDF signature rejected");

  await expectCode(extractPdfText(makeTextPdf(STATEMENT_LINES), { maxBytes: 10 }), "FILE_TOO_LARGE");
  ok("pdf: byte limit enforced");

  await expectCode(extractPdfText(makeTextPdf(STATEMENT_LINES), { maxPages: 0 }), "TOO_MANY_PAGES");
  ok("pdf: page limit enforced");

  const corrupt = new Uint8Array(Buffer.from("%PDF-1.4\nthis is not a valid document"));
  await expectCode(extractPdfText(corrupt), "INVALID_PDF");
  ok("pdf: corrupt PDF returns a safe code");

  const noPassword = mapPdfError(new PasswordException("No password given"));
  assert.equal(noPassword.code, "PASSWORD_REQUIRED");
  const badPassword = mapPdfError(new PasswordException("Incorrect Password"));
  assert.equal(badPassword.code, "WRONG_PASSWORD");
  const invalid = mapPdfError(new InvalidPDFException("secret internal parser detail"));
  assert.equal(invalid.code, "INVALID_PDF");
  assert.ok(!invalid.message.includes("secret"));
  ok("pdf: password/error mapping is safe and does not leak parser text");

  assert.equal(DEFAULT_MAX_BYTES, 10 * 1024 * 1024);
  ok("pdf: default byte limit is the approved provisional 10 MB");

  // ── 7-column layout with em dash and reconciliation ──
  const sevenColPdf = makeTextPdf([
    "DEMO BANK",
    "Statement Period: 15/10/2026 to 25/10/2026",
    "Opening Balance: 100,000.00",
    "Date\tNarration\tChq./Ref.No.\tValue Dt\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance",
    "15-Oct-2026\tSYNTHETIC CLIENT PAYMENT\tREF-A\t15-Oct-2026\t—\t50,000.00\t150,000.00",
    "18-Oct-2026\tSYNTHETIC HOSTING BILL\tREF-B\t18-Oct-2026\t4,500.00\t—\t145,500.00",
    "20-Oct-2026\tSYNTHETIC INTERNAL TRANSFER\tREF-C\t20-Oct-2026\t10,000.00\t—\t135,500.00",
    "22-Oct-2026\tSYNTHETIC INTERNET BILL\tREF-D\t22-Oct-2026\t1,500.00\t—\t134,000.00",
    "25-Oct-2026\tSYNTHETIC MALFORMED ROW\tREF-E\t25-Oct-2026\t2,000.00\t2,000.00\t134,000.00",
    "Closing Balance: 134,000.00",
  ]);

  const parsedSeven = await parseBankStatementPdf(sevenColPdf);
  assert.equal(parsedSeven.lines.length, 5);
  assert.equal(parsedSeven.openingBalance, "100000.00");
  assert.equal(parsedSeven.closingBalance, "134000.00");
  assert.equal(parsedSeven.lines[0].depositAmount, "50000.00");
  assert.equal(parsedSeven.lines[0].direction, "deposit");
  assert.equal(parsedSeven.lines[0].status, "ready");
  assert.equal(parsedSeven.lines[1].withdrawalAmount, "4500.00");
  assert.equal(parsedSeven.lines[1].direction, "withdrawal");
  assert.equal(parsedSeven.lines[1].status, "ready");
  assert.ok(parsedSeven.lines[2].flags.includes("TRANSFER"));
  assert.ok(parsedSeven.lines[4].flags.includes("BOTH_AMOUNTS"));
  assert.equal(parsedSeven.lines[4].status, "pending");
  ok("pdf: extracts and parses 7-column statement with placeholders and reconciliation");

  const wrappedPdf = makeTextPdf([
    "DEMO BANK",
    "Date\tNarration\tChq./Ref.No.\tValue Dt\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance",
    "15-Oct-2026\tSYNTHETIC PAYMENT\tREF-A\t15-Oct-2026\t\t250.00\t1,250.00",
    "\tSYNTHETIC WRAPPED DETAILS\t\t\t\t\t",
    "16-Oct-2026\tSYNTHETIC AMOUNT OMITTED\tREF-B\t16-Oct-2026\t\t\t1,250.00",
  ]);
  const wrapped = await parseBankStatementPdf(wrappedPdf);
  assert.equal(wrapped.lines.length, 2);
  assert.equal(wrapped.lines[0].narration, "SYNTHETIC PAYMENT SYNTHETIC WRAPPED DETAILS");
  assert.equal(wrapped.lines[0].depositAmount, "250.00");
  assert.equal(wrapped.lines[0].closingBalance, "1250.00");
  assert.equal(wrapped.lines[1].txnDate, "2026-10-16");
  assert.equal(wrapped.lines[1].withdrawalAmount, null);
  assert.equal(wrapped.lines[1].depositAmount, null);
  assert.equal(wrapped.lines[1].closingBalance, "1250.00");
  assert.ok(wrapped.lines[1].flags.includes("MISSING_AMOUNT"));
  ok("pdf: wrapped narration attaches once and a dated no-amount row stays for review");

  const hdfcFooterPdf = makePagedTextPdf(
    Array.from({ length: 4 }, (_, index) => {
      const day = 13 + index * 2;
      return [
        "DEMO BANK",
        "Date\tNarration\tChq./Ref.No.\tValue Dt\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance",
        `${day}/04/26\tSYNTHETIC PAYMENT ${index + 1}\tR-${index}-1\t${day}/04/26\t100.00\t\t9,900.00`,
        `${day + 1}/04/26\tSYNTHETIC LAST ROW ${index + 1} HDFC BANK LIMITED *Closingbalanceincludesfundsearmarkedforholdandunclearedfunds\tR-${index}-2\t${day + 1}/04/26\t250.00\t\t9,650.00`,
        "Contentsofthisstatementwillbeconsideredcorrectifnoerrorisreportedwithin30daysofreceiptofstatement.",
        "StateaccountbranchGSTN:27AAACH2702H1Z0",
        "HDFCBankGSTINnumberdetailsareavailableathttps://www.hdfcbank.com/personal/making-payments/online-tax-payment/goods-and-service-tax.",
        "RegisteredOfficeAddress:HDFCBankHouse,SenapatiBapatMarg,Mumbai400013",
        "CO",
        "PageNo.",
      ];
    }),
  );
  const parsedHdfc = await parseBankStatementPdf(hdfcFooterPdf);
  assert.equal(parsedHdfc.pages, 4);
  assert.equal(parsedHdfc.lines.length, 8);
  for (let index = 0; index < 4; index += 1) {
    const line = parsedHdfc.lines[index * 2 + 1];
    assert.equal(line.narration, `SYNTHETIC LAST ROW ${index + 1}`);
    assert.equal(line.classification, "expense");
    assert.equal(line.status, "ready");
    assert.ok(!line.flags.includes("AMBIGUOUS_ENTRY"));
  }
  ok("pdf: four HDFC-style page footers stay out of final transaction rows");

  console.log(`\nResults: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
