/**
 * Client service: manage client profiles, billing information, and history.
 *
 * Rules:
 * - Every write is audited (audit_events), every delete is soft (deleted_at).
 * - Normalized active client names must be unique (lower(trim())).
 * - Validation matches GST & invoice standards (lib/invoices/math.ts).
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditEvents,
  bankStatementLines,
  categories,
  clients,
  invoiceItems,
  invoices,
  recurringExpenses,
  transactions,
} from "@/lib/db/schema";
import { balanceOf, displayStatus, STATES, type DisplayStatus } from "@/lib/invoices/math";
import { todayInIndia } from "@/lib/transactions/period";

export interface ClientProfile {
  id: string;
  name: string;
  email: string | null;
  billingAddress: string | null;
  state: string | null;
  country: string;
  gstin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientInvoiceSummary {
  id: string;
  number: string | null;
  status: string;
  displayStatus: DisplayStatus;
  issueDate: string;
  dueDate: string;
  currency: "INR" | "USD";
  total: string;
  paid: string;
  balance: string;
}

export interface ClientPaymentSummary {
  id: string;
  date: string;
  time: string;
  originalAmount: number;
  originalCurrency: "INR" | "USD";
  amountInr: number;
  exchangeRate: number | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  source: string;
  detail: string | null;
}

export interface ClientExpenseSummary {
  id: string;
  date: string;
  time: string;
  description: string | null;
  category: string | null;
  amountInr: number;
  originalAmount: number;
  originalCurrency: "INR" | "USD";
  source: string;
}

export interface ClientDetail extends ClientProfile {
  totalReceived: number;
  totalExpenses: number;
  netMargin: number;
  marginPct: number | null;
  paymentsCount: number;
  owed: {
    INR: number;
    USD: number;
    overdue: number;
  };
  lastPaymentDate: string | null;
  invoices: ClientInvoiceSummary[];
  payments: ClientPaymentSummary[];
  expenses: ClientExpenseSummary[];
  /** Recurring bills tagged to this client that are still running (active or paused). */
  bills: { id: string; description: string; amount: number; currency: "INR" | "USD"; nextDue: string; endDate: string | null; isActive: boolean }[];
}

export type Result<T = { id: string }> =
  | { ok: true; value?: T; id?: string }
  | { ok: false; error: string };

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const upper = (v: unknown, max: number) =>
  text(v, max)?.toUpperCase().replace(/\s+/g, "") ?? null;

export function parseClient(raw: unknown) {
  const i = (raw ?? {}) as Record<string, unknown>;
  const name = text(i.name, 255);
  const email = text(i.email, 255);
  const address = text(i.address ?? i.billingAddress, 1000);
  const country = text(i.country, 100) ?? "India";
  const india = country.trim().toLowerCase() === "india";
  const state =
    india && typeof i.state === "string" && STATES.some((s) => s.code === i.state)
      ? i.state
      : null;
  const gstin = upper(i.gstin, 15);

  if (!name) return { ok: false as const, error: "Enter the client name." };
  if (email && !EMAIL.test(email)) return { ok: false as const, error: "Enter a valid email address." };
  if (gstin && !GSTIN.test(gstin)) return { ok: false as const, error: "GSTIN should look like 27ABCDE1234F1Z5." };
  if (gstin && state && gstin.slice(0, 2) !== state) {
    return { ok: false as const, error: "Client GSTIN's first two digits don't match their state." };
  }
  if (india && gstin && !state) {
    return { ok: false as const, error: "Pick the client's state matching their GSTIN." };
  }

  return {
    ok: true as const,
    value: {
      name,
      email,
      address,
      country,
      state,
      gstin,
    },
  };
}

