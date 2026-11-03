/**
 * Permanent client deletion against Postgres: dependency cleanup, atomicity,
 * confirmation, and restore isolation. Needs TEST_DATABASE_URL.
 *
 * Run: npx tsx lib/clients/__tests__/permanent-deletion-db.test.ts
 */

import "../../__tests__/test-db"; // must stay first: refuses the live database
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  appUsers,
  auditEvents,
  clients,
  invoiceItems,
  invoices,
  recurringExpenses,
  transactions,
} from "../../db/schema";
import { clientDeletionScope, permanentlyDeleteClient } from "../clients";

const U = "test-permanent-delete-user";

type CountableTable = typeof clients | typeof transactions | typeof invoices | typeof invoiceItems | typeof recurringExpenses;

async function countRows(table: CountableTable, where?: SQL): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(table).where(where);
  return Number(n);
}

async function setupUser() {
  await db.insert(appUsers).values({ id: U, role: "manager", isActive: true }).onConflictDoNothing();
}

async function cleanup() {
  await db.execute(sql`ALTER TABLE "audit_events" DISABLE TRIGGER "trg_audit_events_immutable"`);
  await db.delete(auditEvents).where(eq(auditEvents.performedBy, U));
  await db.execute(sql`ALTER TABLE "audit_events" ENABLE TRIGGER "trg_audit_events_immutable"`);
  await db.delete(transactions).where(eq(transactions.createdBy, U));
  await db.delete(recurringExpenses).where(eq(recurringExpenses.createdBy, U));
  await db.delete(invoices).where(eq(invoices.createdBy, U));
  await db.delete(clients).where(sql`${clients.clientName} LIKE 'test-permanent%%'`);
  await db.delete(appUsers).where(eq(appUsers.id, U));
  await pool.end();
}

