/** Server-side analytics aggregation. Read-only: sums existing normalized INR amounts from
 *  `transactions` (deleted rows excluded, matching Dashboard/Reports eligibility rules).
 *  All 8 period buckets (selected + previous, and the fixed month/quarter/FY + previous
 *  comparisons) come out of ONE grouped query; monthly series, breakdowns and extremes
 *  fan out in parallel afterwards. */

import { monthlyTotalsBetween, transactionExtremes, expenseBreakdown, incomeBreakdown, analyticsRangeTotals, type MonthTotals, type Breakdown, type AnalyticsExtreme, type RangeBucketTotals } from "../transactions/queries";
import { todayInIndia, financialYearLabel } from "../transactions/period";
import { monthWindow, quarterWindow, fyWindow, fyBounds, shiftWindowBack, MONTH_SHORT, type DateWindow } from "./range";

export type RangeTotals = RangeBucketTotals;

const ZERO_RANGE: RangeTotals = { income: 0, expense: 0, incomeCount: 0, expenseCount: 0 };

function monthShortLabel(from: string): string {
  return `${MONTH_SHORT[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
}

function windowLabels({ from, to }: DateWindow, fyAware = true): string {
  if (fyAware) {
    const fyStart = Number(from.slice(5, 7)) >= 4 ? Number(from.slice(0, 4)) : Number(from.slice(0, 4)) - 1;
    const bounds = fyBounds(fyStart);
    if (bounds.from === from && bounds.to === to) return `FY ${financialYearLabel(fyStart)}`;
  }
  if (from.slice(0, 7) === to.slice(0, 7)) return monthShortLabel(from); // single-month window
  return `${monthShortLabel(from)} – ${monthShortLabel(to)}`;
}

export interface AnalyticsComparison {
  label: string;
  current: RangeTotals;
  previous: RangeTotals;
  prevLabel: string;
}

export interface AnalyticsData {
  period: "month" | "quarter" | "fy" | "custom";
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  label: string;
  prevLabel: string;
  current: RangeTotals;
  previous: RangeTotals;
  months: MonthTotals[];
  expenseCats: Breakdown[];
  topClients: Breakdown[];
  extremes: { income: AnalyticsExtreme | null; expense: AnalyticsExtreme | null };
  comparisons: { month: AnalyticsComparison; quarter: AnalyticsComparison; fy: AnalyticsComparison };
}

/** Build every analytics bucket for the selected period. Reads only; no writes anywhere. */
export async function getAnalyticsOverview(spec: { period: "month" | "quarter" | "fy" | "custom"; customFrom?: string | null; customTo?: string | null; today?: string }): Promise<AnalyticsData | null> {
  const today = spec.today ?? todayInIndia();
  const fixed = {
    month: monthWindow(today),
    quarter: quarterWindow(today),
    fy: fyWindow(today),
  };

  let sel: { current: DateWindow; previous: DateWindow; label: string; prevLabel: string };
  if (spec.period === "custom") {
    const from = spec.customFrom ?? "";
    const to = spec.customTo ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
    const current = { from, to };
    const previous = shiftWindowBack(current);
    sel = {
      current,
      previous,
      label: windowLabels(current, false),
      prevLabel: windowLabels(previous, false),
    };
  } else {
    const w = fixed[spec.period];
    sel = {
      current: w.current,
      previous: w.previous,
      label: windowLabels(w.current),
      prevLabel: windowLabels(w.previous),
    };
  }

  const windows = {
    sel: sel.current,
    selPrev: sel.previous,
    m: fixed.month.current,
    mp: fixed.month.previous,
    q: fixed.quarter.current,
    qp: fixed.quarter.previous,
    fy: fixed.fy.current,
    fyp: fixed.fy.previous,
  };

  const [totals, months, cats, clients, extremes] = await Promise.all([
    analyticsRangeTotals(windows),
    monthlyTotalsBetween(sel.current.from, sel.current.to),
    expenseBreakdown(sel.current.from, sel.current.to),
    incomeBreakdown(sel.current.from, sel.current.to),
    transactionExtremes(sel.current.from, sel.current.to),
  ]);

  return {
    period: spec.period,
    from: sel.current.from,
    to: sel.current.to,
    prevFrom: sel.previous.from,
    prevTo: sel.previous.to,
    label: sel.label,
    prevLabel: sel.prevLabel,
    current: totals.sel ?? ZERO_RANGE,
    previous: totals.selPrev ?? ZERO_RANGE,
    months,
    expenseCats: cats,
    topClients: clients,
    extremes,
    comparisons: {
      month: {
        label: monthShortLabel(fixed.month.current.from),
        prevLabel: monthShortLabel(fixed.month.previous.from),
        current: totals.m ?? ZERO_RANGE,
        previous: totals.mp ?? ZERO_RANGE,
      },
      quarter: {
        label: windowLabels(fixed.quarter.current),
        prevLabel: windowLabels(fixed.quarter.previous),
        current: totals.q ?? ZERO_RANGE,
        previous: totals.qp ?? ZERO_RANGE,
      },
      fy: {
        label: windowLabels(fixed.fy.current),
        prevLabel: windowLabels(fixed.fy.previous),
        current: totals.fy ?? ZERO_RANGE,
        previous: totals.fyp ?? ZERO_RANGE,
      },
    },
  };
}