export async function createClient(userId: string, raw: unknown): Promise<Result> {
  const parsed = parseClient(raw);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const normalized = v.name.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: clients.clientId })
      .from(clients)
      .where(and(sql`lower(trim(both from ${clients.clientName})) = ${normalized}`, isNull(clients.deletedAt)))
      .limit(1);

    if (existing) {
      return { ok: false, error: "A client with this name already exists." };
    }

    const [created] = await tx
      .insert(clients)
      .values({
        clientName: v.name,
        email: v.email,
        billingAddress: v.address,
        state: v.state,
        country: v.country,
        gstin: v.gstin,
      })
      .returning({ id: clients.clientId });

    await tx.insert(auditEvents).values({
      entityType: "client",
      entityId: created.id,
      action: "created",
      performedBy: userId,
      source: "manual",
      afterState: v,
    });

    return { ok: true, id: created.id };
  });
}

export async function updateClient(userId: string, id: string, raw: unknown): Promise<Result> {
  const parsed = parseClient(raw);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const normalized = v.name.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.clientId, id), isNull(clients.deletedAt)))
      .for("update");

    if (!existing) {
      return { ok: false, error: "This client no longer exists." };
    }

    const [clash] = await tx
      .select({ id: clients.clientId })
      .from(clients)
      .where(
        and(
          sql`lower(trim(both from ${clients.clientName})) = ${normalized}`,
          sql`${clients.clientId} <> ${id}`,
          isNull(clients.deletedAt),
        ),
      )
      .limit(1);

    if (clash) {
      return { ok: false, error: "Another client with this name already exists." };
    }

    const beforeState = {
      name: existing.clientName,
      email: existing.email,
      address: existing.billingAddress,
      state: existing.state,
      country: existing.country,
      gstin: existing.gstin,
    };

    await tx
      .update(clients)
      .set({
        clientName: v.name,
        email: v.email,
        billingAddress: v.address,
        state: v.state,
        country: v.country,
        gstin: v.gstin,
        updatedAt: new Date(),
      })
      .where(eq(clients.clientId, id));

    await tx.insert(auditEvents).values({
      entityType: "client",
      entityId: id,
      action: "updated",
      performedBy: userId,
      source: "manual",
      beforeState,
      afterState: v,
    });

    return { ok: true, id };
  });
}

/**
 * Authoritative server-side count of everything the permanent deletion will touch.
 * Always recomputed on the server; the browser is never trusted for these numbers.
 */
export interface ClientDeletionScope {
  clientId: string;
  clientName: string;
  /** Transactions directly tagged to this client (income + expense). */
  transactions: number;
  /** Invoices issued to this client (invoice items cascade with them). */
  invoices: number;
  /** Invoice items belonging to the invoices above. */
  invoiceItems: number;
  /** Recurring bills tagged to this client. */
  recurringExpenses: number;
  /** Bank-import staging rows that keep their source data but lose the client link. */
  bankStatementLines: number;
}

