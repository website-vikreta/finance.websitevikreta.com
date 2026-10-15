"use client";

import { useState } from "react";
import { formatINR, formatMonthShort } from "@/lib/format";

export interface CashFlowMonth {
  /** First day of the month, YYYY-MM-01. */
  month: string;
  income: number;
  expense: number;
}

interface CashFlowChartProps {
  data: CashFlowMonth[];
}

const TICK_COUNT = 4;

/** Round the axis top up to 1, 2, 2.5 or 5 × a power of ten so tick labels stay readable. */
function niceMax(value: number): number {
  if (value <= 0) return 1_00_000;
  const step = value / TICK_COUNT;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const nice = [1, 2, 2.5, 5, 10].find((n) => n * magnitude >= step) ?? 10;
  return nice * magnitude * TICK_COUNT;
}

export function CashFlowChart({ data }: CashFlowChartProps) {
  const [hovered, setHovered] = useState<CashFlowMonth | null>(null);
  const maxAxis = niceMax(Math.max(...data.flatMap((d) => [d.income, d.expense])));
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => (maxAxis / TICK_COUNT) * (TICK_COUNT - i));
  const isEmpty = data.every((d) => d.income === 0 && d.expense === 0);

  return (
    <section className="rounded-xl border border-border bg-card p-6" aria-labelledby="cash-flow-title">
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="cash-flow-title" className="text-title-md">Cash flow</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">Income and expenses, last {data.length} months</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
          <span className="flex items-center gap-2"><i className="size-2.5 rounded-sm bg-income" aria-hidden />Income</span>
          <span className="flex items-center gap-2"><i className="size-2.5 rounded-sm bg-expense" aria-hidden />Expenses</span>
        </div>
      </div>

      <div className="relative mt-6">
        <p className="mb-3 h-5 text-caption text-muted-foreground" role="status">
          {hovered
            ? `${formatMonthShort(hovered.month)}: ${formatINR(hovered.income)} income, ${formatINR(hovered.expense)} expenses`
            : isEmpty
              ? "No transactions recorded in this period yet."
              : null}
        </p>
        <div className="flex h-64 min-w-0">
          <div className="flex w-14 shrink-0 flex-col justify-between pr-3 text-right text-caption tabular-nums text-muted-foreground">
            {ticks.map((tick) => <span key={tick}>{formatINR(tick, { compact: true })}</span>)}
          </div>
          <div className="relative flex min-w-0 flex-1 flex-col justify-between">
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
              {ticks.map((tick) => <div key={tick} className="border-b border-dashed border-border" />)}
            </div>
            <div className="relative z-10 flex h-full items-end justify-around gap-2 px-2 sm:px-5">
              {data.map((item) => {
                const label = formatMonthShort(item.month);
                return (
                  <button
                    key={item.month}
                    type="button"
                    onFocus={() => setHovered(item)}
                    onBlur={() => setHovered(null)}
                    onMouseEnter={() => setHovered(item)}
                    onMouseLeave={() => setHovered(null)}
                    aria-label={`${label}: income ${formatINR(item.income)}, expenses ${formatINR(item.expense)}`}
                    className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <div className="flex h-52 items-end justify-center gap-1.5">
                      <span style={{ height: `${(item.income / maxAxis) * 100}%` }} className="w-3 rounded-t-sm bg-income transition-opacity group-hover:opacity-80 sm:w-6" />
                      <span style={{ height: `${(item.expense / maxAxis) * 100}%` }} className="w-3 rounded-t-sm bg-expense transition-opacity group-hover:opacity-80 sm:w-6" />
                    </div>
                    <span className="text-caption text-muted-foreground group-hover:text-foreground">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
