/**
 * Invoices and receivables (server only).
 *
 * - Drafts are editable and have no number. Issuing assigns the next number for the
 *   invoice's financial year (WV/2026-27/001) under a row lock, so numbers never repeat or skip.
 * - "Paid" is never stored: it's the sum of live income transactions linked by invoice_id,
 *   so deleting a payment puts the balance back. Status shown = displayStatus() in math.ts.
 * - Every write is audited. Drafts are soft-deleted; issued invoices can only be voided.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, clients, companyProfile, invoiceItems, invoices } from "@/lib/db/schema";
import { DecimalPrecisionError, parseExactDecimalToBigInt } from "@/lib/currency/precision";
import { createManualTransaction, type ManageResult } from "@/lib/transactions/manage";
import { resolveClientId } from "@/lib/transactions/persist";
import { todayInIndia } from "@/lib/transactions/period";
import { getCompanyProfile, type CompanyProfile } from "./company";
import { GST_RATES, balanceOf, computeTotals, displayStatus, financialYear, invoiceNumber, taxTypeFor, type InvoiceCurrency, type TaxType } from "./math";

export type Result = { ok: true; id: string } | { ok: false; error: string };

export interface InvoiceListRow {
  id: string;
  clientId: string;
  number: string | null;
  status: string;
  clientName: string;
  currency: InvoiceCurrency;
  issueDate: string;
  dueDate: string;
  total: string;
  paid: string;
}

export interface InvoiceDetail extends InvoiceListRow {
  billToAddress: string | null;
  billToState: string | null;
  billToCountry: string;
  billToGstin: string | null;
  billToEmail: string | null;
  taxType: TaxType;
  gstRate: string;
  subtotal: string;
  cgst: string;
  sgst: string;
  igst: string;
  notes: string | null;
  terms: string | null;
  /** Company details frozen at issue; null for drafts (they show the current profile). */
  seller: CompanyProfile | null;
  items: { description: string; quantity: string; rate: string; amount: string }[];
  payments: { id: string; date: string; amount: string; amountInr: string; exchangeRate: string | null }[];
}

export interface ClientBilling {
  name: string;
  email: string | null;
  address: string | null;
  state: string | null;
  country: string;
  gstin: string | null;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Live income in the invoice's currency linked to it. An edited row that became an expense or another currency stops counting. */
const PAID = sql<string>`coalesce((
  SELECT sum(t.original_amount) FROM transactions t
  WHERE t.invoice_id = i.id AND t.deleted_at IS NULL AND t.type_id = 1 AND t.original_currency = i.currency
), 0)`;

export async function listInvoices(): Promise<InvoiceListRow[]> {
  const result = await db.execute(sql`
    SELECT i.id, i.client_id AS "clientId", i.number, i.status, i.bill_to_name AS "clientName", i.currency,
           to_char(i.issue_date, 'YYYY-MM-DD') AS "issueDate", to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate",
           i.total::text AS total, ${PAID}::numeric(18,2)::text AS paid
    FROM invoices i
    WHERE i.deleted_at IS NULL
    ORDER BY (i.status = 'draft') DESC, i.issue_date DESC, i.seq DESC NULLS FIRST
  `);
  return result.rows as unknown as InvoiceListRow[];
}

export async function getInvoice(id: string): Promise<InvoiceDetail | null> {
  const result = await db.execute(sql`
    SELECT i.id, i.number, i.status, i.client_id AS "clientId", i.bill_to_name AS "clientName",
           i.bill_to_address AS "billToAddress", i.bill_to_state AS "billToState", i.bill_to_country AS "billToCountry",
           i.bill_to_gstin AS "billToGstin", i.bill_to_email AS "billToEmail", i.currency,
           to_char(i.issue_date, 'YYYY-MM-DD') AS "issueDate", to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate",
           i.tax_type AS "taxType", i.gst_rate::text AS "gstRate", i.subtotal::text AS subtotal,
           i.cgst::text AS cgst, i.sgst::text AS sgst, i.igst::text AS igst, i.total::text AS total,
           i.notes, i.terms, i.seller, ${PAID}::numeric(18,2)::text AS paid
    FROM invoices i WHERE i.id = ${id}::uuid AND i.deleted_at IS NULL
  `);
  const inv = result.rows[0] as unknown as Omit<InvoiceDetail, "items" | "payments"> | undefined;
  if (!inv) return null;
  const items = await db
    .select({ description: invoiceItems.description, quantity: invoiceItems.quantity, rate: invoiceItems.rate, amount: invoiceItems.amount })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, id))
    .orderBy(asc(invoiceItems.position));
  const payments = await db.execute(sql`
    SELECT t.id, to_char(t.txn_date, 'YYYY-MM-DD') AS date, t.original_amount::text AS amount,
           t.amount_inr::text AS "amountInr", t.exchange_rate::text AS "exchangeRate"
    FROM transactions t JOIN invoices i ON i.id = t.invoice_id
    WHERE t.invoice_id = ${id}::uuid AND t.deleted_at IS NULL AND t.type_id = 1 AND t.original_currency = i.currency
    ORDER BY t.txn_date, t.created_at
  `);
  return { ...inv, items, payments: payments.rows as unknown as InvoiceDetail["payments"] };
}