/** Reads dependency counts inside a transaction (Drizzle typed API). */
async function loadDeletionCounts(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  id: string,
): Promise<ClientDeletionScope> {
  const [client] = await tx
    .select({ id: clients.clientId, name: clients.clientName })
    .from(clients)
    .where(and(eq(clients.clientId, id), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) {
    throw new Error("This client no longer exists.");
  }

  const transactionsCount = await tx
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(and(eq(transactions.clientId, id), isNull(transactions.deletedAt)));
  const invoicesCount = await tx
    .select({ count: sql<number>`count(*)` })
    .from(invoices)
    .where(and(eq(invoices.clientId, id), isNull(invoices.deletedAt)));
  const invoiceItemsCount = await tx
    .select({ count: sql<number>`count(*)` })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(and(eq(invoices.clientId, id), isNull(invoices.deletedAt)));
  const recurringCount = await tx
    .select({ count: sql<number>`count(*)` })
    .from(recurringExpenses)
    .where(and(eq(recurringExpenses.clientId, id), isNull(recurringExpenses.deletedAt)));
  const bankLinesCount = await tx
    .select({ count: sql<number>`count(*)` })
    .from(bankStatementLines)
    .where(eq(bankStatementLines.clientId, id));

  const num = (r: { count: unknown }[]) => Number(r[0]?.count ?? 0);

  return {
    clientId: client.id,
    clientName: client.name,
    transactions: num(transactionsCount),
    invoices: num(invoicesCount),
    invoiceItems: num(invoiceItemsCount),
    recurringExpenses: num(recurringCount),
    bankStatementLines: num(bankLinesCount),
  };
}

/**
 * Authoritative preview of what permanent deletion would remove, for the confirmation dialog.
 * Returns null when the client does not exist or is already gone.
 */
export async function clientDeletionScope(id: string): Promise<ClientDeletionScope | null> {
  try {
    return await db.transaction((tx) => loadDeletionCounts(tx, id));
  } catch {
    return null;
  }
}

/**
 * Permanently deletes one client and its client-specific dependent business records.
 *
 * Atomicity: one PostgreSQL transaction. All dependent rows are removed or unlinked,
 * then the client master record is hard-deleted, then a minimal audit event is recorded.
 * On any failure the whole transaction rolls back and nothing is visible.
 *
 * Dependency handling:
 *   - transactions        -> hard-deleted (never soft-deleted, not restorable)
 *   - invoices            -> hard-deleted; invoice items cascade via FK onDelete cascade
 *   - recurring_expenses  -> hard-deleted (surviving transactions referencing them are unlinked first)
 *   - bank_statement_lines -> RETAINED (source provenance); client link removed; links to
 *                             deleted transactions/invoices severed and marked skipped so they
 *                             cannot be silently re-imported or recreate the removed transaction
 *   - audit_events        -> RETAINED (immutable); one minimal deletion event is added
 *   - app_users, categories, bank_statements, unrelated rows -> untouched
 */
export async function permanentlyDeleteClient(
  userId: string,
  id: string,
  confirmationName: string,
): Promise<Result> {
  return db.transaction(async (tx) => {
    const [client] = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.clientId, id), isNull(clients.deletedAt)))
      .for("update");

    if (!client) {
      return { ok: false, error: "This client no longer exists." };
    }

    // Strong confirmation: the manager must type the exact client name.
    if (typeof confirmationName !== "string" || confirmationName.trim() !== client.clientName) {
      return {
        ok: false,
        error: `Type the exact client name "${client.clientName}" to confirm permanent deletion.`,
      };
    }

    // Recalculate dependency counts on the server; never trust the browser.
    const scope = await loadDeletionCounts(tx, id);

    // ─── 0. Bank-import staging rows: retain source records, remove the client link ───
    // Original narration, amounts, references and statement lineage stay intact for
    // reconciliation; only this client's relationship is removed.
    await tx
      .update(bankStatementLines)
      .set({ clientId: null, updatedAt: new Date() })
      .where(eq(bankStatementLines.clientId, id));
    // Sever staging rows that point to this client's imported transactions so the FK does not
    // block hard-deleting those transactions; mark them skipped so they cannot be silently
    // re-imported or recreate the removed transaction on a later retry.
    await tx
      .update(bankStatementLines)
      .set({
        transactionId: null,
        importedAt: null,
        importedPayloadHash: null,
        importedCategoryId: null,
        status: "skipped",
        skipReason:
          "Client permanently deleted; its imported transaction was removed.",
        updatedAt: new Date(),
      })
      .where(
        sql`${bankStatementLines.transactionId} IN (SELECT id FROM transactions WHERE client_id = ${id})`,
      );
    // Sever staging rows that point to this client's invoices being deleted.
    await tx
      .update(bankStatementLines)
      .set({ invoiceId: null, updatedAt: new Date() })
      .where(
        sql`${bankStatementLines.invoiceId} IN (SELECT id FROM invoices WHERE client_id = ${id})`,
      );

    // ─── 1. Unlink this client's recurring bills from other clients' transactions ───
    // (the client's own transactions are hard-deleted in the next step).
    await tx
      .update(transactions)
      .set({
        recurringId: null,
        recurringDue: null,
        recurringSettled: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          sql`${transactions.recurringId} IN (SELECT id FROM recurring_expenses WHERE client_id = ${id})`,
          sql`${transactions.clientId} IS DISTINCT FROM ${id}`,
          isNull(transactions.deletedAt),
        ),
      );

    // ─── 2. Hard-delete the client's transactions (never soft-deleted, not restorable) ───
    await tx.delete(transactions).where(eq(transactions.clientId, id));

    // ─── 3. Hard-delete the client's recurring bills ───
    await tx.delete(recurringExpenses).where(eq(recurringExpenses.clientId, id));

    // ─── 4. Hard-delete the client's invoices; invoice items cascade via FK onDelete cascade ───
    await tx.delete(invoices).where(eq(invoices.clientId, id));

    // ─── 5. Hard-delete the client master record ───
    const [deleted] = await tx
      .delete(clients)
      .where(eq(clients.clientId, id))
      .returning({ id: clients.clientId });
    if (!deleted) {
      return { ok: false, error: "This client no longer exists." };
    }

    // ─── 6. Minimal deletion audit event (client id only; no personal data copied in) ───
    await tx.insert(auditEvents).values({
      entityType: "client",
      entityId: id,
      action: "permanently_deleted",
      performedBy: userId,
      source: "manual",
      beforeState: { id: client.clientId },
      metadata: {
        deletedRecords: {
          transactions: scope.transactions,
          invoices: scope.invoices,
          invoiceItems: scope.invoiceItems,
          recurringExpenses: scope.recurringExpenses,
        },
        bankStatementLinesUnlinked: scope.bankStatementLines,
      },
    });

    return { ok: true, id };
  });
}

