/**
 * Read-side queries for the ledger screens (dashboard, transactions, clients, reports).
 *
 * - Server only: imported by Server Components and route handlers, never by client code.
 * - Soft-deleted rows (deleted_at IS NOT NULL) are always excluded.
 * - All analytics use amount_inr (INR is the base currency).
 * - "This month" is computed in Asia/Kolkata so month boundaries match the business.
 * - Dates come back as YYYY-MM-DD strings (to_char) so pg never shifts them by timezone.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const INCOME = 1;
const EXPENSE = 2;
const TODAY_IST = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;

export type TxnType = "income" | "expense";

export interface LedgerRow {
  id: string;
  date: string;
  type: TxnType;
  /** Client name for income, expense description for expenses. */
  title: string;
  /** Purpose/notes; for income this is the optional description. */
  detail: string | null;
  originalAmount: number;
  originalCurrency: "INR" | "USD";
  amountInr: number;
  exchangeRate: number | null;
  source: string;
}

export interface MonthTotals {
  /** First day of the month, YYYY-MM-01. */
  month: string;
  income: number;
  expense: number;
}

export interface ClientSummary {
  id: string;
  name: string;
  totalReceived: number;
  payments: number;
  lastPaymentDate: string | null;
  firstSeen: string;
}

export interface Breakdown {
  name: string;
  amount: number;
  count: number;
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

export interface DeletedRow extends LedgerRow {
  deletedAt: string;
}

export async function listLedger(limit?: number): Promise<LedgerRow[]> {
  return listRows(false, limit);
}

/**
 * Deleted in the last 30 days through the app. Maintenance cleanups (audit metadata
 * carries a "reason", e.g. test-suite rows) are not offered for restore.
 */
const RESTORABLE = sql`t.deleted_at IS NOT NULL
  AND t.deleted_at > now() - interval '30 days'
  AND NOT EXISTS (
    SELECT 1 FROM audit_events a
    WHERE a.entity_id = t.id::text AND a.action = 'deleted' AND a.metadata ? 'reason'
  )`;

/** Soft-deleted transactions that can still be restored, most recently deleted first. */
export async function listDeleted(limit = 20): Promise<DeletedRow[]> {
  return listRows(true, limit) as Promise<DeletedRow[]>;
}

async function listRows(deleted: boolean, limit?: number): Promise<LedgerRow[]> {
  const data = await rows<{
    id: string;
    date: string;
    type_id: number;
    title: string;
    detail: string | null;
    original_amount: string;
    original_currency: "INR" | "USD";
    amount_inr: string;
    exchange_rate: string | null;
    source: string;
    deleted_at: string | null;
  }>(sql`
    SELECT t.id,
           to_char(t.txn_date, 'YYYY-MM-DD') AS date,
           t.type_id,
           CASE WHEN t.type_id = ${INCOME}
                THEN coalesce(c.client_name, t.client_name_snapshot, 'Unknown client')
                ELSE coalesce(t.description, 'Expense') END AS title,
           CASE WHEN t.type_id = ${INCOME} THEN t.description END AS detail,
           t.original_amount, t.original_currency, t.amount_inr, t.exchange_rate, t.source,
           to_char(t.deleted_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS deleted_at
    FROM transactions t
    LEFT JOIN clients c ON c.client_id = t.client_id
    WHERE ${deleted ? RESTORABLE : sql`t.deleted_at IS NULL`}
    ORDER BY ${deleted ? sql`t.deleted_at DESC` : sql`t.txn_date DESC, t.created_at DESC`}
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `);

  return data.map((r) => ({
    id: r.id,
    date: r.date,
    type: r.type_id === INCOME ? "income" : "expense",
    title: r.title,
    detail: r.detail,
    originalAmount: Number(r.original_amount),
    originalCurrency: r.original_currency,
    amountInr: Number(r.amount_inr),
    exchangeRate: r.exchange_rate === null ? null : Number(r.exchange_rate),
    source: r.source,
    ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
  }));
}

/** Income/expense per month for the last `months` months, oldest first, zero-filled. */
export async function monthlyTotals(months: number): Promise<MonthTotals[]> {
  const data = await rows<{ month: string; income: string; expense: string }>(sql`
    WITH m AS (
      SELECT generate_series(
        date_trunc('month', ${TODAY_IST}) - make_interval(months => ${months - 1}),
        date_trunc('month', ${TODAY_IST}),
        interval '1 month'
      )::date AS month
    )
    SELECT to_char(m.month, 'YYYY-MM-DD') AS month,
           coalesce(sum(t.amount_inr) FILTER (WHERE t.type_id = ${INCOME}), 0) AS income,
           coalesce(sum(t.amount_inr) FILTER (WHERE t.type_id = ${EXPENSE}), 0) AS expense
    FROM m
    LEFT JOIN transactions t
      ON t.deleted_at IS NULL AND date_trunc('month', t.txn_date)::date = m.month
    GROUP BY m.month
    ORDER BY m.month
  `);

  return data.map((r) => ({ month: r.month, income: Number(r.income), expense: Number(r.expense) }));
}

export async function clientSummaries(): Promise<ClientSummary[]> {
  const data = await rows<{
    id: string;
    name: string;
    total: string;
    payments: string;
    last_payment: string | null;
    first_seen: string;
  }>(sql`
    SELECT c.client_id AS id, c.client_name AS name,
           coalesce(sum(t.amount_inr), 0) AS total,
           count(t.id) AS payments,
           to_char(max(t.txn_date), 'YYYY-MM-DD') AS last_payment,
           to_char(c.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS first_seen
    FROM clients c
    LEFT JOIN transactions t
      ON t.client_id = c.client_id AND t.deleted_at IS NULL AND t.type_id = ${INCOME}
    WHERE c.deleted_at IS NULL
    GROUP BY c.client_id
    ORDER BY total DESC, c.client_name
  `);

  return data.map((r) => ({
    id: r.id,
    name: r.name,
    totalReceived: Number(r.total),
    payments: Number(r.payments),
    lastPaymentDate: r.last_payment,
    firstSeen: r.first_seen,
  }));
}

/** Expenses grouped by description (case-insensitive) since `from` (YYYY-MM-DD), largest first. */
export async function expenseBreakdown(from: string): Promise<Breakdown[]> {
  const data = await rows<{ name: string; amount: string; count: string }>(sql`
    SELECT min(t.description) AS name, sum(t.amount_inr) AS amount, count(*) AS count
    FROM transactions t
    WHERE t.deleted_at IS NULL AND t.type_id = ${EXPENSE} AND t.txn_date >= ${from}::date
    GROUP BY lower(trim(t.description))
    ORDER BY amount DESC
  `);
  return data.map((r) => ({ name: r.name, amount: Number(r.amount), count: Number(r.count) }));
}

/** Income grouped by client since `from` (YYYY-MM-DD), largest first. */
export async function incomeBreakdown(from: string): Promise<Breakdown[]> {
  const data = await rows<{ name: string; amount: string; count: string }>(sql`
    SELECT coalesce(c.client_name, t.client_name_snapshot, 'Unknown client') AS name,
           sum(t.amount_inr) AS amount, count(*) AS count
    FROM transactions t
    LEFT JOIN clients c ON c.client_id = t.client_id
    WHERE t.deleted_at IS NULL AND t.type_id = ${INCOME} AND t.txn_date >= ${from}::date
    GROUP BY 1
    ORDER BY amount DESC
  `);
  return data.map((r) => ({ name: r.name, amount: Number(r.amount), count: Number(r.count) }));
}

export interface RangeSummary {
  income: number;
  expense: number;
  incomeCount: number;
  expenseCount: number;
  /** Largest groups (client for income, description for expenses), biggest first. */
  top: { type: TxnType; name: string; amount: number }[];
}

/**
 * Totals between `from` and `to` (inclusive, YYYY-MM-DD) for the Finance Chat Bot.
 * `search` narrows to rows whose client name or description contains it (case-insensitive).
 */
export async function rangeSummary(from: string, to: string, search: string | null): Promise<RangeSummary> {
  const match = search
    ? sql`AND (coalesce(c.client_name, t.client_name_snapshot, '') ILIKE ${`%${search}%`} OR coalesce(t.description, '') ILIKE ${`%${search}%`})`
    : sql``;
  const data = await rows<{ type_id: number; name: string; amount: string; count: string }>(sql`
    SELECT type_id, min(name) AS name, sum(amount_inr) AS amount, count(*) AS count
    FROM (
      SELECT t.type_id, t.amount_inr,
             CASE WHEN t.type_id = ${INCOME}
                  THEN coalesce(c.client_name, t.client_name_snapshot, 'Unknown client')
                  ELSE coalesce(t.description, 'Expense') END AS name
      FROM transactions t
      LEFT JOIN clients c ON c.client_id = t.client_id
      WHERE t.deleted_at IS NULL AND t.txn_date BETWEEN ${from}::date AND ${to}::date ${match}
    ) r
    GROUP BY type_id, lower(trim(name))
    ORDER BY amount DESC
  `);

  const summary: RangeSummary = { income: 0, expense: 0, incomeCount: 0, expenseCount: 0, top: [] };
  for (const r of data) {
    const type: TxnType = r.type_id === INCOME ? "income" : "expense";
    summary[type] += Number(r.amount);
    summary[type === "income" ? "incomeCount" : "expenseCount"] += Number(r.count);
    summary.top.push({ type, name: r.name ?? "Expense", amount: Number(r.amount) });
  }
  return summary;
}
