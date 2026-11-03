/**
 * DB-backed Phase 4 import tests.
 *
 * - Guarded by `../test-db`; it only ever runs against `TEST_DATABASE_URL`.
 * - Exercises the import path end to end: eligibility re-validation,
 *   exactly-once financial effects, invoice row locks under concurrency,
 *   atomic-rollback evidence, idempotency attempts, replacement of
 *   soft-deleted imports, audited restore, statement completion, and
 *   Finance-AI isolation.
 * - Synthetic fixtures only; every created row (staging, transaction,
 *   invoice) is removed again at the end.
 *
 * Run: `npx tsx lib/bank-import/__tests__/import-db.ts` with TEST_DATABASE_URL.
 */

import assert from "node:assert/strict";
import * as path from "path";
import "../../__tests__/test-db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { createBankAccount, persistStatement } from "../persistence";
import { getStatementDetail } from "../queries";
import { importStatementLines, listIncomeInvoiceOptions, restoreImportedLine } from "../import";
import { markLineDuplicate, markLineReady, updateLineReview } from "../review";
import { computeCanonicalPayloadHash } from "../../transactions/persist";
import { deleteTransaction, restoreTransaction } from "../../transactions/manage";
import type { LineFlag, ParsedStatement } from "../types";

const TEST_USER = "admin";
const TEST_ACCOUNT_NAME = "Import Test Bank Account";
const FILE_MAIN = "import-test-main.pdf";
const FILE_COMPLETE = "import-test-complete.pdf";
const FILE_CONCURRENT = "import-test-concurrent.pdf";
const TEST_FILE_BYTES = 2048;
const CLIENT_1 = "Import Client One Pvt Ltd";
const CLIENT_2 = "Import Client Two Pvt Ltd";
const CATEGORY = "Test Import Rent";
const INVOICE_OPEN = "WV/TEST/401"; // main link / partial / overpay / payoff target
const INVOICE_CONCURRENT = "WV/TEST/402"; // two-line race target
const INVOICE_USD = "WV/TEST/403"; // seeded INR/sent, flipped to USD before import
const INVOICE_DRAFT = "WV/TEST/404"; // seeded sent, flipped to draft before import
const INVOICE_VOID = "WV/TEST/405"; // void at save-time cast, sent at import-time cast
const INVOICE_OTHER_CLIENT = "WV/TEST/406"; // re-pointed to CLIENT_2 before import

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function parsedLine(input: {
  rowNumber: number;
  txnDate: string;
  narration: string;
  reference: string;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  direction: "deposit" | "withdrawal";
  classification: "income" | "expense";
  fingerprint: string;
}): ParsedStatement["lines"][number] {
  return {
    pageNumber: 1,
    rowNumber: input.rowNumber,
    txnDate: input.txnDate,
    valueDate: input.txnDate,
    narration: input.narration,
    reference: input.reference,
    withdrawalAmount: input.withdrawalAmount,
    depositAmount: input.depositAmount,
    closingBalance: null,
    direction: input.direction,
    classification: input.classification,
    status: "pending",
    fingerprint: input.fingerprint,
    flags: [] as LineFlag[],
    errorCode: null,
  };
}

/** Deterministic distinct 64-char hex string (check constraints require hex). */
function hexToken(index: number): string {
  return index.toString(16).padStart(64, "0").slice(-64);
}

function statementFixture(lines: ParsedStatement["lines"]): ParsedStatement {
  return {
    currency: "INR",
    pages: 1,
    lines,
    statementFrom: "2026-04-01",
    statementTo: "2026-04-30",
    openingBalance: "0.00",
    closingBalance: "0.00",
    warnings: [],
  };
}

// Row numbers matter everywhere below; keep narrations distinctive for the
// audit-hygiene scan only (they never reach import audits).
const MAIN_LINES = [
  parsedLine({ rowNumber: 1, txnDate: "2026-04-13", narration: "INVOICE RECEIPT ONE", reference: "REF-01", withdrawalAmount: null, depositAmount: "1000.00", direction: "deposit", classification: "income", fingerprint: hexToken(1) }),
  parsedLine({ rowNumber: 2, txnDate: "2026-04-14", narration: "OFFICE RENT", reference: "REF-02", withdrawalAmount: "250.00", depositAmount: null, direction: "withdrawal", classification: "expense", fingerprint: hexToken(2) }),
  parsedLine({ rowNumber: 3, txnDate: "2026-04-15", narration: "INVOICE RECEIPT TWO", reference: "REF-03", withdrawalAmount: null, depositAmount: "600.00", direction: "deposit", classification: "income", fingerprint: hexToken(3) }),
  parsedLine({ rowNumber: 4, txnDate: "2026-04-15", narration: "INVOICE RECEIPT THREE", reference: "REF-04", withdrawalAmount: null, depositAmount: "500.00", direction: "deposit", classification: "income", fingerprint: hexToken(4) }),
  parsedLine({ rowNumber: 5, txnDate: "2026-04-16", narration: "INVOICE RECEIPT FINAL", reference: "REF-05", withdrawalAmount: null, depositAmount: "400.00", direction: "deposit", classification: "income", fingerprint: hexToken(5) }),
  parsedLine({ rowNumber: 6, txnDate: "2026-04-17", narration: "INVOICE RECEIPT FOUR", reference: "REF-06", withdrawalAmount: null, depositAmount: "300.00", direction: "deposit", classification: "income", fingerprint: hexToken(6) }),
  parsedLine({ rowNumber: 7, txnDate: "2026-04-18", narration: "USD INVOICE CAST", reference: "REF-07", withdrawalAmount: null, depositAmount: "50.00", direction: "deposit", classification: "income", fingerprint: hexToken(7) }),
  parsedLine({ rowNumber: 8, txnDate: "2026-04-18", narration: "DRAFT INVOICE CAST", reference: "REF-08", withdrawalAmount: null, depositAmount: "50.00", direction: "deposit", classification: "income", fingerprint: hexToken(8) }),
  parsedLine({ rowNumber: 9, txnDate: "2026-04-18", narration: "VOID INVOICE CAST", reference: "REF-09", withdrawalAmount: null, depositAmount: "50.00", direction: "deposit", classification: "income", fingerprint: hexToken(9) }),
  parsedLine({ rowNumber: 10, txnDate: "2026-04-18", narration: "MISMATCH CLIENT CAST", reference: "REF-10", withdrawalAmount: null, depositAmount: "60.00", direction: "deposit", classification: "income", fingerprint: hexToken(10) }),
];

