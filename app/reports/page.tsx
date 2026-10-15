import Link from "next/link";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { StatTile } from "@/components/layout/stat-tile";
import { buttonVariants } from "@/components/ui/button";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { formatINR, formatMonthShort, formatShare } from "@/lib/format";
import { PERIODS, parsePeriod, periodStart, type Period } from "@/lib/transactions/period";
import { expenseBreakdown, incomeBreakdown, monthlyTotals, type Breakdown } from "@/lib/transactions/queries";
import { cn } from "@/lib/utils";

const TOP_N = 8;

function BreakdownCard({ title, items, empty, barClass }: { title: string; items: Breakdown[]; empty: string; barClass: string }) {
  const total = items.reduce((s, i) => s + i.amount, 0);
  const top = items.slice(0, TOP_N);
  const rest = items.slice(TOP_N).reduce((s, i) => s + i.amount, 0);
  const rows = rest > 0 ? [...top, { name: `${items.length - TOP_N} more`, amount: rest, count: 0 }] : top;

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-title-md">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-body-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-5 space-y-4">
          {rows.map((item) => {
            const share = (item.amount / total) * 100;
            return (
              <li key={item.name} className="space-y-1.5">
                <div className="flex justify-between gap-3 text-body-sm">
                  <span className="truncate text-foreground">{item.name}</span>
                  <span className="shrink-0 font-mono tabular-nums text-foreground">
                    {formatINR(item.amount)} <span className="text-muted-foreground">· {formatShare(item.amount, total)}</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", barClass)} style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

async function ReportData({ period }: { period: Period }) {
  const from = periodStart(period);
  const [income, expenses, months] = await Promise.all([incomeBreakdown(from), expenseBreakdown(from), monthlyTotals(12)]);
  const totalIn = income.reduce((s, i) => s + i.amount, 0);
  const totalOut = expenses.reduce((s, i) => s + i.amount, 0);
  const net = totalIn - totalOut;
  const margin = totalIn > 0 ? `${((net / totalIn) * 100).toFixed(1)}% margin` : "No income in this period";

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatTile label="INCOME" value={formatINR(totalIn)} note={`${income.reduce((s, i) => s + i.count, 0)} payments`} />
        <StatTile label="EXPENSES" value={formatINR(totalOut)} note={`${expenses.reduce((s, i) => s + i.count, 0)} entries`} />
        <StatTile label="NET PROFIT" value={formatINR(net)} note={margin} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BreakdownCard title="Income by client" items={income} empty="No income recorded in this period." barClass="bg-primary" />
        <BreakdownCard title="Expenses by description" items={expenses} empty="No expenses recorded in this period." barClass="bg-expense" />
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-6 py-4 text-title-md">Last 12 months</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-body-sm">
            <thead className="bg-muted/60">
              <tr className="text-eyebrow text-muted-foreground">
                <th scope="col" className="px-6 py-3 text-left font-semibold">Month</th>
                <th scope="col" className="px-6 py-3 text-right font-semibold">Income</th>
                <th scope="col" className="px-6 py-3 text-right font-semibold">Expenses</th>
                <th scope="col" className="px-6 py-3 text-right font-semibold">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono tabular-nums">
              {[...months].reverse().map((m) => {
                const rowNet = m.income - m.expense;
                return (
                  <tr key={m.month}>
                    <td className="px-6 py-3 font-sans text-foreground">
                      {formatMonthShort(m.month)} {m.month.slice(0, 4)}
                    </td>
                    <td className="px-6 py-3 text-right">{formatINR(m.income)}</td>
                    <td className="px-6 py-3 text-right">{formatINR(m.expense)}</td>
                    <td className={cn("px-6 py-3 text-right", rowNet < 0 ? "text-destructive" : "text-foreground")}>{formatINR(rowNet)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

async function Report({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const period = parsePeriod((await searchParams).period);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Report period" className={segmentedTrack}>
          {(Object.keys(PERIODS) as Period[]).map((p) => (
            <Link
              key={p}
              href={`/reports?period=${p}`}
              aria-current={p === period ? "page" : undefined}
              className={segmentedItem(p === period)}
            >
              {PERIODS[p]}
            </Link>
          ))}
        </nav>
        <a
          href={`/api/reports/export?period=${period}`}
          className={buttonVariants()}
        >
          <Download aria-hidden />
          Export CSV
        </a>
      </div>
      <Suspense key={period} fallback={<ReportSkeleton />}>
        <ReportData period={period} />
      </Suspense>
    </>
  );
}

function ReportSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </>
  );
}

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <AppShell>
      <PageHeader title="Reports" description="Profit and loss from confirmed transactions. Financial year runs April to March." />
      <Suspense fallback={<ReportSkeleton />}>
        <Report searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
