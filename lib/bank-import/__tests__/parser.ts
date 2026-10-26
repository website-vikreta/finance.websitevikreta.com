/**
 * Offline Phase 1 checks for bank-import parsing, normalization, validation,
 * and classification. No DB queries and no PDF library calls.
 *
 * Run: npm run test:bank-import
 */
import assert from "node:assert/strict";
import { classifyLine } from "../classify";
import {
  decimalAdd,
  decimalCompare,
  decimalSubtract,
  isEmptyAmountPlaceholder,
  normalizeNarration,
  parseAmountCell,
  parseDateCell,
} from "../normalize";
import { parseStatementPages, parseStatementText } from "../parse";
import { reconcileStatement, validateLineForImport, validateLineForReady } from "../validate";
import { BankImportError, type ParsedLine } from "../types";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function assertThrowsCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof BankImportError, `expected BankImportError, got ${String(error)}`);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`expected BankImportError ${code}`);
}

const HEADER =
  "Date\tValue Date\tNarration\tChq./Ref.No.\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance";

function statement(...rows: string[]): string {
  return [
    "ACME BANK",
    "Statement Period: 13/04/2026 to 30/04/2026",
    "Opening Balance: 10,000.00",
    HEADER,
    ...rows,
    "Closing Balance: 14,000.00",
  ].join("\n");
}

// ── Dates ────────────────────────────────────────────────────────────────────
{
  const d = parseDateCell("13/04/2026");
  assert.deepEqual(d, { ok: true, value: "2026-04-13", ambiguous: false, twoDigitYear: false });
  ok("date: DD/MM/YYYY with day > 12");

  const ambiguous = parseDateCell("01/04/2026");
  assert.ok(ambiguous.ok && ambiguous.ambiguous);
  assert.equal(ambiguous.value, "2026-04-01");
  ok("date: DD/MM candidate is flagged ambiguous");

  const named = parseDateCell("13-Apr-2026");
  assert.ok(named.ok);
  assert.equal(named.value, "2026-04-13");
  ok("date: DD-MMM-YYYY");

  const iso = parseDateCell("2026-04-13");
  assert.ok(iso.ok);
  assert.equal(iso.value, "2026-04-13");
  ok("date: YYYY-MM-DD");

  assert.equal(parseDateCell("31/02/2026").ok, false);
  ok("date: impossible calendar date rejected");

  const shortYear = parseDateCell("13/04/26");
  assert.ok(shortYear.ok && shortYear.twoDigitYear);
  assert.equal(shortYear.value, "2026-04-13");
  ok("date: two-digit year retained with a flag");
}

// ── Amounts and exact decimal arithmetic ────────────────────────────────────
{
  const inr = parseAmountCell("₹ 1,23,456.78");
  assert.ok(inr.ok);
  assert.equal(inr.value, "123456.78");
  assert.equal(inr.negative, false);
  ok("amount: Indian grouping and rupee prefix");

  const dr = parseAmountCell("500.00 Dr");
  assert.ok(dr.ok && dr.indicator === "dr");
  assert.equal(dr.value, "500.00");
  ok("amount: Dr suffix");

  const para = parseAmountCell("(500.00)");
  assert.ok(para.ok && para.negative);
  assert.equal(para.value, "-500.00");
  ok("amount: parentheses are negative");

  assert.equal(parseAmountCell("1.234").ok, false);
  ok("amount: more than two decimal places rejected");

  assert.equal(decimalAdd("0.10", "0.20"), "0.30");
  assert.equal(decimalSubtract("100.00", "0.01"), "99.99");
  assert.equal(decimalCompare("99.99", "100.00"), -1);
  ok("decimal: exact two-place arithmetic");

  assert.equal(decimalAdd("9999999999999999.99", "0.01"), "10000000000000000.00");
  ok("decimal: large values do not pass through Number");
}