export interface Owed {
  INR: number;
  USD: number;
  overdue: number;
}

/** What clients still owe on issued invoices: per client id and in total (INR and USD kept apart). */
export async function receivables(today: string): Promise<{ total: Owed; byClient: Map<string, Owed> }> {
  const total: Owed = { INR: 0, USD: 0, overdue: 0 };
  const byClient = new Map<string, Owed>();
  for (const inv of await listInvoices()) {
    const status = displayStatus(inv, today);
    if (status !== "sent" && status !== "partial" && status !== "overdue") continue;
    const balance = Number(balanceOf(inv.total, inv.paid));
    const client = byClient.get(inv.clientId) ?? { INR: 0, USD: 0, overdue: 0 };
    for (const owed of [total, client]) {
      owed[inv.currency] += balance;
      if (status === "overdue") owed.overdue += 1;
    }
    byClient.set(inv.clientId, client);
  }
  return { total, byClient };
}

/** Clients with their billing defaults, for the invoice form's client picker. */
export async function listClientBilling(): Promise<ClientBilling[]> {
  return db
    .select({ name: clients.clientName, email: clients.email, address: clients.billingAddress, state: clients.state, country: clients.country, gstin: clients.gstin })
    .from(clients)
    .where(isNull(clients.deletedAt))
    .orderBy(asc(clients.clientName));
}

// ─── Draft create / update ───────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ITEMS = 50;
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));

/** Validates untrusted form input and computes totals exactly. */
export function parseInvoice(raw: unknown, companyState: string) {
  const i = (raw ?? {}) as Record<string, unknown>;
  const clientName = text(i.clientName, 255);
  const country = text(i.country, 100) ?? "India";
  const india = country.toLowerCase() === "india";
  const state = india && typeof i.state === "string" && /^\d{2}$/.test(i.state) ? i.state : null;
  const gstin = text(i.gstin, 15)?.toUpperCase().replace(/\s+/g, "") ?? null;
  const email = text(i.email, 255);
  const currency = i.currency === "INR" || i.currency === "USD" ? i.currency : null;
  const issueDate = isDate(i.issueDate) ? i.issueDate : null;
  const dueDate = isDate(i.dueDate) ? i.dueDate : null;
  const taxType = taxTypeFor(companyState, { country, state });
  const gstRate = taxType === "none" ? "0" : typeof i.gstRate === "string" && (GST_RATES as readonly string[]).includes(i.gstRate) ? i.gstRate : null;
  const rawItems = Array.isArray(i.items) ? i.items : [];

  if (!clientName) return { ok: false as const, error: "Who is this invoice for?" };
  if (india && !state) return { ok: false as const, error: "Pick the client's state (decides CGST/SGST or IGST)." };
  if (gstin && !GSTIN.test(gstin)) return { ok: false as const, error: "Client GSTIN should look like 29ABCDE1234F1Z5." };
  if (gstin && state && gstin.slice(0, 2) !== state) return { ok: false as const, error: "Client GSTIN's first two digits don't match their state." };
  if (email && !EMAIL.test(email)) return { ok: false as const, error: "Enter a valid client email." };
  if (!currency) return { ok: false as const, error: "Choose INR or USD." };
  if (!issueDate || !dueDate) return { ok: false as const, error: "Pick the invoice and due dates." };
  if (dueDate < issueDate) return { ok: false as const, error: "Due date can't be before the invoice date." };
  if (gstRate === null) return { ok: false as const, error: "Pick a GST rate." };
  if (rawItems.length === 0) return { ok: false as const, error: "Add at least one line item." };
  if (rawItems.length > MAX_ITEMS) return { ok: false as const, error: `At most ${MAX_ITEMS} line items.` };

  const items: { description: string; quantity: string; rate: string }[] = [];
  for (const [n, raw] of rawItems.entries()) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const description = text(it.description, 500);
    const quantity = String(it.quantity ?? "").trim();
    const rate = String(it.rate ?? "").trim();
    if (!description) return { ok: false as const, error: `Line ${n + 1}: add a description.` };
    if (!/^\d+(\.\d{1,2})?$/.test(quantity) || Number(quantity) <= 0) return { ok: false as const, error: `Line ${n + 1}: quantity must be more than 0 (max 2 decimals).` };
    if (!/^\d+(\.\d{1,2})?$/.test(rate)) return { ok: false as const, error: `Line ${n + 1}: rate must be a number (max 2 decimals).` };
    items.push({ description, quantity, rate });
  }

  let totals;
  try {
    totals = computeTotals(items, gstRate, taxType);
  } catch (err) {
    if (err instanceof DecimalPrecisionError) return { ok: false as const, error: "Use at most 2 decimals for quantities and rates." };
    throw err;
  }
  if (parseExactDecimalToBigInt(totals.total, 2) <= BigInt(0)) return { ok: false as const, error: "The invoice total must be more than 0." };

  return {
    ok: true as const,
    value: {
      clientName, country, state, gstin, email, address: text(i.address, 1000),
      currency: currency as InvoiceCurrency, issueDate, dueDate, taxType, gstRate,
      notes: text(i.notes, 2000), terms: text(i.terms, 2000), items, totals,
    },
  };
}

