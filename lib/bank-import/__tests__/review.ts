/**
 * Offline Phase 3 checks for the staging-review rules: input parsing, mapping
 * policy, eligibility, and reconciliation arithmetic. No DB queries.
 *
 * Run: tsx lib/bank-import/__tests__/review.ts
 */
import assert from "node:assert/strict";
import {
  bulkDuplicateDecision,
  effectiveLineFlags,
  evaluateLineEligibility,
  mappingForClassification,
  parseReviewLinePatch,
  reviewSaveFailureMessage,
  type ReviewLine,
} from "../review";
import {
  reconcileStatementDetail,
  resolveStatementPeriod,
} from "../reconciliation";
import type { StatementDetail, StatementLineRow } from "../queries";
import type { Classification, LineFlag, LineStatus } from "../types";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function reviewLine(overrides: Partial<ReviewLine> = {}): ReviewLine {
  return {
    id: UUID_A,
    statementId: UUID_B,
    accountId: UUID_B,
    statementStatus: "review",
    status: "pending",
    classification: "unclassified",
    txnDate: "2026-04-13",
    valueDate: "2026-04-13",
    narration: "UPI/P2A/ACME",
    reference: "REF1",
    withdrawalAmount: null,
    depositAmount: "1000.00",
    direction: "deposit",
    flags: [],
    fingerprint: "a".repeat(64),
    clientId: null,
    categoryId: null,
    invoiceId: null,
    skipReason: null,
    reviewedBy: null,
    ...overrides,
  };
}

function lineRow(overrides: Partial<StatementLineRow> = {}): StatementLineRow {
  return {
    id: UUID_A,
    pageNumber: 1,
    rowNumber: 1,
    txnDate: "2026-04-13",
    valueDate: "2026-04-13",
    narration: "UPI/P2A/ACME",
    reference: "REF1",
    withdrawalAmount: null,
    depositAmount: "1000.00",
    closingBalance: "13000.00",
    direction: "deposit",
    classification: "unclassified",
    status: "pending",
    flags: [],
    errorCode: null,
    fingerprint: "a".repeat(64),
    clientId: null,
    categoryName: null,
    clientName: null,
    categoryId: null,
    invoiceId: null,
    invoiceNumber: null,
    skipReason: null,
    reviewedBy: null,
    reviewedAt: null,
    transactionId: null,
    importAttempt: 0,
    importLive: false,
    ...overrides,
  };
}

function detailFixture(
  lines: StatementLineRow[],
  overrides: {
    openingBalance?: string | null;
    closingBalance?: string | null;
    statementFrom?: string | null;
    statementTo?: string | null;
  } = {},
): StatementDetail {
  return {
    statement: {
      id: UUID_B,
      accountId: UUID_A,
      accountName: "Test account",
      fileName: "statement.pdf",
      status: "review",
      statementFrom: overrides.statementFrom === undefined ? "2026-04-01" : overrides.statementFrom,
      statementTo: overrides.statementTo === undefined ? "2026-04-30" : overrides.statementTo,
      pageCount: 1,
      lineCount: lines.length,
      pendingCount: 0,
      readyCount: 0,
      importedCount: 0,
      skippedCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      withdrawalTotal: "0.00",
      depositTotal: "0.00",
      createdAt: "2026-10-20 10:00",
      currency: "INR",
      fileSizeBytes: 2048,
      parserVersion: "1.0.0",
      openingBalance: overrides.openingBalance === undefined ? "10000.00" : overrides.openingBalance,
      closingBalance: overrides.closingBalance === undefined ? "13000.00" : overrides.closingBalance,
      updatedAt: "2026-10-20 10:00",
    },
    account: {
      id: UUID_A,
      displayName: "Test account",
      bankName: "Test bank",
      accountLast4: "1234",
      currency: "INR",
      isActive: true,
      createdAt: "2026-10-01",
    },
    lines,
  };
}