// ── Basic statement ──────────────────────────────────────────────────────────
{
  const parsed = parseStatementText(
    statement(
      "13/04/2026\t13/04/2026\tUPI/ABC/PAYMENT\tUPI123\t1,000.00\t\t9,000.00",
      "15/04/2026\t15/04/2026\tSALARY CREDIT\tNEFT456\t\t5,000.00\t14,000.00",
    ),
  );

  assert.equal(parsed.currency, "INR");
  assert.equal(parsed.pages, 1);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.statementFrom, "2026-04-13");
  assert.equal(parsed.statementTo, "2026-04-30");
  assert.equal(parsed.openingBalance, "10000.00");
  assert.equal(parsed.closingBalance, "14000.00");
  assert.ok(!parsed.warnings.includes("BALANCE_MISMATCH"));

  const [withdrawal, deposit] = parsed.lines;
  assert.equal(withdrawal.direction, "withdrawal");
  assert.equal(withdrawal.withdrawalAmount, "1000.00");
  assert.equal(withdrawal.depositAmount, null);
  assert.equal(withdrawal.classification, "expense");
  assert.equal(withdrawal.status, "ready");
  assert.equal(withdrawal.txnDate, "2026-04-13");
  assert.equal(withdrawal.valueDate, "2026-04-13");
  assert.equal(withdrawal.pageNumber, 1);
  assert.equal(withdrawal.rowNumber, 1);
  assert.equal(withdrawal.fingerprint.length, 64);
  assert.deepEqual(withdrawal.flags, []);

  assert.equal(deposit.direction, "deposit");
  assert.equal(deposit.depositAmount, "5000.00");
  assert.equal(deposit.classification, "income");
  assert.equal(deposit.status, "ready");
  ok("parse: deposits, withdrawals, dates, balances, and readiness");
}

// ── Malformed rows stay reviewable ───────────────────────────────────────────
{
  const parsed = parseStatementText(
    statement(
      "32/13/2026\t13/04/2026\tBAD DATE\tREF1\t1,000.00\t\t9,000.00",
      "15/04/2026\t15/04/2026\t\tREF2\t1,000.00\t\t8,000.00",
      "16/04/2026\t16/04/2026\tBOTH SIDES\tREF3\t100.00\t200.00\t8,000.00",
      "17/04/2026\t17/04/2026\tZERO AMOUNT\tREF4\t0.00\t\t8,000.00",
      "18/04/2026\t18/04/2026\tBAD AMOUNT\tREF5\t1,00,00.999\t\t8,000.00",
      "19/04/2026\t19/04/2026\tSHORT ROW\tREF6\t\t5,000.00",
      "\t\tMISSING DATE\tREF7\t1,000.00\t\t8,000.00",
    ),
  );

  const [badDate, blankNarration, both, zero, badAmount, shortRow, missingDate] = parsed.lines;
  assert.equal(badDate.txnDate, null);
  assert.ok(badDate.flags.includes("INVALID_DATE"));
  assert.equal(badDate.status, "pending");

  assert.equal(blankNarration.narration, null);
  assert.ok(blankNarration.flags.includes("MISSING_NARRATION"));
  assert.equal(blankNarration.status, "pending");

  assert.ok(both.flags.includes("BOTH_AMOUNTS"));
  assert.equal(both.direction, null);
  assert.equal(both.withdrawalAmount, "100.00");
  assert.equal(both.depositAmount, "200.00");
  assert.equal(both.status, "pending");

  assert.ok(zero.flags.includes("ZERO_AMOUNT"));
  assert.equal(zero.status, "pending");

  assert.ok(badAmount.flags.includes("INVALID_AMOUNT"));
  assert.equal(badAmount.status, "pending");

  assert.ok(shortRow.flags.includes("COLUMN_COUNT_MISMATCH"));
  assert.equal(shortRow.depositAmount, null, "an unaligned closing balance is never used as a deposit");
  assert.equal(shortRow.status, "pending");

  assert.equal(missingDate.txnDate, null);
  assert.ok(missingDate.flags.includes("MISSING_DATE"));
  assert.equal(missingDate.status, "pending");

  ok("parse: invalid date, blank narration, both sides, zero/bad amount, short/missing-date rows are preserved");
}