const COMPLETE_LINES = [
  parsedLine({ rowNumber: 1, txnDate: "2026-04-20", narration: "COMPLETE RECEIPT", reference: "REF-11", withdrawalAmount: null, depositAmount: "120.00", direction: "deposit", classification: "income", fingerprint: hexToken(11) }),
  parsedLine({ rowNumber: 2, txnDate: "2026-04-21", narration: "COMPLETE EXPENSE", reference: "REF-12", withdrawalAmount: "80.00", depositAmount: null, direction: "withdrawal", classification: "expense", fingerprint: hexToken(12) }),
];

const CONCURRENT_LINES = [
  parsedLine({ rowNumber: 1, txnDate: "2026-04-22", narration: "RACE RECEIPT ONE", reference: "REF-13", withdrawalAmount: null, depositAmount: "600.00", direction: "deposit", classification: "income", fingerprint: hexToken(13) }),
  parsedLine({ rowNumber: 2, txnDate: "2026-04-22", narration: "RACE RECEIPT TWO", reference: "REF-14", withdrawalAmount: null, depositAmount: "600.00", direction: "deposit", classification: "income", fingerprint: hexToken(14) }),
];

async function count(tableName: "transactions" | "invoices" | "chat_sessions"): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS n FROM ${sql.raw(tableName)}`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function lineIdByRow(statementId: string, rowNumber: number): Promise<string> {
  const result = await db.execute(sql`
    SELECT id FROM bank_statement_lines
    WHERE statement_id = ${statementId}::uuid AND row_number = ${rowNumber}
  `);
  const row = result.rows[0] as unknown as { id: string } | undefined;
  if (!row) throw new Error(`row ${rowNumber} of statement ${statementId} missing`);
  return row.id;
}

async function mapIncomeReady(
  statementId: string,
  lineId: string,
  clientId: string,
  invoiceId: string | null = null,
): Promise<void> {
  const patched = await updateLineReview(TEST_USER, statementId, lineId, {
    classification: "income",
    clientId,
    invoiceId,
  });
  assert.ok(patched.ok, `income mapping should save: ${patched.ok ? "" : patched.error}`);
  const ready = await markLineReady(TEST_USER, statementId, lineId);
  assert.ok(ready.ok, `income line should become ready: ${ready.ok ? "" : ready.error}`);
}

async function mapExpenseReady(statementId: string, lineId: string, categoryId: number): Promise<void> {
  const patched = await updateLineReview(TEST_USER, statementId, lineId, {
    classification: "expense",
    categoryId,
  });
  assert.ok(patched.ok, "expense mapping should save");
  const ready = await markLineReady(TEST_USER, statementId, lineId);
  assert.ok(ready.ok, "expense line should become ready");
}

interface LineRow {
  status: string;
  classification: string;
  clientId: string | null;
  categoryId: number | null;
  invoiceId: string | null;
  transactionId: string | null;
  importAttempt: number;
  importedPayloadHash: string | null;
  importedCategoryId: number | null;
  importedAt: string | null;
}

async function lineRow(lineId: string): Promise<LineRow> {
  const result = await db.execute(sql`
    SELECT status, classification, client_id AS "clientId", category_id AS "categoryId",
           cast(invoice_id AS text) AS "invoiceId", cast(transaction_id AS text) AS "transactionId",
           import_attempt::int AS "importAttempt",
           imported_payload_hash AS "importedPayloadHash",
           imported_category_id AS "importedCategoryId",
           to_char(imported_at, 'YYYY-MM-DD HH24:MI') AS "importedAt"
    FROM bank_statement_lines WHERE id = ${lineId}::uuid
  `);
  return result.rows[0] as never;
}

interface TransactionRow {
  id: string;
  typeId: number;
  clientId: string | null;
  clientNameSnapshot: string | null;
  originalAmount: string;
  originalCurrency: string;
  amountInr: string;
  exchangeRate: string | null;
  description: string | null;
  categoryId: number | null;
  invoiceId: string | null;
  source: string;
  status: string;
  idempotencyKey: string;
  txnDate: string;
  deletedAt: string | null;
}

async function transactionById(id: string): Promise<TransactionRow | null> {
  const result = await db.execute(sql`
    SELECT cast(id AS text) AS id, type_id AS "typeId", cast(client_id AS text) AS "clientId",
           client_name_snapshot AS "clientNameSnapshot",
           original_amount::text AS "originalAmount", original_currency AS "originalCurrency",
           amount_inr::text AS "amountInr", exchange_rate::text AS "exchangeRate",
           description, category_id AS "categoryId", cast(invoice_id AS text) AS "invoiceId",
           source, status, idempotency_key AS "idempotencyKey",
           to_char(txn_date, 'YYYY-MM-DD') AS "txnDate",
           to_char(deleted_at, 'YYYY-MM-DD') AS "deletedAt"
    FROM transactions WHERE id = ${id}::uuid
  `);
  return (result.rows[0] as unknown as TransactionRow) ?? null;
}

/** The line's linked transaction, only when it exists and is live. */
async function liveTransactionId(lineId: string): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT cast(l.transaction_id AS text) AS id, t.deleted_at
    FROM bank_statement_lines l
    LEFT JOIN transactions t ON t.id = l.transaction_id
    WHERE l.id = ${lineId}::uuid
  `);
  const row = result.rows[0] as unknown as { id: string | null; deleted_at: string | null } | undefined;
  if (!row || row.id == null || row.deleted_at != null) return null;
  return row.id;
}

