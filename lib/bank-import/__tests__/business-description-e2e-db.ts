/**
 * DB-backed end-to-end verification for Business Description persistence.
 *
 * Guarded by `../test-db`: runs only against TEST_DATABASE_URL (a disposable
 * local database), never the shared DATABASE_URL. Applies migrations first,
 * then walks the real upload path: parseUploadForm -> parseBankStatementPdf
 * -> persistStatement -> getStatementDetail.
 *
 * Synthetic PDF only (no real statement bytes, names, or references).
 * Run: npx tsx lib/bank-import/__tests__/business-description-e2e-db.ts with TEST_DATABASE_URL.
 */
import assert from "node:assert/strict";
import * as path from "path";
import { createHash } from "crypto";
import "../../__tests__/test-db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { createBankAccount, persistStatement } from "../persistence";
import { parseUploadForm } from "../upload";
import { bankImportLimits } from "../limits";
import { parseBankStatementPdf } from "../pdf";
import { getStatementDetail } from "../queries";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ── Synthetic PDF builder (in-memory only; proven working with PDF.js) ────────
function escapePdfString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function makeTextPdf(lines: string[]): Uint8Array {
  const columnX = [20, 80, 230, 300, 365, 445, 525];
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  ];
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
  objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Arial /Encoding /WinAnsiEncoding >>");

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

const STATEMENT_LINES = [
  "Date\tValue Date\tNarration\tChq./Ref.No.\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance",
  "01/04/26\t01/04/26\tGITHUB 0123 CARD hold\t\t500.00\t\t9500.00",
  "02/04/26\t02/04/26\tDEBIT CARD PRORATA FEE 01APR26\t\t35.00\t\t9465.00",
  "03/04/26\t03/04/26\tNEFT CR PAYMENT ESCROW WEBSITE VIKRETA\t\t\t9000.00\t18465.00",
  "04/04/26\t04/04/26\tNAUSLAJUKF HOLD 991022\t\t25.00\t\t18440.00",
];