/** Fetches full client details, invoices, and payments history. */
export async function getClient(id: string): Promise<ClientDetail | null> {
  const rowQuery = db
    .select({
      id: clients.clientId,
      name: clients.clientName,
      email: clients.email,
      billingAddress: clients.billingAddress,
      state: clients.state,
      country: clients.country,
      gstin: clients.gstin,
      createdAt: sql<string>`to_char(${clients.createdAt} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`,
      updatedAt: sql<string>`to_char(${clients.updatedAt} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`,
    })
    .from(clients)
    .where(and(eq(clients.clientId, id), isNull(clients.deletedAt)))
    .limit(1);

  // Payments / Transactions
  const txQuery = db
    .select({
      id: transactions.id,
      date: sql<string>`to_char(${transactions.txnDate}, 'YYYY-MM-DD')`,
      time: sql<string>`to_char(${transactions.createdAt} AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')`,
      originalAmount: transactions.originalAmount,
      originalCurrency: transactions.originalCurrency,
      amountInr: transactions.amountInr,
      exchangeRate: transactions.exchangeRate,
      invoiceId: transactions.invoiceId,
      invoiceNumber: invoices.number,
      source: transactions.source,
      detail: transactions.description,
    })
    .from(transactions)
    .leftJoin(invoices, eq(invoices.id, transactions.invoiceId))
    .where(and(eq(transactions.clientId, id), isNull(transactions.deletedAt), eq(transactions.typeId, 1)))
    .orderBy(desc(transactions.txnDate), desc(transactions.createdAt));

  // Invoices with live paid sum
  const invQuery = db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      currency: invoices.currency,
      total: invoices.total,
      paid: sql<string>`coalesce((
        SELECT sum(t.original_amount) FROM transactions t
        WHERE t.invoice_id = ${invoices.id} AND t.deleted_at IS NULL AND t.type_id = 1 AND t.original_currency = ${invoices.currency}
      ), 0)::text`,
    })
    .from(invoices)
    .where(and(eq(invoices.clientId, id), isNull(invoices.deletedAt)))
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt));

  // Direct expenses tagged to this client
  const expQuery = db
    .select({
      id: transactions.id,
      date: sql<string>`to_char(${transactions.txnDate}, 'YYYY-MM-DD')`,
      time: sql<string>`to_char(${transactions.createdAt} AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')`,
      description: transactions.description,
      category: categories.name,
      amountInr: transactions.amountInr,
      originalAmount: transactions.originalAmount,
      originalCurrency: transactions.originalCurrency,
      source: transactions.source,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.clientId, id), isNull(transactions.deletedAt), eq(transactions.typeId, 2)))
    .orderBy(desc(transactions.txnDate), desc(transactions.createdAt));

  const billQuery = db
    .select({
      id: recurringExpenses.id,
      description: recurringExpenses.description,
      amount: recurringExpenses.originalAmount,
      currency: recurringExpenses.originalCurrency,
      nextDue: recurringExpenses.nextDue,
      endDate: recurringExpenses.endDate,
      isActive: recurringExpenses.isActive,
    })
    .from(recurringExpenses)
    .where(and(eq(recurringExpenses.clientId, id), isNull(recurringExpenses.deletedAt)))
    .orderBy(recurringExpenses.nextDue);

  // One round trip's wait instead of five (the database is remote).
  const [[row], txRows, invRows, expRows, billRows] = await Promise.all([rowQuery, txQuery, invQuery, expQuery, billQuery]);
  if (!row) return null;

  const today = todayInIndia();

  const clientInvoices: ClientInvoiceSummary[] = invRows.map((inv) => {
    const disp = displayStatus(
      {
        status: inv.status,
        dueDate: inv.dueDate,
        total: inv.total,
        paid: inv.paid,
      },
      today,
    );
    return {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      displayStatus: disp,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      currency: inv.currency as "INR" | "USD",
      total: inv.total,
      paid: inv.paid,
      balance: balanceOf(inv.total, inv.paid),
    };
  });

  const payments: ClientPaymentSummary[] = txRows.map((t) => ({
    id: t.id,
    date: t.date,
    time: t.time,
    originalAmount: Number(t.originalAmount),
    originalCurrency: t.originalCurrency as "INR" | "USD",
    amountInr: Number(t.amountInr),
    exchangeRate: t.exchangeRate ? Number(t.exchangeRate) : null,
    invoiceId: t.invoiceId,
    invoiceNumber: t.invoiceNumber,
    source: t.source,
    detail: t.detail,
  }));


  const expenses: ClientExpenseSummary[] = expRows.map((e) => ({
    id: e.id,
    date: e.date,
    time: e.time,
    description: e.description,
    category: e.category,
    amountInr: Number(e.amountInr),
    originalAmount: Number(e.originalAmount),
    originalCurrency: e.originalCurrency as "INR" | "USD",
    source: e.source,
  }));

  const totalReceived = payments.reduce((sum, p) => sum + p.amountInr, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amountInr, 0);
  const netMargin = totalReceived - totalExpenses;
  const marginPct = totalReceived > 0 ? (netMargin / totalReceived) * 100 : null;
  const lastPaymentDate = payments[0]?.date ?? null;

  const owed = { INR: 0, USD: 0, overdue: 0 };
  for (const inv of clientInvoices) {
    if (inv.displayStatus === "sent" || inv.displayStatus === "partial" || inv.displayStatus === "overdue") {
      const bal = Number(inv.balance);
      owed[inv.currency] += bal;
      if (inv.displayStatus === "overdue") owed.overdue += 1;
    }
  }

  return {
    ...row,
    totalReceived,
    totalExpenses,
    netMargin,
    marginPct,
    paymentsCount: payments.length,
    owed,
    lastPaymentDate,
    invoices: clientInvoices,
    payments,
    expenses,
    bills: billRows.map((b) => ({ ...b, amount: Number(b.amount), currency: b.currency as "INR" | "USD" })),
  };
}

export { toClientsCsv } from "./csv";

