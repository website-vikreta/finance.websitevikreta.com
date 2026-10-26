/**
 * Parser + review-model regression fixtures.
 *
 * Synthetic statement text only: no real account identifiers, client names,
 * references or statement text. Amounts, narrations and references are made
 * up so no customer data enters the repository.
 *
 * Run: npm run test:bank-import
 */
import assert from "node:assert/strict";
import { parseStatementPages, parseStatementText } from "../parse";
import {
  effectiveLineFlags,
  evaluateLineEligibility,
  type ReviewLine,
} from "../review";
import { fingerprintLine } from "../normalize";
import { BankImportError, type ParsedLine } from "../types";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// The bank's canonical in-print-order flow: Date, Narration, Chq./Ref.No.,
// Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance. Fixtures use tab
// cells so empty columns keep their positions.
const CANONICAL_HEADER =
  "Date\tNarration\tChq./Ref.No.\tValue Dt\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance";

function row(...cells: string[]): string {
  const padded = cells.slice();
  while (padded.length < 7) padded.push("");
  return padded.slice(0, 7).join("\t");
}

let tableFixtureRows: string[][] = [];

/** Single page used by the table-extraction case. */
function tablePage(): { pageNumber: number; text: string; tables: string[][] }[] {
  return [{ pageNumber: 1, text: "table fixture", tables: tableFixtureRows }];
}

// ── 1. A wrapped incoming transfer is exactly one row ────────────────────────
{
  // No heading row printed at all: the parser must adopt the canonical flow,
  // map the date row, and attach the wrapped reference to that same row.
  const parsed = parseStatementText(
    [
      row("01/06/26", "NEFT CR FROM ACME STUDIOS", "NEFT-N00", "01/06/26", "", "45,000.00", "145,000.00"),
      "N009220661ALPHAPE",
      "13/06/26\tOFFICE POSTAGE\tX2\t13/06/26\t120.00\t\t144,880.00",
    ].join("\n"),
  );

  assert.equal(parsed.lines.length, 2, "no phantom row from wrapped text");
  const wrapped = parsed.lines[0];
  assert.equal(wrapped.txnDate, "2026-06-01");
  assert.equal(wrapped.depositAmount, "45000.00");
  assert.equal(wrapped.withdrawalAmount, null);
  assert.equal(wrapped.closingBalance, "145000.00");
  assert.equal(wrapped.valueDate, "2026-06-01");
  assert.equal(wrapped.direction, "deposit");
  assert.ok(wrapped.narration?.includes("N009220661ALPHAPE"), "wrapped reference line joins the narration");
  assert.equal(wrapped.status, "ready");
  assert.ok(parsed.warnings.includes("HEADER_IMPLIED"), "implied canonical mapping is recorded");
  ok("1: wrapped incoming transfer stays one row with its reference, dates, deposit and balance");

  // The same wrapped row under an explicit heading (no synthesis needed).
  const headed = parseStatementText(
    [
      CANONICAL_HEADER,
      row("13/06/26", "NEFT CR FROM ACME STUDIOS", "NEFT-N00", "13/06/26", "", "45,000.00", "145,000.00"),
      "N009220661ALPHAPE",
    ].join("\n"),
  );
  assert.equal(headed.lines.length, 1);
  assert.ok(headed.lines[0].narration?.includes("N009220661ALPHAPE"));
  assert.equal(headed.lines[0].status, "ready");
  ok("1b: headed statements attach wrapped text too");
}

