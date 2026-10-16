/**
 * Recurring expenses (rent, subscriptions, salaries). A person logs each occurrence with
 * "Mark paid" (prefilled form → confirm), which then moves next_due forward. Nothing is
 * saved automatically. Every change writes an audit event.
 */

import { and, asc, desc, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, categories, clients, recurringExpenses, transactions } from "@/lib/db/schema";
import { toCategory } from "@/lib/transactions/categories";
import { findClient, type DbTx } from "@/lib/transactions/persist";

import { advanceDue, applyPayment, billSchedule, calculateEndDate, MAX_MONTHS, remaining, type MonthStatus, type PaymentMode } from "@/lib/transactions/recurring-dates";

export interface RecurringRow {
  id: string;
  description: string;
  category: string;
  amount: number;
  currency: "INR" | "USD";
  /** YYYY-MM-DD */
  nextDue: string;
  /** Part payments already made towards the occurrence due on nextDue. */
  paid: number;
  isActive: boolean;
  endDate?: string | null;
  /** Client its payments are tagged to (client profitability). */
  clientName: string | null;
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
      nextDue: recurringExpenses.nextDue,
      paid: recurringExpenses.paidThisPeriod,
      isActive: recurringExpenses.isActive,
      endDate: recurringExpenses.endDate,
      clientName: clients.clientName,
    })
    .from(recurringExpenses)
    .innerJoin(categories, eq(categories.id, recurringExpenses.categoryId))
    .leftJoin(clients, and(eq(clients.clientId, recurringExpenses.clientId), isNull(clients.deletedAt)))
    .where(isNull(recurringExpenses.deletedAt))
    .orderBy(asc(recurringExpenses.nextDue));
  return rows.map((r) => ({ ...r, amount: Number(r.amount), paid: Number(r.paid), currency: r.currency as "INR" | "USD", endDate: r.endDate ?? null }));
}

export interface FinishedBill {
  id: string;
  description: string;
  category: string;
  amount: number;
  currency: "INR" | "USD";
  /** The last month it was due. */
  endDate: string;
  clientName: string | null;
}

/** Bills that ran all their months (not ones a person stopped), most recently ended first. */
export async function listFinished(): Promise<FinishedBill[]> {
  const rows = await db
    .select({
      id: recurringExpenses.id,
      description: recurringExpenses.description,
      category: categories.name,
      amount: recurringExpenses.originalAmount,
      currency: recurringExpenses.originalCurrency,
      endDate: recurringExpenses.endDate,
      clientName: clients.clientName,
    })
    .from(recurringExpenses)
    .innerJoin(categories, eq(categories.id, recurringExpenses.categoryId))
    .leftJoin(clients, and(eq(clients.clientId, recurringExpenses.clientId), isNull(clients.deletedAt)))
    .where(and(isNotNull(recurringExpenses.deletedAt), isNotNull(recurringExpenses.endDate), gt(recurringExpenses.nextDue, recurringExpenses.endDate)))
    .orderBy(desc(recurringExpenses.endDate));
  return rows.map((r) => ({ ...r, amount: Number(r.amount), currency: r.currency as "INR" | "USD", endDate: r.endDate! }));
}

export interface BillDetails {
  id: string;
  description: string;
  category: string;
  amount: number;
  currency: "INR" | "USD";
  clientName: string | null;
  clientId: string | null;
  nextDue: string;
  /** Paid so far towards the open month. */
  paid: number;
  status: "active" | "paused" | "finished" | "stopped";
  /** Day it was added (YYYY-MM-DD, India time). */
  addedOn: string;
  firstDue: string;
  anchorDay: number;
  endDate: string | null;
  schedule: { due: string; status: MonthStatus }[];
  /** Expenses that paid it, newest first (payments from before bills were linked aren't listed). */
  payments: { id: string; date: string; due: string; amount: number; currency: "INR" | "USD" }[];
}