// ── Ambiguous dates and continuation lines ──────────────────────────────────
{
  const parsed = parseStatementText(
    statement(
      "01/04/2026\t01/04/2026\tACME INDUSTRIES\tREF1\t1,000.00\t\t9,000.00",
      "PVT LTD",
    ),
  );
  const [line] = parsed.lines;
  assert.equal(line.txnDate, "2026-04-01");
  assert.ok(line.flags.includes("AMBIGUOUS_DATE"));
  assert.equal(line.narration, "ACME INDUSTRIES PVT LTD");
  assert.equal(line.status, "pending");
  ok("parse: ambiguous date stays flagged and continuation joins narration");
}

// ── A continuation can fill a blank narration without keeping stale flags ───
{
  const parsed = parseStatementText(
    statement(
      "13/04/2026\t13/04/2026\t\tREF1\t1,000.00\t\t9,000.00",
      "PVT LTD",
    ),
  );
  const [line] = parsed.lines;
  assert.equal(line.narration, "PVT LTD");
  assert.ok(!line.flags.includes("MISSING_NARRATION"));
  assert.equal(line.status, "ready");
  ok("parse: continuation fills a blank narration and clears the stale flag");
}

// ── Multi-page and repeated headers ─────────────────────────────────────────
{
  const parsed = parseStatementPages([
    { pageNumber: 1, text: [HEADER, "13/04/2026\t13/04/2026\tFIRST\tR1\t10.00\t\t9,990.00"].join("\n") },
    {
      pageNumber: 2,
      text: [
        HEADER,
        "15/04/2026\t15/04/2026\tSECOND\tR2\t\t20.00\t10,010.00",
        "Page 2 of 2",
      ].join("\n"),
    },
  ]);

  assert.equal(parsed.pages, 2);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].pageNumber, 1);
  assert.equal(parsed.lines[1].pageNumber, 2);
  assert.equal(parsed.lines[0].rowNumber, 1);
  assert.equal(parsed.lines[1].rowNumber, 1);
  ok("parse: pages, repeated headers, row numbering, footer skipping");
}

// ── Fallback rows are preserved, never guessed ──────────────────────────────
{
  const parsed = parseStatementText(
    statement("13/04/2026 Payment to vendor 1000.00"),
  );
  const [line] = parsed.lines;
  assert.equal(line.txnDate, "2026-04-13");
  assert.ok(line.flags.includes("UNRECOGNIZED_ROW"));
  assert.ok(line.flags.includes("MISSING_AMOUNT"));
  assert.equal(line.withdrawalAmount, null);
  assert.equal(line.depositAmount, null);
  assert.equal(line.status, "pending");
  ok("parse: compact/unmapped row preserved with flags");
}

// ── Single-space PDF text is preserved, not treated as a hidden table ───────
{
  const parsed = parseStatementText(
    [
      "Date Narration Withdrawal Deposit Balance",
      "13/04/2026 Office rent 1,000.00 9,000.00",
    ].join("\n"),
  );
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].txnDate, "2026-04-13");
  assert.ok(parsed.lines[0].flags.includes("UNRECOGNIZED_ROW"));
  assert.equal(parsed.lines[0].status, "pending");
  ok("parse: single-space header keeps rows for review instead of throwing");
}

// ── Classification ──────────────────────────────────────────────────────────
{
  assert.deepEqual(classifyLine("withdrawal", "SELF TRANSFER TO A/C 123"), {
    classification: "transfer",
    flags: ["TRANSFER"],
  });
  assert.deepEqual(classifyLine("deposit", "REFUND FROM MERCHANT"), {
    classification: "refund",
    flags: ["REFUND"],
  });
  assert.deepEqual(classifyLine("deposit", "REVERSAL OF FAILED PAYMENT"), {
    classification: "reversal",
    flags: ["REVERSAL"],
  });
  assert.equal(classifyLine("withdrawal", "BANK CHARGES").classification, "other");
  assert.ok(classifyLine("withdrawal", "CASH WITHDRAWAL").flags.includes("AMBIGUOUS_ENTRY"));
  assert.equal(classifyLine("deposit", "CLIENT PAYMENT").classification, "income");
  assert.equal(classifyLine("withdrawal", "OFFICE RENT").classification, "expense");
  ok("classify: transfers, refunds, reversals, cash, charges, ordinary rows");
}