// ── 1t. Table extraction path: wrapped rows stored once, shell dropped ──────
{
  tableFixtureRows = [
    ["Date"],
    CANONICAL_HEADER.split("\t"),
    row("01/06/26", "NEFT CR FROM ACME STUDIOS", "NEFT-N00", "01/06/26", "", "45,000.00", "145,000.00").split("\t"),
    ["", "CMS REF 1209034", "", "", "", "", ""],
    ["Branch", ":", "Demo Mall Demo Road 000000", "", "", "", ""],
    row("02/06/26", "VENDOR PAYMENT", "", "02/06/26", "500.00", "", "144,500.00").split("\t"),
  ];
  const parsed = parseStatementPages(tablePage());
  assert.equal(parsed.lines.length, 2, "metadata and shell rows are never stored");
  const wrapped = parsed.lines[0];
  assert.equal(wrapped.txnDate, "2026-06-01");
  assert.ok(wrapped.narration?.includes("CMS REF 1209034"), "table continuation text joins the transaction");
  assert.equal(wrapped.depositAmount, "45000.00");
  assert.equal(parsed.lines[1].withdrawalAmount, "500.00");
  ok("1t: table path keeps wrapped transfers as one row and drops bank-metadata rows");
}

// ── 2. A fee withdrawal is never turned into income by balance difference ───
{
  const parsed = parseStatementText(
    [
      CANONICAL_HEADER,
      row("02/06/26", "MONTHLY SMS CHARGES", "", "02/06/26", "35.00", "", "144,965.00"),
      row("03/06/26", "CLIENT PAYMENT UPI", "", "03/06/26", "", "9,000.00", "153,965.00"),
    ].join("\n"),
  );
  const [fee, credit] = parsed.lines;
  assert.equal(fee.withdrawalAmount, "35.00");
  assert.equal(fee.depositAmount, null, "the fee keeps its debit side");
  assert.equal(fee.direction, "withdrawal");
  assert.equal(fee.status, "pending", "bank-charge classification needs a reviewer decision");
  assert.equal(credit.depositAmount, "9000.00");
  assert.equal(credit.direction, "deposit");
  assert.equal(credit.withdrawalAmount, null);
  ok("2: fee stays a 35.00 withdrawal; the credit stays a 9,000.00 deposit");
}

// ── 3. A withdrawal after a missed transaction keeps its real amount ────────
{
  const parsed = parseStatementText(
    [
      CANONICAL_HEADER,
      row("32/13/26", "BROKEN DATE ROW", "", "04/06/26", "700.00", "", "144,265.00"),
      row("14/06/26", "OFFICE SUPPLIES", "", "14/06/26", "500.00", "", "144,465.00"),
    ].join("\n"),
  );
  const [, withdrawal] = parsed.lines;
  assert.equal(withdrawal.txnDate, "2026-06-14");
  assert.equal(withdrawal.withdrawalAmount, "500.00", "500 is retained, never 500 plus the missed 700");
  assert.equal(withdrawal.depositAmount, null);
  assert.equal(withdrawal.status, "ready");
  assert.deepEqual(withdrawal.flags, [], "a still-valid next row inherits no parser flags");
  ok("3: withdrawal after a broken row keeps its own source amount");
}

// ── 4. Consecutive withdrawals remain separate, never combined ──────────────
{
  const parsed = parseStatementText(
    [
      CANONICAL_HEADER,
      row("15/06/26", "VENDOR ALPHA", "", "15/06/26", "120.00", "", "144,345.00"),
      row("16/06/26", "VENDOR BETA", "", "16/06/26", "300.00", "", "144,045.00"),
    ].join("\n"),
  );
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].withdrawalAmount, "120.00");
  assert.equal(parsed.lines[1].withdrawalAmount, "300.00");
  assert.ok(amountsDoNotContain(parsed.lines, "420.00"));
  assert.equal(parsed.lines[0].status, "ready");
  assert.equal(parsed.lines[1].status, "ready");
  ok("4: consecutive withdrawals are two rows of 120 and 300, never one of 420");
}

// ── 5. A small fee followed by another transaction stays separate ───────────
{
  const parsed = parseStatementText(
    [
      CANONICAL_HEADER,
      row("07/06/26", "INSTA ALERT SMS CHARGES", "", "07/06/26", "0.70", "", "144,044.30"),
      row("08/06/26", "MERCHANT SETTLEMENT", "", "08/06/26", "", "2,500.00", "146,544.30"),
    ].join("\n"),
  );
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].withdrawalAmount, "0.70");
  assert.equal(parsed.lines[0].status, "pending", "charge rows wait for the reviewer");
  assert.equal(parsed.lines[1].depositAmount, "2500.00", "2,500.00 is not grown to 2,500.70");
  ok("5: the 0.70 fee is its own row; the next deposit keeps its exact amount");
}