export async function getBillDetails(id: string, today: string): Promise<BillDetails | null> {
  const [bill] = await db
    .select({
      id: recurringExpenses.id,
      description: recurringExpenses.description,
      category: categories.name,
      amount: recurringExpenses.originalAmount,
      currency: recurringExpenses.originalCurrency,
      clientName: clients.clientName,
      clientId: clients.clientId,
      isActive: recurringExpenses.isActive,
      deletedAt: recurringExpenses.deletedAt,
      anchorDay: recurringExpenses.anchorDay,
      nextDue: recurringExpenses.nextDue,
      endDate: recurringExpenses.endDate,
      paid: recurringExpenses.paidThisPeriod,
      addedOn: sql<string>`to_char(${recurringExpenses.createdAt} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`,
      // The created audit event holds the first due date; next_due has moved on since.
      firstDue: sql<string | null>`(SELECT a.after_state->>'firstDue' FROM audit_events a WHERE a.entity_type = 'recurring_expense' AND a.entity_id = ${recurringExpenses.id}::text AND a.action = 'created' LIMIT 1)`,
    })
    .from(recurringExpenses)
    .innerJoin(categories, eq(categories.id, recurringExpenses.categoryId))
    .leftJoin(clients, and(eq(clients.clientId, recurringExpenses.clientId), isNull(clients.deletedAt)))
    .where(eq(recurringExpenses.id, id));
  if (!bill) return null;
  const finished = bill.deletedAt !== null && bill.endDate !== null && bill.nextDue > bill.endDate;

  const payments = await db
    .select({
      id: transactions.id,
      date: sql<string>`to_char(${transactions.txnDate}, 'YYYY-MM-DD')`,
      due: sql<string>`to_char(${transactions.recurringDue}, 'YYYY-MM-DD')`,
      amount: transactions.originalAmount,
      currency: transactions.originalCurrency,
    })
    .from(transactions)
    .where(and(eq(transactions.recurringId, id), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.txnDate), desc(transactions.createdAt));

  const firstDue = bill.firstDue && DATE.test(bill.firstDue) ? bill.firstDue : bill.nextDue;
  return {
    id: bill.id,
    description: bill.description,
    category: bill.category,
    amount: Number(bill.amount),
    currency: bill.currency as "INR" | "USD",
    clientName: bill.clientName,
    clientId: bill.clientId,
    nextDue: bill.nextDue,
    paid: Number(bill.paid),
    status: finished ? "finished" : bill.deletedAt ? "stopped" : bill.isActive ? "active" : "paused",
    addedOn: bill.addedOn,
    firstDue,
    anchorDay: bill.anchorDay,
    endDate: bill.endDate,
    schedule: billSchedule({ firstDue, anchorDay: bill.anchorDay, nextDue: bill.nextDue, endDate: bill.endDate, paid: Number(bill.paid) }, today),
    payments: payments.map((p) => ({ ...p, amount: Number(p.amount), currency: p.currency as "INR" | "USD" })),
  };
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
  const firstDue = typeof input.firstDue === "string" && DATE.test(input.firstDue) && !Number.isNaN(Date.parse(input.firstDue)) ? input.firstDue : null;
  const endDate = typeof input.endDate === "string" && DATE.test(input.endDate) && !Number.isNaN(Date.parse(input.endDate)) ? input.endDate : null;
  const client = typeof input.client === "string" && input.client.trim() ? input.client.trim() : null;

  if (!description) return { ok: false as const, error: "What is this bill for?" };
  if (amount === null) return { ok: false as const, error: "Enter an amount greater than zero (max 2 decimals)." };
  if (!currency) return { ok: false as const, error: "Choose INR or USD." };
  if (!firstDue) return { ok: false as const, error: "Pick the next due date." };
  const anchorDay = Number(firstDue.slice(8, 10));
  if (input.endDate !== undefined && input.endDate !== null && !endDate) return { ok: false as const, error: "Pick a valid end date." };
  if (endDate && (endDate < firstDue || endDate > calculateEndDate(firstDue, MAX_MONTHS, anchorDay))) {
    return { ok: false as const, error: `A bill can run for 1 to ${MAX_MONTHS} months.` };
  }
  return { ok: true as const, value: { description, category, amount, currency, firstDue, endDate, anchorDay, client } };
}

