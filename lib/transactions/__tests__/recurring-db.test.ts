/**
 * Recurring bill payments against Postgres: paying, over-paying, completing, and how
 * deleting / restoring / editing a payment moves the bill. Needs TEST_DATABASE_URL.
 *
 * Run: npx tsx lib/transactions/__tests__/recurring-db.test.ts
 */

import "../../__tests__/test-db"; // must stay first: refuses the live database
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { appUsers, clients, recurringExpenses, transactions } from "../../db/schema";
import { createManualTransaction, deleteTransaction, restoreTransaction, updateTransaction } from "../manage";
import { createRecurring, listFinished, recordPayment, startPaidRecurring, updateRecurring } from "../recurring";
import type { PaymentMode } from "../recurring-dates";

const U = "test-recurring-user";
const input = (amount: number) => ({ type: "expense", currency: "INR", amount, rate: null, client: null, description: "test-recurring rent", category: "Other", date: "2026-03-01" });

async function bill(id: string) {
  const [b] = await db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id));
  return { nextDue: b.nextDue, paid: Number(b.paidThisPeriod), done: b.deletedAt !== null };
}

async function run() {
  await db.insert(appUsers).values({ id: U, role: "manager", isActive: true }).onConflictDoNothing();
  try {
    // 31st anchor, two months: 31 Jan and 28 Feb.
    const created = await createRecurring(U, { description: "test-recurring rent", category: "Other", amount: 1000, currency: "INR", firstDue: "2026-01-31", endDate: "2026-02-28" });
    assert.ok(created.ok);
    const id = created.id;
    const pay = (amount: number, due: string, mode: PaymentMode = "partial") =>
      createManualTransaction(U, input(amount), randomUUID(), true, undefined, async (tx, txnId) => {
        const r = await recordPayment(tx, U, id, due, { amount, currency: "INR" }, mode, txnId);
        return r.ok ? null : r.error;
      });
    const count = async () => Number((await db.execute(sql`SELECT count(*) AS n FROM transactions WHERE created_by = ${U}`)).rows[0].n);

    const p1 = await pay(400, "2026-01-31");
    assert.ok(p1.ok);
    assert.deepEqual(await bill(id), { nextDue: "2026-01-31", paid: 400, done: false });

    const p2 = await pay(600, "2026-01-31");
    assert.ok(p2.ok);
    assert.deepEqual(await bill(id), { nextDue: "2026-02-28", paid: 0, done: false }, "settles; Feb clamps to 28");

    const before = await count();
    assert.equal((await pay(1500, "2026-02-28")).ok, false, "over-payment refused");
    assert.equal((await pay(100, "2026-01-31")).ok, false, "paying a month already settled is refused");
    assert.equal(await count(), before, "refused payments save no expense");

    assert.equal((await deleteTransaction(U, p1.ok ? p1.id! : "")).ok, false, "earlier part payment of a settled month can't be deleted");
    assert.equal((await updateTransaction(U, p2.ok ? p2.id! : "", input(700))).ok, false, "bill payment amount can't be edited");

    assert.ok((await deleteTransaction(U, p2.ok ? p2.id! : "")).ok);
    assert.deepEqual(await bill(id), { nextDue: "2026-01-31", paid: 400, done: false }, "delete reopens the month");
    assert.ok((await restoreTransaction(U, p2.ok ? p2.id! : "")).ok);
    assert.deepEqual(await bill(id), { nextDue: "2026-02-28", paid: 0, done: false }, "restore settles it again");

    const p3 = await pay(800, "2026-02-28", "full");
    assert.ok(p3.ok);
    assert.deepEqual(await bill(id), { nextDue: "2026-03-31", paid: 0, done: true }, "last month completes the bill");
    assert.ok((await deleteTransaction(U, p3.ok ? p3.id! : "")).ok);
    assert.deepEqual(await bill(id), { nextDue: "2026-02-28", paid: 0, done: false }, "deleting the last payment brings the bill back");

    // Editing a bill: amount must stay above this month's part payments; dates don't move.
    const part = await pay(200, "2026-02-28");
    assert.ok(part.ok);
    assert.equal((await updateRecurring(U, id, { description: "test-recurring rent", category: "Other", amount: 150 })).ok, false, "can't edit below what's paid");
    assert.ok((await updateRecurring(U, id, { description: "test-recurring rent 2", category: "Rent", amount: 1200 })).ok);
    const [edited] = await db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id));
    assert.deepEqual([edited.description, edited.originalAmount, edited.nextDue, edited.paidThisPeriod], ["test-recurring rent 2", "1200.00", "2026-02-28", "200.00"]);

    // Paying off the last month moves it to Finished.
    assert.ok((await pay(1000, "2026-02-28")).ok);
    assert.ok((await listFinished()).some((f) => f.id === id && f.endDate === "2026-02-28"), "completed bill is listed as finished");

    // "Paid today" + 3 months: the expense is month 1 of a new bill, saved together.
    const first = await createManualTransaction(U, { ...input(500), date: "2026-01-31" }, randomUUID(), true, undefined, (tx, txnId) =>
      startPaidRecurring(tx, U, txnId, { ...input(500), date: "2026-01-31" }, 3),
    );
    assert.ok(first.ok);
    const [linked] = await db.select().from(transactions).where(eq(transactions.id, first.ok ? first.id! : ""));
    assert.ok(linked.recurringId && linked.recurringDue === "2026-01-31" && linked.recurringSettled, "first expense is linked as month 1");
    const started = await bill(linked.recurringId!);
    assert.deepEqual(started, { nextDue: "2026-02-28", paid: 0, done: false }, "month 2 is next, anchored to the 31st");
    const [{ endDate }] = await db.select({ endDate: recurringExpenses.endDate }).from(recurringExpenses).where(eq(recurringExpenses.id, linked.recurringId!));
    assert.equal(endDate, "2026-03-31", "3 months: 31 Jan, 28 Feb, 31 Mar");

    // If the bill can't be created, the expense isn't saved either.
    const n = await count();
    const bad = await createManualTransaction(U, input(500), randomUUID(), true, undefined, (tx, txnId) => startPaidRecurring(tx, U, txnId, { ...input(500), description: "" }, null));
    assert.equal(bad.ok, false);
    assert.equal(await count(), n, "no expense without its bill");

    // A bill keeps the expense's client tag, so later months stay tagged.
    const [acme] = await db.insert(clients).values({ clientName: "test-recurring Acme" }).returning({ id: clients.clientId });
    const hosting = { ...input(300), description: "test-recurring hosting", client: "Test-Recurring acme " };
    const tagged = await createManualTransaction(U, hosting, randomUUID(), true, undefined, (tx, txnId) => startPaidRecurring(tx, U, txnId, hosting, null));
    assert.ok(tagged.ok);
    const [t] = await db.select().from(transactions).where(eq(transactions.id, tagged.ok ? tagged.id! : ""));
    assert.equal(t.clientId, acme.id, "expense tagged");
    const [b] = await db.select({ clientId: recurringExpenses.clientId }).from(recurringExpenses).where(eq(recurringExpenses.id, t.recurringId!));
    assert.equal(b.clientId, acme.id, "bill tagged to the same client");
    assert.equal((await createRecurring(U, { description: "TEST-RECURRING HOSTING", amount: 1, currency: "INR", firstDue: "2026-01-01" })).ok, false, "duplicate bill name refused");
    assert.equal((await createRecurring(U, { description: "test-recurring x", amount: 1, currency: "INR", firstDue: "2026-01-01", client: "test-recurring nobody" })).ok, false, "unknown client refused");

    console.log("recurring db ok");
  } finally {
    await db.delete(transactions).where(eq(transactions.createdBy, U));
    await db.delete(recurringExpenses).where(eq(recurringExpenses.createdBy, U));
    await db.execute(sql`ALTER TABLE "audit_events" DISABLE TRIGGER "trg_audit_events_immutable"`);
    await db.execute(sql`DELETE FROM "audit_events" WHERE "performed_by" = ${U}`);
    await db.execute(sql`ALTER TABLE "audit_events" ENABLE TRIGGER "trg_audit_events_immutable"`);
    await db.delete(clients).where(eq(clients.clientName, "test-recurring Acme"));
    await db.delete(appUsers).where(eq(appUsers.id, U));
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
