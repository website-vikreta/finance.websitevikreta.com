/**
 * DB-backed Financial Integration Tests for Bank Import.
 *
 * Proves that a confirmed imported transaction is reflected exactly once in
 * every financial read path:
 * 1. Dashboard income/expense monthly totals, year totals, and category/client breakdowns.
 * 2. Transaction ledger listing and transaction counts.
 * 3. Client summaries (totalReceived, payments count, lastPaymentDate).
 * 4. Invoices paid and balance calculations (linked to valid issued invoices).
 * 5. Report CSV and Ledger CSV generation.
 *
 * Also verifies:
 * - Staging rows, skipped rows, and duplicate rows have ZERO financial effect.
 * - Idempotent re-import does not duplicate financial effects.
 * - Soft-deleting an imported transaction cleanly updates all financial read paths.
 * - Restoring the transaction restores its exact financial effects.
 * - Unrelated records remain untouched throughout.
 */

import assert from "node:assert/strict";
import * as path from "path";
import "../../__tests__/test-db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { createBankAccount, persistStatement } from "../persistence";
import { markLineDuplicate, markLineReady, skipLine, updateLineReview } from "../review";
import { importStatementLines } from "../import";
import {
  expenseBreakdown,
  incomeBreakdown,
  listLedger,
  monthlyTotals,
  monthlyTotalsForYear,
  rangeSummary,
  clientSummaries,
} from "../../transactions/queries";
import { toCsv } from "../../transactions/csv";
import { toReportCsv } from "../../reports/csv";
import { getInvoice, listInvoices, receivables } from "../../invoices/invoices";
import { deleteTransaction, restoreTransaction } from "../../transactions/manage";
import { todayInIndia } from "../../transactions/period";
import type { ParsedStatement } from "../types";

const TEST_USER = "admin";
const ACCOUNT_NAME = "Fin Integration Test Account";
const FILE_NAME = "fin-integration-statement.pdf";
const CLIENT_NAME = "Fin Integration Client Pvt Ltd";
const CATEGORY_NAME = "Fin Test Operations";
const INVOICE_NUMBER = "WV/2026-27/888";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function hexToken(index: number): string {
  return index.toString(16).padStart(64, "0").slice(-64);
}

async function cleanup(): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Delete staging lines & statements
    await tx.execute(sql`
      DELETE FROM bank_statement_lines
      WHERE statement_id IN (SELECT id FROM bank_statements WHERE file_name = ${FILE_NAME})
    `);
    await tx.execute(sql`DELETE FROM bank_statements WHERE file_name = ${FILE_NAME}`);

    // 2. Delete test transactions created by bank_import or test user
    await tx.execute(sql`
      DELETE FROM transactions
      WHERE (source = 'bank_import' AND created_by = ${TEST_USER})
         OR client_name_snapshot = ${CLIENT_NAME}
    `);

    // 3. Delete invoice items & invoice
    await tx.execute(sql`
      DELETE FROM invoice_items
      WHERE invoice_id IN (SELECT id FROM invoices WHERE number = ${INVOICE_NUMBER})
    `);
    await tx.execute(sql`DELETE FROM invoices WHERE number = ${INVOICE_NUMBER}`);

    // 4. Delete client, category, bank account
    await tx.execute(sql`DELETE FROM clients WHERE client_name = ${CLIENT_NAME}`);
    await tx.execute(sql`DELETE FROM categories WHERE name = ${CATEGORY_NAME}`);
    await tx.execute(sql`DELETE FROM bank_accounts WHERE display_name = ${ACCOUNT_NAME}`);
  });
}

async function applyMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, "../../../drizzle");
  await migrate(db, { migrationsFolder });
}