// ── Patch parsing ────────────────────────────────────────────────────────────
{
  assert.ok(!parseReviewLinePatch("nope").ok);
  assert.ok(!parseReviewLinePatch(null).ok);
  assert.ok(!parseReviewLinePatch([1]).ok);
  ok("patch: non-object payloads are rejected");

  assert.ok(!parseReviewLinePatch({ classification: "profit" }).ok);
  ok("patch: unsupported classification is rejected");

  const patch = parseReviewLinePatch({
    classification: "expense",
    description: "  office   rent  ",
    categoryId: "3",
    clientId: null,
  });
  assert.ok(patch.ok);
  if (patch.ok) {
    assert.equal(patch.value.classification, "expense");
    assert.equal(patch.value.description, "office rent");
    assert.equal(patch.value.categoryId, 3);
    assert.equal(patch.value.clientId, null);
  }
  ok("patch: description, category and explicit clears parse");

  const long = parseReviewLinePatch({ description: "x".repeat(501) });
  assert.ok(!long.ok);
  ok("patch: overly long description is rejected");

  assert.ok(!parseReviewLinePatch({ clientId: "not-a-uuid" }).ok);
  assert.ok(!parseReviewLinePatch({ categoryId: "zero" }).ok);
  assert.ok(!parseReviewLinePatch({ categoryId: 0 }).ok);
  const normalized = parseReviewLinePatch({ clientId: UUID_A.toUpperCase() });
  assert.ok(normalized.ok && normalized.ok && normalized.value.clientId === UUID_A);
  ok("patch: client/category identifiers are validated");

  assert.ok(!parseReviewLinePatch({ invoiceId: "not-a-uuid" }).ok);
  const invoicePatch = parseReviewLinePatch({ invoiceId: UUID_B.toUpperCase() });
  assert.ok(invoicePatch.ok && invoicePatch.value.invoiceId === UUID_B);
  const invoiceClear = parseReviewLinePatch({ invoiceId: null });
  assert.ok(invoiceClear.ok && invoiceClear.value.invoiceId === null);
  ok("patch: invoice identifiers are validated, normalized and clearable");
}

// ── Mapping policy ───────────────────────────────────────────────────────────
{
  const income = mappingForClassification(
    "income",
    { clientId: UUID_A, categoryId: 3, invoiceId: null },
    {},
  );
  assert.ok(income.ok && income.clientId === UUID_A && income.categoryId === null);
  const incomeBad = mappingForClassification(
    "income",
    { clientId: null, categoryId: null, invoiceId: null },
    { categoryId: 3 },
  );
  assert.ok(!incomeBad.ok);
  ok("mapping: income keeps client, refuses and clears expense category");

  const expense = mappingForClassification(
    "expense",
    { clientId: UUID_A, categoryId: 3, invoiceId: null },
    {},
  );
  assert.ok(expense.ok && expense.categoryId === 3 && expense.clientId === null);
  const expenseBad = mappingForClassification(
    "expense",
    { clientId: null, categoryId: null, invoiceId: null },
    { clientId: UUID_A },
  );
  assert.ok(!expenseBad.ok);
  ok("mapping: expense keeps category, refuses and clears client");

  const transfer = mappingForClassification(
    "transfer",
    { clientId: UUID_A, categoryId: null, invoiceId: null },
    {},
  );
  assert.ok(transfer.ok && transfer.clientId === null && transfer.categoryId === null);
  const transferBad = mappingForClassification(
    "transfer",
    { clientId: null, categoryId: null, invoiceId: null },
    { clientId: UUID_A },
  );
  assert.ok(!transferBad.ok);
  ok("mapping: non-importable classifications never keep a mapping");

  // Phase 4 invoice links: income-only, explicit choice, cleared elsewhere.
  const invoiceCurrent = { clientId: UUID_A, categoryId: null, invoiceId: "33333333-3333-4333-8333-333333333333" };
  const kept = mappingForClassification("income", invoiceCurrent, {});
  assert.ok(kept.ok && kept.invoiceId === invoiceCurrent.invoiceId);
  const clearedInvoice = mappingForClassification("income", invoiceCurrent, { invoiceId: null });
  assert.ok(clearedInvoice.ok && clearedInvoice.invoiceId === null);
  ok("mapping: an income line keeps or clears an explicit invoice link");

  const expenseInvoice = mappingForClassification(
    "expense",
    { clientId: null, categoryId: 3, invoiceId: null },
    { invoiceId: invoiceCurrent.invoiceId },
  );
  assert.ok(!expenseInvoice.ok);
  const transferInvoice = mappingForClassification(
    "transfer",
    { clientId: null, categoryId: null, invoiceId: null },
    { invoiceId: invoiceCurrent.invoiceId },
  );
  assert.ok(!transferInvoice.ok);
  const flipped = mappingForClassification(
    "expense",
    invoiceCurrent,
    { classification: undefined, categoryId: 5 },
  );
  assert.ok(flipped.ok && flipped.invoiceId === null);
  ok("mapping: invoices never survive outside income lines");
}