const NEED_PROFILE = "Fill in the company profile in Settings first (it's printed on every invoice).";

/** Creates a draft (id null) or updates one. Also saves the client's billing details as defaults. */
export async function saveDraft(userId: string, id: string | null, raw: unknown): Promise<Result> {
  const company = await getCompanyProfile();
  if (!company) return { ok: false, error: NEED_PROFILE };
  const parsed = parseInvoice(raw, company.state);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  return db.transaction(async (tx) => {
    if (id) {
      const [existing] = await tx.select({ status: invoices.status }).from(invoices).where(and(eq(invoices.id, id), isNull(invoices.deletedAt))).for("update");
      if (!existing) return { ok: false, error: "This invoice no longer exists." };
      if (existing.status !== "draft") return { ok: false, error: "Only drafts can be edited. Void it and create a new one instead." };
    }

    const clientId = await resolveClientId(tx, v.clientName);
    await tx
      .update(clients)
      .set({ email: v.email, billingAddress: v.address, state: v.state, country: v.country, gstin: v.gstin, updatedAt: new Date() })
      .where(eq(clients.clientId, clientId));

    const fields = {
      clientId,
      billToName: v.clientName,
      billToAddress: v.address,
      billToState: v.state,
      billToCountry: v.country,
      billToGstin: v.gstin,
      billToEmail: v.email,
      currency: v.currency,
      issueDate: v.issueDate,
      dueDate: v.dueDate,
      taxType: v.taxType,
      gstRate: v.gstRate,
      subtotal: v.totals.subtotal,
      cgst: v.totals.cgst,
      sgst: v.totals.sgst,
      igst: v.totals.igst,
      total: v.totals.total,
      notes: v.notes,
      terms: v.terms,
      updatedAt: new Date(),
    };
    const invoiceId = id
      ? (await tx.update(invoices).set(fields).where(eq(invoices.id, id)).returning({ id: invoices.id }))[0].id
      : (await tx.insert(invoices).values({ ...fields, createdBy: userId }).returning({ id: invoices.id }))[0].id;

    await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
    await tx.insert(invoiceItems).values(v.items.map((it, n) => ({ invoiceId, position: n, ...it, amount: v.totals.lines[n] })));
    await tx.insert(auditEvents).values({
      entityType: "invoice",
      entityId: invoiceId,
      action: id ? "updated" : "created",
      performedBy: userId,
      source: "manual",
      afterState: JSON.parse(JSON.stringify({ ...fields, items: v.items })),
    });
    return { ok: true, id: invoiceId };
  });
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/** Draft → sent. Numbers are per financial year; the company row lock serialises issuing. */
export async function issueInvoice(userId: string, id: string): Promise<Result> {
  return db.transaction(async (tx) => {
    const [company] = await tx.select().from(companyProfile).where(eq(companyProfile.id, 1)).for("update");
    if (!company) return { ok: false, error: NEED_PROFILE };
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, id), isNull(invoices.deletedAt))).for("update");
    if (!inv) return { ok: false, error: "This invoice no longer exists." };
    if (inv.status !== "draft") return { ok: false, error: "This invoice is already issued." };

    const fy = financialYear(inv.issueDate);
    const [{ last }] = await tx.select({ last: sql<number>`coalesce(max(${invoices.seq}), 0)` }).from(invoices).where(eq(invoices.fy, fy));
    const seq = Number(last) + 1;
    const number = invoiceNumber(company.invoicePrefix, fy, seq);
    const seller = JSON.parse(JSON.stringify(company)); // frozen copy printed on this invoice forever
    await tx.update(invoices).set({ status: "sent", fy, seq, number, seller, sentAt: new Date(), updatedAt: new Date() }).where(eq(invoices.id, id));
    await tx.insert(auditEvents).values({ entityType: "invoice", entityId: id, action: "issued", performedBy: userId, source: "manual", afterState: { number, fy, seq } });
    return { ok: true, id };
  });
}

