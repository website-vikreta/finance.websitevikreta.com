/**
 * GET /api/reports/export?period=month|fy|all
 *
 * Downloads the confirmed ledger for the period as CSV (amounts in INR, plus the
 * original USD amount and rate where relevant). Auth-guarded, read-only.
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { listLedger } from "@/lib/transactions/queries";
import { parsePeriod, periodStart } from "@/lib/transactions/period";

/** Quote every cell; neutralise leading =,+,-,@ so spreadsheets don't run user text as a formula. */
function cell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const period = parsePeriod(req.nextUrl.searchParams.get("period"));
  const from = periodStart(period);
  const rows = (await listLedger()).filter((r) => r.date >= from);

  const header = ["Date", "Type", "Client / Expense", "Description", "Amount (INR)", "Original amount", "Currency", "Exchange rate", "Source"];
  const lines = rows.map((r) =>
    [
      r.date,
      r.type === "income" ? "Income" : "Expense",
      r.title,
      r.detail,
      r.amountInr.toFixed(2),
      r.originalAmount.toFixed(2),
      r.originalCurrency,
      r.exchangeRate,
      r.source,
    ]
      .map(cell)
      .join(","),
  );

  const csv = [header.map(cell).join(","), ...lines].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ledger-${period}-${from}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