async function statementState(statementId: string): Promise<{ status: string; completedAt: string | null }> {
  const result = await db.execute(sql`
    SELECT status, to_char(completed_at, 'YYYY-MM-DD HH24:MI') AS "completedAt"
    FROM bank_statements WHERE id = ${statementId}::uuid
  `);
  const row = result.rows[0] as unknown as { status: string; completedAt: string | null } | undefined;
  assert.ok(row, "statement row must exist");
  return { status: row.status, completedAt: row.completedAt ?? null };
}

async function invoicePaid(invoiceNumber: string): Promise<string> {
  const result = await db.execute(sql`
    SELECT coalesce((
      SELECT sum(t.original_amount)
      FROM transactions t
      WHERE t.invoice_id = i.id AND t.deleted_at IS NULL AND t.type_id = 1 AND t.original_currency = i.currency
    ), 0)::text AS paid
    FROM invoices i WHERE i.number = ${invoiceNumber}
  `);
  return String((result.rows[0] as unknown as { paid: string }).paid);
}

/** Live (not soft-deleted) transactions produced by imports of this test run. */
async function liveImportedTransactionCount(): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS n FROM transactions
    WHERE source = 'bank_import' AND idempotency_key LIKE 'bank-line:%' AND deleted_at IS NULL
  `);
  return Number((result.rows[0] as unknown as { n: number }).n);
}

async function seedClient(name: string): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO clients (client_name, country) VALUES (${name}, 'India') RETURNING client_id
  `);
  return String((result.rows[0] as unknown as { client_id: string }).client_id);
}

async function seedCategory(): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO categories (name) VALUES (${CATEGORY}) RETURNING id
  `);
  return Number((result.rows[0] as unknown as { id: number }).id);
}

async function seedInvoice(input: {
  number: string;
  clientId: string;
  status: "sent";
  currency: "INR";
  total: string;
}): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO invoices (number, fy, seq, status, client_id, bill_to_name, currency,
                          issue_date, due_date, tax_type, gst_rate, subtotal, total, created_by)
    VALUES (${input.number}, '2026-27',
            (SELECT coalesce(max(seq), 0) + 1 FROM invoices WHERE fy = '2026-27'),
            ${input.status}, ${input.clientId}, 'Test client', ${input.currency},
            '2026-04-01', '2026-04-30', 'none', 0, ${input.total}, ${input.total}, ${TEST_USER})
    RETURNING id
  `);
  return String((result.rows[0] as unknown as { id: string }).id);
}

let accountId = "";

async function stageStatement(fileName: string, sha: string, parsed: ParsedStatement): Promise<string> {
  const staged = await persistStatement({
    accountId,
    userId: TEST_USER,
    fileName,
    fileSha256: sha,
    fileSizeBytes: TEST_FILE_BYTES,
    parsed,
  });
  assert.ok(staged.ok, `statement ${fileName} should stage: ${staged.ok ? "" : staged.error}`);
  return staged.ok ? staged.value.statementId : "";
}

async function applyMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, "../../../drizzle");
  await migrate(db, { migrationsFolder });
}

/** Shared array literal for this run's statement files (all statements seeded here). */
const FILES_SQL = sql.raw(
  `ARRAY['${FILE_MAIN}','${FILE_COMPLETE}','${FILE_CONCURRENT}']::text[]`,
);

async function cleanup(): Promise<void> {
  await db.transaction(async (tx) => {
    // Free the transaction FK before touching transactions.
    await tx.execute(sql`
      DELETE FROM bank_statement_lines
      WHERE statement_id IN (SELECT id FROM bank_statements WHERE file_name = ANY(${FILES_SQL}))
    `);
    // Every import transaction of this run — linked, replaced, or orphaned by
    // a restore — is identifiable by source.
    await tx.execute(sql`DELETE FROM transactions WHERE source = 'bank_import' AND created_by = ${TEST_USER}`);
    await tx.execute(sql`DELETE FROM bank_statements WHERE file_name = ANY(${FILES_SQL})`);
    await tx.execute(sql`
      DELETE FROM invoices
      WHERE client_id IN (SELECT client_id FROM clients WHERE client_name IN (${CLIENT_1}, ${CLIENT_2}))
         OR number IN (${INVOICE_OPEN}, ${INVOICE_CONCURRENT}, ${INVOICE_USD}, ${INVOICE_DRAFT}, ${INVOICE_VOID}, ${INVOICE_OTHER_CLIENT})
    `);
    for (const name of [CLIENT_1, CLIENT_2]) {
      await tx.execute(sql`DELETE FROM clients WHERE client_name = ${name}`);
    }
    await tx.execute(sql`DELETE FROM categories WHERE name = ${CATEGORY}`);
    await tx.execute(sql`DELETE FROM bank_accounts WHERE display_name = ${TEST_ACCOUNT_NAME}`);
  });
}

