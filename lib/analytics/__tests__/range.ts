/** Offline checks for the analytics period windows and comparison maths (pure logic only). */
import assert from "node:assert/strict";
import {
  monthWindow,
  quarterWindow,
  fyWindow,
  fyBounds,
  shiftWindowBack,
  shiftMonth,
  growth,
  profitMargin,
  quarterlyBuckets,
  parseAnalyticsPeriod,
} from "../range";

let passed = 0;
function ok(message: string): void {
  console.log(`  ✓ ${message}`);
  passed += 1;
}

const eq = (a: unknown, b: unknown) => assert.deepEqual(a, b);

function run(): void {
  // Month boundaries — including the leap-year February.
  const oct = monthWindow("2026-10-29");
  eq(oct.current, { from: "2026-10-01", to: "2026-10-31" });
  eq(oct.previous, { from: "2026-09-01", to: "2026-09-30" });
  eq(monthWindow("2024-02-10").current.to, "2024-02-29");
  eq(monthWindow("2023-02-10").current.to, "2023-02-28");
  ok("month: Oct 2026 closes on the 31st; Feb 2024 leap vs Feb 2023");

  // Month shift clamps the day (31 → shorter month).
  eq(shiftMonth("2026-03-31", -1), "2026-02-28");
  eq(shiftMonth("2026-01-31", 1), "2026-02-28");
  ok("shiftMonth: day 31 clamps into shorter months");

  // Quarter windows — calendar quarters (project convention), incl. the year rollover.
  const q4 = quarterWindow("2026-10-29");
  eq(q4.current, { from: "2026-10-01", to: "2026-12-31" });
  eq(q4.previous, { from: "2026-07-01", to: "2026-09-30" });
  const q1 = quarterWindow("2026-01-15");
  eq(q1.current, { from: "2026-01-01", to: "2026-03-31" });
  eq(q1.previous, { from: "2025-10-01", to: "2025-12-31" });
  ok("quarter: Oct–Dec follows Jul–Sep; Jan window rolls back to the previous year");

  // Financial-year windows — April to March, previous FY one year back.
  const fy = fyWindow("2026-10-29");
  eq(fy.current, { from: "2026-04-01", to: "2027-03-31" });
  eq(fy.previous, { from: "2025-04-01", to: "2026-03-31" });
  eq(fyWindow("2027-01-15").current, fyBounds(2026));
  eq(fyWindow("2026-03-31").current, fyBounds(2025));
  ok("fy: Apr 2026–Mar 2027 with the 2025-26 window behind it; Jan/Mar pick the right FY");

  // Custom previous window = same length ending the day before.
  eq(shiftWindowBack({ from: "2026-01-01", to: "2026-01-31" }), { from: "2025-12-01", to: "2025-12-31" });
  eq(shiftWindowBack({ from: "2026-03-31", to: "2026-04-02" }), { from: "2026-03-28", to: "2026-03-30" });
  ok("custom: previous window keeps length and rolls across the year boundary");

  // Growth percentages — the misleading-cases rules.
  eq(growth(0, 0), { pct: null, absolute: 0, kind: "flat" });
  eq(growth(500, 0), { pct: null, absolute: 500, kind: "new" });
  eq(growth(0, 400), { pct: -100, absolute: -400, kind: "down" });
  eq(growth(800, 400), { pct: 100, absolute: 400, kind: "up" });
  eq(growth(-200, 100).pct, null); // negative baseline: no percent claim
  ok("growth: 0/0 stays flat, 0→+ is 'new', +→0 is −100%, negative baseline hides pct");

  // Profit margin — never divides by zero income.
  eq(profitMargin(100_000, 20_000), 80);
  eq(profitMargin(500, 900), -80);
  eq(profitMargin(0, 300), null);
  eq(profitMargin(-100, 200), null);
  ok("margin: 80% / negative income / zero income → null, never a fake percent");

  // Quarterly bucket fold — sums are preserved exactly, labels are calendar quarters.
  const buckets = quarterlyBuckets([
    { month: "2026-04-01", income: 100.5, expense: 10 },
    { month: "2026-05-01", income: 200, expense: 20.25 },
    { month: "2026-06-01", income: 50, expense: 5 },
    { month: "2026-07-01", income: 0, expense: 0 },
  ]);
  eq(buckets.length, 2);
  eq(buckets[0].income, 350.5);
  eq(buckets[0].expense, 35.25);
  eq(buckets[1].income, 0);
  ok("quarterly: Apr–Jun folds into one bucket with exact sums; empty month still closes its bucket");

  // Period parsing falls back safely.
  eq(parseAnalyticsPeriod("fy"), "fy");
  eq(parseAnalyticsPeriod("nonsense"), "month");
  ok("parse: unknown period falls back to this month");

  console.log(`\nanalytics-range: ${passed} checks passed`);
}

run();
