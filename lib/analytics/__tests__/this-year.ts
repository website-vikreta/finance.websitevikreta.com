/** Offline checks for the This year band (pure logic only — no DB).
 *  Fixture locked to today = 2026-11-02 (FY 2026-27, day 216 of 365), months hand-summed so
 *  the pace lands on clean round numbers: 8,64,000 in / 4,32,000 out over 216 days →
 *  ₹4,000 in and ₹2,000 out a day → 14,60,000 / 7,30,000 by 31 March. */
import assert from "node:assert/strict";
import { buildThisYear, thisYearBadgeLabel, type ThisYearData } from "../this-year";
import type { YearlyRow } from "../yearly";

let passed = 0;
function ok(message: string): void {
  console.log(`  ✓ ${message}`);
  passed += 1;
}

const eq = (a: unknown, b: unknown) => assert.deepEqual(a, b);

/** The 12 zero-filled rows of FY 2026-27, exactly as `monthlyTotalsForYear` returns them. */
const FY26_MONTH_KEYS = [
  "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01",
  "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01",
];

type Cell = { month: string; income: number; expense: number };

function monthsFor(data: Record<string, [number, number]>): Cell[] {
  return FY26_MONTH_KEYS.map((month) => {
    const ym = month.slice(0, 7);
    const [income = 0, expense = 0] = data[ym] ?? [];
    return { month, income, expense };
  });
}

function yearRow(fyStart: number, label: string, income: number): YearlyRow {
  return { fyStart, label, income, expense: 0, profit: income, margin: null, entries: 0, prevLabel: null, profitGrowth: null };
}

/** The standard fixture: 8 months elapsed (Apr–Nov), 6 months on mute, Nov is the running month. */
const BIG_FIXTURE: Record<string, [number, number]> = {
  "2026-04": [180_000, 130_000],
  "2026-05": [84_000, 95_000],
  "2026-07": [240_000, 100_000],
  "2026-08": [120_000, 90_000],
  "2026-10": [150_000, 17_000],
  "2026-11": [90_000, 0],
};

function build(main: boolean, overrides?: Partial<Parameters<typeof buildThisYear>[0]>): ThisYearData {
  return buildThisYear({
    months: monthsFor(BIG_FIXTURE),
    today: "2026-11-02",
    lastIncomeDate: main ? "2026-10-29" : null,
    yearlyRows: main ? [yearRow(2025, "2025-26", 40_000), yearRow(2026, "2026-27", 864_000)] : [],
    ...overrides,
  });
}

function pastLedgerOnly(overrides?: Partial<Parameters<typeof buildThisYear>[0]>): ThisYearData {
  // Skip the milestone-weighted default rows: behaviour-only overrides play on this one.
  return buildThisYear({
    months: monthsFor(BIG_FIXTURE),
    today: "2026-11-02",
    lastIncomeDate: null,
    yearlyRows: [],
    ...overrides,
  });
}

