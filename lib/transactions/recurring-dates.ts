/** Pure date maths for recurring bills; safe to import in the browser. Tested in __tests__/recurring.ts. */

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/** Next monthly due date after `due`, keeping the anchor day (31 → 30 Apr → 31 May). */
export function advanceDue(due: string, anchorDay: number): string {
  const [y, m] = due.split("-").map(Number);
  const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
  const d = Math.min(anchorDay, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Calculate the final occurrence due date for a monthly recurring bill after `months` total cycles starting from `firstDue`. */
export function calculateEndDate(firstDue: string, months: number, anchorDay: number): string {
  let curr = firstDue;
  for (let i = 1; i < months; i++) {
    curr = advanceDue(curr, anchorDay);
  }
  return curr;
}

/** Longest fixed duration a bill can run for. */
export const MAX_MONTHS = 60;

/** Whole number of months typed for a custom duration (1–MAX_MONTHS), else null. */
export function parseMonths(text: string): number | null {
  const n = /^\d+$/.test(text.trim()) ? Number(text) : NaN;
  return n >= 1 && n <= MAX_MONTHS ? n : null;
}

/** Whole days from `today` to `due` (negative = overdue). */
export function daysUntil(due: string, today: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export type MonthStatus = "paid" | "part_paid" | "overdue" | "due" | "upcoming";

/**
 * Every month of a bill from its first due date: months before next_due are paid, next_due is
 * open (part paid / overdue / due), later ones upcoming. Runs to end_date, or two months past
 * next_due for an ongoing bill.
 */
export function billSchedule(bill: { firstDue: string; anchorDay: number; nextDue: string; endDate: string | null; paid: number }, today: string): { due: string; status: MonthStatus }[] {
  let last = bill.endDate ?? advanceDue(advanceDue(bill.nextDue, bill.anchorDay), bill.anchorDay);
  if (last < bill.nextDue) last = bill.nextDue; // completed bills keep next_due one past the end
  const out: { due: string; status: MonthStatus }[] = [];
  for (let due = bill.firstDue; due <= last && out.length < 240; due = advanceDue(due, bill.anchorDay)) {
    const status: MonthStatus =
      due < bill.nextDue ? "paid" : due > bill.nextDue ? "upcoming" : bill.paid > 0 ? "part_paid" : due < today ? "overdue" : "due";
    if (!(bill.endDate && due > bill.endDate)) out.push({ due, status });
  }
  return out;
}

export type PaymentMode = "partial" | "full";

/**
 * What a payment does to the occurrence due now. "full" (or paying at least what's left,
 * or a different currency) settles it and the bill moves on; "partial" adds to what's
 * paid so far and keeps the same due date. Works in paise/cents to avoid float error.
 */
export function applyPayment(
  bill: { amount: number; paid: number; currency: string },
  payment: { amount: number; currency: string },
  mode: PaymentMode,
): { settled: boolean; paid: number } {
  const cents = (n: number) => Math.round(n * 100);
  if (mode === "full" || payment.currency !== bill.currency) return { settled: true, paid: 0 };
  const paid = cents(bill.paid) + cents(payment.amount);
  return paid >= cents(bill.amount) ? { settled: true, paid: 0 } : { settled: false, paid: paid / 100 };
}

/** What is still due on the current occurrence. */
export const remaining = (bill: { amount: number; paid: number }) => Math.round(bill.amount * 100 - bill.paid * 100) / 100;