// ── Validation and mapping gates ────────────────────────────────────────────
{
  const base: ParsedLine = {
    pageNumber: 1,
    rowNumber: 1,
    txnDate: "2026-04-13",
    valueDate: "2026-04-13",
    narration: "OFFICE RENT",
    reference: null,
    withdrawalAmount: "1000.00",
    depositAmount: null,
    closingBalance: "9000.00",
    direction: "withdrawal",
    classification: "expense",
    status: "ready",
    fingerprint: "a".repeat(64),
    flags: [],
    errorCode: null,
  };

  assert.deepEqual(validateLineForReady(base), { ok: true });
  assert.equal(validateLineForReady({ ...base, txnDate: null }).ok, false);
  assert.equal(validateLineForReady({ ...base, narration: "   " }).ok, false);
  assert.equal(validateLineForReady({ ...base, withdrawalAmount: "0.00" }).ok, false);
  assert.equal(validateLineForReady({ ...base, flags: ["TRANSFER"] }).ok, false);
  assert.equal(validateLineForReady({ ...base, classification: "transfer" }).ok, false);

  assert.equal(
    validateLineForImport({ ...base, classification: "expense", categoryId: null, clientId: null }).ok,
    false,
  );
  assert.deepEqual(
    validateLineForImport({ ...base, classification: "expense", categoryId: 3, clientId: null }),
    { ok: true },
  );
  assert.equal(
    validateLineForImport({
      ...base,
      withdrawalAmount: null,
      depositAmount: "1000.00",
      direction: "deposit",
      classification: "income",
      categoryId: null,
      clientId: null,
    }).ok,
    false,
  );
  assert.deepEqual(
    validateLineForImport({
      ...base,
      withdrawalAmount: null,
      depositAmount: "1000.00",
      direction: "deposit",
      classification: "income",
      categoryId: null,
      clientId: "00000000-0000-4000-8000-000000000001",
    }),
    { ok: true },
  );
  ok("validate: readiness and client/category mapping gates");
}

// ── Reconciliation ──────────────────────────────────────────────────────────
{
  const good = reconcileStatement(
    [
      { withdrawalAmount: "100.00", depositAmount: null },
      { withdrawalAmount: null, depositAmount: "50.00" },
    ],
    "1000.00",
    "950.00",
  );
  assert.ok(good.checked && good.ok);
  assert.equal(good.expectedClosing, "950.00");

  const bad = reconcileStatement([{ withdrawalAmount: "100.00", depositAmount: null }], "1000.00", "950.00");
  assert.ok(bad.checked && !bad.ok);
  assert.equal(bad.difference, "50.00");

  const unchecked = reconcileStatement([], null, "950.00");
  assert.equal(unchecked.checked, false);
  ok("validate: exact balance reconciliation");
}

// ── Safe parse errors ───────────────────────────────────────────────────────
{
  assertThrowsCode(() => parseStatementText("No columns here\n13/04/2026 Payment 100.00"), "NO_HEADER");
  assertThrowsCode(() => parseStatementText(`${HEADER}\nClosing Balance: 10,000.00`), "NO_ROWS");
  assertThrowsCode(
    () => parseStatementText(`Currency: USD\n${HEADER}\n13/04/2026\t13/04/2026\tX\tR\t1.00\t\t1.00`),
    "UNSUPPORTED_CURRENCY",
  );
  assertThrowsCode(
    () =>
      parseStatementText(
        statement(
          "13/04/2026\t13/04/2026\tFIRST\tR1\t1.00\t\t9,999.00",
          "15/04/2026\t15/04/2026\tSECOND\tR2\t1.00\t\t9,998.00",
        ),
        { maxRows: 1 },
      ),
    "TOO_MANY_ROWS",
  );
  ok("errors: safe codes for no header, no rows, currency, row limit");
}

// ── Fingerprint stability and normalization helpers ────────────────────────
{
  const parsedA = parseStatementText(
    statement("13/04/2026\t13/04/2026\t  Office   Rent  \tR1\t100.00\t\t9,900.00"),
  );
  const parsedB = parseStatementText(
    statement("13/04/2026\t13/04/2026\tOffice Rent\tR1\t100.00\t\t9,900.00"),
  );
  assert.equal(parsedA.lines[0].fingerprint, parsedB.lines[0].fingerprint);
  assert.equal(normalizeNarration("  Office   Rent  "), "Office Rent");
  ok("fingerprint: whitespace-normalized and stable");
}

