/**
 * GET /api/reports/export?period=month|fy|all
 *
 * Downloads the confirmed ledger for the period as CSV (columns in lib/transactions/csv.ts).
 * Auth-guarded, read-only. Used by Settings → Export all.
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { listLedger } from "@/lib/transactions/queries";
import { parsePeriod, periodStart } from "@/lib/transactions/period";
import { toCsv } from "@/lib/transactions/csv";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const period = parsePeriod(req.nextUrl.searchParams.get("period"));
  const from = periodStart(period);
  const rows = (await listLedger()).filter((r) => r.date >= from);

  const csv = toCsv(rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ledger-${period}-${from}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