// ── 6. A negative amount keeps its sign as a blocking flag ──────────────────
{
  const parsed = parseStatementText(
    [
      CANONICAL_HEADER,
      row("09/06/26", "REVERSAL UPI TXN", "", "09/06/26", "-199.00", "", "144,244.30"),
    ].join("\n"),
  );
  const [reversal] = parsed.lines;
  assert.ok(reversal.flags.includes("NEGATIVE_AMOUNT"), "the source sign is preserved as a flag");
  assert.equal(reversal.status, "pending", "it cannot silently become income");
  assert.equal(reversal.classification, "reversal", "documented reversal treatment, not ordinary income");
  assert.equal(reversal.withdrawalAmount, "-199.00");
  ok("6: negative withdrawal is flagged, classified for reversal, never auto-income");

  // Fused value-date variant (bank prints one credited reversal in line).
  const fused = parseStatementText(
    [CANONICAL_HEADER, "11/06/26\tPOS ADJUST MERCHANTNAME\tREFA1\t11/06/26-92.77\t199,000.10"].join("\n"),
  );
  const [line] = fused.lines;
  assert.ok(line.flags.includes("COLUMN_COUNT_MISMATCH"));
  assert.equal(line.valueDate, "2026-06-11");
  assert.equal(line.closingBalance, null);
  assert.equal(line.withdrawalAmount, null, "an unaligned balance is never promoted to an amount");
  assert.equal(line.status, "pending");
  ok("6b: fused amount outside a source amount column stays pending without field guessing");
}

// ── 7. Page headers, footers, metadata and URLs never become transactions ───
{
  const parsed = parseStatementText(
    [
      "STATEMENT OF ACCOUNT",
      "Account No. : DE12345678901",
      "Branch : KHAMGAON",
      "State : Maharashtra",
      "Email : ops at acme.example",
      CANONICAL_HEADER,
      row("13/06/26", "OFFICE EXPENSES", "", "13/06/26", "1,000.00", "", "143,445.30"),
      row("15/06/26", "CLIENT INVOICE PAYMENT", "", "15/06/26", "", "4,000.00", "147,445.30"),
      "This is a computer generated statement and does not require a signature.",
      "https://www.bank.example/terms",
      "Page 1 of 1",
    ].join("\n"),
  );
  assert.equal(parsed.lines.length, 2, "only real rows are stored");
  for (const line of parsed.lines) {
    assert.ok(!line.narration?.includes("computer"), "footer text never leaks into narrations");
    assert.ok(!line.narration?.includes("www."), "URLs never leak into narrations");
    assert.ok(!line.narration?.includes("Page"), "page numbers never leak into narrations");
  }
  ok("7: cover-page details, disclaimers, URLs and page numbers are ignored");
}