/** Issued invoice → void. Refused while it has payments (delete those first). Number stays used. */
export async function voidInvoice(userId: string, id: string): Promise<Result> {
  const inv = await getInvoice(id);
  if (!inv) return { ok: false, error: "This invoice no longer exists." };
  if (inv.status !== "sent") return { ok: false, error: inv.status === "draft" ? "Drafts are deleted, not voided." : "This invoice is already void." };
  if (inv.payments.length > 0) return { ok: false, error: "It has payments recorded. Delete those transactions first, then void it." };
  await db.transaction(async (tx) => {
    await tx.update(invoices).set({ status: "void", voidedAt: new Date(), updatedAt: new Date() }).where(and(eq(invoices.id, id), eq(invoices.status, "sent")));
    await tx.insert(auditEvents).values({ entityType: "invoice", entityId: id, action: "voided", performedBy: userId, source: "manual", beforeState: { number: inv.number } });
  });
  return { ok: true, id };
}

export async function deleteDraft(userId: string, id: string): Promise<Result> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(invoices)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.status, "draft"), isNull(invoices.deletedAt)))
      .returning({ id: invoices.id, billToName: invoices.billToName, total: invoices.total });
    if (!row) return { ok: false, error: "Only drafts can be deleted." };
    await tx.insert(auditEvents).values({ entityType: "invoice", entityId: id, action: "deleted", performedBy: userId, source: "manual", beforeState: row });
    return { ok: true, id };
  });
}

// ─── Payments ────────────────────────────────────────────────────────────────

/**
 * Records money received against an issued invoice as an income transaction linked by
 * invoice_id. Same currency as the invoice; never more than the balance.
 */
// ponytail: the balance check and the insert are separate statements; two people paying the same
// invoice at the same moment could overpay. Lock the invoice row inside persist if that ever matters.
export async function recordPayment(userId: string, id: string, raw: unknown, requestId: string): Promise<ManageResult> {
  const inv = await getInvoice(id);
  if (!inv) return { ok: false, error: "This invoice no longer exists." };
  if (inv.status !== "sent") return { ok: false, error: inv.status === "draft" ? "Issue the invoice before recording a payment." : "This invoice is void." };

  const p = (raw ?? {}) as Record<string, unknown>;
  const amount = String(p.amount ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return { ok: false, error: "Enter the amount received (max 2 decimals)." };
  const balance = balanceOf(inv.total, inv.paid);
  if (parseExactDecimalToBigInt(amount, 2) > parseExactDecimalToBigInt(balance, 2)) {
    return { ok: false, error: `Only ${inv.currency === "USD" ? "$" : "₹"}${Number(balance).toLocaleString("en-IN")} is due on this invoice.` };
  }
  const date = isDate(p.date) ? p.date : null;
  if (!date) return { ok: false, error: "Pick the date the money came in." };
  if (date > todayInIndia()) return { ok: false, error: "The payment date can't be in the future." };

  return createManualTransaction(
    userId,
    { type: "income", amount: Number(amount), currency: inv.currency, rate: inv.currency === "USD" ? Number(p.rate) : null, client: inv.clientName, description: null, category: null, date },
    requestId,
    true, // linked to an invoice and capped at its balance, so not a duplicate
    { id, note: `Invoice ${inv.number}` },
  );
}
