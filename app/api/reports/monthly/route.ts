import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { monthlyTotalsForYear, transactionYears } from "@/lib/transactions/queries";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const yearParam = req.nextUrl.searchParams.get("year");
  if (!yearParam || !/^\d{4}$/.test(yearParam)) {
    return NextResponse.json({ error: "year required (YYYY)" }, { status: 400 });
  }

  const year = Number(yearParam);
  const [months, years] = await Promise.all([monthlyTotalsForYear(year), transactionYears()]);

  return NextResponse.json({ months, years });
}
