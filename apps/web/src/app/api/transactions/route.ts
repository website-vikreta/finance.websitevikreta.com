/**
 * GET /api/transactions
 *
 * Authoritative read endpoint for the Transactions ledger page.
 * Retrieves verified, non-deleted transactions from PostgreSQL,
 * ordered by actual creation timestamp (created_at DESC).
 *
 * Mappings:
 *   - Date: txn_date
 *   - Category: "Income" (type_id = 1) | "Expense" (type_id = 2)
 *   - Description: client name (for income) | expense description (for expense)
 *   - Amount: amount_inr (stored INR major units)
 *   - Source: source (e.g. "chatbot", "manual", "telegram")
 *
 * Guarantees:
 *   - Protected by requireAuth.
 *   - Read-only: never modifies, inserts, or deletes records.
 *   - Zero cache: Cache-Control no-store prevents stale reads.
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { transactions, clients } from "@/lib/db/schema";
import { isNull, desc, eq } from "drizzle-orm";

export interface TransactionListItem {
  id: string;
  date: string;
  category: "Income" | "Expense";
  description: string;
  amountInr: string;
  source: string;
  createdAt: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const rows = await db
      .select({
        id: transactions.id,
        typeId: transactions.typeId,
        clientId: transactions.clientId,
        clientName: clients.clientName,
        clientNameSnapshot: transactions.clientNameSnapshot,
        description: transactions.description,
        amountInr: transactions.amountInr,
        txnDate: transactions.txnDate,
        source: transactions.source,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .leftJoin(clients, eq(transactions.clientId, clients.clientId))
      .where(isNull(transactions.deletedAt))
      .orderBy(desc(transactions.createdAt));

    const data: TransactionListItem[] = rows.map((r) => {
      const isIncome = r.typeId === 1;
      const category: "Income" | "Expense" = isIncome ? "Income" : "Expense";
      const description = isIncome
        ? r.clientNameSnapshot || r.clientName || "Unspecified Client"
        : r.description || "Unspecified Expense";

      return {
        id: r.id,
        date: r.txnDate,
        category,
        description,
        amountInr: r.amountInr,
        source: r.source,
        createdAt: r.createdAt.toISOString(),
      };
    });

    return NextResponse.json(
      { ok: true, transactions: data },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    );
  } catch (err) {
    console.error("[GET /api/transactions] Database query failed:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load transactions from database." },
      { status: 500 },
    );
  }
}