// ── Flags ────────────────────────────────────────────────────────────────────
{
  const kept = effectiveLineFlags(
    reviewLine({ narration: null, flags: ["MISSING_NARRATION", "ZERO_AMOUNT"] }),
  );
  assert.deepEqual(kept, ["MISSING_NARRATION", "ZERO_AMOUNT"]);
  ok("flags: MISSING_NARRATION stays while narration is empty");

  const cleared = effectiveLineFlags(
    reviewLine({ narration: "Cash deposit", flags: ["MISSING_NARRATION", "BANK_CHARGE"] }),
  );
  assert.deepEqual(cleared, ["BANK_CHARGE"]);
  ok("flags: a filled description clears MISSING_NARRATION only");
}

// ── Eligibility ──────────────────────────────────────────────────────────────
{
  const missingClient = evaluateLineEligibility(reviewLine({ classification: "income" }));
  assert.ok(!missingClient.ready);
  assert.equal(missingClient.blockers.length, 1);
  ok("eligibility: income without an existing client is not ready");

  const ready = evaluateLineEligibility(reviewLine({ classification: "income", clientId: UUID_A }));
  assert.ok(ready.ready);
  assert.deepEqual(ready.blockers, []);
  ok("eligibility: income with a client is ready");

  const missingCategory = evaluateLineEligibility(
    reviewLine({
      classification: "expense",
      categoryId: null,
      withdrawalAmount: "500.00",
      depositAmount: null,
      direction: "withdrawal",
    }),
  );
  assert.ok(!missingCategory.ready);
  ok("eligibility: expense without a category is not ready");

  const readyExpense = evaluateLineEligibility(
    reviewLine({
      classification: "expense",
      categoryId: 3,
      withdrawalAmount: "500.00",
      depositAmount: null,
      direction: "withdrawal",
    }),
  );
  assert.ok(readyExpense.ready);
  ok("eligibility: expense with a category is ready");

  const noDate = evaluateLineEligibility(reviewLine({ txnDate: null }));
  assert.ok(!noDate.ready);
  ok("eligibility: an unparsed date never becomes ready");

  const noNarration = evaluateLineEligibility(reviewLine({ narration: null }));
  assert.ok(!noNarration.ready);
  ok("eligibility: missing narration never becomes ready");

  const bothAmounts = evaluateLineEligibility(
    reviewLine({ withdrawalAmount: "500.00", depositAmount: "500.00" }),
  );
  assert.ok(!bothAmounts.ready);
  ok("eligibility: rows with both amounts never become ready");

  const classifications: Classification[] = ["transfer", "refund", "reversal", "other", "non_business"];
  for (const classification of classifications) {
    const undecided = evaluateLineEligibility(reviewLine({ classification }));
    assert.ok(!undecided.ready, `${classification} must not be ready`);
  }
  ok("eligibility: transfer/refund/reversal/other/non-business need a reviewer decision");

  const flagged = evaluateLineEligibility(reviewLine({ flags: ["TRANSFER"] as LineFlag[] }));
  assert.ok(!flagged.ready);
  ok("eligibility: blocking parser flags keep the line out of ready");

  for (const status of ["imported", "error"] as LineStatus[]) {
    const closed = evaluateLineEligibility(reviewLine({ status }));
    assert.ok(!closed.ready);
  }
  ok("eligibility: imported and error rows are closed for review");

  const skipped = evaluateLineEligibility(
    reviewLine({ status: "skipped", skipReason: "Personal" }),
  );
  assert.ok(!skipped.ready);
  const markedDuplicate = evaluateLineEligibility(
    reviewLine({ status: "duplicate", skipReason: "Same as row 3" }),
  );
  assert.ok(!markedDuplicate.ready);
  ok("eligibility: skipped and duplicate decisions are not importable");
}

