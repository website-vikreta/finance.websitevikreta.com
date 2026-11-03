import { Suspense } from "react";
import { connection } from "next/server";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { KPICard, type KPICardData } from "@/components/dashboard/kpi-card";
import { BreakdownDonut } from "@/components/dashboard/breakdown-donut";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { UpcomingBills } from "@/components/dashboard/upcoming-bills";
import { Skeleton } from "@/components/ui/skeleton";
import { percentChange } from "@/lib/format";
import { expenseBreakdown, incomeBreakdown, listLedger, monthlyTotals, transactionYears, monthlyTotalsForYear } from "@/lib/transactions/queries";
import { listRecurring } from "@/lib/transactions/recurring";
import { receivables } from "@/lib/invoices/invoices";
import { todayInIndia, financialYearStart } from "@/lib/transactions/period";

export const metadata = { title: "Dashboard" };

const MONTHS = 12; // the trend chart's longest range

function change(current: number, previous: number, higherIsBetter: boolean): Pick<KPICardData, "note" | "tone"> {
  const pct = percentChange(current, previous);
  if (pct === null) return {};
  const good = higherIsBetter ? pct >= 0 : pct <= 0;
  return { note: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}% vs last month`, tone: good ? "good" : "bad" };
}

async function DashboardData() {
  await connection(); // upcoming bills are relative to today
  const years = await transactionYears();
  const latestYear = years[0] ?? financialYearStart(todayInIndia());
  const [kpiMonths, chartMonths] = await Promise.all([monthlyTotals(MONTHS), monthlyTotalsForYear(latestYear)]);
  const thisMonth = kpiMonths[kpiMonths.length - 1];
  const lastMonth = kpiMonths[kpiMonths.length - 2];
  const today = todayInIndia();
  const [owed, paidThisMonth, spentThisMonth, recent, bills] = await Promise.all([
    receivables(today),
    incomeBreakdown(thisMonth.month),
    expenseBreakdown(thisMonth.month),
    listLedger(5),
    listRecurring(),
  ]);

  const month = new Date(`${thisMonth.month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" });
  const netNow = thisMonth.income - thisMonth.expense;
  const netBefore = lastMonth.income - lastMonth.expense;

  const kpis: KPICardData[] = [
    { id: "money-in", label: `Money in · ${month}`, amount: thisMonth.income, ...change(thisMonth.income, lastMonth.income, true) },
    { id: "money-out", label: `Money out · ${month}`, amount: thisMonth.expense, ...change(thisMonth.expense, lastMonth.expense, false) },
    { id: "net", label: `Net · ${month}`, amount: netNow, ...change(netNow, netBefore, true) },
    {
      id: "owed",
      label: "Owed to us",
      amount: owed.total.INR,
      note: [owed.total.USD > 0 ? `+ $${owed.total.USD.toLocaleString("en-US")}` : null, owed.total.overdue > 0 ? `${owed.total.overdue} overdue` : "Nothing overdue"].filter(Boolean).join(" · "),
      tone: owed.total.overdue > 0 ? "bad" : "neutral",
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-6 @4xl:grid-cols-4">
        {kpis.map((kpi) => <KPICard key={kpi.id} card={kpi} />)}
      </div>
      <div className="grid grid-cols-1 items-stretch gap-6 @4xl:grid-cols-12">
        <div className="min-w-0 @4xl:col-span-8">
          <TrendChart data={chartMonths} years={years} initialYear={latestYear} />
        </div>
        <div className="min-w-0 @4xl:col-span-4">
          <BreakdownDonut title={`Where money went · ${month}`} items={spentThisMonth} empty="No expenses this month." />
        </div>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-6 @4xl:grid-cols-12">
        <div className="min-w-0 @4xl:col-span-4">
          <BreakdownDonut title={`Who paid us · ${month}`} items={paidThisMonth} empty="No income this month." />
        </div>
        <div className="min-w-0 @4xl:col-span-4">
          <UpcomingBills rows={bills} today={today} />
        </div>
        <div className="min-w-0 @4xl:col-span-4">
          <RecentTransactions rows={recent} />
        </div>
      </div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-6 @4xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-12">
        <Skeleton className="h-96 rounded-xl @4xl:col-span-8" />
        <Skeleton className="h-96 rounded-xl @4xl:col-span-4" />
      </div>
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-12">
        <Skeleton className="h-80 rounded-xl @4xl:col-span-4" />
        <Skeleton className="h-80 rounded-xl @4xl:col-span-4" />
        <Skeleton className="h-80 rounded-xl @4xl:col-span-4" />
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      <PageHeader title="Dashboard" />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardData />
      </Suspense>
    </AppShell>
  );
}
