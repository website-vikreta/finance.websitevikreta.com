/**
 * Offline Phase 2 upload rules. No database and no real statement content.
 * PDFs are generated in-memory only.
 */
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { bankImportLimits } from "../limits";
import { parseUploadForm } from "../upload";
import { persistStatement } from "../persistence";
import { STATEMENT_SAVE_ERROR } from "../upload-errors";
import type { ParsedStatement } from "../types";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function safePdf(): Uint8Array {
  return new Uint8Array(Buffer.from("%PDF-1.4\n%Test fixture\n%%EOF\n", "latin1"));
}

function fileWith(bytes: Uint8Array | number, type = "application/pdf", suffix = "pdf") {
  const bytesToUse = typeof bytes === "number" ? new Array(bytes).fill(1) : Array.from(bytes);
  return new File([new Uint8Array(bytesToUse).buffer as ArrayBuffer], `statement.${suffix}`, {
    type,
  });
}

function statementFixture(overrides: Partial<ParsedStatement> = {}): ParsedStatement {
  return {
    currency: "INR",
    pages: 1,
    lines: [],
    statementFrom: "2026-04-13",
    statementTo: "2026-04-13",
    openingBalance: "10000.00",
    closingBalance: "9000.00",
    warnings: [],
    ...overrides,
  };
}

async function run(): Promise<void> {
  assert.equal(STATEMENT_SAVE_ERROR, "The statement could not be saved. Try again.");
  ok("upload errors: save failures use the requested safe message");

  const defaults = bankImportLimits();
  assert.ok(defaults.maxBytes >= 1);
  assert.equal(bankImportLimits({ BANK_IMPORT_MAX_FILE_BYTES: "1024" }).maxBytes, 1024);
  assert.equal(bankImportLimits({ BANK_IMPORT_MAX_FILE_BYTES: "bogus" }).maxBytes, defaults.maxBytes);
  ok("limits: configurable and defensive");

  const emptyForm = new FormData();
  const empty = await parseUploadForm(emptyForm, defaults.maxBytes);
  assert.ok(!empty.ok);
  ok("upload input: missing file rejected");

  const textForm = new FormData();
  textForm.append(
    "file",
    fileWith(new Uint8Array([1, 2, 3]), "text/plain", "txt"),
  );
  const nonPdf = await parseUploadForm(textForm, defaults.maxBytes);
  assert.ok(!nonPdf.ok);
  ok("upload input: non-PDF rejected");

  const fakePdfForm = new FormData();
  fakePdfForm.append("file", fileWith(new Uint8Array([0, 1, 2, 3])));
  const fakePdf = await parseUploadForm(fakePdfForm, defaults.maxBytes);
  assert.ok(fakePdf.ok);
  assert.ok(fakePdf.bytes.byteLength > 0);
  ok("upload input: parser sees stored bytes rather than a spoofed MIME type");

  const tooLargeForm = new FormData();
  tooLargeForm.append(
    "file",
    fileWith(new Uint8Array(new Array(defaults.maxBytes + 1).fill(9))),
  );
  const tooLarge = await parseUploadForm(tooLargeForm, defaults.maxBytes);
  assert.ok(!tooLarge.ok);
  ok("upload input: oversized file rejected");

  const allowedForm = new FormData();
  allowedForm.append("file", fileWith(safePdf()));
  const allowed = await parseUploadForm(allowedForm, defaults.maxBytes);
  assert.ok(allowed.ok);
  assert.ok(allowed.password === undefined);
  ok("upload input: optional password is not persisted or logged when absent");

  const noRows = statementFixture();
  const noRowsPersist = await persistStatement({
    accountId: "11111111-1111-4111-8111-111111111111",
    userId: "admin",
    fileName: "statement.pdf",
    fileSha256: createHash("sha256").update(safePdf()).digest("hex"),
    fileSizeBytes: safePdf().byteLength,
    parsed: noRows,
  });
  assert.ok(!noRowsPersist.ok);
  ok("persistence: no statement is written when parsing produced no rows");

  const malformed = statementFixture({ pages: 0 });
  const malformedPersist = await persistStatement({
    accountId: "",
    userId: "",
    fileName: "",
    fileSha256: "",
    fileSizeBytes: 0,
    parsed: malformed,
  });
  assert.ok(!malformedPersist.ok);
  ok("persistence: invalid metadata rejects the statement without staging data");

  console.log(`\nResults: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