async function run(): Promise<void> {
  await applyMigrations();
  await cleanup();

  const before = {
    transactions: await count("transactions"),
    invoices: await count("invoices"),
    chatSessions: await count("chat_sessions"),
  };

  const account = await createBankAccount(TEST_USER, {
    displayName: TEST_ACCOUNT_NAME,
    bankName: "Import Test Bank",
    last4: "1122",
  });
  assert.ok(account.ok, "bank account should be created");
  accountId = account.ok ? account.value : "";

  const clientId1 = await seedClient(CLIENT_1);
  const clientId2 = await seedClient(CLIENT_2);
  const categoryId = await seedCategory();

  // All invoices start INR + sent so review mapping can save; the guard cases
  // mutate the invoice server-side afterwards to prove import-time
  // revalidation catches state changed between save and import.
  const invoiceOpen = await seedInvoice({ number: INVOICE_OPEN, clientId: clientId1, status: "sent", currency: "INR", total: "1000.00" });
  const invoiceConcurrent = await seedInvoice({ number: INVOICE_CONCURRENT, clientId: clientId1, status: "sent", currency: "INR", total: "1000.00" });
  const invoiceUsd = await seedInvoice({ number: INVOICE_USD, clientId: clientId1, status: "sent", currency: "INR", total: "100.00" });
  const invoiceDraft = await seedInvoice({ number: INVOICE_DRAFT, clientId: clientId1, status: "sent", currency: "INR", total: "300.00" });
  const invoiceVoid = await seedInvoice({ number: INVOICE_VOID, clientId: clientId1, status: "sent", currency: "INR", total: "90.00" });
  const invoiceOtherClient = await seedInvoice({ number: INVOICE_OTHER_CLIENT, clientId: clientId1, status: "sent", currency: "INR", total: "100.00" });

  const mainId = await stageStatement(FILE_MAIN, hexToken(21), statementFixture(MAIN_LINES));
  const completeId = await stageStatement(FILE_COMPLETE, hexToken(22), statementFixture(COMPLETE_LINES));
  const concurrentId = await stageStatement(FILE_CONCURRENT, hexToken(23), statementFixture(CONCURRENT_LINES));
  ok("setup: account, two clients, category, six invoices and three statements staged");

  const row = (statementId: string, rowNumber: number) => lineIdByRow(statementId, rowNumber);

  // ── Batch-level validation ─────────────────────────────────────────────────
  {
    const badStatement = await importStatementLines(TEST_USER, "not-a-uuid", [await row(mainId, 1)]);
    assert.ok(!badStatement.ok);
    const empty = await importStatementLines(TEST_USER, mainId, []);
    assert.ok(!empty.ok && empty.error === "Select at least one line to import.");
    ok("validation: malformed statement ids and empty selections are rejected without writes");
  }

  // ── Valid income and expense imports ───────────────────────────────────────
  {
    const A = await row(mainId, 1);
    const B = await row(mainId, 2);
    await mapIncomeReady(mainId, A, clientId1);
    await mapExpenseReady(mainId, B, categoryId);

    const imported = await importStatementLines(TEST_USER, mainId, [A, B]);
    assert.ok(imported.ok && imported.imported === 2 && imported.failed === 0, JSON.stringify(imported.results));
    assert.equal(imported.statementStatus, "review", "remaining rows keep the statement in review");
    ok("import: income and expense lines commit as confirmed transactions");

    const firstResult = imported.results[0];
    const firstTxId = firstResult.ok ? firstResult.transactionId : "";
    assert.ok(firstResult.ok && firstResult.attempt === 1 && firstResult.replacement === false && firstTxId !== "");
    const lineA = await lineRow(A);
    assert.equal(lineA.status, "imported");
    assert.equal(lineA.importAttempt, 1);
    assert.ok(lineA.importedAt != null);
    assert.equal(lineA.transactionId, firstTxId);
    ok("line: the imported row records the attempt, link and import time");

    const txnA = await transactionById(firstTxId);
    assert.ok(txnA, "transaction A exists");
    assert.equal(txnA.typeId, 1);
    assert.equal(txnA.clientId, clientId1);
    assert.equal(txnA.clientNameSnapshot, CLIENT_1);
    assert.equal(txnA.originalAmount, "1000.00");
    assert.equal(txnA.originalCurrency, "INR");
    assert.equal(txnA.amountInr, "1000.00");
    assert.equal(txnA.exchangeRate, null);
    assert.equal(txnA.description, "INVOICE RECEIPT ONE");
    assert.equal(txnA.categoryId, null);
    assert.equal(txnA.invoiceId, null);
    assert.equal(txnA.source, "bank_import");
    assert.equal(txnA.status, "confirmed");
    assert.equal(txnA.txnDate, "2026-04-13");
    assert.ok(txnA.idempotencyKey.endsWith(":a1"));
    ok("transaction: the income row carries the exact INR contract and a1 key");
    const expectedHash = computeCanonicalPayloadHash({
      typeId: 1,
      originalAmount: "1000.00",
      originalCurrency: "INR",
      amountInr: "1000.00",
      exchangeRate: null,
      clientName: CLIENT_1,
      description: "INVOICE RECEIPT ONE",
      txnDate: "2026-04-13",
      createdBy: TEST_USER,
    });
    const storedHash = await db.execute(sql`SELECT imported_payload_hash AS h FROM bank_statement_lines WHERE id = ${A}::uuid`);
    assert.equal(String((storedHash.rows[0] as unknown as { h: string }).h), expectedHash);
    ok("line: the shared canonical payload hash is stored on the staging row");

    const lineB = await lineRow(B);
    assert.equal(lineB.status, "imported");
    assert.equal(lineB.importedCategoryId, categoryId);
    assert.ok(lineB.transactionId != null && lineA.transactionId !== lineB.transactionId);
    const txnB = await transactionById(lineB.transactionId ?? "");
    assert.ok(txnB);
    assert.equal(txnB.typeId, 2);
    assert.equal(txnB.clientId, null);
    assert.equal(txnB.categoryId, categoryId);
    assert.equal(txnB.description, "OFFICE RENT");
    ok("transaction: the expense row carries the explicit category and no client");
  }

  // ── Exactly-once: repeated request + concurrent same-line race ─────────────
  {
    const A = await row(mainId, 1);
    const B = await row(mainId, 2);
    const liveBefore = await liveImportedTransactionCount();

    const repeated = await importStatementLines(TEST_USER, mainId, [A, B]);
    assert.ok(repeated.ok && repeated.imported === 0 && repeated.failed === 2);
    assert.ok(repeated.results.every((entry) => !entry.ok && entry.error.includes("already been imported")));
    assert.equal(await liveImportedTransactionCount(), liveBefore);
    ok("exactly-once: an already-imported line is rejected and nothing is written");

    const race = await Promise.allSettled([
      importStatementLines(TEST_USER, mainId, [B]),
      importStatementLines(TEST_USER, mainId, [B]),
    ]);
    for (const entry of race) {
      assert.equal(entry.status, "fulfilled");
    }
    const outcomes = race.map((entry) => (entry.status === "fulfilled" ? entry.value : null));
    assert.ok(outcomes.every((value) => value !== null && value.imported === 0 && value.failed === 1));
    assert.equal(await liveImportedTransactionCount(), liveBefore);
    ok("concurrency: two reviewers racing the same imported line both refuse, session stays exact");
  }

  // ── Ineligible staging rows are rejected ───────────────────────────────────
  {
    const F = await row(mainId, 6);
    assert.equal((await lineRow(F)).status, "pending");
    const result = await importStatementLines(TEST_USER, mainId, [F]);
    assert.ok(result.ok && result.imported === 0 && result.failed === 1);
    const pendingError = result.results[0];
    assert.ok(!pendingError.ok && /mark it ready/i.test(pendingError.error));
    assert.equal((await lineRow(F)).status, "pending");
    ok("eligibility: a pending line needs the reviewer decision first");

    // Force the state server-side: a ready income line with no client can
    // only exist if review was bypassed; the import must refuse it anyway.
    await db.execute(sql`UPDATE bank_statement_lines SET status = 'ready', reviewed_by = ${TEST_USER} WHERE id = ${F}::uuid`);
    const noClient = await importStatementLines(TEST_USER, mainId, [F]);
    assert.ok(noClient.ok && noClient.imported === 0 && noClient.failed === 1);
    const missingClient = noClient.results[0];
    assert.ok(!missingClient.ok && /client/i.test(missingClient.error));
    assert.equal((await lineRow(F)).status, "ready", "the line stays ready for a real decision");
    await db.execute(sql`UPDATE bank_statement_lines SET status = 'pending' WHERE id = ${F}::uuid`);
    ok("eligibility: income without an existing client is refused on the server");
  }

  // ── Imported lines are terminal — missing mapping cannot resurrect them ────
  {
    const B = await row(mainId, 2);
    await db.execute(sql`UPDATE bank_statement_lines SET category_id = NULL WHERE id = ${B}::uuid`);
    const reImport = await importStatementLines(TEST_USER, mainId, [B]);
    assert.ok(reImport.ok && reImport.imported === 0 && reImport.failed === 1);
    assert.ok(!reImport.results[0].ok && /already been imported/i.test(reImport.results[0].error));
    ok("eligibility: imported rows stay imported; mapping loss cannot re-run them");
  }

  // ── Invoice lifecycle on the open invoice ──────────────────────────────────
  {
    const options1 = await listIncomeInvoiceOptions(clientId1);
    const openOption = options1.find((entry) => entry.id === invoiceOpen);
    assert.ok(openOption != null && openOption.number === INVOICE_OPEN && openOption.outstanding === "1000.00");
    ok("picker: open sent INR invoices list with the exact outstanding balance");

    const C = await row(mainId, 3);
    await mapIncomeReady(mainId, C, clientId1, invoiceOpen);
    const partial = await importStatementLines(TEST_USER, mainId, [C]);
    assert.ok(partial.ok && partial.imported === 1);
    assert.equal(await invoicePaid(INVOICE_OPEN), "600.00");
    const options2 = await listIncomeInvoiceOptions(clientId1);
    assert.equal(options2.find((entry) => entry.id === invoiceOpen)?.outstanding, "400.00");
    ok("invoice: a linked deposit pays the invoice and the balance moves exactly");

    const D = await row(mainId, 4);
    await mapIncomeReady(mainId, D, clientId1, invoiceOpen);
    const overpay = await importStatementLines(TEST_USER, mainId, [D]);
    assert.ok(overpay.ok && overpay.imported === 0 && overpay.failed === 1);
    const overpayError = overpay.results[0];
    assert.ok(!overpayError.ok && /exceeds the invoice/i.test(overpayError.error));
    assert.equal(await invoicePaid(INVOICE_OPEN), "600.00");
    ok("invoice: overpayment is rejected and the paid balance is untouched");

    // Atomic rollback evidence: the attempt bump rolled back with the refusal.
    const DRow = await lineRow(D);
    assert.equal(DRow.status, "ready");
    assert.equal(DRow.importAttempt, 0);
    assert.equal(DRow.transactionId, null);
    ok("rollback: a rejected guard leaves the line ready at attempt 0 — no partial state");

    const E = await row(mainId, 5);
    await mapIncomeReady(mainId, E, clientId1, invoiceOpen);
    const payoff = await importStatementLines(TEST_USER, mainId, [E]);
    assert.ok(payoff.ok && payoff.imported === 1);
    assert.equal(await invoicePaid(INVOICE_OPEN), "1000.00");
    const options3 = await listIncomeInvoiceOptions(clientId1);
    assert.ok(!options3.some((entry) => entry.id === invoiceOpen), "paid invoice leaves the picker");
    ok("invoice: the exact payoff completes the invoice");
  }

  // ── Save-time invoice validation + import-time guards ──────────────────────
  {
    const I = await row(mainId, 9);

    // A void invoice cannot even be saved onto a line.
    await db.execute(sql`UPDATE invoices SET status = 'void' WHERE id = ${invoiceVoid}::uuid`);
    const voidSave = await updateLineReview(TEST_USER, mainId, I, {
      classification: "income",
      clientId: clientId1,
      invoiceId: invoiceVoid,
    });
    assert.ok(!voidSave.ok && /void/i.test(voidSave.error));
    assert.equal((await lineRow(I)).clientId, null, "the rejected save left the mapping untouched");
    await db.execute(sql`UPDATE invoices SET status = 'sent' WHERE id = ${invoiceVoid}::uuid`);
    ok("save-guard: a void invoice is refused when the reviewer saves the link");

    // G: link while INR/sent, then make the invoice USD — the import must
    // revalidate state changed after the save.
    const G = await row(mainId, 7);
    await mapIncomeReady(mainId, G, clientId1, invoiceUsd);
    await db.execute(sql`UPDATE invoices SET currency = 'USD' WHERE id = ${invoiceUsd}::uuid`);
    const usd = await importStatementLines(TEST_USER, mainId, [G]);
    assert.ok(usd.ok && usd.imported === 0 && usd.failed === 1);
    assert.ok(!usd.results[0].ok && /INR invoices/i.test(usd.results[0].error));
    ok("import-guard: an invoice turned USD after the save is refused at import");

    // H: draft flip.
    const H = await row(mainId, 8);
    await mapIncomeReady(mainId, H, clientId1, invoiceDraft);
    await db.execute(sql`UPDATE invoices SET status = 'draft', number = NULL WHERE id = ${invoiceDraft}::uuid`);
    const draft = await importStatementLines(TEST_USER, mainId, [H]);
    assert.ok(draft.ok && draft.imported === 0 && draft.failed === 1);
    assert.ok(!draft.results[0].ok && /Issue the invoice/i.test(draft.results[0].error));
    ok("import-guard: an invoice turned draft after the save is refused at import");

    // I: void flip.
    await mapIncomeReady(mainId, I, clientId1, invoiceVoid);
    await db.execute(sql`UPDATE invoices SET status = 'void' WHERE id = ${invoiceVoid}::uuid`);
    const voided = await importStatementLines(TEST_USER, mainId, [I]);
    assert.ok(voided.ok && voided.imported === 0 && voided.failed === 1);
    assert.ok(!voided.results[0].ok && /void/i.test(voided.results[0].error));
    ok("import-guard: an invoice voided after the save is refused at import");

    // J: client mismatch flip.
    const J = await row(mainId, 10);
    await mapIncomeReady(mainId, J, clientId1, invoiceOtherClient);
    await db.execute(sql`UPDATE invoices SET client_id = ${clientId2}::uuid WHERE id = ${invoiceOtherClient}::uuid`);
    const mismatch = await importStatementLines(TEST_USER, mainId, [J]);
    assert.ok(mismatch.ok && mismatch.imported === 0 && mismatch.failed === 1);
    assert.ok(!mismatch.results[0].ok && /different client/i.test(mismatch.results[0].error));
    ok("import-guard: an invoice re-pointed to another client is refused at import");

    for (const lineId of [G, H, I, J]) {
      const line = await lineRow(lineId);
      assert.equal(line.status, "ready");
      assert.equal(line.importAttempt, 0);
      assert.equal(line.transactionId, null);
    }
    ok("guards: every refused guard case leaves its line ready and unlinked");
  }

  // ── Soft-deleted transaction → replacement attempt ─────────────────────────
  {
    const A = await row(mainId, 1);
    const originalTxId = await liveTransactionId(A);
    assert.ok(originalTxId, "A has a live import");

    await db.execute(sql`UPDATE transactions SET deleted_at = now(), deleted_by = ${TEST_USER} WHERE id = ${originalTxId}::uuid`);
    const detail = await getStatementDetail(mainId);
    const ARow = detail?.lines.find((line) => line.id === A);
    assert.ok(ARow != null);
    assert.equal(ARow.status, "imported");
    assert.equal(ARow.importLive, false, "the workspace reports the dead import, not a success");
    ok("delete: removing the transaction marks the staging row import-deleted");

    // The invoice link still points at a fully paid invoice; clear it so the
    // replacement can be a plain income import (review edits are locked on an
    // imported row, so a test fixture adjusts the link directly).
    await db.execute(sql`UPDATE bank_statement_lines SET invoice_id = NULL WHERE id = ${A}::uuid`);

    const replacement = await importStatementLines(TEST_USER, mainId, [A]);
    assert.ok(replacement.ok, `replacement should run: ${JSON.stringify(replacement.results)}`);
    assert.ok(replacement.imported === 1);
    const replacedResult = replacement.results[0];
    const replacedTxId = replacedResult.ok ? replacedResult.transactionId : "";
    assert.ok(replacedResult.ok && replacedResult.replacement === true && replacedResult.attempt === 2 && replacedTxId !== "");
    const newTxn = await transactionById(replacedTxId);
    assert.ok(newTxn != null && newTxn.idempotencyKey.endsWith(":a2"), "replacement uses the next attempt key");
    const original = await transactionById(originalTxId);
    assert.ok(original != null && original.deletedAt != null && original.idempotencyKey.endsWith(":a1"), "the soft-deleted transaction keeps its consumed key");
    const replacedAudit = await db.execute(sql`
      SELECT count(*)::int AS n FROM audit_events
      WHERE entity_type = 'bank_statement_line' AND entity_id = ${A}::text AND action = 'import_replaced'
    `);
    assert.equal(Number((replacedAudit.rows[0] as unknown as { n: number }).n), 1);
    ok("replacement: the re-import audited as a swap; the old key stays consumed");

    // Restoration requires a dead import: retire the replacement first.
    await db.execute(sql`UPDATE transactions SET deleted_at = now(), deleted_by = ${TEST_USER} WHERE id = ${replacedTxId}::uuid`);
  }

  // ── Audited restoration back to review ─────────────────────────────────────
  {
    const A = await row(mainId, 1);
    const restored = await restoreImportedLine(TEST_USER, mainId, A);
    assert.ok(restored.ok, restored.ok ? "" : restored.error);
    const line = await lineRow(A);
    assert.equal(line.status, "pending");
    assert.equal(line.transactionId, null);
    assert.equal(line.importAttempt, 2, "the consumed attempt stays with the line");
    assert.equal(line.importedAt, null);
    assert.equal(line.importedPayloadHash, null);

    const restoreAudit = await db.execute(sql`
      SELECT count(*)::int AS n FROM audit_events
      WHERE entity_type = 'bank_statement_line' AND entity_id = ${A}::text AND action = 'import_restored'
    `);
    assert.equal(Number((restoreAudit.rows[0] as unknown as { n: number }).n), 1);
    ok("restore: the audited reset returns the line to review with its attempt preserved");

    // The invoice link still targets the fully paid invoice; drop it before
    // re-importing through the ordinary review flow.
    const unlinked = await updateLineReview(TEST_USER, mainId, A, { invoiceId: null });
    assert.ok(unlinked.ok, `invoice unlink should save: ${unlinked.ok ? "" : unlinked.error}`);
    await mapIncomeReady(mainId, A, clientId1);

    const again = await importStatementLines(TEST_USER, mainId, [A]);
    assert.ok(again.ok && again.imported === 1);
    const lastResult = again.results[0];
    const lastTxId = lastResult.ok ? lastResult.transactionId : "";
    assert.ok(lastResult.ok && lastTxId !== "");
    const txn = await transactionById(lastTxId);
    assert.ok(txn != null && txn.idempotencyKey.endsWith(":a3"), "the restored import moves to attempt 3");
    ok("restore: the reviewer can import a fresh transaction after restoration");
  }

  // ── Concurrent same-line race on a fresh line ──────────────────────────────
  {
    const F = await row(mainId, 6);
    await mapIncomeReady(mainId, F, clientId1);
    const liveBefore = await liveImportedTransactionCount();

    const race = await Promise.allSettled([
      importStatementLines(TEST_USER, mainId, [F]),
      importStatementLines(TEST_USER, mainId, [F]),
    ]);
    const outcomes = race.map((entry) => (entry.status === "fulfilled" ? entry.value : null));
    assert.ok(outcomes.every((value) => value != null), "both import attempts returned");
    const winners = outcomes.filter((value) => value !== null && value.imported === 1);
    const losers = outcomes.filter((value) => value !== null && value.imported === 0);
    assert.equal(winners.length, 1, "exactly one same-line import wins");
    assert.equal(losers.length, 1);
    const loser = losers[0];
    const loserResult = loser !== null ? loser.results[0] : null;
    assert.ok(loserResult !== null && !loserResult.ok && /already been imported/i.test(loserResult.error));
    assert.equal(await liveImportedTransactionCount(), liveBefore + 1);
    assert.equal((await lineRow(F)).status, "imported");
    ok("concurrency: a fresh line imported twice concurrently commits exactly once");
  }

  // ── Line state across ledger delete/restore (existing manage service) ──────
  {
    const A = await row(mainId, 1);
    const txId = await liveTransactionId(A);
    assert.ok(txId != null);

    const deleted = await deleteTransaction(TEST_USER, txId);
    assert.ok(deleted.ok, "ledger delete succeeds");
    assert.equal(await liveTransactionId(A), null, "the line immediately sees the delete");
    const detail = await getStatementDetail(mainId);
    const ARow = detail?.lines.find((line) => line.id === A);
    assert.ok(ARow != null && ARow.importLive === false);

    const restoredTx = await restoreTransaction(TEST_USER, txId);
    assert.ok(restoredTx.ok, "ledger restore succeeds");
    assert.ok(await liveTransactionId(A) != null, "the line sees the restore and is live again");

    const attempt = await importStatementLines(TEST_USER, mainId, [A]);
    assert.ok(attempt.ok && attempt.imported === 0 && attempt.failed === 1);
    assert.ok(!attempt.results[0].ok && /already been imported/i.test(attempt.results[0].error));
    ok("ledger: a restored import is live again and cannot be double-imported");
  }

  // ── Statement completion follows the row states ────────────────────────────
  {
    for (const lineRowNumber of [4, 8, 9, 10]) {
      const duplicate = await markLineDuplicate(TEST_USER, mainId, await row(mainId, lineRowNumber), "Reviewed — retired in tests");
      assert.ok(duplicate.ok, `row ${lineRowNumber} should close as duplicate`);
    }

    const stateBeforeLastBatch = await statementState(mainId);
    assert.equal(stateBeforeLastBatch.status, "review");

    const D = await row(mainId, 4);
    const closedRetry = await importStatementLines(TEST_USER, mainId, [D]);
    assert.ok(closedRetry.ok && closedRetry.imported === 0 && closedRetry.failed === 1);
    assert.ok(!closedRetry.results[0].ok && /marked as a duplicate/i.test(closedRetry.results[0].error));
    assert.equal((await statementState(mainId)).status, "review", "ready rows still exist — stay in review");
    ok("statement: closed duplicates cannot import and the statement stays in review");

    const dupG = await markLineDuplicate(TEST_USER, mainId, await row(mainId, 7), "Reviewed — retired in tests");
    assert.ok(dupG.ok);

    const G = await row(mainId, 7);
    const closer = await importStatementLines(TEST_USER, mainId, [G]);
    assert.ok(closer.ok && closer.imported === 0 && closer.failed === 1);
    assert.equal(closer.statementStatus, "completed");
    const completedState = await statementState(mainId);
    assert.equal(completedState.status, "completed");
    assert.ok(completedState.completedAt != null);
    ok("statement: when the last rows resolve, the next batch completes the statement");

    const locked = await importStatementLines(TEST_USER, mainId, [G]);
    assert.ok(!locked.ok && locked.error === "This statement is no longer importable.");
    ok("statement: completed statements are locked against further imports");
  }

  // ── Completion on a clean statement ────────────────────────────────────────
  {
    const K1 = await row(completeId, 1);
    const K2 = await row(completeId, 2);
    await mapIncomeReady(completeId, K1, clientId1);
    await mapExpenseReady(completeId, K2, categoryId);
    const result = await importStatementLines(TEST_USER, completeId, [K1, K2]);
    assert.ok(result.ok && result.imported === 2);
    assert.equal(result.statementStatus, "completed");
    const state = await statementState(completeId);
    assert.equal(state.status, "completed");
    assert.ok(state.completedAt != null);
    ok("statement: importing the last ready rows completes the statement in the same action");
  }

  // ── Concurrent imports fighting over one invoice ───────────────────────────
  {
    const L1 = await row(concurrentId, 1);
    const L2 = await row(concurrentId, 2);
    await mapIncomeReady(concurrentId, L1, clientId1, invoiceConcurrent);
    await mapIncomeReady(concurrentId, L2, clientId1, invoiceConcurrent);

    const race = await Promise.allSettled([
      importStatementLines(TEST_USER, concurrentId, [L1]),
      importStatementLines(TEST_USER, concurrentId, [L2]),
    ]);
    const outcomes = race.map((entry) => (entry.status === "fulfilled" ? entry.value : null));
    assert.ok(outcomes.every((value) => value != null && value.ok), "both batch calls returned batch-ok");
    const winners = outcomes.filter((value) => value !== null && value.imported === 1);
    const losers = outcomes.filter((value) => value !== null && value.imported === 0);
    assert.equal(winners.length, 1, "exactly one import wins the invoice balance");
    assert.equal(losers.length, 1);
    const loser = losers[0];
    const loserResult = loser !== null ? loser.results[0] : null;
    const loserLineId = loserResult !== null && !loserResult.ok ? loserResult.lineId : "";
    assert.ok(loserResult !== null && !loserResult.ok && /exceeds the invoice/i.test(loserResult.error));
    assert.equal(await invoicePaid(INVOICE_CONCURRENT), "600.00");
    const loserLine = await lineRow(loserLineId);
    assert.equal(loserLine.status, "ready", "the losing line stays ready for a corrected retry");
    ok("concurrency: row locks serialize competing invoice payments to one winner");
  }

  // ── Finance-AI isolation + audit hygiene ───────────────────────────────────
  {
    assert.equal(await count("chat_sessions"), before.chatSessions, "Finance AI chats untouched");
    ok("isolation: no chat session was created, read into, or written by imports");

    const audits = await db.execute(sql`
      SELECT before_state AS b, after_state AS a FROM audit_events
      WHERE entity_type = 'bank_statement_line' AND entity_id IN (
        SELECT id::text FROM bank_statement_lines
        WHERE statement_id IN (SELECT id FROM bank_statements WHERE file_name = ANY(${FILES_SQL}))
      )
    `);
    const serialized = JSON.stringify(audits.rows);
    for (const narration of ["INVOICE RECEIPT ONE", "OFFICE RENT", "RACE RECEIPT ONE"]) {
      assert.ok(!serialized.includes(narration), `line audits must not carry "${narration}"`);
    }
    for (const amount of ["1000.00", "250.00"]) {
      assert.ok(!serialized.includes(amount), `line audits must not carry ${amount}`);
    }
    ok("audit: import events record state and attempts without narration or amounts");
  }

  // ── Exactly-once financial effect ──────────────────────────────────────────
  {
    // A(:a3) + B + C + E + F + K1 + K2 + one race winner = 8 live imports.
    // A's a1/a2 and the retired replacement stay soft-deleted.
    const liveImports = await liveImportedTransactionCount();
    assert.equal(liveImports, 8, `live imports should be 8, found ${liveImports}`);

    const linked = await db.execute(sql`
      SELECT count(*)::int AS n FROM bank_statement_lines WHERE transaction_id IS NOT NULL
    `);
    const linkedImported = await db.execute(sql`
      SELECT count(*)::int AS n FROM bank_statement_lines
      WHERE transaction_id IS NOT NULL AND status = 'imported'
    `);
    assert.equal(
      Number((linked.rows[0] as unknown as { n: number }).n),
      Number((linkedImported.rows[0] as unknown as { n: number }).n),
      "every linked line is an imported line — no dangling or partial links",
    );
    ok("exactly-once: staging links match live financial rows; nothing double-counted");
  }

  await cleanup();
  const after = { transactions: await count("transactions"), invoices: await count("invoices") };
  assert.equal(after.transactions, before.transactions, "cleanup removes every imported transaction");
  assert.equal(after.invoices, before.invoices, "cleanup removes the seeded invoices");
  ok("cleanup: staging, transactions, invoices and audits removed");

  console.log(`\nimport-db: ${passed} passed, 0 failed`);
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
