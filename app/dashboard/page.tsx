import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { HeroCard } from "@/components/dashboard/hero-card";
import { KPICard, type KPICardData } from "@/components/dashboard/kpi-card";
import { CashFlowChart } from "@/components/dashboard/cash-flow-chart";
import { TopClientsList } from "@/components/dashboard/top-clients-list";
import { Skeleton } from "@/components/ui/skeleton";
import { percentChange } from "@/lib/format";
import { clientSummaries, incomeBreakdown, monthlyTotals } from "@/lib/transactions/queries";

const MONTHS = 6;

function changeBadge(
  current: number,
  previous: number,
  higherIsBetter: boolean,
): Pick<KPICardData, "badgeText" | "badgeType"> {
  const change = percentChange(current, previous);
  if (change === null) return { badgeText: "No data last month", badgeType: "neutral" };
  const sign = change > 0 ? "+" : "";
  const good = higherIsBetter ? change >= 0 : change <= 0;
  return { badgeText: `${sign}${change.toFixed(1)}% vs last month`, badgeType: good ? "positive" : "negative" };
}

async function DashboardData() {
  const months = await monthlyTotals(MONTHS);
  const thisMonth = months[months.length - 1];
  const lastMonth = months[months.length - 2];
  const [clients, paidThisMonth] = await Promise.all([clientSummaries(), incomeBreakdown(thisMonth.month)]);

  const netNow = thisMonth.income - thisMonth.expense;
  const netBefore = lastMonth.income - lastMonth.expense;

  const kpis: KPICardData[] = [
    { id: "money-in", label: "MONEY IN · THIS MONTH", amount: thisMonth.income, iconName: "credit-card", ...changeBadge(thisMonth.income, lastMonth.income, true) },
    { id: "money-out", label: "MONEY OUT · THIS MONTH", amount: thisMonth.expense, iconName: "arrow-left-right", ...changeBadge(thisMonth.expense, lastMonth.expense, false) },
    { id: "net", label: "NET CASH FLOW", amount: netNow, iconName: "bar-chart-2", ...changeBadge(netNow, netBefore, true) },
    {
      id: "clients-paid",
      label: "CLIENTS PAID · THIS MONTH",
      amount: paidThisMonth.length,
      isCount: true,
      iconName: "users",
      badgeText: `${clients.length} total`,
      badgeType: "neutral",
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {kpis.map((kpi) => <KPICard key={kpi.id} card={kpi} />)}
      </div>
      <div className="grid grid-cols-1 items-stretch gap-6 2xl:grid-cols-12">
        <div className="flex min-w-0 flex-col 2xl:col-span-8">
          <CashFlowChart data={months} />
        </div>
        <div className="flex min-w-0 flex-col 2xl:col-span-4">
          <TopClientsList clients={clients} />
        </div>
      </div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-12">
        <Skeleton className="h-96 rounded-xl 2xl:col-span-8" />
        <Skeleton className="h-96 rounded-xl 2xl:col-span-4" />
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <HeroCard />
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardData />
        </Suspense>
      </div>
    </AppShell>
  );
}
