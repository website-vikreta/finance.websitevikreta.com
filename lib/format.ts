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

export function formatCurrentHeroDate(date: Date = new Date()): string {
  const weekday = date.toLocaleDateString("en-IN", { weekday: "long" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-IN", { month: "long" });
  return `${weekday}, ${day} ${month} · All figures shown in INR unless noted.`;
}

export type PaymentStatus = "paid" | "due" | "overdue";

export const STATUS_CONFIG: Record<
  PaymentStatus,
  {
    label: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
    barColor: string;
  }
> = {
  paid: {
    label: "Paid",
    bgClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    textClass: "text-emerald-600",
    borderClass: "border-emerald-500",
    barColor: "#22C55E",
  },
  due: {
    label: "Due",
    bgClass: "bg-amber-50 text-amber-800 border-amber-200",
    textClass: "text-amber-600",
    borderClass: "border-amber-400",
    barColor: "#FFD600",
  },
  overdue: {
    label: "Overdue",
    bgClass: "bg-rose-50 text-rose-700 border-rose-200",
    textClass: "text-rose-600",
    borderClass: "border-rose-400",
    barColor: "#EF4444",
  },
};
