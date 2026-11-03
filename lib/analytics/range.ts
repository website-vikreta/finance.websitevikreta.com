/** Pure analytics period + comparison maths. No DB, no clocks — `today` comes from
 *  `todayInIndia()` so IST rules are the caller's concern. Indian FY: 1 April – 31 March. */

import { financialYearStart } from "../transactions/period";

export const ANALYTICS_PERIODS = {
  month: "This month",
  quarter: "This quarter",
  fy: "This financial year",
  custom: "Custom range",
} as const;

export type AnalyticsPeriod = keyof typeof ANALYTICS_PERIODS;

export function parseAnalyticsPeriod(value: unknown): AnalyticsPeriod {
  return typeof value === "string" && value in ANALYTICS_PERIODS ? (value as AnalyticsPeriod) : "month";
}

export interface DateWindow {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
}

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Shift a YYYY-MM-DD date by months, clamping the day (2026-03-31 − 1m → 2026-02-28). */
export function shiftMonth(date: string, delta: number): string {
  const { y, m, d } = parts(date);
  const zero = y * 12 + (m - 1) + delta;
  const ny = Math.floor(zero / 12);
  const nm = (zero % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function monthWindow(today: string): { current: DateWindow; previous: DateWindow } {
  const { y, m } = parts(today);
  return {
    current: { from: ymd(y, m, 1), to: ymd(y, m, daysInMonth(y, m)) },
    previous: (() => {
      const p = shiftMonth(ymd(y, m, 1), -1);
      const { y: py, m: pm } = parts(p);
      return { from: p, to: ymd(py, pm, daysInMonth(py, pm)) };
    })(),
  };
}

/** Calendar quarters (project convention, period.ts): Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec. */
export function quarterWindow(today: string): { current: DateWindow; previous: DateWindow } {
  const { y, m } = parts(today);
  const qStart = Math.floor((m - 1) / 3) * 3 + 1;
  const start = ymd(y, qStart, 1);
  return { current: quarterBoundsFor(start), previous: quarterBoundsFor(shiftMonth(start, -3)) };
}

function quarterBoundsFor(start: string): DateWindow {
  const { y, m } = parts(start);
  return { from: start, to: ymd(y, m + 2, daysInMonth(y, m + 2)) };
}

/** Financial-year window for the FY containing `today` (Apr–Mar, "2026-27"). */
export function fyWindow(today: string): { current: DateWindow; previous: DateWindow } {
  const fyStart = financialYearStart(today);
  return { current: fyBounds(fyStart), previous: fyBounds(fyStart - 1) };
}

export function fyBounds(fyStart: number): DateWindow {
  return { from: ymd(fyStart, 4, 1), to: ymd(fyStart + 1, 3, 31) };
}

/** Previous window = the same number of days ending the day before `from`. */
export function shiftWindowBack({ from, to }: DateWindow): DateWindow {
  const dayMs = 86_400_000;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  const len = Math.round((toMs - fromMs) / dayMs) + 1;
  const prevTo = new Date(fromMs - dayMs).toISOString().slice(0, 10);
  const prevFrom = new Date(fromMs - len * dayMs).toISOString().slice(0, 10);
  return { from: prevFrom, to: prevTo };
}

/** Money change with safe percentage rules. Rising meaning (good/bad) is the caller's job.
 *  Percent is withheld when it would cross zero (+₹100 → −₹200 is a "−300%" that reads absurd) or
 *  when the baseline itself is not positive. */
export function growth(current: number, previous: number): { pct: number | null; absolute: number; kind: "up" | "down" | "flat" | "new" } {
  const absolute = current - previous;
  if (previous === 0 && current === 0) return { pct: null, absolute, kind: "flat" };
  if (previous === 0) return { pct: null, absolute, kind: "new" };
  if (previous < 0 || current < 0) return { pct: null, absolute, kind: absolute === 0 ? "flat" : absolute > 0 ? "up" : "down" }; // negative baseline/zero-crossing: a raw % would mislead
  return { pct: (absolute / previous) * 100, absolute, kind: absolute === 0 ? "flat" : absolute > 0 ? "up" : "down" };
}

/** Net profit figures for a window's totals (exact sums; no float drift — sums are integer minor unit Sums). */
export function netProfit(income: number, expense: number): number {
  return income - expense;
}

/** Profit margin %, or null when there is nothing to divide by (no income at all). */
export function profitMargin(income: number, expense: number): number | null {
  if (income <= 0) return null;
  return ((income - expense) / income) * 100;
}

/** Fold month series into calendar-quarter buckets (sums stay exact; empty months drop out). */
export function quarterlyBuckets(months: { month: string; income: number; expense: number }[]): { label: string; income: number; expense: number }[] {
  const out = new Map<string, { label: string; income: number; expense: number }>();
  for (const m of months) {
    const { y, m: mn } = parts(m.month);
    const qStart = Math.floor((mn - 1) / 3) * 3 + 1;
    const key = `${y}-${pad(qStart)}`;
    const end = qStart + 2;
    const label = quarterLabel(ymd(y, qStart, 1), end <= 12 ? y : y + 1);
    const bucket = out.get(key) ?? { label, income: 0, expense: 0 };
    bucket.income += m.income;
    bucket.expense += m.expense;
    out.set(key, bucket);
  }
  return [...out.values()];
}

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

function quarterLabel(from: string, endYear: number): string {
  const { m } = parts(from);
  return `${MONTH_SHORT[m - 1]}–${MONTH_SHORT[((m + 1) % 12)]} ${endYear}`;
}