async function run(): Promise<void> {
  await applyMigrations();
  await cleanup();

  const today = todayInIndia(); // e.g. "2026-10-23"
  const currentYear = new Date(`${today}T00:00:00Z`).getUTCFullYear();
  const currentMonthStart = `${today.slice(0, 7)}-01`;

  // ── 1. Setup Test Master Data ─────────────────────────────────────────────
  const accountRes = await createBankAccount(TEST_USER, {
    displayName: ACCOUNT_NAME,
    bankName: "Fin Bank",
    last4: "9988",
  });
  assert.ok(accountRes.ok);
  const accountId = accountRes.value;

  // Insert test category
  const [catRow] = (
    await db.execute(
      sql`INSERT INTO categories (name) VALUES (${CATEGORY_NAME}) RETURNING id`,
    )
  ).rows as unknown as [{ id: number }];
  const categoryId = Number(catRow.id);

  // Insert test client
  const [clientRow] = (
    await db.execute(
      sql`INSERT INTO clients (client_name, country) VALUES (${CLIENT_NAME}, 'India') RETURNING client_id`,
    )
  ).rows as unknown as [{ client_id: string }];
  const clientId = clientRow.client_id;

  // Insert an issued INR invoice for 3,000.00
  const [invoiceRow] = (
    await db.execute(sql`
      INSERT INTO invoices (
        client_id, number, fy, seq, status, bill_to_name, bill_to_country, currency,
        issue_date, due_date, tax_type, gst_rate, subtotal, total, created_by
      ) VALUES (
        ${clientId}::uuid, ${INVOICE_NUMBER}, '2026-27', 888, 'sent', ${CLIENT_NAME}, 'India', 'INR',
        ${today}::date, ${today}::date, 'none', 0, 3000.00, 3000.00, ${TEST_USER}
      ) RETURNING id
    `)
  ).rows as unknown as [{ id: string }];
  const invoiceId = invoiceRow.id;

  ok("setup: test account, client, category, and issued invoice ready");

  // ── 2. Capture Baselines ──────────────────────────────────────────────────
  const baselineLedger = await listLedger();
  const baselineMonthly = await monthlyTotals(12);
  const baselineCurrentMonth = baselineMonthly.find((m) => m.month === currentMonthStart) ?? {
    month: currentMonthStart,
    income: 0,
    expense: 0,
  };
  const baselineYearTotals = await monthlyTotalsForYear(currentYear);
  const baselineClientSummary = (await clientSummaries()).find((c) => c.id === clientId) ?? {
    totalReceived: 0,
    payments: 0,
    lastPaymentDate: null,
  };
  const baselineInvoice = await getInvoice(invoiceId);
  assert.ok(baselineInvoice);
  assert.equal(baselineInvoice.paid, "0.00", "baseline invoice has 0 paid");

  ok("baseline: financial read paths captured before staging");

  // ── 3. Stage Statement and Verify Staging Isolation ───────────────────────
  const parsedStatement: ParsedStatement = {
    currency: "INR",
    pages: 1,
    statementFrom: currentMonthStart,
    statementTo: today,
    openingBalance: "10000.00",
    closingBalance: "10850.00",
    warnings: [],
    lines: [
      {
        pageNumber: 1,
        rowNumber: 1,
        txnDate: today,
        valueDate: today,
        narration: "CLIENT PAYMENT INV-888",
        reference: "DEP-01",
        withdrawalAmount: null,
        depositAmount: "1250.00",
        closingBalance: null,
        direction: "deposit",
        classification: "income",
        status: "pending",
        fingerprint: hexToken(101),
        flags: [],
        errorCode: null,
      },
      {
        pageNumber: 1,
        rowNumber: 2,
        txnDate: today,
        valueDate: today,
        narration: "OFFICE EXPENSE CLOUD",
        reference: "WTH-02",
        withdrawalAmount: "400.00",
        depositAmount: null,
        closingBalance: null,
        direction: "withdrawal",
        classification: "expense",
        status: "pending",
        fingerprint: hexToken(102),
        flags: [],
        errorCode: null,
      },
      {
        pageNumber: 1,
        rowNumber: 3,
        txnDate: today,
        valueDate: today,
        narration: "PERSONAL COFFEE",
        reference: "WTH-03",
        withdrawalAmount: "50.00",
        depositAmount: null,
        closingBalance: null,
        direction: "withdrawal",
        classification: "expense",
        status: "pending",
        fingerprint: hexToken(103),
        flags: [],
        errorCode: null,
      },
      {
        pageNumber: 1,
        rowNumber: 4,
        txnDate: today,
        valueDate: today,
        narration: "REFUND DUPLICATE ENTRY",
        reference: "DEP-04",
        withdrawalAmount: null,
        depositAmount: "100.00",
        closingBalance: null,
        direction: "deposit",
        classification: "income",
        status: "pending",
        fingerprint: hexToken(104),
        flags: [],
        errorCode: null,
      },
    ],
  };

  const staged = await persistStatement({
    accountId,
    userId: TEST_USER,
    fileName: FILE_NAME,
    fileSha256: hexToken(555),
    fileSizeBytes: 4096,
    parsed: parsedStatement,
  });
  assert.ok(staged.ok);
  const statementId = staged.value.statementId;

  // Retrieve line IDs
  const lineRows = (
    await db.execute(sql`
      SELECT id, row_number AS "rowNumber" FROM bank_statement_lines
      WHERE statement_id = ${statementId}::uuid
      ORDER BY row_number ASC
    `)
  ).rows as unknown as Array<{ id: string; rowNumber: number }>;

  const line1 = lineRows.find((r) => r.rowNumber === 1)!.id;
  const line2 = lineRows.find((r) => r.rowNumber === 2)!.id;
  const line3 = lineRows.find((r) => r.rowNumber === 3)!.id;
  const line4 = lineRows.find((r) => r.rowNumber === 4)!.id;

  // Skip line 3 and mark line 4 as duplicate
  const skipRes = await skipLine(TEST_USER, statementId, line3, "Personal expense");
  assert.ok(skipRes.ok);
  const dupRes = await markLineDuplicate(TEST_USER, statementId, line4, "Duplicate refund");
  assert.ok(dupRes.ok);

  // Assert staging rows NEVER bleed into financial queries:
  const stagingLedger = await listLedger();
  assert.equal(stagingLedger.length, baselineLedger.length, "staging rows not in ledger");

  const stagingMonthly = await monthlyTotals(12);
  const stagingCurMonth = stagingMonthly.find((m) => m.month === currentMonthStart)!;
  assert.equal(stagingCurMonth.income, baselineCurrentMonth.income, "staging rows not in monthly income");
  assert.equal(stagingCurMonth.expense, baselineCurrentMonth.expense, "staging rows not in monthly expense");

  const stagingInvoice = await getInvoice(invoiceId);
  assert.equal(stagingInvoice?.paid, "0.00", "staging rows not in invoice paid");

  ok("isolation: staging, skipped, and duplicate lines have ZERO financial effect");

  // ── 4. Map & Import Approved Lines ────────────────────────────────────────
  // Map line 1 to client and invoice
  const map1 = await updateLineReview(TEST_USER, statementId, line1, {
    classification: "income",
    clientId,
    invoiceId,
  });
  assert.ok(map1.ok);
  const ready1 = await markLineReady(TEST_USER, statementId, line1);
  assert.ok(ready1.ok);

  // Map line 2 to expense category
  const map2 = await updateLineReview(TEST_USER, statementId, line2, {
    classification: "expense",
    categoryId,
  });
  assert.ok(map2.ok);
  const ready2 = await markLineReady(TEST_USER, statementId, line2);
  assert.ok(ready2.ok);

  // Import lines 1 and 2
  const importRes = await importStatementLines(TEST_USER, statementId, [line1, line2]);
  assert.ok(importRes.ok);
  assert.equal(importRes.imported, 2);
  assert.equal(importRes.failed, 0);

  const r1 = importRes.results.find((r) => r.lineId === line1);
  const r2 = importRes.results.find((r) => r.lineId === line2);
  assert.ok(r1 && r1.ok);
  assert.ok(r2 && r2.ok);
  const tx1Id = r1.transactionId;
  const tx2Id = r2.transactionId;
  assert.ok(tx1Id && tx2Id);

  ok("import: confirmed income (linked to invoice) and expense successfully imported");

  // ── 5. Verify Financial Read Paths (Exactly Once) ─────────────────────────

  // A. Dashboard Monthly Totals
  const postMonthly = await monthlyTotals(12);
  const postCurMonth = postMonthly.find((m) => m.month === currentMonthStart)!;
  assert.equal(
    postCurMonth.income,
    baselineCurrentMonth.income + 1250,
    "dashboard monthly income increased by exactly 1250",
  );
  assert.equal(
    postCurMonth.expense,
    baselineCurrentMonth.expense + 400,
    "dashboard monthly expense increased by exactly 400",
  );
  ok("dashboard: monthly income and expense totals updated exactly once");

  // B. Dashboard Year Totals & Range Summary
  const postYearTotals = await monthlyTotalsForYear(currentYear);
  const postYearCurMonth = postYearTotals.find((m) => m.month === currentMonthStart)!;
  const baselineYearCurMonth = baselineYearTotals.find((m) => m.month === currentMonthStart);
  assert.equal(postYearCurMonth.income, (baselineYearCurMonth?.income ?? 0) + 1250);
  assert.equal(postYearCurMonth.expense, (baselineYearCurMonth?.expense ?? 0) + 400);

  const range = await rangeSummary(`${currentYear}-01-01`, `${currentYear}-12-31`, null);
  assert.ok(range.income >= 1250 && range.expense >= 400);
  ok("dashboard: yearly totals and range summaries reflect imported transactions");

  // C. Income & Expense Breakdowns
  const inBreakdown = await incomeBreakdown(currentMonthStart);
  const clientEntry = inBreakdown.find((b) => b.name === CLIENT_NAME);
  assert.ok(clientEntry, "client appears in income breakdown");
  assert.equal(clientEntry.amount, 1250);
  assert.equal(clientEntry.count, 1);

  const expBreakdown = await expenseBreakdown(currentMonthStart);
  const catEntry = expBreakdown.find((b) => b.name === CATEGORY_NAME);
  assert.ok(catEntry, "category appears in expense breakdown");
  assert.equal(catEntry.amount, 400);
  assert.equal(catEntry.count, 1);
  ok("dashboard: income and expense breakdown donut queries reflect imported rows");

  // D. Transaction Ledger
  const postLedger = await listLedger();
  assert.equal(postLedger.length, baselineLedger.length + 2, "ledger count increased by 2");

  const ledgerRow1 = postLedger.find((r) => r.id === tx1Id);
  assert.ok(ledgerRow1, "income transaction present in ledger");
  assert.equal(ledgerRow1.type, "income");
  assert.equal(ledgerRow1.amountInr, 1250);
  assert.equal(ledgerRow1.originalAmount, 1250);
  assert.equal(ledgerRow1.originalCurrency, "INR");
  assert.equal(ledgerRow1.clientName, CLIENT_NAME);
  assert.equal(ledgerRow1.source, "bank_import");

  const ledgerRow2 = postLedger.find((r) => r.id === tx2Id);
  assert.ok(ledgerRow2, "expense transaction present in ledger");
  assert.equal(ledgerRow2.type, "expense");
  assert.equal(ledgerRow2.amountInr, 400);
  assert.equal(ledgerRow2.category, CATEGORY_NAME);
  assert.equal(ledgerRow2.source, "bank_import");
  ok("ledger: listLedger returns both imported transactions with exact source and amounts");

  // E. Client Summary
  const postClients = await clientSummaries();
  const clientSummary = postClients.find((c) => c.id === clientId);
  assert.ok(clientSummary);
  assert.equal(clientSummary.totalReceived, baselineClientSummary.totalReceived + 1250);
  assert.equal(clientSummary.payments, baselineClientSummary.payments + 1);
  assert.equal(clientSummary.lastPaymentDate, today);
  ok("clients: clientSummaries reflects imported receipt and payment count");

  // F. Invoice Paid & Balance Calculations
  const postInvoice = await getInvoice(invoiceId);
  assert.ok(postInvoice);
  assert.equal(postInvoice.paid, "1250.00", "invoice paid increased from 0 to 1250.00");
  assert.equal(postInvoice.payments.length, 1);
  assert.equal(postInvoice.payments[0].amount, "1250.00");

  const postInvoicesList = await listInvoices();
  const listInv = postInvoicesList.find((i) => i.id === invoiceId);
  assert.equal(listInv?.paid, "1250.00", "listInvoices calculates exact paid sum");

  const rec = await receivables(today);
  const clientOwed = rec.byClient.get(clientId);
  assert.ok(clientOwed);
  // Total was 3000, 1250 paid -> remaining due = 1750
  assert.equal(clientOwed.INR, 1750, "receivables balance reduced exactly to 1750.00");
  ok("invoices: invoice paid, balance, and receivables move exactly");

  // G. CSV Exports (Ledger CSV & Report CSV)
  const ledgerCsv = toCsv(postLedger);
  assert.ok(ledgerCsv.includes('"Bank Statement"'), "ledger CSV contains Bank Statement source");
  assert.ok(ledgerCsv.includes(CLIENT_NAME), "ledger CSV contains client name");
  assert.ok(ledgerCsv.includes(CATEGORY_NAME), "ledger CSV contains category name");
  assert.ok(ledgerCsv.includes('"1250.00"'), "ledger CSV contains income amount");
  assert.ok(ledgerCsv.includes('"400.00"'), "ledger CSV contains expense amount");
  assert.ok(ledgerCsv.includes(`" ${today}"`), "ledger CSV writes dates as text-forced YYYY-MM-DD (Excel never shows ######)");

  const reportCsv = toReportCsv({
    periodLabel: "This Month",
    from: currentMonthStart,
    today,
    generatedAt: "12:00",
    income: inBreakdown,
    expenses: expBreakdown,
    months: postMonthly,
    selectedYear: currentYear,
    rows: postLedger,
  });
  assert.ok(reportCsv.includes("SUMMARY"), "report CSV contains SUMMARY section");
  assert.ok(reportCsv.includes(CLIENT_NAME), "report CSV includes imported client");
  assert.ok(reportCsv.includes(CATEGORY_NAME), "report CSV includes imported category");
  ok("exports: toCsv and toReportCsv export the imported transactions accurately");

  // ── 6. Retry Rejection (Idempotency Guarantee) ────────────────────────────
  const retryRes = await importStatementLines(TEST_USER, statementId, [line1, line2]);
  assert.ok(
    (!retryRes.ok && /no longer importable/i.test(retryRes.error ?? "")) ||
      (retryRes.ok && retryRes.imported === 0 && retryRes.failed === 2),
    "retry is safely rejected without creating new transactions",
  );

  // Verify financial read paths remained completely identical
  const postRetryMonthly = await monthlyTotals(12);
  const postRetryCurMonth = postRetryMonthly.find((m) => m.month === currentMonthStart)!;
  assert.equal(postRetryCurMonth.income, postCurMonth.income, "retry does not increase income");
  assert.equal(postRetryCurMonth.expense, postCurMonth.expense, "retry does not increase expense");

  const postRetryInvoice = await getInvoice(invoiceId);
  assert.equal(postRetryInvoice?.paid, "1250.00", "retry does not double invoice payment");
  ok("idempotency: retrying already-imported lines is safely rejected without financial changes");

  // ── 7. Soft Delete & Restoration ──────────────────────────────────────────
  // Soft delete the income transaction
  const delRes = await deleteTransaction(TEST_USER, tx1Id);
  assert.ok(delRes.ok);

  // Verify financial read paths immediately revert
  const postDelLedger = await listLedger();
  assert.equal(postDelLedger.some((r) => r.id === tx1Id), false, "deleted transaction excluded from ledger");

  const postDelInvoice = await getInvoice(invoiceId);
  assert.equal(postDelInvoice?.paid, "0.00", "invoice paid drops back to 0.00 upon payment deletion");

  const postDelMonthly = await monthlyTotals(12);
  const postDelCurMonth = postDelMonthly.find((m) => m.month === currentMonthStart)!;
  assert.equal(postDelCurMonth.income, baselineCurrentMonth.income, "monthly income reverts to baseline");

  // Restore the income transaction
  const restRes = await restoreTransaction(TEST_USER, tx1Id);
  assert.ok(restRes.ok);

  // Verify financial read paths restore
  const postRestLedger = await listLedger();
  assert.equal(postRestLedger.some((r) => r.id === tx1Id), true, "restored transaction reappears in ledger");

  const postRestInvoice = await getInvoice(invoiceId);
  assert.equal(postRestInvoice?.paid, "1250.00", "invoice paid restores to 1250.00");

  const postRestMonthly = await monthlyTotals(12);
  const postRestCurMonth = postRestMonthly.find((m) => m.month === currentMonthStart)!;
  assert.equal(postRestCurMonth.income, baselineCurrentMonth.income + 1250, "monthly income restored to +1250");

  ok("lifecycle: soft-delete and restoration cleanly update all financial read paths");

  // ── 8. Cleanup and Final Integrity ────────────────────────────────────────
  await cleanup();
  const finalLedger = await listLedger();
  assert.equal(finalLedger.length, baselineLedger.length, "final ledger matches initial baseline");

  ok("cleanup: test transactions, invoices, and staging rows cleaned cleanly");
  console.log(`\nfinancial-integration-db: ${passed} checks passed`);
}

run()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