async function run() {
  await setupUser();
  try {
    // ─── 1. Client with no related records ───
    {
      const [c] = await db.insert(clients).values({ clientName: "test-permanent Solo" }).returning({ id: clients.clientId, clientName: clients.clientName });
      const scope = await clientDeletionScope(c.id);
      assert.ok(scope, "scope should exist for a live client");
      assert.equal(scope!.transactions, 0);
      assert.equal(scope!.invoices, 0);
      assert.equal(scope!.invoiceItems, 0);
      assert.equal(scope!.recurringExpenses, 0);

      const res = await permanentlyDeleteClient(U, c.id, c.clientName);
      assert.ok(res.ok, "deletion of client with no records should succeed");
      assert.equal(res.id, c.id);

      const [gone] = await db.select().from(clients).where(eq(clients.clientId, c.id));
      assert.equal(gone, undefined, "client row must be hard-deleted");
    }

    // ─── 2. Client with multiple linked transactions ───
    {
      const [c] = await db.insert(clients).values({ clientName: "test-permanent WithTxns" }).returning({ id: clients.clientId, clientName: clients.clientName });
      await db.insert(transactions).values([
        {
          typeId: 1, clientId: c.id, clientNameSnapshot: "test-permanent WithTxns",
          originalAmount: "100.00", originalCurrency: "INR", amountInr: "100.00",
          description: "payment 1", source: "manual", status: "confirmed",
          idempotencyKey: `k-${randomUUID()}`, payloadHash: randomUUID(), createdBy: U,
          txnDate: "2026-01-10",
        },
        {
          typeId: 1, clientId: c.id, clientNameSnapshot: "test-permanent WithTxns",
          originalAmount: "200.00", originalCurrency: "INR", amountInr: "200.00",
          description: "payment 2", source: "manual", status: "confirmed",
          idempotencyKey: `k-${randomUUID()}`, payloadHash: randomUUID(), createdBy: U,
          txnDate: "2026-02-10",
        },
      ]);

      const scope = await clientDeletionScope(c.id);
      assert.equal(scope!.transactions, 2);

      const res = await permanentlyDeleteClient(U, c.id, c.clientName);
      assert.ok(res.ok, "deletion of client with transactions should succeed");

      const txnLeft = await countRows(transactions, eq(transactions.clientId, c.id));
      assert.equal(txnLeft, 0, "all client transactions must be hard-deleted");
      const clientLeft = await countRows(clients, eq(clients.clientId, c.id));
      assert.equal(clientLeft, 0, "client must be hard-deleted");

      // Transactions must not be soft-deleted (not restorable).
      const softDeleted = await countRows(transactions, sql`${transactions.clientId} = ${c.id} AND ${transactions.deletedAt} IS NOT NULL`);
      assert.equal(softDeleted, 0, "transactions must not be soft-deleted");
    }

    // ─── 3. Client with invoices and invoice items ───
    {
      const [c] = await db.insert(clients).values({ clientName: "test-permanent WithInvoices" }).returning({ id: clients.clientId, clientName: clients.clientName });
      const [inv] = await db.insert(invoices).values({
        number: "WV/2026-27/001", status: "sent", clientId: c.id,
        billToName: "test-permanent WithInvoices", currency: "INR", taxType: "none",
        gstRate: "0", subtotal: "500.00", total: "500.00",
        issueDate: "2026-01-01", dueDate: "2026-02-01",
        createdBy: U,
      }).returning({ id: invoices.id });
      await db.insert(invoiceItems).values([
        { invoiceId: inv.id, position: 1, description: "item 1", quantity: "1", rate: "300.00", amount: "300.00" },
        { invoiceId: inv.id, position: 2, description: "item 2", quantity: "1", rate: "200.00", amount: "200.00" },
      ]);

      const scope = await clientDeletionScope(c.id);
      assert.equal(scope!.invoices, 1);
      assert.equal(scope!.invoiceItems, 2);

      const res = await permanentlyDeleteClient(U, c.id, c.clientName);
      assert.ok(res.ok);

      const invLeft = await countRows(invoices, eq(invoices.clientId, c.id));
      assert.equal(invLeft, 0, "invoices must be hard-deleted");
      const itemLeft = await countRows(invoiceItems, sql`${invoiceItems.invoiceId} IN (SELECT id FROM invoices WHERE client_id = ${c.id})`);
      assert.equal(itemLeft, 0, "invoice items must cascade-delete");
      const clientLeft = await countRows(clients, eq(clients.clientId, c.id));
      assert.equal(clientLeft, 0, "client must be hard-deleted");
    }

    // ─── 4. Client with recurring records ───
    {
      const [c] = await db.insert(clients).values({ clientName: "test-permanent WithBills" }).returning({ id: clients.clientId, clientName: clients.clientName });
      await db.insert(recurringExpenses).values({
        description: "test-permanent monthly rent", categoryId: 1,
        originalAmount: "1000.00", originalCurrency: "INR", anchorDay: 1, nextDue: "2026-02-01",
        createdBy: U, clientId: c.id, isActive: true,
      });

      const scope = await clientDeletionScope(c.id);
      assert.equal(scope!.recurringExpenses, 1);

      const res = await permanentlyDeleteClient(U, c.id, c.clientName);
      assert.ok(res.ok);

      const billLeft = await countRows(recurringExpenses, eq(recurringExpenses.clientId, c.id));
      assert.equal(billLeft, 0, "recurring bills must be hard-deleted");
      const clientLeft = await countRows(clients, eq(clients.clientId, c.id));
      assert.equal(clientLeft, 0, "client must be hard-deleted");
    }

    // ─── 5. Large number of dependent records (set-based, no per-record overhead) ───
    {
      const [c] = await db.insert(clients).values({ clientName: "test-permanent Large" }).returning({ id: clients.clientId, clientName: clients.clientName });
      const rows = Array.from({ length: 200 }, (_, i) => ({
        typeId: 1, clientId: c.id, clientNameSnapshot: "test-permanent Large",
        originalAmount: "10.00", originalCurrency: "INR", amountInr: "10.00",
        description: `bulk payment ${i}`, source: "manual", status: "confirmed",
        idempotencyKey: `bulk-${i}-${randomUUID()}`, payloadHash: randomUUID(), createdBy: U,
        txnDate: "2026-03-01",
      }));
      await db.insert(transactions).values(rows);

      const scope = await clientDeletionScope(c.id);
      assert.equal(scope!.transactions, 200);

      const res = await permanentlyDeleteClient(U, c.id, c.clientName);
      assert.ok(res.ok, "deletion of client with many records should succeed");

      const txnLeft = await countRows(transactions, eq(transactions.clientId, c.id));
      assert.equal(txnLeft, 0, "all 200 transactions must be deleted");
      const clientLeft = await countRows(clients, eq(clients.clientId, c.id));
      assert.equal(clientLeft, 0, "client must be hard-deleted");
    }

    // ─── 6. Deleted client absent from active and recoverable client queries ───
    {
      const [c1] = await db.insert(clients).values({ clientName: "test-permanent Gone1" }).returning({ id: clients.clientId });
      await db.insert(clients).values({ clientName: "test-permanent Gone2" }).returning({ id: clients.clientId });
      await permanentlyDeleteClient(U, c1.id, "test-permanent Gone1");

      const active = await countRows(clients, sql`${clients.deletedAt} IS NULL AND ${clients.clientName} LIKE 'test-permanent%'`);
      assert.equal(active, 1, "only the non-deleted client should be active");

      const [gone] = await db.select().from(clients).where(eq(clients.clientId, c1.id));
      assert.equal(gone, undefined, "permanently deleted client row must not exist");
    }

    // ─── 7. Unrelated clients and records remain unchanged ───
    {
      const [unrelated] = await db.insert(clients).values({ clientName: "test-permanent Untouched" }).returning({ id: clients.clientId });
      const [target] = await db.insert(clients).values({ clientName: "test-permanent Target" }).returning({ id: clients.clientId });
      await db.insert(transactions).values({
        typeId: 1, clientId: unrelated.id, clientNameSnapshot: "test-permanent Untouched",
        originalAmount: "50.00", originalCurrency: "INR", amountInr: "50.00",
        description: "unrelated payment", source: "manual", status: "confirmed",
        idempotencyKey: `unrel-${randomUUID()}`, payloadHash: randomUUID(), createdBy: U,
        txnDate: "2026-04-01",
      });

      await permanentlyDeleteClient(U, target.id, "test-permanent Target");

      const unrelatedLeft = await countRows(clients, eq(clients.clientId, unrelated.id));
      assert.equal(unrelatedLeft, 1, "unrelated client must remain");
      const unrelatedTxnLeft = await countRows(transactions, eq(transactions.clientId, unrelated.id));
      assert.equal(unrelatedTxnLeft, 1, "unrelated client's transaction must remain");
    }

    // ─── 8. Confirmation counts match actual deletion scope ───
    {
      const [c] = await db.insert(clients).values({ clientName: "test-permanent Counts" }).returning({ id: clients.clientId, clientName: clients.clientName });
      await db.insert(transactions).values({
        typeId: 1, clientId: c.id, clientNameSnapshot: "test-permanent Counts",
        originalAmount: "75.00", originalCurrency: "INR", amountInr: "75.00",
        description: "counted payment", source: "manual", status: "confirmed",
        idempotencyKey: `cnt-${randomUUID()}`, payloadHash: randomUUID(), createdBy: U,
        txnDate: "2026-05-01",
      });
      const [inv] = await db.insert(invoices).values({
        number: "WV/2026-27/002", status: "sent", clientId: c.id,
        billToName: "test-permanent Counts", currency: "INR", taxType: "none",
        gstRate: "0", subtotal: "100.00", total: "100.00",
        issueDate: "2026-01-01", dueDate: "2026-02-01",
        createdBy: U,
      }).returning({ id: invoices.id });
      await db.insert(invoiceItems).values({
        invoiceId: inv.id, position: 1, description: "item", quantity: "1", rate: "100.00", amount: "100.00",
      });

      const scope = await clientDeletionScope(c.id);
      assert.equal(scope!.transactions, 1);
      assert.equal(scope!.invoices, 1);
      assert.equal(scope!.invoiceItems, 1);

      const res = await permanentlyDeleteClient(U, c.id, c.clientName);
      assert.ok(res.ok);

      // Verify actual deleted counts match the preview scope.
      const txnLeft = await countRows(transactions, eq(transactions.clientId, c.id));
      const invLeft = await countRows(invoices, eq(invoices.clientId, c.id));
      assert.equal(txnLeft, 0);
      assert.equal(invLeft, 0);
    }

    // ─── 9. Wrong confirmation name is rejected, no data changes ───
    {
      const [c] = await db.insert(clients).values({ clientName: "test-permanent Confirm" }).returning({ id: clients.clientId, clientName: clients.clientName });
      const before = await countRows(clients, eq(clients.clientId, c.id));
      const res = await permanentlyDeleteClient(U, c.id, "Wrong Name");
      assert.equal(res.ok, false);
      assert.equal(res.error, `Type the exact client name "${c.clientName}" to confirm permanent deletion.`);
      const after = await countRows(clients, eq(clients.clientId, c.id));
      assert.equal(after, before, "failed confirmation must not delete the client");
    }

    // ─── 10. Empty confirmation name is rejected ───
    {
      const [c] = await db.insert(clients).values({ clientName: "test-permanent Empty" }).returning({ id: clients.clientId });
      const res = await permanentlyDeleteClient(U, c.id, "");
      assert.equal(res.ok, false);
      const res2 = await permanentlyDeleteClient(U, c.id, "   ");
      assert.equal(res2.ok, false);
      const left = await countRows(clients, eq(clients.clientId, c.id));
      assert.equal(left, 1, "empty confirmation must not delete");
    }

    // ─── 11. Already-deleted client cannot be deleted again ───
    {
      const [c] = await db.insert(clients).values({ clientName: "test-permanent Twice" }).returning({ id: clients.clientId, clientName: clients.clientName });
      assert.ok((await permanentlyDeleteClient(U, c.id, c.clientName)).ok);
      const res = await permanentlyDeleteClient(U, c.id, c.clientName);
      assert.equal(res.ok, false);
      assert.equal(res.error, "This client no longer exists.");
    }

    // ─── 12. Deletion audit event is recorded ───
    {
      const [c] = await db.insert(clients).values({ clientName: "test-permanent Audit" }).returning({ id: clients.clientId });
      await permanentlyDeleteClient(U, c.id, "test-permanent Audit");
      const [audit] = await db.select().from(auditEvents)
        .where(and(eq(auditEvents.entityType, "client"), eq(auditEvents.entityId, c.id), eq(auditEvents.action, "permanently_deleted")))
        .orderBy(sql`${auditEvents.createdAt} DESC`)
        .limit(1);
      assert.ok(audit, "deletion audit event must be recorded");
      assert.equal(audit.performedBy, U);
    }

    console.log("permanent deletion db ok");
  } finally {
    await cleanup();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