// Review-save errors identify the known unapplied amount constraint.
{
  assert.equal(
    reviewSaveFailureMessage({ code: "23514", constraint: "chk_bank_statement_lines_amounts" }),
    "An admin needs to update bank import before this flagged amount can be saved. Try again after the update.",
  );
  assert.equal(
    reviewSaveFailureMessage({ code: "23514", constraint: "untrusted_constraint", detail: "secret" }),
    "Saving the review failed. Try again.",
  );
  ok("review: a stale flagged-amount constraint gets a safe, actionable message");
}

// ── Reconciliation ───────────────────────────────────────────────────────────
{
  const balanced = reconcileStatementDetail(
    detailFixture([
      lineRow({ id: UUID_A, depositAmount: "5000.00" }),
      lineRow({ id: UUID_B, rowNumber: 2, withdrawalAmount: "2000.00", depositAmount: null, direction: "withdrawal" }),
    ]),
    [],
  );
  assert.equal(balanced.status, "balanced");
  assert.equal(balanced.difference, "0.00");
  assert.equal(balanced.expectedClosing, "13000.00");
  assert.equal(balanced.unresolvedCount, 2);
  ok("reconciliation: opening + deposits − withdrawals closes exactly");

  const off = reconcileStatementDetail(
    detailFixture([lineRow({ depositAmount: "5000.00" })], { closingBalance: "12000.00" }),
    [],
  );
  assert.equal(off.status, "unbalanced");
  assert.equal(off.difference, "-3000.00");
  assert.ok(off.warnings.some((warning) => warning.includes("off by")));
  ok("reconciliation: a difference is reported, never corrected");

  const halves = reconcileStatementDetail(
    detailFixture(
      [lineRow({ depositAmount: "0.10" }), lineRow({ id: UUID_B, rowNumber: 2, depositAmount: "0.20" })],
      { openingBalance: "100.05", closingBalance: "100.35" },
    ),
    [],
  );
  assert.equal(halves.status, "balanced");
  assert.equal(halves.difference, "0.00");
  assert.equal(halves.expectedClosing, "100.35");
  ok("reconciliation: paise arithmetic stays exact (no float drift)");

  const noClosing = reconcileStatementDetail(
    detailFixture([lineRow({ depositAmount: "100.00", closingBalance: null })], {
      closingBalance: null,
    }),
    [],
  );
  assert.equal(noClosing.status, "insufficient_data");
  assert.equal(noClosing.difference, null);
  assert.ok(noClosing.warnings.some((warning) => warning.includes("closing balance is missing")));
  ok("reconciliation: a closing balance no row can supply is insufficient data");

  const derived = reconcileStatementDetail(
    detailFixture(
      [
        lineRow({ id: UUID_B, pageNumber: 1, rowNumber: 2, withdrawalAmount: "3000.00", depositAmount: null, direction: "withdrawal", closingBalance: "8000.00" }),
        lineRow({ id: UUID_A, pageNumber: 1, rowNumber: 1, depositAmount: "1000.00", closingBalance: "11000.00" }),
      ],
      { openingBalance: null, closingBalance: null },
    ),
    [],
  );
  assert.equal(derived.status, "balanced");
  assert.equal(derived.openingBalance, "10000.00");
  assert.equal(derived.closingBalance, "8000.00");
  assert.equal(derived.difference, "0.00");
  assert.ok(derived.notes.some((note) => note.includes("Opening balance derived")));
  assert.ok(derived.notes.some((note) => note.includes("Declared closing")));
  assert.ok(!derived.warnings.some((warning) => warning.includes("opening balance is missing")));
  ok("reconciliation: row balances reconstruct a missing opening and closing");

  const partialDerive = reconcileStatementDetail(
    detailFixture(
      [lineRow({ depositAmount: "500.00", closingBalance: "5500.00", status: "ready" })],
      { openingBalance: "5000.00", closingBalance: null },
    ),
    [],
  );
  assert.equal(partialDerive.closingBalance, "5500.00");
  assert.equal(partialDerive.status, "balanced");
  assert.ok(partialDerive.notes.some((note) => note.includes("Declared closing")));
  ok("reconciliation: derivation fills only the side the statement left empty");

  const firstRowBroken = reconcileStatementDetail(
    detailFixture(
      [
        lineRow({
          pageNumber: 1,
          rowNumber: 1,
          withdrawalAmount: "100.00",
          depositAmount: "100.00",
          closingBalance: "9000.00",
        }),
        lineRow({ id: UUID_B, pageNumber: 1, rowNumber: 2, depositAmount: "1000.00", closingBalance: "11000.00" }),
      ],
      { openingBalance: null, closingBalance: null },
    ),
    [],
  );
  assert.equal(firstRowBroken.openingBalance, null);
  assert.equal(firstRowBroken.closingBalance, "11000.00");
  assert.equal(firstRowBroken.status, "insufficient_data");
  assert.ok(firstRowBroken.warnings.some((warning) => warning.includes("opening balance is missing")));
  assert.ok(!firstRowBroken.notes.some((note) => note.includes("Opening balance derived")));
  ok("reconciliation: an uncountable first row cannot anchor the opening balance");

  const invalid = reconcileStatementDetail(
    detailFixture(
      [
        lineRow({ withdrawalAmount: "100.00", depositAmount: "100.00", closingBalance: null }),
        lineRow({
          id: UUID_B,
          rowNumber: 2,
          depositAmount: null,
          withdrawalAmount: null,
          closingBalance: null,
        }),
      ],
      { closingBalance: null },
    ),
    [],
  );
  assert.equal(invalid.status, "insufficient_data");
  assert.equal(invalid.invalidLineCount, 2);
  assert.ok(invalid.warnings.some((warning) => warning.includes("2 rows cannot be counted")));
  ok("reconciliation: rows without balances cannot rescue a missing balance chain");

  const partialRows = reconcileStatementDetail(
    detailFixture([
      lineRow({ withdrawalAmount: "100.00", depositAmount: "100.00" }),
      lineRow({ id: UUID_B, rowNumber: 2, depositAmount: null, withdrawalAmount: "0.00", closingBalance: "12000.00" }),
    ]),
    [],
  );
  assert.equal(partialRows.invalidLineCount, 2);
  assert.ok(partialRows.warnings.some((warning) => warning.includes("2 rows cannot be counted")));
  assert.equal(partialRows.status, "unbalanced");
  assert.equal(partialRows.difference, "3000.00");
  ok("reconciliation: uncountable rows no longer hide a computable balance check");

  const skippedRows = reconcileStatementDetail(
    detailFixture([
      lineRow({ depositAmount: "1000.00", status: "skipped", skipReason: "Personal" }),
      lineRow({ id: UUID_B, rowNumber: 2, depositAmount: "2000.00", status: "pending" }),
      lineRow({ id: "33333333-3333-4333-8333-333333333333", rowNumber: 3, depositAmount: "500.00", status: "duplicate", skipReason: "Same row" }),
      lineRow({ id: "44444444-4444-4444-8444-444444444444", rowNumber: 4, depositAmount: null, withdrawalAmount: "10.00", status: "error", direction: "withdrawal" }),
    ]),
    [],
  );
  assert.equal(skippedRows.skippedCount, 1);
  assert.equal(skippedRows.duplicateCount, 1);
  assert.equal(skippedRows.pendingCount, 1);
  assert.equal(skippedRows.errorCount, 1);
  assert.equal(skippedRows.unresolvedCount, 2);
  // Real bank movements count even while their rows are in review: deposits
  // 3500 − withdrawal 10 over opening 10000 expects 13490 vs declared 13000.
  assert.equal(skippedRows.status, "unbalanced");
  assert.equal(skippedRows.difference, "-490.00");
  ok("reconciliation: skipped and duplicate rows still count toward the movement");

  const withOverlaps = reconcileStatementDetail(
    detailFixture([lineRow({ depositAmount: "1000.00" })]),
    [{ id: UUID_B, fileName: "april-again.pdf", statementFrom: "2026-04-01", statementTo: "2026-04-30" }],
  );
  assert.ok(
    withOverlaps.warnings.some(
      (warning) => warning.includes("overlaps 1") && warning.includes("other statement"),
    ),
  );
  ok("reconciliation: overlapping statement periods warn");
}

