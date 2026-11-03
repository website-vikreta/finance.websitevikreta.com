/** Offline checks for the yearly growth assembly (pure logic only — no DB). */
import assert from "node:assert/strict";
import { buildYearlyRows, yearlyGrowthCellSub, yearlyGrowthCellText, yearlyGrowthCellTone, type YearlyRawRow } from "../yearly";

let passed = 0;
function ok(message: string): void {
  console.log(`  ✓ ${message}`);
  passed += 1;
}

const eq = (a: unknown, b: unknown) => assert.deepEqual(a, b);

function raw(fyStart: number, income: number, expense: number, incomeCount = 0, expenseCount = 0): YearlyRawRow {
  return { fyStart, income, expense, incomeCount, expenseCount };
}

function run(): void {
  // The real ledger shape (FY 2025-26 = 40k in / 15k out over 2 entries; FY 2026-27 running with
  // 551,699 in / 324,107 out): EVERY year compares with the FULL previous April–March year.
  const rows = buildYearlyRows([raw(2026, 551_699, 324_107, 78, 52), raw(2025, 40_000, 15_000, 1, 1)]);
  eq(rows.map((r) => r.fyStart), [2025, 2026]);
  eq(rows.map((r) => r.label), ["2025-26", "2026-27"]);
  ok("rows come out ascending with start-year FY labels (Apr–Mar)");

  const fy2025 = rows[0];
  eq(fy2025.profit, 25_000); // 40,000 − 15,000
  eq(fy2025.margin, 62.5); // 25,000 / 40,000
  eq(fy2025.entries, 2);
  eq(fy2025.prevLabel, null); // FY 2024-25 has no transactions → nothing comparable
  eq(fy2025.profitGrowth, null);
  eq(yearlyGrowthCellText(fy2025.profitGrowth), "—");
  eq(yearlyGrowthCellSub(fy2025.profitGrowth), null);
  eq(yearlyGrowthCellTone(fy2025.profitGrowth), "neutral");
  ok("FY 2025-26: '—' (neutral) while its own profit ₹25,000 and 62.5% margin stay real");

  const fy2026 = rows[1];
  eq(fy2026.profit, 227_592); // 551,699 − 324,107
  eq(fy2026.prevLabel, "2025-26");
  eq(fy2026.entries, 130);
  eq(fy2026.profitGrowth?.kind, "up");
  eq(fy2026.profitGrowth?.pct?.toFixed(1), "810.4"); // (227,592 − 25,000) / 25,000 × 100
  eq(yearlyGrowthCellText(fy2026.profitGrowth), "+810.4%");
  eq(yearlyGrowthCellTone(fy2026.profitGrowth), "good");
  eq(yearlyGrowthCellSub(fy2026.profitGrowth), "+₹2.03L"); // exact money move: 227,592 − 25,000 = 202,592
  ok("full-FY comparison prints the exact percent (+810.4%) and exact money move (+₹2.03L)");

  // Falling profit: negative percent with the exact move, both bad-toned.
  const dropping = buildYearlyRows([raw(2026, 50_000, 0), raw(2025, 200_000, 100_000)])[1];
  eq(dropping.profitGrowth?.pct?.toFixed(1), "-50.0"); // (50,000 − 100,000) / 100,000
  eq(yearlyGrowthCellText(dropping.profitGrowth), "-50.0%");
  eq(yearlyGrowthCellTone(dropping.profitGrowth), "bad");
  eq(yearlyGrowthCellSub(dropping.profitGrowth), "−₹50k");
  ok("falling profit: −50.0% with the exact −₹50k move, bad-toned");

  // Zero-profit baseline (completed year): 'New' with the exact profit underneath.
  const revived = buildYearlyRows([raw(2026, 550_000, 320_000), raw(2025, 374_000, 145_700), raw(2024, 200_000, 200_000)])[1];
  eq(revived.profitGrowth?.kind, "new");
  eq(revived.profitGrowth?.pct, null);
  eq(yearlyGrowthCellText(revived.profitGrowth), "New");
  eq(yearlyGrowthCellTone(revived.profitGrowth), "good");
  eq(yearlyGrowthCellSub(revived.profitGrowth), "+₹2.28L"); // 228,300 earned from a ₹0 baseline year
  ok("zero-profit baseline reads 'New' (good); the sub-line still shows the exact ₹2.28L");

  // Loss after a zero-profit baseline: still 'New', but bad, with the exact loss.
  const lossNew = buildYearlyRows([raw(2026, 10_000, 0), raw(2025, 50_000, 80_000), raw(2024, 20_000, 20_000)])[1];
  eq(lossNew.profitGrowth?.kind, "new");
  eq(yearlyGrowthCellText(lossNew.profitGrowth), "New");
  eq(yearlyGrowthCellTone(lossNew.profitGrowth), "bad");
  eq(yearlyGrowthCellSub(lossNew.profitGrowth), "−₹30k");
  ok("loss after a zero-profit year: 'New' in red with the exact −₹30k loss");

  // Unchanged / both-zero profits.
  const unchanged = buildYearlyRows([raw(2026, 10_000, 5_000), raw(2025, 10_000, 5_000)])[1];
  eq(unchanged.profitGrowth?.kind, "flat");
  eq(unchanged.profitGrowth?.pct, 0);
  eq(yearlyGrowthCellText(unchanged.profitGrowth), "0.0%");
  eq(yearlyGrowthCellTone(unchanged.profitGrowth), "neutral");
  eq(yearlyGrowthCellSub(unchanged.profitGrowth), null);
  const nothing = buildYearlyRows([raw(2026, 0, 0), raw(2025, 0, 0)])[1];
  eq(yearlyGrowthCellText(nothing.profitGrowth), "—");
  eq(yearlyGrowthCellSub(nothing.profitGrowth), null);
  ok("equal profit reads 0.0% (no sub-line); both-zero reads '—'");

  // Negative previous-year profit: percent withheld, the cell itself IS the exact move.
  const negativeBase = buildYearlyRows([raw(2026, 10_000, 0), raw(2025, 0, 10_000)])[1];
  eq(negativeBase.profitGrowth?.pct, null);
  eq(negativeBase.profitGrowth?.absolute, 20_000); // 10,000 − (−10,000)
  eq(negativeBase.profitGrowth?.kind, "up");
  eq(yearlyGrowthCellText(negativeBase.profitGrowth), "+₹20k");
  eq(yearlyGrowthCellTone(negativeBase.profitGrowth), "good");
  eq(yearlyGrowthCellSub(negativeBase.profitGrowth), null); // no duplicate sub-line
  ok("negative baseline withholds percent; the cell itself is the exact money move");

  // Gap year: 2024-25 and 2026-27 on record, 2025-26 missing → no claim.
  const gap = buildYearlyRows([raw(2026, 551_699, 324_107), raw(2024, 200_000, 100_000)]);
  eq(gap[1].prevLabel, null);
  eq(gap[1].profitGrowth, null);
  eq(yearlyGrowthCellText(gap[1].profitGrowth), "—");
  ok("a missing consecutive FY never claims growth (honest '—')");

  // Single year on record (the ledger shape before the 2025-26 entries landed): '—'.
  const alone = buildYearlyRows([raw(2026, 551_699, 324_107)])[0];
  eq(alone.profit, 227_592);
  eq(alone.margin?.toFixed(1), "41.3"); // 227,592 / 551,699 × 100
  eq(alone.profitGrowth, null);
  eq(alone.entries, 0);
  ok("a lone FY on record: totals and margin stay honest, growth '—'");

  // Margin never divides by nothing; entries sum both types.
  const noIncome = buildYearlyRows([raw(2026, 0, 900), raw(2025, 10_000, 5_000), raw(2024, 10_000, 5_000, 4, 6)]);
  eq(noIncome[2].margin, null); // 2026-27 has zero income
  eq(noIncome[0].entries, 10); // 4 income + 6 expense entries
  ok("margin '—' with zero income; entries sum income + expense counts");
}

run();
console.log(`yearly-growth: ${passed} checks passed`);
