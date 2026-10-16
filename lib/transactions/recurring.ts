/**
 * Recurring expenses (rent, subscriptions, salaries). A person logs each occurrence with
 * "Mark paid" (prefilled form → confirm), which then moves next_due forward. Nothing is
 * saved automatically. Every change writes an audit event.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, categories, recurringExpenses } from "@/lib/db/schema";
import { toCategory } from "@/lib/transactions/categories";

import { advanceDue, applyPayment, remaining, type Frequency, type PaymentMode } from "@/lib/transactions/recurring-dates";
export type { Frequency };

export interface RecurringRow {
  id: string;
  description: string;
  category: string;
  amount: number;
  currency: "INR" | "USD";
  frequency: Frequency;
  /** YYYY-MM-DD */
  nextDue: string;
  /** Part payments already made towards the occurrence due on nextDue. */
  paid: number;
  isActive: boolean;
}

export type RecurringResult = { ok: true; id: string } | { ok: false; error: string };

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Active and paused bills (stopped ones are hidden), soonest first. */
export async function listRecurring(): Promise<RecurringRow[]> {
  const rows = await db
    .select({
      id: recurringExpenses.id,
      description: recurringExpenses.description,
      category: categories.name,
      amount: recurringExpenses.originalAmount,
      currency: recurringExpenses.originalCurrency,
      frequency: recurringExpenses.frequency,
      nextDue: recurringExpenses.nextDue,
      paid: recurringExpenses.paidThisPeriod,
      isActive: recurringExpenses.isActive,
    })
    .from(recurringExpenses)
    .innerJoin(categories, eq(categories.id, recurringExpenses.categoryId))
    .where(isNull(recurringExpenses.deletedAt))
    .orderBy(asc(recurringExpenses.nextDue));
  return rows.map((r) => ({ ...r, amount: Number(r.amount), paid: Number(r.paid), currency: r.currency as "INR" | "USD", frequency: r.frequency as Frequency }));
}

// ─── Writes ──────────────────────────────────────────────────────────────────

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates untrusted input from the browser. */
function parse(raw: unknown) {
  const input = (raw ?? {}) as Record<string, unknown>;
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 200) : "";
  const category = toCategory(input.category) ?? "Other";
  const amount = typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount > 0 && AMOUNT.test(String(input.amount)) ? input.amount : null;
  const currency = input.currency === "INR" || input.currency === "USD" ? input.currency : null;
  const frequency = input.frequency === "monthly" || input.frequency === "yearly" ? input.frequency : null;
  const firstDue = typeof input.firstDue === "string" && DATE.test(input.firstDue) && !Number.isNaN(Date.parse(input.firstDue)) ? input.firstDue : null;

  if (!description) return { ok: false as const, error: "What is this bill for?" };
  if (amount === null) return { ok: false as const, error: "Enter an amount greater than zero (max 2 decimals)." };
  if (!currency) return { ok: false as const, error: "Choose INR or USD." };
  if (!frequency) return { ok: false as const, error: "Choose monthly or yearly." };
  if (!firstDue) return { ok: false as const, error: "Pick the next due date." };
  return { ok: true as const, value: { description, category, amount, currency, frequency, firstDue } };
}

export async function createRecurring(userId: string, raw: unknown): Promise<RecurringResult> {
  const parsed = parse(raw);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  return db.transaction(async (tx) => {
    const [cat] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.name, v.category));
    if (!cat) return { ok: false, error: "Unknown category." };
    const [row] = await tx
      .insert(recurringExpenses)
      .values({
        description: v.description,
        categoryId: cat.id,
        originalAmount: String(v.amount),
        originalCurrency: v.currency,
        frequency: v.frequency,
        anchorDay: Number(v.firstDue.slice(8, 10)),
        nextDue: v.firstDue,
        createdBy: userId,
      })
      .returning({ id: recurringExpenses.id });
    await tx.insert(auditEvents).values({ entityType: "recurring_expense", entityId: row.id, action: "created", performedBy: userId, source: "manual", afterState: v });
    return { ok: true, id: row.id };
  });
}

async function update(userId: string, id: string, action: string, set: Partial<typeof recurringExpenses.$inferInsert>, guard = sql`true`): Promise<RecurringResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(recurringExpenses)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(recurringExpenses.id, id), isNull(recurringExpenses.deletedAt), guard))
      .returning({ id: recurringExpenses.id, nextDue: recurringExpenses.nextDue, isActive: recurringExpenses.isActive });
    if (!row) return { ok: false, error: "This bill changed or no longer exists. Refresh and try again." };
    await tx.insert(auditEvents).values({ entityType: "recurring_expense", entityId: id, action, performedBy: userId, source: "manual", afterState: row });
    return { ok: true, id };
  });
}

export const setRecurringActive = (userId: string, id: string, active: boolean) =>
  update(userId, id, active ? "resumed" : "paused", { isActive: active });

export const stopRecurring = (userId: string, id: string) => update(userId, id, "stopped", { deletedAt: new Date() });

/** What is still owed on the occurrence due on `due` (null if the bill is gone or has moved on). */
export async function amountLeft(id: string, due: string): Promise<{ amount: number; currency: string } | null> {
  const [bill] = await db.select().from(recurringExpenses).where(and(eq(recurringExpenses.id, id), isNull(recurringExpenses.deletedAt)));
  if (!bill || bill.nextDue !== due) return null;
  return { amount: remaining({ amount: Number(bill.originalAmount), paid: Number(bill.paidThisPeriod) }), currency: bill.originalCurrency };
}

/**
 * After a payment towards the occurrence due on `due` was saved: a part payment adds to
 * paid_this_period and keeps the due date; settling it moves next_due forward one period.
 * Guarded on next_due = due, so a double submit or two people paying the same bill can't
 * skip a period.
 */
export async function recordPayment(
  userId: string,
  id: string,
  due: string,
  payment: { amount: number; currency: string },
  mode: PaymentMode,
): Promise<RecurringResult> {
  const [bill] = await db.select().from(recurringExpenses).where(and(eq(recurringExpenses.id, id), isNull(recurringExpenses.deletedAt)));
  if (!bill) return { ok: false, error: "This bill no longer exists." };
  if (bill.nextDue !== due) return { ok: true, id }; // already moved on
  const outcome = applyPayment({ amount: Number(bill.originalAmount), paid: Number(bill.paidThisPeriod), currency: bill.originalCurrency }, payment, mode);
  const guard = and(eq(recurringExpenses.nextDue, due), eq(recurringExpenses.paidThisPeriod, bill.paidThisPeriod));
  return outcome.settled
    ? update(userId, id, "paid", { nextDue: advanceDue(due, bill.frequency as Frequency, bill.anchorDay), paidThisPeriod: "0" }, guard)
    : update(userId, id, "part_paid", { paidThisPeriod: outcome.paid.toFixed(2) }, guard);
}
