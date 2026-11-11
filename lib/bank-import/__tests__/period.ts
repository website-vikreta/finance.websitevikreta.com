/**
 * Offline checks for the statement period shown to managers.
 * No DB queries and no PDF library calls.
 *
 * Run: npm run test:bank-import
 */
import assert from "node:assert/strict";
import {
  effectivePeriod,
  effectiveStatementPeriod,
  formatPeriodRange,
  formatStatementPeriod,
} from "../period";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const printed = { statementFrom: "2026-04-01", statementTo: "2026-10-20" };

// ── The reported case: one-page extract of a six-month statement ─────────────
{
  const period = effectiveStatementPeriod(printed, [
    { txnDate: "2026-05-25", valueDate: "2026-05-25" },
    { txnDate: "2026-04-07", valueDate: "2026-04-07" },
    { txnDate: "2026-04-11", valueDate: null },
    { txnDate: "2026-04-22", valueDate: null },
  ]);
  assert.deepEqual(period, { from: "2026-04-07", to: "2026-05-25" });
  assert.equal(
    formatStatementPeriod(period.from, period.to),
    "7 Apr 2026 → 25 May 2026",
  );
  ok("period: row coverage wins over a wider printed header period");
}

// ── Value date is the fallback when the transaction date is missing ──────────
{
  const period = effectiveStatementPeriod(printed, [
    { txnDate: null, valueDate: "2026-04-09" },
    { txnDate: "2026-04-12", valueDate: null },
    { txnDate: null, valueDate: null },
  ]);
  assert.deepEqual(period, { from: "2026-04-09", to: "2026-04-12" });
  ok("period: value dates fill missing transaction dates; undated rows are ignored");
}

// ── Header period is the fallback only when no row carries a usable date ─────
{
  assert.deepEqual(effectiveStatementPeriod(printed, []), {
    from: "2026-04-01",
    to: "2026-10-20",
  });
  assert.deepEqual(
    effectiveStatementPeriod(printed, [{ txnDate: null, valueDate: null }]),
    { from: "2026-04-01", to: "2026-10-20" },
  );
  assert.deepEqual(
    effectiveStatementPeriod(
      { statementFrom: null, statementTo: null },
      [{ txnDate: "2026-04-05", valueDate: null }],
    ),
    { from: "2026-04-05", to: "2026-04-05" },
  );
  ok("period: printed header used only when no dated rows exist");
}

// ── Pre-aggregated SQL bounds use the same rule as loaded rows ───────────────
{
  assert.deepEqual(effectivePeriod(printed, "2026-04-07", "2026-05-25"), {
    from: "2026-04-07",
    to: "2026-05-25",
  });
  assert.deepEqual(effectivePeriod(printed, null, null), {
    from: "2026-04-01",
    to: "2026-10-20",
  });
  assert.equal(
    formatPeriodRange("2026-04-07", "2026-05-25"),
    "7 Apr 2026 → 25 May 2026",
  );
  assert.equal(formatPeriodRange("2026-04-07", null), null);
  ok("period: list aggregation and detail rows share one resolution rule");
}

// ── Shared copy ──────────────────────────────────────────────────────────────
{
  assert.equal(formatStatementPeriod(null, null), "Statement period unavailable");
  assert.equal(formatStatementPeriod("2026-04-07", null), "7 Apr 2026 → Ongoing");
  assert.equal(formatStatementPeriod("2026-04-07", "2026-04-07"), "7 Apr 2026 → 7 Apr 2026");
  ok("period: one consistent label for cards, summaries and warnings");
}

console.log(`\nperiod: ${passed} checks passed.`);