// ── 7-column header with em dash / en dash / hyphen placeholders and exact reconciliation ──
{
  assert.equal(isEmptyAmountPlaceholder("—"), true);
  assert.equal(isEmptyAmountPlaceholder("–"), true);
  assert.equal(isEmptyAmountPlaceholder("-"), true);
  assert.equal(isEmptyAmountPlaceholder("--"), true);
  assert.equal(isEmptyAmountPlaceholder("nil"), true);
  assert.equal(isEmptyAmountPlaceholder("N/A"), true);
  assert.equal(isEmptyAmountPlaceholder("  .  "), true);
  assert.equal(isEmptyAmountPlaceholder("500.00"), false);
  ok("placeholder: em dash, en dash, hyphen, and nil safely recognized as empty");

  const SEVEN_COL_HEADER =
    "Date\tNarration\tChq./Ref.No.\tValue Dt\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance";

  const sevenColText = [
    "DEMO BANK",
    "Statement Period: 15/10/2026 to 25/10/2026",
    "Opening Balance: 100,000.00",
    SEVEN_COL_HEADER,
    "15-Oct-2026\tSYNTHETIC CLIENT PAYMENT\tREF-A\t15-Oct-2026\t—\t50,000.00\t150,000.00",
    "18-Oct-2026\tSYNTHETIC HOSTING BILL\tREF-B\t18-Oct-2026\t4,500.00\t–\t145,500.00",
    "20-Oct-2026\tSYNTHETIC INTERNAL TRANSFER\tREF-C\t20-Oct-2026\t10,000.00\t-\t135,500.00",
    "22-Oct-2026\tSYNTHETIC INTERNET BILL\tREF-D\t22-Oct-2026\t1,500.00\t—\t134,000.00",
    "25-Oct-2026\tSYNTHETIC MALFORMED ROW\tREF-E\t25-Oct-2026\t2,000.00\t2,000.00\t134,000.00",
    "Closing Balance: 134,000.00",
  ].join("\n");

  const parsed = parseStatementText(sevenColText);

  assert.equal(parsed.currency, "INR");
  assert.equal(parsed.openingBalance, "100000.00");
  assert.equal(parsed.closingBalance, "134000.00");
  assert.equal(parsed.lines.length, 5);

  // Line 1: Income
  const income = parsed.lines[0];
  assert.equal(income.txnDate, "2026-10-15");
  assert.equal(income.valueDate, "2026-10-15");
  assert.equal(income.narration, "SYNTHETIC CLIENT PAYMENT");
  assert.equal(income.reference, "REF-A");
  assert.equal(income.withdrawalAmount, null);
  assert.equal(income.depositAmount, "50000.00");
  assert.equal(income.closingBalance, "150000.00");
  assert.equal(income.direction, "deposit");
  assert.equal(income.classification, "income");
  assert.equal(income.status, "ready");
  assert.deepEqual(income.flags, []);

  // Line 2: AWS Expense
  const aws = parsed.lines[1];
  assert.equal(aws.txnDate, "2026-10-18");
  assert.equal(aws.valueDate, "2026-10-18");
  assert.equal(aws.narration, "SYNTHETIC HOSTING BILL");
  assert.equal(aws.reference, "REF-B");
  assert.equal(aws.withdrawalAmount, "4500.00");
  assert.equal(aws.depositAmount, null);
  assert.equal(aws.closingBalance, "145500.00");
  assert.equal(aws.direction, "withdrawal");
  assert.equal(aws.classification, "expense");
  assert.equal(aws.status, "ready");
  assert.deepEqual(aws.flags, []);

  // Line 3: Internal Transfer
  const transfer = parsed.lines[2];
  assert.equal(transfer.txnDate, "2026-10-20");
  assert.equal(transfer.narration, "SYNTHETIC INTERNAL TRANSFER");
  assert.equal(transfer.withdrawalAmount, "10000.00");
  assert.equal(transfer.depositAmount, null);
  assert.equal(transfer.closingBalance, "135500.00");
  assert.equal(transfer.direction, "withdrawal");
  assert.equal(transfer.classification, "transfer");
  assert.ok(transfer.flags.includes("TRANSFER"));

  // Line 4: Internet Expense
  const internet = parsed.lines[3];
  assert.equal(internet.txnDate, "2026-10-22");
  assert.equal(internet.narration, "SYNTHETIC INTERNET BILL");
  assert.equal(internet.withdrawalAmount, "1500.00");
  assert.equal(internet.depositAmount, null);
  assert.equal(internet.closingBalance, "134000.00");
  assert.equal(internet.direction, "withdrawal");
  assert.equal(internet.classification, "expense");
  assert.equal(internet.status, "ready");

  // Line 5: Intentionally Malformed
  const malformed = parsed.lines[4];
  assert.equal(malformed.withdrawalAmount, "2000.00");
  assert.equal(malformed.depositAmount, "2000.00");
  assert.ok(malformed.flags.includes("BOTH_AMOUNTS"));
  assert.equal(malformed.status, "pending");
  assert.equal(validateLineForReady(malformed).ok, false);

  // Exact reconciliation of valid lines: 100,000 + 50,000 - 4,500 - 10,000 - 1,500 = 134,000
  const recon = reconcileStatement(parsed.lines.slice(0, 4), "100000.00", "134000.00");
  assert.equal(recon.checked, true);
  if (recon.checked) {
    assert.equal(recon.ok, true);
    assert.equal(recon.expectedClosing, "134000.00");
    assert.equal(recon.difference, "0.00");
  }

  ok("parse: 7-column layout, placeholders (—, –, -), amounts, directions, transfer flag, malformed row, and exact reconciliation");
}

