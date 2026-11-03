import { Suspense } from "react";
import { connection } from "next/server";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PERIODS, parsePeriod, periodStart, timeInIndia, todayInIndia, financialYearStart, type Period } from "@/lib/transactions/period";
import { expenseBreakdown, incomeBreakdown, listLedger, transactionYears, monthlyTotalsForYear } from "@/lib/transactions/queries";
import { ReportsView } from "@/components/reports/reports-view";

export const metadata = { title: "Reports" };

async function ReportData({ period }: { period: Period }) {
  await connection(); // periodStart reads the current date, so this runs at request time
  const from = periodStart(period);
  const years = await transactionYears();
  const latestYear = years[0] ?? financialYearStart(todayInIndia());
  const [income, expenses, yearMonths, ledger] = await Promise.all([
    incomeBreakdown(from),
    expenseBreakdown(from),
    monthlyTotalsForYear(latestYear),
    listLedger(),
  ]);
  const today = todayInIndia();
  const generatedAt = timeInIndia();

  return (
    <ReportsView
      period={period}
      periodLabel={PERIODS[period]}
      from={period === "all" ? null : from}
      today={today}
      generatedAt={generatedAt}
      income={income}
      expenses={expenses}
      yearMonths={yearMonths}
      years={years}
      latestYear={latestYear}
      rows={ledger.filter((r) => r.date >= from)}
    />
  );
}

async function Report({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const period = parsePeriod((await searchParams).period);
  return (
    <Suspense key={period} fallback={<ReportSkeleton />}>
      <ReportData period={period} />
    </Suspense>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center @xl:justify-between">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-10 w-52 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <AppShell>
      <div className="print:hidden">
        <PageHeader title="Reports" />
      </div>
      <Suspense fallback={<ReportSkeleton />}>
        <Report searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
