"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { KPICard } from "@/components/dashboard/kpi-card";
import { BreakdownDonut } from "@/components/dashboard/breakdown-donut";
import { StatTile } from "@/components/layout/stat-tile";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { formatDate, formatINR, formatMonthShort, formatShare } from "@/lib/format";
import { cn } from "@/lib/utils";
import { quarterlyBuckets, growth, profitMargin, ANALYTICS_PERIODS, type AnalyticsPeriod } from "@/lib/analytics/range";
import type { AnalyticsData, AnalyticsComparison } from "@/lib/analytics/overview";

const SERIES = [
  { key: "income", label: "Income", color: "var(--income)" },
  { key: "expense", label: "Expenses", color: "var(--expense)" },
] as const;

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };

/** Percent/absolute note with safe zero-baseline rules. Rising is good for income & profit,
 *  bad for spending. Returns tone + short "vs {prevLabel}" note. */
function deltaNote(current: number, previous: number, prevLabel: string, risingIsGood: boolean): { note: string; tone: "good" | "bad" | "neutral" } {
  const g = growth(current, previous);
  if (g.kind === "flat") return { note: `No change vs ${prevLabel}`, tone: "neutral" };
  if (g.kind === "new") {
    return current > 0
      ? { note: `New vs ${prevLabel}`, tone: risingIsGood ? "good" : "bad" }
      : { note: `Nothing here vs ${prevLabel}`, tone: "neutral" };
  }
  if (g.pct !== null) {
    const text = `${g.pct > 0 ? "+" : ""}${g.pct.toFixed(1)}% vs ${prevLabel}`;
    const up = g.pct >= 0;
    return { note: text, tone: up ? (risingIsGood ? "good" : "bad") : risingIsGood ? "bad" : "good" };
  }
  // Un-computable percentage (negative baseline) — show the absolute move instead.
  const dir = g.absolute > 0 ? "+" : "−";
  const text = `${dir}${formatINR(Math.abs(g.absolute))} vs ${prevLabel}`;
  const up = g.absolute >= 0;
  return { note: text, tone: up ? (risingIsGood ? "good" : "bad") : risingIsGood ? "bad" : "good" };
}

function AnalyticsTooltip({ active, payload, label }: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="w-max rounded-lg border border-border bg-popover px-3 py-2 text-caption shadow-md">
      <p className="mb-1 font-medium text-foreground">{String(label)}</p>
      {SERIES.map((s) => {
        const value = payload.find((p) => p.dataKey === s.key)?.value ?? 0;
        return (
          <p key={s.key} className="flex items-center justify-between gap-6 text-muted-foreground">
            <span className="flex items-center gap-2">
              <i className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
            <span className="font-mono tabular-nums text-foreground">{formatINR(Number(value))}</span>
          </p>
        );
      })}
    </div>
  );
}

