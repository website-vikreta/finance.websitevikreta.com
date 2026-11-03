/** "This year" — the analytics hero band for the current financial year (April → March).
 *  It answers HOW the year is moving, not just how much: pace (a straight-line projection),
 *  the milestone against the previous full year's income, the profit rhythm of the months
 *  gone by, one last-money beat, and a 12-month net-movement strip.
 *
 *  Pure and clock-free — `today` comes from `todayInIndia()`. The band re-anchors itself
 *  every 1 April with no code change, exactly like the rest of the FY maths. */

import { fyBounds, MONTH_SHORT, netProfit } from "./range";
import { financialYearStart } from "../transactions/period";
import { formatINR } from "../format";
import type { YearlyRow } from "./yearly";

/** A single cell of the April → March money strip. */
export type ThisYearMonthCell = {
  /** First day of the month, YYYY-MM-01. */
  month: string;
  /** "Apr", "Sept" (same naming as the rest of the page). */
  label: string;
  state: "past" | "current" | "future";
  income: number;
  expense: number;
  /** money in − money out, exactly as the ledger holds it. */
  net: number;
  /** |net| / max|net| of the year (0..1) — drives the strip's colour intensity.
   *  Null for flat months (nothing to scale) and always null for future months. */
  intensity: number | null;
  /** Human tooltip copy, ready to hand to a native `title`. */
  title: string;
};

export type ThisYearData = {
  /** "APR26-MAR27" — re-anchors itself on every 1 April. */
  label: string;
  /** Full financial-year bounds, YYYY-MM-DD (1 April → 31 March). */
  fy: { from: string; to: string };
  /** Days of the year consumed so far — always 1..daysIn (day one counts). */
  daysUsed: number;
  /** 365, or 366 across a leap February. */
  daysIn: number;
  /** daysUsed / daysIn. */
  progress: number;
  /** Money actually recorded year-to-date (not projected). */
  income: number;
  expense: number;
  profit: number;
  /** Months gone by, the running one included. */
  monthsElapsed: number;
  /** Where the current day-rates land by 31 March if the rest of the year
   *  runs at exactly the year-to-date pace. Null when nothing is recorded yet. */
  pace: {
    income: number;
    expense: number;
    profit: number;
    /** Rounded per-day rates behind the projection. */
    dailyIncome: number;
    dailyExpense: number;
  } | null;
  /** Income progress vs the previous FY's FULL April–March income. Null when the
   *  previous year isn't on record; pct stays null when it never earned anything. */
  milestone: { prevLabel: string; prevIncome: number; pct: number | null; passed: boolean } | null;
  /** How many of the elapsed months kept money, plus the strongest one. */
  rhythm: { count: number; total: number; best: { label: string; net: number } | null };
  /** Most recent income entry across the whole ledger — "last money in". */
  lastIncome: { date: string; daysAgo: number } | null;
  strip: ThisYearMonthCell[];
  /** One or two plain sentences telling the year's story. Null with an empty year. */
  story: string | null;
};

/** Typed shortcut: |a − b| in whole days, parsing both ends as UTC midnight
 *  (the same trick `shiftWindowBack` uses, so no timezone surprises). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const yy = (year: number) => String(year % 100).padStart(2, "0");

/** The badge text for an FY starting year, e.g. 2026 → "APR26-MAR27". */
export function thisYearBadgeLabel(fyStart: number): string {
  return `APR${yy(fyStart)}-MAR${yy(fyStart + 1)}`;
}

/** Minus sign style shared with the yearly growth cells (typographic, not hyphen). */
const MINUS = "−";

function titleFor(cell: { label: string; month: string; net: number }, details: string): string {
  const year = cell.month.slice(0, 4);
  const suffix = details.length > 0 ? ` · ${details}` : "";
  return `${cell.label} ${year}${suffix}`;
}