// ── 7b. HDFC's unspaced footer never contaminates the page's final row ─────
{
  const tableRow = (...cells: string[]) => {
    const padded = cells.slice();
    while (padded.length < 7) padded.push("");
    return padded.slice(0, 7);
  };
  const footerRows = [
    tableRow(
      "",
      "Contentsofthisstatementwillbeconsideredcorrectifnoerrorisreportedwithin30daysofreceiptofstatement.TheaddressonthisstatementisthatonrecordwiththeBankasatthedayofrequestingthisstatement.",
    ),
    tableRow("", "StateaccountbranchGSTN:27AAACH2702H1Z0"),
    tableRow(
      "",
      "HDFCBankGSTINnumberdetailsareavailableathttps://www.hdfcbank.com/personal/making-payments/online-tax-payment/goods-and-service-tax.",
    ),
    tableRow("", "RegisteredOfficeAddress:HDFCBankHouse,SenapatiBapatMarg,Mumbai400013"),
    tableRow("", "CO"),
    tableRow("", "PageNo."),
  ];
  const pages = Array.from({ length: 4 }, (_, index) => {
    const firstDay = 13 + index * 2;
    const lastDay = firstDay + 1;
    const lastRowNarration =
      `SYNTHETIC LAST ROW ${index + 1} HDFC BANK LIMITED *Closingbalanceincludesfundsearmarkedforholdandunclearedfunds`;
    return {
      pageNumber: index + 1,
      text: "INR statement",
      tables: [
        ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
        tableRow(`${firstDay}/04/26`, `SYNTHETIC PAYMENT ${index + 1}`, `R-${index}-1`, `${firstDay}/04/26`, "100.00", "", "9,900.00"),
        tableRow(`${lastDay}/04/26`, lastRowNarration, `R-${index}-2`, `${lastDay}/04/26`, "250.00", "", "9,650.00"),
        ...footerRows,
      ],
    };
  });

  const parsed = parseStatementText(pages);
  assert.equal(parsed.lines.length, 8, "four pages produce only their eight dated transactions");
  for (let index = 0; index < 4; index += 1) {
    const line = parsed.lines[index * 2 + 1];
    assert.equal(line.narration, `SYNTHETIC LAST ROW ${index + 1}`);
    assert.equal(line.classification, "expense");
    assert.equal(line.status, "ready");
    assert.ok(!line.flags.includes("AMBIGUOUS_ENTRY"));
    assert.ok(!line.narration?.includes("HDFC"));
    assert.ok(!line.narration?.includes("hold"));
  }

  const textOnly = parseStatementText(
    [
      CANONICAL_HEADER,
      row(
        "13/04/26",
        "SYNTHETIC TEXT ROW HDFC BANK LIMITED *Closingbalanceincludesfundsearmarkedforholdandunclearedfunds",
        "R-TEXT",
        "13/04/26",
        "250.00",
        "",
        "9,650.00",
      ),
      "Contentsofthisstatementwillbeconsideredcorrectifnoerrorisreportedwithin30daysofreceiptofstatement.",
      "CO",
      "PageNo.",
    ].join("\n"),
  );
  assert.equal(textOnly.lines.length, 1);
  assert.equal(textOnly.lines[0].narration, "SYNTHETIC TEXT ROW");
  assert.equal(textOnly.lines[0].status, "ready");
  ok("7b: four-page HDFC disclaimers, bank details and PageNo text stay out of transaction rows");
}

// ── 8. Valid rows do not receive irrelevant flags ───────────────────────────
{
  const parsed = parseStatementText(
    [
      CANONICAL_HEADER,
      row("13/06/26", "OFFICE EXPENSES", "R-1", "13/06/26", "1,000.00", "", "143,445.30"),
      row("15/06/26", "CLIENT INVOICE PAYMENT", "R-2", "15/06/26", "", "4,000.00", "147,445.30"),
    ].join("\n"),
  );
  for (const line of parsed.lines) {
    assert.deepEqual(line.flags, [], `row ${line.rowNumber} must be flag-free`);
    assert.equal(line.status, "ready");
    assert.match(String(line.txnDate), /^2026-06-(13|15)$/);
  }
  ok("8: clean withdrawals and deposits carry no flags and reach ready");
}