/** Pass `tx` to create it inside a caller's DB transaction (e.g. with the expense that pays its first month). */
export async function createRecurring(userId: string, raw: unknown, tx?: DbTx): Promise<RecurringResult> {
  const parsed = parse(raw);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const run = async (tx: DbTx): Promise<RecurringResult> => {
    const [cat] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.name, v.category));
    if (!cat) return { ok: false, error: "Unknown category." };
    const taken = await nameTaken(tx, v.description);
    if (taken) return { ok: false, error: taken };
    const client = v.client ? await findClient(tx, v.client) : null;
    if (v.client && !client) return { ok: false, error: `${v.client} isn't an active client any more. Pick another client or none.` };
    const [row] = await tx
      .insert(recurringExpenses)
      .values({
        description: v.description,
        categoryId: cat.id,
        originalAmount: String(v.amount),
        originalCurrency: v.currency,
        anchorDay: v.anchorDay,
        nextDue: v.firstDue,
        endDate: v.endDate,
        clientId: client?.id ?? null,
        createdBy: userId,
      })
      .returning({ id: recurringExpenses.id });
    await tx.insert(auditEvents).values({ entityType: "recurring_expense", entityId: row.id, action: "created", performedBy: userId, source: "manual", afterState: v });
    return { ok: true, id: row.id };
  };
  return tx ? run(tx) : db.transaction(run);
}

/** Why a bill can't use this name: another active (or paused) bill already has it. */
async function nameTaken(tx: DbTx, description: string, exceptId?: string): Promise<string | null> {
  const [clash] = await tx
    .select({ id: recurringExpenses.id })
    .from(recurringExpenses)
    .where(and(isNull(recurringExpenses.deletedAt), sql`lower(${recurringExpenses.description}) = ${description.toLowerCase()}`, exceptId ? ne(recurringExpenses.id, exceptId) : undefined))
    .limit(1);
  return clash ? `You already have a bill called "${description}".` : null;
}

async function write(tx: DbTx, userId: string, id: string, action: string, set: Partial<typeof recurringExpenses.$inferInsert>, guard = isNull(recurringExpenses.deletedAt), beforeState?: unknown): Promise<RecurringResult> {
  const [row] = await tx
    .update(recurringExpenses)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(recurringExpenses.id, id), guard))
    .returning({ id: recurringExpenses.id, nextDue: recurringExpenses.nextDue, isActive: recurringExpenses.isActive });
  if (!row) return { ok: false, error: "This bill changed or no longer exists. Refresh and try again." };
  await tx.insert(auditEvents).values({ entityType: "recurring_expense", entityId: id, action, performedBy: userId, source: "manual", beforeState, afterState: beforeState ? { ...row, ...set } : row });
  return { ok: true, id };
}

const update = (userId: string, id: string, action: string, set: Partial<typeof recurringExpenses.$inferInsert>) =>
  db.transaction((tx) => write(tx, userId, id, action, set));

/**
 * Changes what a bill is for, its category, amount or client. Its dates and currency stay;
 * the amount must stay above what's already been paid towards this month.
 */