export function buildThisYear(spec: {
  /** The 12 zero-filled Apr→Mar rows of the current FY, as `monthlyTotalsForYear` returns them. */
  months: readonly { month: string; income: number; expense: number }[];
  today: string;
  lastIncomeDate: string | null;
  /** Year rows on record — used only to find the previous FY's full-year totals. */
  yearlyRows: readonly YearlyRow[];
}): ThisYearData {
  const fyStart = financialYearStart(spec.today);
  const fy = fyBounds(fyStart);
  const todayYM = spec.today.slice(0, 7);

  const strip: ThisYearMonthCell[] = spec.months.map((m) => {
    const ym = m.month.slice(0, 7);
    const state: ThisYearMonthCell["state"] = ym < todayYM ? "past" : ym === todayYM ? "current" : "future";
    return {
      month: m.month,
      label: MONTH_SHORT[Number(ym.slice(5, 7)) - 1],
      state,
      income: m.income,
      expense: m.expense,
      net: netProfit(m.income, m.expense),
      intensity: null, // filled in below, once the year's biggest move is known
      title: "",
    };
  });

  const elapsed = strip.filter((c) => c.state !== "future");

  // Strip intensity: each month's |net| against the largest monthly move of the year.
  const maxAbsNet = Math.max(0, ...elapsed.map((c) => Math.abs(c.net)));
  for (const cell of elapsed) {
    cell.intensity = maxAbsNet === 0 || cell.net === 0 ? null : Math.abs(cell.net) / maxAbsNet;
  }

  // Tooltips, in plain words. Data months give exact figures; empty ones say so honestly.
  for (const cell of strip) {
    if (cell.state === "future") {
      cell.title = titleFor(cell, "no money recorded yet");
    } else if (cell.net === 0) {
      cell.title = titleFor(cell, cell.state === "current" ? "current month · no movement yet" : "no movement recorded");
    } else {
      const net = cell.net > 0 ? `net ${formatINR(cell.net)}` : `net ${MINUS}${formatINR(Math.abs(cell.net))}`;
      const details = `money in ${formatINR(cell.income)} · money out ${formatINR(cell.expense)} · ${net}`;
      cell.title = titleFor(cell, cell.state === "current" ? `${details} · current month` : details);
    }
  }

  // Year-to-date totals — summed from the same monthly rows the strip shows.
  const income = elapsed.reduce((sum, c) => sum + c.income, 0);
  const expense = elapsed.reduce((sum, c) => sum + c.expense, 0);
  const profit = netProfit(income, expense);
  const anyMoney = income !== 0 || expense !== 0;

  const daysIn = daysBetween(fy.from, fy.to) + 1;
  const daysUsed = Math.min(daysIn, Math.max(1, daysBetween(fy.from, spec.today) + 1));

  // Pace: the year-to-date day-rates, projected straight to full-year. Never shipped as
  // a promise — the label says "at this pace", the calendar may always break it.
  const pace = anyMoney
    ? {
        income: Math.round((income / daysUsed) * daysIn),
        expense: Math.round((expense / daysUsed) * daysIn),
        profit: Math.round((profit / daysUsed) * daysIn),
        dailyIncome: Math.round(income / daysUsed),
        dailyExpense: Math.round(expense / daysUsed),
      }
    : null;

  // Milestone: income so far vs the previous FY's FULL year. The previous year must be
  // on record directly behind this one; percent stays undecided when it earned nothing.
  const prev = spec.yearlyRows.find((r) => r.fyStart === fyStart - 1) ?? null;
  const milestone =
    prev === null
      ? null
      : {
          prevLabel: prev.label,
          prevIncome: prev.income,
          pct: prev.income > 0 ? (income / prev.income) * 100 : null,
          passed: prev.income > 0 && income >= prev.income,
        };

  // Rhythm: of the months gone by, how many kept money, and the strongest one (ties → earliest).
  const profitable = elapsed.filter((c) => c.net > 0);
  const bestCell = profitable.reduce<{ label: string; net: number } | null>(
    (acc, c) => (acc === null || c.net > acc.net ? { label: c.label, net: c.net } : acc),
    null,
  );
  const rhythm = { count: profitable.length, total: elapsed.length, best: bestCell };

  const lastIncome =
    spec.lastIncomeDate === null
      ? null
      : { date: spec.lastIncomeDate, daysAgo: Math.max(0, daysBetween(spec.lastIncomeDate, spec.today)) };

  // The one-line story. Sentence one always reports the money; sentence two picks the
  // single most remarkable behaviour, in priority order. No promises, no hype.
  let story: string | null = null;
  if (anyMoney) {
    const months = elapsed.length;
    const allProfitable = rhythm.count > 0 && rhythm.count === months;
    let insight: string | null = null;
    if (milestone !== null && milestone.prevIncome > 0) {
      const label = `FY ${milestone.prevLabel}`;
      if (income > milestone.prevIncome) insight = `You've already earned more than ${label} did all year.`;
      else if (income === milestone.prevIncome) insight = `You've matched ${label}'s full-year income.`;
      // Still short of the bar → fall through to the rhythm insight below.
    }
    if (insight === null) {
      if (allProfitable && months >= 2) {
        insight = `All ${months} months so far have stayed profitable.`;
      } else if (bestCell !== null) {
        insight = `${bestCell.label} was the strongest month, netting ${formatINR(bestCell.net, { compact: true })}.`;
      }
    }
    const money = `Since 1 April you've brought in ${formatINR(income, { compact: true })}, spent ${formatINR(expense, { compact: true })} and kept ${formatINR(profit, { compact: true })}.`;
    story = insight === null ? money : `${money} ${insight}`;
  }

  return {
    label: thisYearBadgeLabel(fyStart),
    fy,
    daysUsed,
    daysIn,
    progress: daysUsed / daysIn,
    income,
    expense,
    profit,
    monthsElapsed: elapsed.length,
    pace,
    milestone,
    rhythm,
    lastIncome,
    strip,
    story,
  };
}
