/** Yearly growth assembly for the analytics page: raw per-FY totals → one row per financial
 *  year (Apr–Mar) with profit, margin and growth. Pure and clock-free.
 *
 *  Every year — the running one included — is compared with the FULL previous financial year
 *  (Apr 1 – Mar 31), exactly as the financial year is defined. The running year's totals are
 *  simply what the ledger holds so far, so its growth keeps improving as the year records money. */

import { growth, netProfit, profitMargin } from "./range";
import { financialYearLabel } from "../transactions/period";
import { formatINR } from "../format";

export type YearlyGrowth = ReturnType<typeof growth>;

export type YearlyRawRow = {
  fyStart: number;
  income: number;
  expense: number;
  incomeCount: number;
  expenseCount: number;
};

export type YearlyRow = {
  fyStart: number;
  /** "2026-27" — labelled from the FY start year (Apr `Y` – Mar `Y+1`). */
  label: string;
  income: number;
  expense: number;
  profit: number;
  margin: number | null; // null when the year has no income to divide by
  entries: number;
  /** Label of the comparable previous FY on record (null when none directly before). */
  prevLabel: string | null;
  /** Safe growth of net profit vs the previous FY's full April–March totals; null without a baseline. */
  profitGrowth: YearlyGrowth | null;
};

export type YearlyData = {
  rows: YearlyRow[]; // ascending by FY start (oldest first)
};

/** Assemble FY rows from raw totals. Growth compares the previous CONSECUTIVE FY only
 *  (`fyStart − 1` must be on record): a gap year never claims a growth percentage. */
export function buildYearlyRows(raw: readonly YearlyRawRow[]): YearlyRow[] {
  const sorted = [...raw].sort((a, b) => a.fyStart - b.fyStart);
  const byFy = new Map(sorted.map((r) => [r.fyStart, r]));

  return sorted.map((r) => {
    const prev = byFy.get(r.fyStart - 1) ?? null;
    const profit = netProfit(r.income, r.expense);
    const prevProfit = prev === null ? null : netProfit(prev.income, prev.expense);
    return {
      fyStart: r.fyStart,
      label: financialYearLabel(r.fyStart),
      income: r.income,
      expense: r.expense,
      profit,
      margin: profitMargin(r.income, r.expense),
      entries: r.incomeCount + r.expenseCount,
      prevLabel: prev === null ? null : financialYearLabel(prev.fyStart),
      profitGrowth: prevProfit === null ? null : growth(profit, prevProfit),
    };
  });
}

/** Table-cell text for a year's profit growth — compact on purpose (the column header and the
 *  sub-line carry the context): `+x.x%`, `-x.x%`, `New` (profit exists where the baseline had
 *  none), the compact absolute move when a percent would mislead (negative baseline), `0.0%`
 *  for unchanged, "—" when there is nothing to claim. */
export function yearlyGrowthCellText(g: YearlyGrowth | null): string {
  if (g === null || (g.kind === "flat" && g.pct === null)) return "—";
  if (g.kind === "flat") return "0.0%";
  if (g.pct !== null) return `${g.pct > 0 ? "+" : ""}${g.pct.toFixed(1)}%`;
  if (g.kind === "new") return "New";
  // Un-computable percentage (negative baseline or zero crossing): show the absolute move.
  return `${g.absolute > 0 ? "+" : "−"}${formatINR(Math.abs(g.absolute), { compact: true })}`;
}

/** Micro sub-line under a growth cell: the exact money move behind the percent (e.g. "+₹2.03L").
 *  Null when the main cell text already is an amount, or when there is no money move to show. */
export function yearlyGrowthCellSub(g: YearlyGrowth | null): string | null {
  if (g === null || g.kind === "flat") return null;
  if (g.pct === null && g.kind !== "new") return null; // the main cell text already is the amount
  return `${g.absolute > 0 ? "+" : "−"}${formatINR(Math.abs(g.absolute), { compact: true })}`;
}

/** Tone for the growth cell: profit up reads good, down bad — nothing readable stays neutral. */
export function yearlyGrowthCellTone(g: YearlyGrowth | null): "good" | "bad" | "neutral" {
  if (g === null || g.kind === "flat") return "neutral";
  const up = g.kind === "new" ? g.absolute > 0 : g.pct !== null ? g.pct >= 0 : g.absolute >= 0;
  return up ? "good" : "bad";
}