export async function updateRecurring(userId: string, id: string, raw: unknown): Promise<RecurringResult> {
  const input = (raw ?? {}) as Record<string, unknown>;
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 200) : "";
  const category = toCategory(input.category) ?? "Other";
  const amount = typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount > 0 && AMOUNT.test(String(input.amount)) ? input.amount : null;
  const clientName = typeof input.client === "string" && input.client.trim() ? input.client.trim() : null;
  if (!description) return { ok: false, error: "What is this bill for?" };
  if (amount === null) return { ok: false, error: "Enter an amount greater than zero (max 2 decimals)." };

  return db.transaction(async (tx) => {
    const [bill] = await tx.select().from(recurringExpenses).where(and(eq(recurringExpenses.id, id), isNull(recurringExpenses.deletedAt))).for("update");
    if (!bill) return { ok: false, error: "This bill no longer exists." };
    const taken = await nameTaken(tx, description, id);
    if (taken) return { ok: false, error: taken };
    if (amount <= Number(bill.paidThisPeriod)) {
      return { ok: false, error: `${bill.originalCurrency === "USD" ? "$" : "₹"}${Number(bill.paidThisPeriod).toLocaleString("en-IN")} is already paid this month. Enter more than that.` };
    }
    const [cat] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.name, category));
    if (!cat) return { ok: false, error: "Unknown category." };
    const client = clientName ? await findClient(tx, clientName) : null;
    if (clientName && !client) return { ok: false, error: `${clientName} isn't an active client any more. Pick another client or none.` };
    const before = { description: bill.description, categoryId: bill.categoryId, originalAmount: bill.originalAmount, clientId: bill.clientId };
    return write(tx, userId, id, "updated", { description, categoryId: cat.id, originalAmount: String(amount), clientId: client?.id ?? null }, isNull(recurringExpenses.deletedAt), before);
  });
}

export const setRecurringActive = (userId: string, id: string, active: boolean) =>
  update(userId, id, active ? "resumed" : "paused", { isActive: active });

export const stopRecurring = (userId: string, id: string) => update(userId, id, "stopped", { deletedAt: new Date() });

/**
 * Runs inside the transaction that saves the expense, so the expense and the bill move
 * together or not at all. A part payment adds to paid_this_period and keeps the due date;
 * settling it moves next_due forward a month (or completes the bill after its end date).
 * Row-locked and guarded on next_due = due, so two people paying the same bill can't skip a month.
 */
export async function recordPayment(
  tx: DbTx,
  userId: string,
  id: string,
  due: string,
  payment: { amount: number; currency: string },
  mode: PaymentMode,
  transactionId: string,
): Promise<RecurringResult> {
  const [bill] = await tx.select().from(recurringExpenses).where(and(eq(recurringExpenses.id, id), isNull(recurringExpenses.deletedAt))).for("update");
  if (!bill) return { ok: false, error: "This bill no longer exists." };
  if (bill.nextDue !== due) return { ok: false, error: "This bill was already paid. Refresh and try again." };
  const left = remaining({ amount: Number(bill.originalAmount), paid: Number(bill.paidThisPeriod) });
  if (payment.currency === bill.originalCurrency && payment.amount > left) {
    return { ok: false, error: `Only ${bill.originalCurrency === "USD" ? "$" : "₹"}${left.toLocaleString("en-IN")} is left on this bill. Enter that amount or less.` };
  }
  const outcome = applyPayment({ amount: Number(bill.originalAmount), paid: Number(bill.paidThisPeriod), currency: bill.originalCurrency }, payment, mode);
  const guard = and(isNull(recurringExpenses.deletedAt), eq(recurringExpenses.nextDue, due), eq(recurringExpenses.paidThisPeriod, bill.paidThisPeriod));
  const nextDue = advanceDue(due, bill.anchorDay);
  const result = !outcome.settled
    ? await write(tx, userId, id, "part_paid", { paidThisPeriod: outcome.paid.toFixed(2) }, guard)
    : bill.endDate && nextDue > bill.endDate
      ? // next_due moves past end_date too, which is how a completed bill differs from a stopped one.
        await write(tx, userId, id, "completed", { nextDue, deletedAt: new Date(), paidThisPeriod: "0" }, guard)
      : await write(tx, userId, id, "paid", { nextDue, paidThisPeriod: "0" }, guard);
  if (result.ok) await tx.update(transactions).set({ recurringId: id, recurringDue: due, recurringSettled: outcome.settled }).where(eq(transactions.id, transactionId));
  return result;
}

