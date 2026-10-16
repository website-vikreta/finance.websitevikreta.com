import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { KPICard, type KPICardData } from "@/components/dashboard/kpi-card";
import { BreakdownDonut } from "@/components/dashboard/breakdown-donut";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { percentChange } from "@/lib/format";
import { clientSummaries, expenseBreakdown, incomeBreakdown, listLedger, monthlyTotals } from "@/lib/transactions/queries";

export const metadata = { title: "Dashboard" };

const MONTHS = 12; // the trend chart's longest range

function change(current: number, previous: number, higherIsBetter: boolean): Pick<KPICardData, "note" | "tone"> {
  const pct = percentChange(current, previous);
  if (pct === null) return {};
  const good = higherIsBetter ? pct >= 0 : pct <= 0;
  return { note: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}% vs last month`, tone: good ? "good" : "bad" };
}

async function DashboardData() {
  const months = await monthlyTotals(MONTHS);
  const thisMonth = months[months.length - 1];
  const lastMonth = months[months.length - 2];
  const [clients, paidThisMonth, spentThisMonth, recent] = await Promise.all([
    clientSummaries(),
    incomeBreakdown(thisMonth.month),
    expenseBreakdown(thisMonth.month),
    listLedger(5),
  ]);

  const month = new Date(`${thisMonth.month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" });
  const netNow = thisMonth.income - thisMonth.expense;
  const netBefore = lastMonth.income - lastMonth.expense;

  const kpis: KPICardData[] = [
    { id: "money-in", label: `Money in · ${month}`, amount: thisMonth.income, ...change(thisMonth.income, lastMonth.income, true) },
    { id: "money-out", label: `Money out · ${month}`, amount: thisMonth.expense, ...change(thisMonth.expense, lastMonth.expense, false) },
    { id: "net", label: `Net · ${month}`, amount: netNow, ...change(netNow, netBefore, true) },
    { id: "clients-paid", label: `Clients paid · ${month}`, amount: paidThisMonth.length, isCount: true, note: `of ${clients.length}` },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-6 @4xl:grid-cols-4">
        {kpis.map((kpi) => <KPICard key={kpi.id} card={kpi} />)}
      </div>
      <div className="grid grid-cols-1 items-stretch gap-6 @4xl:grid-cols-12">
        <div className="min-w-0 @4xl:col-span-8">
          <TrendChart data={months} />
        </div>
        <div className="min-w-0 @4xl:col-span-4">
          <BreakdownDonut title={`Where money went · ${month}`} items={spentThisMonth} empty="No expenses this month." />
        </div>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-6 @4xl:grid-cols-12">
        <div className="min-w-0 @4xl:col-span-4">
          <BreakdownDonut title={`Who paid us · ${month}`} items={paidThisMonth} empty="No income this month." />
        </div>
        <div className="min-w-0 @4xl:col-span-8">
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
        <Skeleton className="h-80 rounded-xl @4xl:col-span-8" />
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
