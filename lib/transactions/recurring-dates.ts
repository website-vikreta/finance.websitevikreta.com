/** Pure date maths for recurring bills; safe to import in the browser. Tested in __tests__/recurring.ts. */

export type Frequency = "monthly" | "yearly";

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/** Next due date after `due`, keeping the anchor day (31 → 30 Apr → 31 May). */
export function advanceDue(due: string, frequency: Frequency, anchorDay: number): string {
  const [y, m] = due.split("-").map(Number);
  const [ny, nm] = frequency === "yearly" ? [y + 1, m] : m === 12 ? [y + 1, 1] : [y, m + 1];
  const d = Math.min(anchorDay, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Whole days from `today` to `due` (negative = overdue). */
export function daysUntil(due: string, today: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** INR per month for the "fixed costs" total; USD bills are reported separately (no rate yet). */
export function monthlyShare(row: { amount: number; frequency: Frequency }): number {
  return row.frequency === "yearly" ? row.amount / 12 : row.amount;
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