async function main() {
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle"),
  });

  const limits = bankImportLimits();
  const bytes = makeTextPdf(STATEMENT_LINES);

  // 1) Real upload form path
  const form = new FormData();
  form.set("file", new File([bytes], "e2e-synthetic-statement.pdf", { type: "application/pdf" }));
  const input = await parseUploadForm(form, limits.maxBytes);
  assert.ok(input.ok, `form parsing failed: ${input.ok ? "" : input.error}`);
  if (!input.ok) throw new Error("unreachable");

  // 2) Real parse path — parsing must generate descriptions
  const parsed = await parseBankStatementPdf(input.bytes, {
    maxBytes: limits.maxBytes,
    maxPages: limits.maxPages,
    maxRows: limits.maxRows,
  });
  const businessRows = parsed.lines.filter((line) => line.narration);
  assert.equal(businessRows.length, 4);
  for (const line of businessRows) {
    assert.ok(line.businessDescription, "parse stage must generate a description");
  }
  assert.equal(businessRows[0].businessDescription, "Payment to GitHub by card");
  assert.equal(businessRows[1].businessDescription, "Debit card fee");
  assert.ok(businessRows[2].businessDescription?.startsWith("Money received via NEFT through Payment Escrow"));
  assert.equal(businessRows[3].businessDescription, "Card payment — merchant and purpose require review");
  ok("parsing generated descriptions for recognized, charge, incoming and unknown rows");

  // Account + statement through the real persistence path
  const account = await createBankAccount("admin", {
    displayName: "E2E Verify Disposable Account",
    bankName: "E2E Verify Bank",
    last4: "0001",
  });
  assert.ok(account.ok);
  if (!account.ok) throw new Error("unreachable");

  const fileSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const persisted = await persistStatement({
    accountId: account.value,
    userId: "admin",
    fileName: input.fileName,
    fileSha256,
    fileSizeBytes: input.bytes.length,
    parsed,
  });
  assert.ok(persisted.ok, `upload persist failed: ${persisted.ok ? "" : persisted.error}`);
  if (!persisted.ok) throw new Error("unreachable");
  ok(`upload committed ${persisted.value.lineCount} staging rows`);

  // 3) Raw database contents after commit
  const raw = await db.execute(sql`
    SELECT
      row_number,
      business_description IS NULL AS desc_null,
      txn_date::text AS txn_date
    FROM bank_statement_lines
    WHERE statement_id = ${persisted.value.statementId}::uuid
    ORDER BY row_number
  `);
  const rawRows = raw.rows as unknown as Array<{
    rowNumber: number;
    desc_null: boolean;
    txn_date: string;
  }>;
  assert.equal(rawRows.length, 4);
  assert.equal(rawRows.filter((row) => row.desc_null).length, 0, "all rows must have a persisted description");
  ok("bank_statement_lines.business_description filled for every row after commit");

  const descRows = await db.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (
        WHERE business_description = narration
      )::int AS desc_equals_narration
    FROM bank_statement_lines
    WHERE statement_id = ${persisted.value.statementId}::uuid
  `);
  const rawCounts = descRows.rows[0] as unknown as {
    total: number;
    desc_equals_narration: number;
  };
  assert.equal(rawCounts.total, 4);
  ok(`stored descriptions: ${rawCounts.total} rows with a business_description, 0 NULL`);

  // 4) The actual review query used by the review table
  const detail = await getStatementDetail(persisted.value.statementId);
  assert.ok(detail, "getStatementDetail must return the statement");
  if (!detail) throw new Error("unreachable");
  const reviewRows = detail.lines.filter((line) => line.narration);
  assert.equal(reviewRows.length, 4);
  assert.equal(
    reviewRows.filter((line) => line.businessDescription).length,
    4,
    "review query must return the stored descriptions",
  );
  assert.equal(reviewRows[0].businessDescription, "Payment to GitHub by card");
  assert.equal(reviewRows[1].businessDescription, "Debit card fee");
  assert.ok(reviewRows[2].businessDescription?.startsWith("Money received via NEFT through Payment Escrow"));
  assert.equal(reviewRows[3].businessDescription, "Card payment — merchant and purpose require review");
  ok("review query returns the same descriptions the review table renders");

  // 5) Unknown narration keeps the safe review-required fallback
  assert.ok(!reviewRows[3].status.includes("ready"), "unknown row must not be promoted to ready by a description");
  assert.ok(reviewRows[2].flags.length > 0, "incoming transfer keeps mapping/review flags");
  ok("unknown row uses the safe fallback and stays pending for review");

  // 6) Source identity: narration/reference/amounts/direction/flags untouched
  const source = await db.execute(sql`
    SELECT
      row_number,
      narration,
      reference,
      withdrawal_amount::text AS withdrawal_amount,
      deposit_amount::text AS deposit_amount,
      direction,
      classification,
      status,
      flags,
      fingerprint
    FROM bank_statement_lines
    WHERE statement_id = ${persisted.value.statementId}::uuid
    ORDER BY row_number
  `);
  const dbLines = source.rows as unknown as Array<{
    rowNumber: number;
    narration: string | null;
    reference: string | null;
    withdrawal_amount: string | null;
    deposit_amount: string | null;
    direction: string | null;
    classification: string;
    status: string;
    flags: unknown;
    fingerprint: string;
  }>;
  for (let index = 0; index < businessRows.length; index += 1) {
    const expected = businessRows[index];
    const stored = dbLines[index];
    assert.equal(stored.narration, expected.narration, "narration must remain exactly as extracted");
    assert.equal(stored.reference, expected.reference, "reference must remain exactly as extracted");
    assert.equal(stored.withdrawal_amount, expected.withdrawalAmount, "withdrawal amount untouched");
    assert.equal(stored.deposit_amount, expected.depositAmount, "deposit amount untouched");
    assert.equal(stored.direction, expected.direction, "direction untouched");
    assert.equal(stored.classification, expected.classification, "classification untouched");
    assert.equal(stored.status, expected.status, "status untouched by description generation");
    assert.deepEqual(stored.flags, expected.flags, "flags untouched");
    assert.equal(stored.fingerprint, expected.fingerprint, "transaction identity fingerprint untouched");
  }
  ok("original narration, references, amounts, direction, flags and fingerprints unchanged");

  console.log(`business-description-e2e-db: ${passed} checks passed`);
  await pool.end();
}

main().catch(async (error) => {
  console.error("E2E verification failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
  try {
    await pool.end();
  } catch {
    // pool already closed
  }
});