function run(): void {
  const y = build(true);

  // Badge, bounds, day maths (Indian FY: 1 Apr 2026 – 31 Mar 2027; no leap February).
  eq(thisYearBadgeLabel(2026), "APR26-MAR27");
  eq(y.label, "APR26-MAR27");
  eq(y.fy, { from: "2026-04-01", to: "2027-03-31" });
  eq(y.daysIn, 365);
  eq(y.daysUsed, 216); // Apr 30 + May 31 + Jun 30 + Jul 31 + Aug 31 + Sep 30 + Oct 31 + Nov 2
  eq(Number((y.progress * 365).toFixed(10)), 216);
  ok("day maths: Day 216 of 365, label APR26-MAR27, bounds 1 Apr → 31 Mar");

  // Year-to-date totals, summed from the strip's own monthly rows.
  eq(y.income, 864_000);
  eq(y.expense, 432_000);
  eq(y.profit, 432_000);
  eq(y.monthsElapsed, 8);
  ok("year-to-date: 8,64,000 in / 4,32,000 out / 4,32,000 kept across 8 elapsed months");

  // Pace: day-rates × 365 — clean because 216 divides both totals exactly.
  eq(y.pace, { income: 1_460_000, expense: 730_000, profit: 730_000, dailyIncome: 4_000, dailyExpense: 2_000 });
  ok("pace: ₹4,000 in and ₹2,000 out a day → 14,60,000 / 7,30,000 by 31 Mar");

  // Milestone: income so far vs the previous FY's FULL income — never capped, honest at 100%.
  eq(y.milestone, { prevLabel: "2025-26", prevIncome: 40_000, pct: 2160, passed: true });
  ok("milestone: 2160% of FY 2025-26's full income, passed");

  // Rhythm: 5 of 8 elapsed months kept money, July is the strongest.
  eq(y.rhythm, { count: 5, total: 8, best: { label: "Jul", net: 140_000 } });
  ok("rhythm: 5 of 8 months profitable, best July at ₹1,40,000 net");

  // Strip: 12 cells, April names first, September keeps the page's "Sept" spelling.
  eq(y.strip.length, 12);
  eq(y.strip.map((c) => c.label), ["Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]);
  eq(y.strip.map((c) => c.state), [
    "past", "past", "past", "past", "past", "past", "past", "current", "future", "future", "future", "future",
  ]);
  ok("strip: 12 Apr→Mar cells, Apr–Oct past, Nov current, Dec–Mar future");

  // Intensity: |net| / max|net| — July is the year's full strength, flat months stay null.
  const [apr, may, jun, jul, , , oct, nov] = y.strip;
  eq(apr.intensity?.toFixed(4), "0.3571"); // 50,000 / 1,40,000
  eq(may.intensity?.toFixed(4), "0.0786"); // 11,000 lost
  eq(jun.intensity, null); // flat month
  eq(jul.intensity?.toFixed(4), "1.0000");
  eq(oct.intensity?.toFixed(4), "0.9500"); // 1,33,000
  eq(nov.intensity?.toFixed(4), "0.6429"); // 90,000, still the running month
  ok("intensity scales each month against July's 1,40,000; flat months stay null");

  // Tooltips, in plain words with exact figures (en-IN grouping, typographic minus).
  eq(apr.title, "Apr 2026 · money in ₹1,80,000 · money out ₹1,30,000 · net ₹50,000");
  eq(may.title, "May 2026 · money in ₹84,000 · money out ₹95,000 · net −₹11,000");
  eq(jun.title, "Jun 2026 · no movement recorded");
  eq(nov.title, "Nov 2026 · money in ₹90,000 · money out ₹0 · net ₹90,000 · current month");
  eq(y.strip[8].title, "Dec 2026 · no money recorded yet");
  ok("tooltips say what each month did — exact in/out/net, flat months admit it, future promises nothing");

  // Last money in: 29 Oct → 2 Nov 2026 = 4 days, clamped for future-dated mistakes.
  eq(y.lastIncome, { date: "2026-10-29", daysAgo: 4 });
  eq(build(true, { lastIncomeDate: "2026-11-02" }).lastIncome?.daysAgo, 0);
  eq(build(true, { lastIncomeDate: "2025-12-15" }).lastIncome?.daysAgo, 322);
  eq(build(true, { lastIncomeDate: "2027-01-15" }).lastIncome?.daysAgo, 0); // future-dated entry never goes negative
  ok("last money: 4 days since 29 Oct; today/old/future dates land on 0..N correctly");

  // The story: money sentence + one insight, milestone passed beats best month.
  eq(y.story, "Since 1 April you've brought in ₹8.64L, spent ₹4.32L and kept ₹4.32L. You've already earned more than FY 2025-26 did all year.");

  // Below the milestone: the best-month insight steps in.
  const under = pastLedgerOnly({ yearlyRows: [yearRow(2025, "2025-26", 2_000_000)], lastIncomeDate: null });
  eq(under.milestone, { prevLabel: "2025-26", prevIncome: 2_000_000, pct: 43.2, passed: false });
  eq(under.story, "Since 1 April you've brought in ₹8.64L, spent ₹4.32L and kept ₹4.32L. Jul was the strongest month, netting ₹1.40L.");
  ok("story: milestone line at 2160%, best-July line when the year hasn't caught up (43.2%)");

  // Exactly matched: 'matched' wording, 100%, passed.
  const even = pastLedgerOnly({
    months: monthsFor({ "2026-04": [40_000, 0] }),
    yearlyRows: [yearRow(2025, "2025-26", 40_000)],
  });
  eq(even.milestone, { prevLabel: "2025-26", prevIncome: 40_000, pct: 100, passed: true });
  eq(even.story, "Since 1 April you've brought in ₹40k, spent ₹0 and kept ₹40k. You've matched FY 2025-26's full-year income.");
  ok("exact year-over-year match reads 'matched', 100%, passed");

  // Empty year: honest zeros, no pace, no story, nothing to measure against.
  const empty = pastLedgerOnly({ months: monthsFor({}) });
  eq(empty.income, 0);
  eq(empty.pace, null);
  eq(empty.story, null);
  eq(empty.rhythm, { count: 0, total: 8, best: null });
  eq(empty.lastIncome, null);
  eq(empty.milestone, null);
  eq(empty.strip[3].intensity, null); // no movement anywhere → everything stays neutral
  ok("empty year: pace/story/rhythm-best go null, strip stays muted and honest");

  // Previous year on record but it earned nothing: pct undecided, copy stays exact.
  const zeroPrev = pastLedgerOnly({ yearlyRows: [yearRow(2025, "2025-26", 0)] });
  eq(zeroPrev.milestone, { prevLabel: "2025-26", prevIncome: 0, pct: null, passed: false });
  ok("zero-income previous year: 100% is meaningless, pct stays null");

  // Leap February FY: 1 Apr 2027 – 31 Mar 2028 spans 366 days. Asked for 5 Jan 2028:
  // 280 days in (275 across Apr–Dec + 5 in Jan), 10 months elapsed, Jan current, zero data.
  const leap = buildThisYear({
    months: monthsFor({}).map((c) => ({ ...c, month: `${String(Number(c.month.slice(0, 4)) + 1)}${c.month.slice(4)}` })),
    today: "2028-01-05",
    lastIncomeDate: null,
    yearlyRows: [],
  });
  eq(leap.label, "APR27-MAR28");
  eq(leap.fy, { from: "2027-04-01", to: "2028-03-31" });
  eq(leap.daysIn, 366);
  eq(leap.daysUsed, 280);
  eq(leap.monthsElapsed, 10);
  eq(leap.strip[9], { month: "2028-01-01", label: "Jan", state: "current", income: 0, expense: 0, net: 0, intensity: null, title: "Jan 2028 · current month · no movement yet" });
  ok("leap FY 2027-28: APR27-MAR28, 366 days, Day 280, 10 months elapsed, Jan current");
}

run();
console.log(`this-year band: ${passed} checks passed`);
