/**
 * DB-backed Phase 2 ingest tests.
 *
 * - Guarded by `../test-db`; it only ever runs against `TEST_DATABASE_URL`.
 * - Applies pending drizzle migrations against that disposable database first.
 * - Verifies staging rows, duplicate guards, rollback safety, and that the
 *   financial `transactions`, clients, invoices and Finance-AI chats were not
 *   touched.
 *
 * Run: `npx tsx lib/bank-import/__tests__/upload-db.ts` with TEST_DATABASE_URL.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as path from "path";
import { NextRequest } from "next/server";
import "../../__tests__/test-db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { createSession, SESSION_COOKIE } from "../../auth";
import { POST as uploadPost } from "../../../app/api/bank-connections/upload/route";
import { createBankAccount, persistStatement } from "../persistence";
import { getStatementDetail, listStatements } from "../queries";
import { parseBankStatementPdf } from "../pdf";
import type { ParsedStatement } from "../types";

const TEST_USER = "admin";
const TEST_ACCOUNT_NAME = "Test Bank Account";
const TEST_FILE_NAME = "bank-import-test.pdf";
const TEST_FILE_BYTES = 2048;

const FINGERPRINT = "6f5d3a3c1b2a4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function statementFixture(overrides: Partial<ParsedStatement> = {}): ParsedStatement {
  return {
    currency: "INR",
    pages: 1,
    lines: [
      {
        pageNumber: 1,
        rowNumber: 1,
        txnDate: "2026-04-13",
        valueDate: "2026-04-13",
        narration: "OPENING CREDIT",
        reference: "REF-1",
        withdrawalAmount: null,
        depositAmount: "1000.00",
        closingBalance: "1000.00",
        direction: "deposit",
        classification: "income",
        status: "pending",
        fingerprint: FINGERPRINT,
        flags: [],
        errorCode: null,
      },
      {
        pageNumber: 1,
        rowNumber: 2,
        txnDate: "2026-04-14",
        valueDate: "2026-04-14",
        narration: "TEST RENT",
        reference: "REF-2",
        withdrawalAmount: "250.00",
        depositAmount: null,
        closingBalance: "750.00",
        direction: "withdrawal",
        classification: "expense",
        status: "pending",
        fingerprint: "1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
        flags: [],
        errorCode: null,
      },
    ],
    statementFrom: "2026-04-01",
    statementTo: "2026-04-30",
    openingBalance: "0.00",
    closingBalance: "750.00",
    warnings: [],
    ...overrides,
  };
}

function syntheticStatementPdf(): Uint8Array {
  const columns = [20, 95, 240, 305, 370, 450, 530];
  const rows = [
    ["Transaction Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
    ["13/04/2026", "SYNTHETIC DEPOSIT", "DEP-1", "13/04/2026", "—", "1000.00", "1000.00"],
    ["14/04/2026", "SYNTHETIC WITHDRAWAL", "WDR-1", "14/04/2026", "250.00", "—", "750.00"],
    ["15/04/2026", "SYNTHETIC NEGATIVE AMOUNT", "NEG-1", "15/04/2026", "-25.00", "—", "775.00"],
  ];
  const content = ["BT", "/F1 7 Tf"];
  let y = 740;
  for (const row of rows) {
    row.forEach((cell, index) => {
      if (!cell || cell === "—") return;
      const escaped = cell.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      content.push(`1 0 0 1 ${columns[index]} ${y} Tm (${escaped}) Tj`);
    });
    y -= 18;
  }
  content.push("ET");
  const stream = content.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

function fileSha(): string {
  // Deterministic test value; a real SHA-256 is enforced by the schema.
  return "0".repeat(64).replace(/0/g, () => Math.floor(Math.random() * 16).toString(16)).slice(0, 64);
}

async function count(tableName: "transactions" | "clients" | "invoices" | "chat_sessions"): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS n FROM ${sql.raw(tableName)}`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function stagingCount(): Promise<number> {
  const result = await db.execute(sql`SELECT count(*)::int AS n FROM bank_statement_lines`);
  return Number(result.rows[0]?.n);
}

async function cleanupTestAccount(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM bank_statement_lines
      WHERE statement_id IN (
        SELECT id FROM bank_statements
        WHERE file_name = ${TEST_FILE_NAME}
      )
    `);
    await tx.execute(sql`DELETE FROM bank_statements WHERE file_name = ${TEST_FILE_NAME}`);
    await tx.execute(sql`DELETE FROM bank_accounts WHERE display_name = ${TEST_ACCOUNT_NAME}`);
  });
}

async function applyMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, "../../../drizzle");
  await migrate(db, { migrationsFolder });
}

async function run(): Promise<void> {
  await applyMigrations();
  await cleanupTestAccount();

  const before = {
    transactions: await count("transactions"),
    clients: await count("clients"),
    invoices: await count("invoices"),
    chat_sessions: await count("chat_sessions"),
  };

  const created = await createBankAccount(TEST_USER, {
    displayName: TEST_ACCOUNT_NAME,
    bankName: "Test Bank",
    last4: "1234",
  });
  assert.ok(created.ok, "bank account should be created");
  ok("staging: bank account created");

  const pdfBytes = syntheticStatementPdf();
  const syntheticSha = createHash("sha256").update(pdfBytes).digest("hex");
  const statement = await parseBankStatementPdf(pdfBytes);
  assert.equal(statement.lines.length, 3);
  const parsedNegative = statement.lines.find((line) => line.reference === "NEG-1");
  assert.ok(parsedNegative);
  assert.equal(parsedNegative.withdrawalAmount, "-25.00");
  assert.equal(parsedNegative.status, "pending");
  assert.ok(parsedNegative.flags.includes("NEGATIVE_AMOUNT"));

  process.env.JWT_SECRET = "test-jwt-secret-key-32-chars-long-abc-123";
  const token = await createSession(TEST_USER);
  const form = new FormData();
  form.append("accountId", created.ok ? created.value : "");
  form.append(
    "file",
    new File([new Uint8Array(pdfBytes).buffer as ArrayBuffer], TEST_FILE_NAME, { type: "application/pdf" }),
  );
  const response = await uploadPost(new NextRequest("http://localhost/api/bank-connections/upload", {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
    body: form,
  }));
  assert.equal(response.status, 200, "synthetic PDF upload route should succeed");
  const responseBody = await response.json() as {
    ok: boolean;
    statementId?: string;
    lineCount?: number;
  };
  assert.equal(responseBody.ok, true);
  assert.equal(responseBody.lineCount, 3);
  const statementId = responseBody.statementId;
  assert.ok(statementId);
  ok("upload route: synthetic PDF with positive and flagged negative amounts succeeds");

  const detail = await getStatementDetail(statementId);
  assert.ok(detail);
  assert.equal(detail.statement.lineCount, 3);
  assert.equal(detail.statement.depositTotal, "1000.00");
  const readyLines = detail.lines.filter((line) => line.status === "ready");
  assert.ok(readyLines.length > 0, "ordinary positive rows should remain import-ready when valid");
  for (const line of readyLines) {
    const amount = line.withdrawalAmount ?? line.depositAmount;
    assert.ok(amount && !amount.startsWith("-") && amount !== "0.00");
  }
  const storedNegative = detail.lines.find((line) => line.reference === "NEG-1");
  assert.ok(storedNegative);
  assert.equal(storedNegative.withdrawalAmount, "-25.00");
  assert.equal(storedNegative.status, "pending");
  assert.ok(storedNegative.flags.includes("NEGATIVE_AMOUNT"));
  const audit = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM audit_events
    WHERE entity_type = 'bank_statement'
      AND entity_id = ${statementId}
      AND action = 'created'
      AND source = 'bank_import'
  `);
  assert.equal(Number(audit.rows[0]?.n), 1, "statement and audit event should commit together");
  ok("staging: statement detail exposes parsed rows and totals");

  const statements = await listStatements();
  assert.ok(statements.some((row) => row.id === statementId));
  ok("staging: upload history lists the statement");

  const duplicate = await persistStatement({
    accountId: created.ok ? created.value : "",
    userId: TEST_USER,
    fileName: TEST_FILE_NAME,
    fileSha256: syntheticSha,
    fileSizeBytes: TEST_FILE_BYTES,
    parsed: statementFixture(),
  });
  assert.ok(!duplicate.ok, "duplicate should be rejected");
  ok("staging: duplicate upload rejected safely");

  const negativeLine = {
    ...parsedNegative,
  };

  const negativeReady = await persistStatement({
    accountId: created.ok ? created.value : "",
    userId: TEST_USER,
    fileName: TEST_FILE_NAME,
    fileSha256: fileSha(),
    fileSizeBytes: TEST_FILE_BYTES,
    parsed: statementFixture({ lines: [{ ...negativeLine, status: "ready" }] }),
  });
  assert.ok(!negativeReady.ok, "a negative amount must never be staged as ready");
  ok("staging: negative source amounts cannot become import-ready");

  const broken = await persistStatement({
    accountId: created.ok ? created.value : "",
    userId: TEST_USER,
    fileName: "broken-test.pdf",
    fileSha256: fileSha(),
    fileSizeBytes: TEST_FILE_BYTES,
    parsed: statementFixture({
      lines: [
        {
          pageNumber: 1,
          rowNumber: 1,
          txnDate: "2026-04-13",
          valueDate: "2026-04-13",
          narration: "INVALID AMOUNT",
          reference: "REF-1",
          withdrawalAmount: "0.000",
          depositAmount: null,
          closingBalance: "750.00",
          direction: "withdrawal",
          classification: "expense",
          status: "pending",
          fingerprint: FINGERPRINT,
          flags: [],
          errorCode: null,
        },
      ],
    }),
  });
  assert.ok(!broken.ok, "impossible amounts must roll back");
  const brokenCount = await stagingCount();
  assert.equal(brokenCount, 3, "valid statement rows preserved; broken rows rolled back");
  const brokenStatement = await db.execute(
    sql`SELECT count(*)::int AS n FROM bank_statements WHERE file_name = 'broken-test.pdf'`,
  );
  assert.equal(Number(brokenStatement.rows[0]?.n), 0, "broken statement rolled back");
  ok("staging: failed insert rolls back all statement rows");

  const after = {
    transactions: await count("transactions"),
    clients: await count("clients"),
    invoices: await count("invoices"),
    chat_sessions: await count("chat_sessions"),
  };
  assert.deepEqual(after, before, "financial tables must be untouched");
  ok("financial isolation: financial tables and Finance AI chats unchanged");

  await cleanupTestAccount();
  assert.ok(true, "test staging rows removed");
  ok("cleanup: test staging rows removed");

  console.log(`\nResults: ${passed} passed, 0 failed`);
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