// ── 9. Invalid rows receive exactly the conditional flags they earned ───────
{
  const parsed = parseStatementText(
    [
      CANONICAL_HEADER,
      row("32/13/26", "IMPOSSIBLE DATE", "", "16/06/26", "10.00", "", "147,435.30"),
      "\t\tMISSING DATE ROW\tM-1\t1,000.00\t\t147,000.00",
      row("17/06/26", "NO AMOUNT ROW", "", "17/06/26", "", "", "147,000.00"),
      row("18/06/26", "BOTH SIDES ROW", "", "18/06/26", "100.00", "200.00", "147,000.00"),
      row("19/06/26", "CONFLICT ROW", "", "19/06/26", "", "1,000.00 Dr", "147,000.00"),
    ].join("\n"),
  );
  const [badDate, shiftedDateRow, noAmount, bothSides, conflict] = parsed.lines;

  assert.ok(badDate.flags.includes("INVALID_DATE"));
  assert.equal(badDate.status, "pending");

  // Empty leading cells are retained, so the missing source date is localized
  // without shifting the value date or the source amount columns.
  assert.ok(shiftedDateRow.flags.includes("MISSING_DATE"));
  assert.ok(!shiftedDateRow.flags.includes("INVALID_DATE"));
  assert.ok(!shiftedDateRow.flags.includes("COLUMN_COUNT_MISMATCH"));
  assert.equal(shiftedDateRow.status, "pending");

  assert.ok(noAmount.flags.includes("MISSING_AMOUNT"));
  assert.ok(!noAmount.flags.includes("UNKNOWN_DIRECTION"));
  assert.equal(noAmount.status, "pending");

  assert.ok(bothSides.flags.includes("BOTH_AMOUNTS"));
  assert.equal(bothSides.direction, null);
  assert.equal(bothSides.status, "pending");

  assert.ok(conflict.flags.includes("DIRECTION_CONFLICT"));
  assert.equal(conflict.status, "pending");
  ok("9: INVALID_DATE / MISSING_DATE / MISSING_AMOUNT / BOTH_AMOUNTS / DIRECTION_CONFLICT land only where earned");

  // Table extraction preserves empty cells, so a true empty-date row is
  // flagged MISSING_DATE while its real amounts stay intact for review.
  tableFixtureRows = [
    CANONICAL_HEADER.split("\t"),
    ["", "DATELESS WITH AMOUNT", "", "", "750.00", "", "146,250.00"],
    row("21/06/26", "NEXT VALID ROW", "", "21/06/26", "20.00", "", "146,230.00").split("\t"),
  ];
  const tableParsed = parseStatementPages(tablePage());
  const [dateless, next] = tableParsed.lines;
  assert.ok(dateless.flags.includes("MISSING_DATE"));
  assert.equal(dateless.withdrawalAmount, "750.00", "the real amount stays on the review row");
  assert.equal(dateless.status, "pending");
  assert.equal(next.txnDate, "2026-06-21");
  assert.deepEqual(next.flags, [], "the next valid row inherits nothing");
  ok("9c: preserved empty cells make the missing date explicit; amounts on that row stay reviewable");

  assert.throws(
    () => parseStatementText("There are no dates in this text at all.\nTotal 0.00"),
    (error: unknown) => error instanceof BankImportError && error.code === "NO_HEADER",
  );
  const compact = parseStatementText([CANONICAL_HEADER, "14/06/26 Payment to vendor 1000.00"].join("\n"));
  assert.ok(compact.lines[0].flags.includes("UNRECOGNIZED_ROW"));
  assert.ok(compact.lines[0].flags.includes("MISSING_AMOUNT"));
  ok("9b: compact/unmappable rows stay flagged for review; headerless junk throws NO_HEADER");
}

