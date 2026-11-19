"use client";

import { useState, useCallback } from "react";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { financialYearLabel } from "@/lib/transactions/period";
import type { MonthTotals } from "@/lib/transactions/queries";
import { SERIES } from "./trend-series";
import { TrendCanvas } from "./trend-canvas";

const RANGES = [3, 6, 12] as const;
const TYPES = { bar: "Bars", line: "Lines", area: "Area" } as const;
type ChartType = keyof typeof TYPES;

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

  return (
    <section className="h-full rounded-xl border border-border bg-card p-6" aria-labelledby="trend-title">
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 id="trend-title" className="text-title-md">Income vs expenses</h2>
            <select
              id="trend-year-select"
              aria-label="Financial year"
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
          <TrendCanvas rows={rows} type={type} />
        )}
      </div>
    </section>
  );
}
