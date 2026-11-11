/**
 * Offline reconciliation checks for the printed-balance chain: every
 * uncountable row's movement is derived from two consecutive printed
 * balances, and only rows without any anchor stay excluded. No DB queries.
 *
 * Run: tsx lib/bank-import/__tests__/reconciliation.ts
 */
import assert from "node:assert/strict";
import { deriveBalancesFromRows, reconcileStatementDetail } from "../reconciliation";
import type { StatementDetail, StatementLineRow } from "../queries";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const UUID_D = "44444444-4444-4444-8444-444444444444";
const UUID_E = "55555555-5555-4555-8555-555555555555";

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
    depositAmount: null,
    closingBalance: null,
    direction: null,
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
    transactionDescription: null,
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
  } = {},
): StatementDetail {
  return {
    statement: {
      id: UUID_B,
      accountId: UUID_A,
      accountName: "Test account",
      fileName: "statement.pdf",
      status: "review",
      statementFrom: "2026-04-01",
      statementTo: "2026-04-30",
      rowFrom: "2026-04-01",
      rowTo: "2026-04-30",
      periodFrom: "2026-04-01",
      periodTo: "2026-04-30",
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
      createdAt: "2026-11-03 10:00",
      currency: "INR",
      fileSizeBytes: 2048,
      parserVersion: "1.0.0",
      openingBalance: overrides.openingBalance ?? null,
      closingBalance: overrides.closingBalance ?? null,
      updatedAt: "2026-11-03 10:00",
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

// ── The real "Stmt-All" shape: one pending negative row closes the chain ─────
{
  // Printed chain (balance-after semantics), real-world magnitudes:
  // opening 6,28,816.17 → counted movement deposits 5,15,135.35 −
  // withdrawals 3,23,028.44 → 8,20,923.08 → the flagged row moves the
  // printed balance up 209.74 exactly, where the reviewer sees a negative
  // amount it cannot count from the columns.
  const result = reconcileStatementDetail(
    detailFixture([
      lineRow({ id: UUID_A, status: "ready", depositAmount: "1000.00", closingBalance: "629816.17" }),
      lineRow({ id: UUID_B, rowNumber: 2, status: "ready", withdrawalAmount: "323028.44", closingBalance: "306787.73" }),
      lineRow({ id: UUID_C, rowNumber: 3, status: "ready", depositAmount: "514135.35", closingBalance: "820923.08" }),
      lineRow({
        id: UUID_D,
        rowNumber: 4,
        withdrawalAmount: "-209.74",
        status: "pending",
        direction: null,
        flags: ["NEGATIVE_AMOUNT"],
        closingBalance: "821132.82",
      }),
    ]),
    [],
  );

  assert.equal(result.status, "balanced");
  assert.equal(result.difference, "0.00");
  assert.equal(result.openingBalance, "628816.17");
  assert.equal(result.closingBalance, "821132.82");
  assert.equal(result.expectedClosing, "821132.82");
  assert.equal(result.depositsTotal, "515135.35");
  assert.equal(result.withdrawalsTotal, "323028.44");
  assert.equal(result.derivedMovement, "209.74");
  assert.equal(result.derivedMovementCount, 1);
  assert.equal(result.invalidLineCount, 0);
  assert.ok(
    result.notes.some((note) => note.includes("Movement of 1 row taken from the printed balance chain")),
  );
  assert.ok(result.notes.some((note) => note.includes("209.74")));
  assert.ok(!result.warnings.some((warning) => warning.includes("cannot be counted")));
  // The reviewer still sees the unresolved row; balancing never hides it.
  assert.ok(result.warnings.some((warning) => warning.includes("1 line still needs review")));
  ok("reconciliation: a chain-anchored uncountable row closes the balance exactly (real-shape case)");
}

// ── Negative chain movement prints its absolute value in the note ────────────
{
  const result = reconcileStatementDetail(
    detailFixture([
      lineRow({ id: UUID_A, depositAmount: "500.00", closingBalance: "10500.00" }),
      lineRow({ id: UUID_B, rowNumber: 2, depositAmount: "1000.00", closingBalance: "11500.00" }),
      lineRow({
        id: UUID_C,
        rowNumber: 3,
        withdrawalAmount: "-120.00",
        status: "pending",
        flags: ["NEGATIVE_AMOUNT"],
        closingBalance: "11380.00",
      }),
    ]),
    [],
  );

  assert.equal(result.status, "balanced");
  assert.equal(result.difference, "0.00");
  assert.equal(result.derivedMovement, "-120.00");
  assert.equal(result.derivedMovementCount, 1);
  // The note prints the size of the movement, never a misleading minus.
  assert.ok(result.notes.some((note) => note.includes("printed balance chain (120.00 net)")));
  ok("reconciliation: a negative chain-derived movement reads as its absolute net size");
}

// ── No anchor: an uncountable first row stays excluded ───────────────────────
{
  const result = reconcileStatementDetail(
    detailFixture([
      lineRow({ id: UUID_A, withdrawalAmount: "-50.00", status: "pending", flags: ["NEGATIVE_AMOUNT"], closingBalance: "10000.00" }),
      lineRow({ id: UUID_B, rowNumber: 2, depositAmount: "500.00", closingBalance: "10500.00" }),
    ]),
    [],
  );

  assert.equal(result.invalidLineCount, 1);
  assert.equal(result.derivedMovementCount, 0); // the second row is countable and needs no derivation
  // Opening derivation needs a countable first row, so no opening exists.
  assert.equal(result.openingBalance, null);
  assert.equal(result.status, "insufficient_data");
  assert.ok(result.warnings.some((warning) => warning.includes("1 row cannot be counted")));
  ok("reconciliation: an uncountable row without a previous printed balance stays excluded");
}

// ── A counted row without a printed balance blocks derivation after it ───────
{
  const result = reconcileStatementDetail(
    detailFixture(
      [
        lineRow({ id: UUID_A, depositAmount: "1000.00", closingBalance: null }),
        lineRow({ id: UUID_B, rowNumber: 2, withdrawalAmount: "0.00", status: "pending", flags: ["ZERO_AMOUNT"], closingBalance: "11000.00" }),
      ],
      { openingBalance: "10000.00", closingBalance: "11000.00" },
    ),
    [],
  );

  // The pending row's movement cannot be isolated (the 1000 counted movement
  // sits inside any span), so it is excluded; the counted movement alone
  // still closes the check.
  assert.equal(result.derivedMovementCount, 0);
  assert.equal(result.invalidLineCount, 1);
  assert.equal(result.expectedClosing, "11000.00");
  assert.equal(result.status, "balanced");
  assert.ok(result.warnings.some((warning) => warning.includes("1 row cannot be counted")));
  ok("reconciliation: a counted row without a printed balance stops a double-counted derivation");
}

// ── A printed span absorbs an unprintable excluded row (no double count) ─────
{
  const result = reconcileStatementDetail(
    detailFixture(
      [
        lineRow({ id: UUID_A, depositAmount: "100.00", closingBalance: "100.00" }),
        lineRow({ id: UUID_B, rowNumber: 2, withdrawalAmount: null, depositAmount: null, closingBalance: null, status: "pending" }),
        lineRow({ id: UUID_C, rowNumber: 3, withdrawalAmount: "0.00", status: "pending", flags: ["ZERO_AMOUNT"], closingBalance: "1100.00" }),
      ],
      { openingBalance: "0.00", closingBalance: "1100.00" },
    ),
    [],
  );

  assert.equal(result.derivedMovementCount, 1);
  assert.equal(result.invalidLineCount, 1);
  assert.equal(result.derivedMovement, "1000.00");
  assert.equal(result.expectedClosing, "1100.00");
  assert.equal(result.status, "balanced");
  ok("reconciliation: a derived span covers unprintable rows exactly once");
}

// ── Consecutive uncountable rows derive one by one ───────────────────────────
{
  const result = reconcileStatementDetail(
    detailFixture(
      [
        lineRow({ id: UUID_A, depositAmount: "100.00", closingBalance: "100.00" }),
        lineRow({ id: UUID_B, rowNumber: 2, withdrawalAmount: "0.00", status: "pending", flags: ["ZERO_AMOUNT"], closingBalance: "95.00" }),
        lineRow({ id: UUID_C, rowNumber: 3, withdrawalAmount: "-10.00", status: "pending", flags: ["NEGATIVE_AMOUNT"], closingBalance: "105.00" }),
      ],
      { openingBalance: "0.00", closingBalance: "105.00" },
    ),
    [],
  );

  assert.equal(result.derivedMovement, "5.00");
  assert.equal(result.derivedMovementCount, 2);
  assert.equal(result.invalidLineCount, 0);
  assert.equal(result.status, "balanced");
  ok("reconciliation: consecutive flagged rows derive their own movements from the chain");
}

// ── Statement metadata present: the chain only fills movement, not balances ──
{
  const result = reconcileStatementDetail(
    detailFixture(
      [
        lineRow({ id: UUID_A, depositAmount: "500.00", closingBalance: "10500.00" }),
        lineRow({ id: UUID_B, rowNumber: 2, withdrawalAmount: "0.00", status: "pending", flags: ["ZERO_AMOUNT"], closingBalance: "10440.00" }),
        lineRow({ id: UUID_C, rowNumber: 3, depositAmount: "60.00", closingBalance: "10500.00" }),
      ],
      { openingBalance: "10000.00", closingBalance: "10500.00" },
    ),
    [],
  );

  // Declared balances win; the pending row's −60 still comes from the chain.
  assert.equal(result.derivedMovement, "-60.00");
  assert.equal(result.derivedMovementCount, 1);
  assert.equal(result.expectedClosing, "10500.00");
  assert.equal(result.status, "balanced");
  assert.ok(
    !result.notes.some((note) => note.includes("Opening balance derived")),
  );
  ok("reconciliation: chain-derived movement also works when the metadata declares both balances");
}

// ── Excluded rows never collide across pages / row order ────────────────────
{
  const result = reconcileStatementDetail(
    detailFixture(
      [
        lineRow({ id: UUID_C, pageNumber: 2, rowNumber: 1, depositAmount: "100.00", closingBalance: "300.00" }),
        lineRow({ id: UUID_A, pageNumber: 1, rowNumber: 2, depositAmount: "100.00", closingBalance: "200.00" }),
        lineRow({ id: UUID_D, pageNumber: 3, rowNumber: 1, withdrawalAmount: "0.00", status: "pending", flags: ["ZERO_AMOUNT"], closingBalance: "310.00" }),
      ],
      { openingBalance: "100.00", closingBalance: "310.00" },
    ),
    [],
  );

  assert.equal(result.derivedMovement, "10.00");
  assert.equal(result.derivedMovementCount, 1);
  assert.equal(result.invalidLineCount, 0);
  assert.equal(result.status, "balanced");
  ok("reconciliation: movement derivation follows page/row order, not array order");
}

// ── Derive Balances From Rows guard: uncountable first row cannot anchor ─────
{
  const derived = deriveBalancesFromRows([
    lineRow({ id: UUID_A, withdrawalAmount: "-50.00", closingBalance: "10500.00" }),
    lineRow({ id: UUID_E, rowNumber: 2, depositAmount: "500.00", closingBalance: "11000.00" }),
  ]);
  assert.equal(derived.opening, null);
  assert.equal(derived.closing, "11000.00");
  ok("reconciliation: closing stays derivable even when opening is not");
}

// ── Duplicate and skipped rows keep counting toward the movement ─────────────
{
  const result = reconcileStatementDetail(
    detailFixture(
      [
        lineRow({ id: UUID_A, depositAmount: "1000.00", status: "duplicate", closingBalance: "11000.00" }),
        lineRow({ id: UUID_C, rowNumber: 2, depositAmount: "500.00", status: "skipped", skipReason: "Personal", closingBalance: "11500.00" }),
        lineRow({ id: UUID_E, rowNumber: 3, depositAmount: "0.00", status: "pending", flags: ["ZERO_AMOUNT"], closingBalance: "11500.00" }),
      ],
      { openingBalance: "10000.00", closingBalance: "11500.00" },
    ),
    [],
  );

  assert.equal(result.depositsTotal, "1500.00");
  assert.equal(result.derivedMovement, "0.00");
  assert.equal(result.derivedMovementCount, 1);
  assert.equal(result.status, "balanced");
  ok("reconciliation: duplicates and skipped rows still count; a flat pending row derives zero");
}

console.log(`\n${passed} reconciliation checks passed`);
if (passed === 0) process.exit(1);
