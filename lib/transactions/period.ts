/** Reporting periods, resolved against today's date in India (Asia/Kolkata). */

export const PERIODS = {
  month: "This month",
  fy: "This financial year",
  all: "All time",
} as const;

export type Period = keyof typeof PERIODS;

export function parsePeriod(value: string | string[] | undefined | null): Period {
  return typeof value === "string" && value in PERIODS ? (value as Period) : "fy";
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** First day (YYYY-MM-DD) of the period. The Indian financial year starts on 1 April. */
export function periodStart(period: Period, now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth() + 1;
  if (period === "month") return `${year}-${String(month).padStart(2, "0")}-01`;
  if (period === "fy") return `${month >= 4 ? year : year - 1}-04-01`;
  return "1900-01-01";
}