// ── Period fallback ──────────────────────────────────────────────────────────
{
  const declared = resolveStatementPeriod(detailFixture([]));
  assert.deepEqual(declared, { from: "2026-04-01", to: "2026-04-30" });

  const fallback = resolveStatementPeriod(
    detailFixture(
      [
        lineRow({ id: UUID_B, rowNumber: 2, txnDate: "2026-04-05" }),
        lineRow({ id: UUID_A, rowNumber: 1, txnDate: "2026-04-20" }),
      ],
      { statementFrom: null, statementTo: null },
    ),
  );
  assert.deepEqual(fallback, { from: "2026-04-05", to: "2026-04-20" });

  const neither = resolveStatementPeriod(
    detailFixture([lineRow({ txnDate: null, valueDate: null })], { statementFrom: null, statementTo: null }),
  );
  assert.deepEqual(neither, { from: null, to: null });
  ok("period: declared period wins, else row dates, else nothing");
}

// ── Bulk duplicate policy ────────────────────────────────────────────────────
{
  for (const status of ["pending", "ready"] as const) {
    assert.deepEqual(bulkDuplicateDecision(status, "review"), { action: "mark" });
  }
  ok("bulk duplicate: pending and ready rows are marked together");

  assert.deepEqual(bulkDuplicateDecision("duplicate", "review"), { action: "skip" });
  ok("bulk duplicate: already-duplicate rows are counted, not touched again");

  assert.deepEqual(bulkDuplicateDecision("imported", "review"), {
    action: "reject",
    error: "Imported lines can no longer be changed.",
  });
  assert.deepEqual(bulkDuplicateDecision("error", "review"), {
    action: "reject",
    error: "This line does not parse; review is not available for it.",
  });
  assert.deepEqual(bulkDuplicateDecision("skipped", "review"), {
    action: "reject",
    error: "Reopen this line before changing the review decision.",
  });
  ok("bulk duplicate: imported, error, and skipped rows keep their own review path");

  for (const statementStatus of ["importing", "completed", "failed", "cancelled"]) {
    assert.deepEqual(bulkDuplicateDecision("ready", statementStatus), {
      action: "reject",
      error: "This statement can no longer be reviewed.",
    });
  }
  ok("bulk duplicate: statements outside review reject the whole decision");
}

console.log(`\nreview: ${passed} checks passed`);