// ── Source columns stay authoritative; no balance-derived direction ──
{
  const header = "Date\tNarration\tChq./Ref.No.\tValue Dt\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance";
  const parsed = parseStatementText(
    [
      header,
      "13/05/26\tSYNTHETIC OFFICE FEE\tREF-A\t13/05/26\t10.00\t\t990.00",
      "14/05/26\tSYNTHETIC CLIENT PAYMENT\tREF-B\t14/05/26\t\t50.00\t1040.00",
      "15/05/26\tSYNTHETIC REVERSAL\tREF-C\t15/05/26\t-5.00\t\t1035.00",
    ].join("\n"),
  );
  assert.equal(parsed.lines.length, 3);
  assert.equal(parsed.lines[0].withdrawalAmount, "10.00");
  assert.equal(parsed.lines[0].depositAmount, null);
  assert.equal(parsed.lines[0].closingBalance, "990.00");
  assert.equal(parsed.lines[0].direction, "withdrawal");
  assert.equal(parsed.lines[0].status, "ready");
  assert.equal(parsed.lines[1].depositAmount, "50.00");
  assert.equal(parsed.lines[1].withdrawalAmount, null);
  assert.equal(parsed.lines[1].direction, "deposit");
  assert.equal(parsed.lines[1].status, "ready");
  assert.equal(parsed.lines[2].withdrawalAmount, "-5.00");
  assert.ok(parsed.lines[2].flags.includes("NEGATIVE_AMOUNT"));
  assert.ok(!parsed.lines[2].flags.includes("ZERO_AMOUNT"));
  assert.equal(parsed.lines[2].status, "pending");
  ok("source amount columns determine direction; negative values remain blocked for review");
}

// ── A folded amount/balance layout stays pending instead of being guessed ──
{
  const header = "Date\tNarration\tChq./Ref.No.\tValue Dt\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance";
  const parsed = parseStatementText(
    [
      header,
      "13/05/26\tSYNTHETIC FEE\tREF-A\t13/05/26\t10.00\t990.00",
    ].join("\n"),
  );
  const [line] = parsed.lines;
  assert.equal(line.status, "pending");
  assert.ok(line.flags.includes("COLUMN_COUNT_MISMATCH"));
  assert.equal(line.direction, null, "balance position does not establish transaction direction");
  ok("short rows with collapsed empty cells remain pending for manual mapping");
}

console.log(`\nResults: ${passed} passed, 0 failed`);
