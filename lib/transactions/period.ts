/** Reporting periods, resolved against today's date in India (Asia/Kolkata). */

export const PERIODS = {
  month: "This month",
  quarter: "This quarter",
  fy: "This financial year",
  all: "All time",
} as const;

export type Period = keyof typeof PERIODS;

export function parsePeriod(value: string | string[] | undefined | null): Period {
  return typeof value === "string" && value in PERIODS ? (value as Period) : "fy";
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's date in India as YYYY-MM-DD ("today" in chat and forms must not follow UTC). */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Current time in India as HH:MM (24h). */
export function timeInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/**
 * Indian FY quarter start months: Q1=Apr(4), Q2=Jul(7), Q3=Oct(10), Q4=Jan(1).
 * Returns the first month (1-indexed) of the quarter that `month` falls in.
 */
function quarterStartMonth(month: number): number {
  if (month >= 10) return 10; // Q3: Oct–Dec
  if (month >= 7) return 7;   // Q2: Jul–Sep
  if (month >= 4) return 4;   // Q1: Apr–Jun
  return 1;                    // Q4: Jan–Mar
}

/** First day (YYYY-MM-DD) of the period. The Indian financial year starts on 1 April. */
export function periodStart(period: Period, now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth() + 1;
  if (period === "month") return `${year}-${String(month).padStart(2, "0")}-01`;
  if (period === "quarter") {
    const qm = quarterStartMonth(month);
    return `${year}-${String(qm).padStart(2, "0")}-01`;
  }
  if (period === "fy") return `${month >= 4 ? year : year - 1}-04-01`;
  return "1900-01-01";
}
