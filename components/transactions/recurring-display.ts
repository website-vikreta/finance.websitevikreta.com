import { formatDate, formatINR } from "@/lib/format";
import { daysUntil, remaining } from "@/lib/transactions/recurring-dates";
import type { RecurringRow } from "@/lib/transactions/recurring";
import type { BillToLog } from "./transaction-form-dialog";

/**
 * Pure display helpers for recurring bills. Kept apart from the list UI so pages
 * that only need a formatted row (the dashboard) don't pull in the dialogs.
 */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const money = (r: Pick<RecurringRow, "amount" | "currency">) =>
  r.currency === "USD" ? usd.format(r.amount) : formatINR(r.amount, { decimals: r.amount % 1 === 0 ? 0 : 2 });

/** "Due today", "Due in 3 days", "Overdue by 2 days", or the date when further out. */
export function dueText(due: string, today: string): { text: string; overdue: boolean } {
  const d = daysUntil(due, today);
  if (d < 0) return { text: `Overdue by ${-d} day${d === -1 ? "" : "s"}`, overdue: true };
  if (d === 0) return { text: "Due today", overdue: false };
  if (d <= 7) return { text: `Due in ${d} day${d === 1 ? "" : "s"}`, overdue: false };
  return { text: `Due ${formatDate(due)}`, overdue: false };
}

export const toBill = (r: RecurringRow): BillToLog => ({
  id: r.id,
  due: r.nextDue,
  description: r.description,
  category: r.category,
  amount: remaining(r),
  fullAmount: r.amount,
  currency: r.currency,
  client: r.clientName,
});

/** "₹58,000 left" once part of the current bill is paid. */
export const leftText = (r: RecurringRow) =>
  r.paid > 0 ? `${money({ amount: remaining(r), currency: r.currency })} left` : null;
