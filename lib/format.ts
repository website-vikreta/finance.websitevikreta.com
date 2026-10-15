/**
 * Currency & Date formatting helpers for Website Vikreta Finance.
 * Enforces Indian digit grouping (en-IN) and compact Lakh/Crore notation.
 */

export function formatINR(
  amount: number,
  options?: {
    compact?: boolean;
    decimals?: number;
    showSign?: boolean;
  }
): string {
  const { compact = false, decimals = 0, showSign = false } = options || {};

  if (compact) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? "-" : showSign && amount > 0 ? "+" : "";

    if (abs >= 1_00_00_000) {
      const cr = abs / 1_00_00_000;
      return `${sign}₹${cr.toFixed(cr % 1 === 0 ? 0 : 2)}Cr`;
    }
    if (abs >= 1_00_000) {
      const lakh = abs / 1_00_000;
      return `${sign}₹${lakh.toFixed(lakh % 1 === 0 ? 0 : 2)}L`;
    }
    if (abs >= 1_000) {
      const k = abs / 1_000;
      return `${sign}₹${k.toFixed(k % 1 === 0 ? 0 : 1)}k`;
    }
    return `${sign}₹${abs}`;
  }

  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });

  const formatted = formatter.format(Math.abs(amount));
  if (amount < 0) {
    return `-${formatted}`;
  }
  if (showSign && amount > 0) {
    return `+${formatted}`;
  }
  return formatted;
}

/** "2026-10-01" → "Oct". Parsed as UTC so the server timezone never shifts the month. */
export function formatMonthShort(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
}

/** "2026-10-14" → "14 Oct 2026". */
export function formatDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "13:43" -> "1:43 pm" */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

/** Percent change from `previous` to `current`, or null when there is no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}


/** Share of a total for labels: "<1%" for tiny non-zero parts so they never read as nothing. */
export function formatShare(part: number, total: number): string {
  if (total <= 0 || part <= 0) return "0%";
  const pct = (part / total) * 100;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}