type PaidTransaction = Pick<typeof transactions.$inferSelect, "id" | "originalAmount" | "originalCurrency" | "recurringId" | "recurringDue" | "recurringSettled">;

/**
 * Takes a deleted expense's payment back off its bill, in the caller's DB transaction.
 * An open month just loses the part payment; a settled month reopens, but only if nothing
 * was paid after it. Returns why it can't, or null. Stopped bills are left alone.
 */
export async function undoPayment(tx: DbTx, userId: string, txn: PaidTransaction): Promise<string | null> {
  if (!txn.recurringId || !txn.recurringDue) return null;
  const due = txn.recurringDue;
  const [bill] = await tx.select().from(recurringExpenses).where(eq(recurringExpenses.id, txn.recurringId)).for("update");
  if (!bill) return null;
  const completed = bill.deletedAt !== null && bill.endDate !== null && bill.nextDue > bill.endDate;
  if (bill.deletedAt && !completed) return null;

  if (!bill.deletedAt && bill.nextDue === due) {
    const paid = bill.originalCurrency === txn.originalCurrency ? Math.max(0, remaining({ amount: Number(bill.paidThisPeriod), paid: Number(txn.originalAmount) })) : Number(bill.paidThisPeriod);
    const res = await write(tx, userId, bill.id, "payment_undone", { paidThisPeriod: paid.toFixed(2) });
    return res.ok ? null : res.error;
  }

  const latest = txn.recurringSettled && bill.nextDue === advanceDue(due, bill.anchorDay) && Number(bill.paidThisPeriod) === 0;
  if (!latest) return `A later payment for ${bill.description} depends on this one. Delete that payment first.`;

  const [{ others }] = await tx
    .select({ others: sql<string>`coalesce(sum(${transactions.originalAmount}), 0)::text` })
    .from(transactions)
    .where(and(eq(transactions.recurringId, bill.id), eq(transactions.recurringDue, due), eq(transactions.originalCurrency, bill.originalCurrency), isNull(transactions.deletedAt), ne(transactions.id, txn.id)));
  const res = await write(tx, userId, bill.id, "payment_undone", { nextDue: due, paidThisPeriod: Number(others).toFixed(2), deletedAt: null }, sql`true`);
  return res.ok ? null : res.error;
}

/** Puts a restored expense's payment back on its bill; refuses if that month was paid again meanwhile. */
export async function redoPayment(tx: DbTx, userId: string, txn: PaidTransaction): Promise<string | null> {
  if (!txn.recurringId || !txn.recurringDue) return null;
  const res = await recordPayment(tx, userId, txn.recurringId, txn.recurringDue, { amount: Number(txn.originalAmount), currency: txn.originalCurrency }, txn.recurringSettled ? "full" : "partial", txn.id);
  return res.ok ? null : res.error;
}

/**
 * Inside the DB transaction that saved `transactionId`: makes that expense month 1 of a new
 * monthly bill (`months` total, null = ongoing) and marks month 1 paid. Returns why it can't, or null.
 */
export async function startPaidRecurring(
  tx: DbTx,
  userId: string,
  transactionId: string,
  expense: { description?: unknown; category?: unknown; client?: unknown; amount?: unknown; currency?: unknown; date?: unknown },
  months: number | null,
): Promise<string | null> {
  const date = String(expense.date);
  const amount = Number(expense.amount);
  const currency = String(expense.currency);
  const endDate = months ? calculateEndDate(date, months, Number(date.slice(8, 10))) : null;
  const created = await createRecurring(userId, { description: expense.description, category: expense.category, client: expense.client, amount, currency, firstDue: date, endDate }, tx);
  if (!created.ok) return created.error;
  const res = await recordPayment(tx, userId, created.id, date, { amount, currency }, "full", transactionId);
  return res.ok ? null : res.error;
}
