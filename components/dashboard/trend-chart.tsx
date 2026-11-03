"use client";

import { useState, useCallback } from "react";
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
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { formatINR, formatMonthShort } from "@/lib/format";
import { financialYearLabel } from "@/lib/transactions/period";
import type { MonthTotals } from "@/lib/transactions/queries";

const RANGES = [3, 6, 12] as const;
const TYPES = { bar: "Bars", line: "Lines", area: "Area" } as const;
type ChartType = keyof typeof TYPES;

const SERIES = [
  { key: "income", label: "Income", color: "var(--income)" },
  { key: "expense", label: "Expenses", color: "var(--expense)" },
] as const;

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };

function TrendTooltip({ active, payload, label }: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="w-max rounded-lg border border-border bg-popover px-3 py-2 text-caption shadow-md">
      <p className="mb-1 font-medium text-foreground">{formatMonthShort(String(label))} {String(label).slice(0, 4)}</p>
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

/** Income vs expenses per month. Receives 12 months; the range control slices the tail. */
export function TrendChart({ data, years, initialYear }: { data: MonthTotals[]; years: number[]; initialYear: number }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(12);
  const [type, setType] = useState<ChartType>("bar");
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [chartData, setChartData] = useState(data);

  const handleYearChange = useCallback(async (year: number) => {
    setSelectedYear(year);
    if (year === initialYear) { setChartData(data); return; }
    const res = await fetch(`/api/reports/monthly?year=${year}`);
    const json = await res.json();
    setChartData(json.months);
  }, [initialYear, data]);

  const rows = chartData.slice(-range);
  const isEmpty = rows.every((r) => r.income === 0 && r.expense === 0);

  const common = { data: rows, margin: { top: 8, right: 8, bottom: 0, left: 8 } };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
      <XAxis dataKey="month" tickFormatter={formatMonthShort} tick={axisTick} axisLine={false} tickLine={false} />
      <YAxis
        tickFormatter={(v: number) => formatINR(v, { compact: true })}
        tick={axisTick}
        axisLine={false}
        tickLine={false}
        width={56}
      />
      <Tooltip
        content={TrendTooltip}
        wrapperStyle={{ zIndex: 20 }}
        cursor={type === "bar" ? { fill: "var(--muted)" } : { stroke: "var(--hairline-strong)" }}
      />
    </>
  );

  return (
    <section className="h-full rounded-xl border border-border bg-card p-6" aria-labelledby="trend-title">
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 id="trend-title" className="text-title-md">Income vs expenses</h2>
            <select
              id="trend-year-select"
              value={selectedYear}
              onChange={(e) => handleYearChange(Number(e.target.value))}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-caption font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {years.map((y) => <option key={y} value={y}>{financialYearLabel(y)}</option>)}
            </select>
          </div>
          <div className="mt-2 flex items-center gap-4 text-caption text-muted-foreground">
            {SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-2">
                <i className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                {s.label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div role="tablist" aria-label="Range" className={segmentedTrack}>
            {RANGES.map((r) => (
              <button key={r} type="button" role="tab" aria-selected={range === r} onClick={() => setRange(r)} className={segmentedItem(range === r)}>
                {r}M
              </button>
            ))}
          </div>
          <div role="tablist" aria-label="Chart type" className={segmentedTrack}>
            {(Object.keys(TYPES) as ChartType[]).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={type === t} onClick={() => setType(t)} className={segmentedItem(type === t)}>
                {TYPES[t]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 h-64" role="img" aria-label={`Income and expenses for the last ${range} months`}>
        {isEmpty ? (
          <p className="grid h-full place-items-center text-body-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {type === "bar" ? (
              <BarChart {...common} barGap={2} barCategoryGap="28%">
                {axes}
                {SERIES.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
                ))}
              </BarChart>
            ) : type === "line" ? (
              <LineChart {...common}>
                {axes}
                {SERIES.map((s) => (
                  <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: s.color }} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} type="monotone" />
                ))}
              </LineChart>
            ) : (
              <AreaChart {...common}>
                {axes}
                {SERIES.map((s) => (
                  <Area key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.12} type="monotone" activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} />
                ))}
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