// ── 10. A reviewer edit recalculates flags and status (offline model) ───────
{
  const reviewLine: ReviewLine = {
    id: "00000000-0000-4000-8000-000000000001",
    statementId: "00000000-0000-4000-8000-000000000002",
    accountId: "00000000-0000-4000-8000-000000000003",
    statementStatus: "review",
    status: "pending",
    classification: "unclassified",
    txnDate: "2026-06-13",
    valueDate: "2026-06-13",
    narration: "",
    reference: null,
    withdrawalAmount: "1000.00",
    depositAmount: null,
    direction: "withdrawal",
    flags: ["MISSING_NARRATION"],
    fingerprint: fingerprintLine({
      txnDate: "2026-06-13",
      valueDate: "2026-06-13",
      narration: null,
      reference: null,
      withdrawalAmount: "1000.00",
      depositAmount: null,
    }),
    clientId: null,
    categoryId: null,
    invoiceId: null,
    skipReason: null,
    reviewedBy: null,
  };

  // Before the edit: MISSING_NARRATION blocks.
  assert.ok(evaluateLineEligibility(reviewLine).blockers.length > 0);

  // The reviewer fills the description; the derived flag clears and the
  // gate re-runs against the real fields, not the stale status.
  const edited: ReviewLine = {
    ...reviewLine,
    narration: "OFFICE EXPENSES RECORDED BY REVIEWER",
    classification: "expense",
    categoryId: 7,
  };
  const remaining = effectiveLineFlags(edited);
  assert.ok(!remaining.includes("MISSING_NARRATION"));
  const eligible = evaluateLineEligibility(edited);
  assert.ok(eligible.ready, "eligibility mirrors the recalculated status");
  ok("10: editing recalculates derived flags and validation from actual fields");
}

// ── 12. Identical statement rows produce identical fingerprints ─────────────
{
  const base = {
    txnDate: "2026-06-13",
    valueDate: "2026-06-13",
    narration: "OFFICE EXPENSES",
    reference: "R-1",
    withdrawalAmount: "1000.00",
    depositAmount: null,
  };
  const first = fingerprintLine(base);
  const second = fingerprintLine({ ...base, narration: "OFFICE   EXPENSES" });
  assert.equal(first, second);
  const different = fingerprintLine({ ...base, reference: "R-2" });
  assert.notEqual(first, different);
  ok("12: content fingerprints stay stable under harmless spacing only");
}

// ═══ Review-table raw fields equal the source column values ═════════════════
{
  const parsed = parseStatementText(
    [
      CANONICAL_HEADER,
      row("20/06/26", "FIRST EXPENSE", "", "20/06/26", "100.00", "", "147,345.30"),
      row("21/06/26", "DAY TWO EXPENSE", "", "21/06/26", "999.00", "", "146,346.30"),
      row("22/06/26", "SECOND EXPENSE", "", "22/06/26", "450.00", "", "145,896.30"),
    ].join("\n"),
  );
  assert.equal(parsed.lines.length, 3, "each printed row stays its own line");
  assert.equal(parsed.lines[0].withdrawalAmount, "100.00");
  assert.equal(parsed.lines[1].withdrawalAmount, "999.00", "raw field equals its own source cell");
  assert.equal(parsed.lines[2].withdrawalAmount, "450.00");
  assert.ok(amountsDoNotContain(parsed.lines, "550.00"), "no 450+100=550 compensation appears");
  ok("raw amount fields per row equal their source column values");
}

function amountsDoNotContain(lines: ParsedLine[], amount: string): boolean {
  return !lines.some((line) => line.withdrawalAmount === amount || line.depositAmount === amount);
}

// Column misalignment stays per-row; surrounding rows are untouched.
{
  const parsed = parseStatementText(
    [
      "Date\tNarration\tChq./Ref.No.\tValue Dt\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance",
      row("23/06/26", "GOOD ROW", "C-1", "23/06/26", "50.00", "", "145,846.30"),
      "24/06/26\tFOLDED ROW IGNORED SLOTS\tC-2\t24/06/26",
      row("25/06/26", "GOOD ROW TWO", "C-3", "25/06/26", "60.00", "", "145,726.30"),
    ].join("\n"),
  );
  const mismatched = parsed.lines.filter((line) => line.flags.includes("COLUMN_COUNT_MISMATCH"));
  assert.equal(mismatched.length, 1, "only the actually misaligned row is flagged");
  assert.equal(parsed.lines[0].status, "ready");
  assert.equal(parsed.lines[2].status, "ready");
  assert.equal(parsed.lines[0].withdrawalAmount, "50.00");
  assert.equal(parsed.lines[2].withdrawalAmount, "60.00");
  ok("column misalignment is per-row and never propagates to neighbours");
}

console.log(`\nResults: ${passed} passed, 0 failed`);