/** Fire for the "This Month / Quarter / FY" trio, mirroring the reference layout but in our tokens. */
function ComparisonCard({ title, comparison }: { title: string; comparison: AnalyticsComparison }) {
  const profit = comparison.current.income - comparison.current.expense;
  const prevProfit = comparison.previous.income - comparison.previous.expense;
  const note = deltaNote(profit, prevProfit, comparison.prevLabel, true);
  const rows = [
    { label: "Income", cur: comparison.current.income, prev: comparison.previous.income },
    { label: "Expenses", cur: comparison.current.expense, prev: comparison.previous.expense },
    { label: "Profit", cur: profit, prev: prevProfit },
  ];
  return (
    <section className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/40" aria-label={`${title} comparison`}>
      <h3 className="text-caption font-semibold text-foreground">{title}</h3>
      <div className="mt-1 grid grid-cols-3 gap-3 font-mono text-body-sm tabular-nums">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <p className={cn("truncate text-body-sm font-medium tabular-nums", r.label === "Profit" && r.cur < 0 ? "text-destructive" : "text-foreground")}>{formatINR(r.cur)}</p>
            <p className="text-caption text-muted-foreground">{r.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-caption text-muted-foreground">{comparison.prevLabel}</p>
      <div className="mt-0.5 grid grid-cols-3 gap-3 font-mono text-body-sm tabular-nums text-muted-foreground">
        {rows.map((r) => (
          <p key={r.label} className="truncate text-body-sm">{formatINR(r.prev)}</p>
        ))}
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <p className={cn("text-caption tabular-nums", note.tone === "good" && "text-success", note.tone === "bad" && "text-destructive", note.tone === "neutral" && "text-muted-foreground")}>
          Profit {note.note}
        </p>
      </div>
    </section>
  );
}

export function AnalyticsView({ data }: { data: AnalyticsData | null }) {
  const router = useRouter();
  const [grouping, setGrouping] = useState<"month" | "quarter">("month");
  const [chartType, setChartType] = useState<"bar" | "area">("bar");
  const [customFrom, setCustomFrom] = useState(data?.from ?? "");
  const [customTo, setCustomTo] = useState(data?.to ?? "");

  const series = useMemo(() => {
    if (!data) return [];
    if (grouping === "quarter") return quarterlyBuckets(data.months);
    return data.months.map((m) => ({ label: `${formatMonthShort(m.month)} ${m.month.slice(0, 4)}`, month: m.month, income: m.income, expense: m.expense }));
  }, [data, grouping]);

  const bucketed = grouping === "quarter";
  const xKey = bucketed ? "label" : "month";
  const xTickFormat = bucketed ? (v: string) => v : formatMonthShort;

  if (!data) {
    return (
      <section className="rounded-xl border border-border bg-card p-6" role="alert">
        <h2 className="text-title-md">Custom range not valid</h2>
        <p className="mt-2 text-body-sm text-muted-foreground">
          The from/to dates never opened a valid range. Pick a start date, then an end date on or after it.
        </p>
        <div className="mt-4">
          <Link href="/analytics?period=month" className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-active">
            Back to this month
          </Link>
        </div>
      </section>
    );
  }

  const applyCustom = () => {
    if (customFrom && customTo && customFrom <= customTo) {
      router.push(`/analytics?period=custom&from=${customFrom}&to=${customTo}`);
    }
  };

  const profit = data.current.income - data.current.expense;
  const prevProfit = data.previous.income - data.previous.expense;
  const margin = profitMargin(data.current.income, data.current.expense);
  const prevMargin = profitMargin(data.previous.income, data.previous.expense);
  const marginDelta = margin !== null && prevMargin !== null ? margin - prevMargin : null;

  const trendEmpty = series.every((s) => s.income === 0 && s.expense === 0);

  const customActive = data.period === "custom";

  return (
    <div className="space-y-6">
      {/* A. Period selector */}
      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center @xl:justify-between">
        <nav aria-label="Analytics period" className={segmentedTrack}>
          {(Object.keys(ANALYTICS_PERIODS) as AnalyticsPeriod[]).map((p) => (
            <Link
              key={p}
              href={p === "custom" ? `/analytics?period=custom&from=${data.from}&to=${data.to}` : `/analytics?period=${p}`}
              aria-current={data.period === p ? "page" : undefined}
              className={segmentedItem(data.period === p)}
            >
              {ANALYTICS_PERIODS[p]}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-caption text-muted-foreground">
            From
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-caption text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption text-muted-foreground">
            To
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-caption text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <button
            type="button"
            onClick={applyCustom}
            disabled={!customFrom || !customTo || customFrom > customTo}
            className={cn(
              "h-8 rounded-lg px-3 text-caption font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
              customActive ? "bg-foreground text-background" : "border border-input bg-background hover:bg-accent",
            )}
          >
            Apply range
          </button>
        </div>
      </div>

      {/* B. KPI cards for the selected period */}
      <div className="grid grid-cols-2 gap-6 @4xl:grid-cols-4">
        <KPICard card={{ id: "a-income", label: `Total income · ${data.label}`, amount: data.current.income, ...deltaNote(data.current.income, data.previous.income, data.prevLabel, true) }} />
        <KPICard card={{ id: "a-expense", label: `Total expenses · ${data.label}`, amount: data.current.expense, ...deltaNote(data.current.expense, data.previous.expense, data.prevLabel, false) }} />
        <KPICard card={{ id: "a-profit", label: "Net profit", amount: profit, ...deltaNote(profit, prevProfit, data.prevLabel, true) }} />
        <StatTile
          label={`Profit margin · ${data.label}`}
          value={margin === null ? "—" : `${margin.toFixed(1)}%`}
          note={margin === null ? `No income in this period` : marginDelta === null ? (prevMargin === null ? "No previous margin" : `Previous margin ${prevMargin.toFixed(1)}%`) : `${marginDelta >= 0 ? "+" : ""}${marginDelta.toFixed(1)} pp vs ${data.prevLabel}`}
        />
      </div>

      {/* C. Fixed period comparisons */}
      <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-3">
        <ComparisonCard title={`This month (${data.comparisons.month.label})`} comparison={data.comparisons.month} />
        <ComparisonCard title={`This quarter (${data.comparisons.quarter.label})`} comparison={data.comparisons.quarter} />
        <ComparisonCard title={`This financial year (${data.comparisons.fy.label})`} comparison={data.comparisons.fy} />
      </div>

      {/* D+E. Income vs expense trend and net movement */}
      <div className="grid grid-cols-1 items-stretch gap-6 @4xl:grid-cols-12">
        <section className="min-w-0 rounded-xl border border-border bg-card p-6 @4xl:col-span-7" aria-labelledby="analytics-trend-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="analytics-trend-title" className="text-title-md">Income vs expenses · {data.label}</h2>
            <div className="flex gap-2">
              <div role="tablist" aria-label="Time grouping" className={segmentedTrack}>
                {(["month", "quarter"] as const).map((g) => (
                  <button key={g} type="button" role="tab" aria-selected={grouping === g} onClick={() => setGrouping(g)} className={segmentedItem(grouping === g)}>
                    {g === "month" ? "Monthly" : "Quarterly"}
                  </button>
                ))}
              </div>
              <div role="tablist" aria-label="Chart type" className={segmentedTrack}>
                {(["bar", "area"] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={chartType === t} onClick={() => setChartType(t)} className={segmentedItem(chartType === t)}>
                    {t === "bar" ? "Bars" : "Area"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-4 text-caption text-muted-foreground">
            {SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-2">
                <i className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                {s.label}
              </span>
            ))}
          </div>
          <div className="mt-6 h-64" role="img" aria-label={`Income and expenses between ${data.from} and ${data.to}`}>
            {trendEmpty ? (
              <p className="grid h-full place-items-center text-body-sm text-muted-foreground">No transactions in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "bar" ? (
                  <BarChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2} barCategoryGap="28%">
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
                    <XAxis dataKey={xKey} tickFormatter={xTickFormat} tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v: number) => formatINR(v, { compact: true })} tick={axisTick} axisLine={false} tickLine={false} width={56} />
                    <Tooltip content={AnalyticsTooltip} wrapperStyle={{ zIndex: 20 }} cursor={{ fill: "var(--muted)" }} />
                    {SERIES.map((s) => (
                      <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    ))}
                  </BarChart>
                ) : (
                  <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
                    <XAxis dataKey={xKey} tickFormatter={xTickFormat} tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v: number) => formatINR(v, { compact: true })} tick={axisTick} axisLine={false} tickLine={false} width={56} />
                    <Tooltip content={AnalyticsTooltip} wrapperStyle={{ zIndex: 20 }} cursor={{ stroke: "var(--hairline-strong)" }} />
                    {SERIES.map((s) => (
                      <Area key={s.key} dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={2} type="monotone" activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} />
                    ))}
                  </AreaChart>
                )}
              </ResponsiveContainer>
            )}
          </div>
        </section>
        <section className="min-w-0 rounded-xl border border-border bg-card p-6 @4xl:col-span-5" aria-labelledby="analytics-profit-title">
          <h2 id="analytics-profit-title" className="text-title-md">Net movement trend</h2>
          <p className="mt-1 text-caption text-muted-foreground">Income minus expenses per bucket — read together with actual bank balances, not cash in hand.</p>
          <div className="mt-6 h-64" role="img" aria-label="Income minus expenses over the selected period">
            {trendEmpty ? (
              <p className="grid h-full place-items-center text-body-sm text-muted-foreground">No transactions in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
                  <XAxis dataKey={xKey} tickFormatter={xTickFormat} tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v: number) => formatINR(v, { compact: true })} tick={axisTick} axisLine={false} tickLine={false} width={56} />
                  <Tooltip content={AnalyticsTooltip} wrapperStyle={{ zIndex: 20 }} cursor={{ stroke: "var(--hairline-strong)" }} />
                  <Line dataKey="net" name="Net" stroke="var(--income)" strokeWidth={2} dot={{ r: 3, strokeWidth: 0 }} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      {/* F+G/H. Expense categories and top income clients */}
      <div className="grid grid-cols-1 items-stretch gap-6 @4xl:grid-cols-2">
        <BreakdownDonut title={`Expense mix · ${data.label}`} items={data.expenseCats} empty="No expenses in this period." />
        <section className="rounded-xl border border-border bg-card p-6" aria-labelledby="analytics-clients-title">
          <h2 id="analytics-clients-title" className="text-title-md">Top income clients · {data.label}</h2>
          {data.topClients.length === 0 ? (
            <p className="mt-6 text-body-sm text-muted-foreground">No income in this period.</p>
          ) : (
            <table className="mt-4 w-full text-body-sm">
              <thead>
                <tr className="text-caption text-muted-foreground">
                  <th scope="col" className="pb-2 text-left font-semibold">Client</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Money in</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Share</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Entries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.topClients.slice(0, 8).map((c) => (
                  <tr key={c.name} className="transition-colors hover:bg-accent/40">
                    <td className="max-w-40 truncate py-2 text-foreground">{c.name}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-foreground">{formatINR(c.amount)}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{formatShare(c.amount, data.current.income)}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* I. Activity summary */}
      <section className="rounded-xl border border-border bg-card p-6" aria-labelledby="analytics-activity-title">
        <h2 id="analytics-activity-title" className="text-title-md">Activity · {data.label}</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 @2xl:grid-cols-6">
          <StatTile label="Income entries" value={String(data.current.incomeCount)} />
          <StatTile label="Expense entries" value={String(data.current.expenseCount)} />
          <StatTile label="Avg money in" value={data.current.incomeCount > 0 ? formatINR(data.current.income / data.current.incomeCount) : "—"} />
          <StatTile label="Avg money out" value={data.current.expenseCount > 0 ? formatINR(data.current.expense / data.current.expenseCount) : "—"} />
          <StatTile
            label="Largest money in"
            value={data.extremes.income ? formatINR(data.extremes.income.amount) : "—"}
            note={data.extremes.income ? `${formatDate(data.extremes.income.date)} · ${truncate(data.extremes.income.title, 28)}` : undefined}
          />
          <StatTile
            label="Largest money out"
            value={data.extremes.expense ? formatINR(data.extremes.expense.amount) : "—"}
            note={data.extremes.expense ? `${formatDate(data.extremes.expense.date)} · ${truncate(data.extremes.expense.title, 28)}` : undefined}
          />
        </div>
      </section>
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
