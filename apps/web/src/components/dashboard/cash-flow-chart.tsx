"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { formatINR } from "@/lib/format";
import type { CashFlowMonth } from "@/lib/mock-data";

interface CashFlowChartProps {
  data: CashFlowMonth[];
}

const maxAxis = 10_00_000;
const ticks = [
  { label: "₹10L", value: 10_00_000 },
  { label: "₹7.5L", value: 7_50_000 },
  { label: "₹5L", value: 5_00_000 },
  { label: "₹2.5L", value: 2_50_000 },
  { label: "₹0", value: 0 },
];

export function CashFlowChart({ data }: CashFlowChartProps) {
  const [hoveredMonth, setHoveredMonth] = useState<CashFlowMonth | null>(null);

  return (
    <section className="rounded-xl border border-border bg-card p-6" aria-labelledby="cash-flow-title">
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="cash-flow-title" className="text-title-md">Cash flow</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">Income and expenses, last 6 months</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
          <span className="flex items-center gap-2"><i className="size-2.5 rounded-sm bg-income" aria-hidden />Income</span>
          <span className="flex items-center gap-2"><i className="size-2.5 rounded-sm bg-surface-elevated" aria-hidden />Expenses</span>
          <button type="button" className="flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            6 months
            <ChevronDown className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="relative mt-6">
        {hoveredMonth ? (
          <p className="mb-3 text-caption text-muted-foreground" role="status">
            {hoveredMonth.month}: {formatINR(hoveredMonth.income)} income, {formatINR(hoveredMonth.expense)} expenses
          </p>
        ) : null}
        <div className="flex h-64 min-w-0">
          <div className="flex w-12 shrink-0 flex-col justify-between pr-3 text-right text-caption text-muted-foreground">
            {ticks.map((tick) => <span key={tick.value}>{tick.label}</span>)}
          </div>
          <div className="relative flex min-w-0 flex-1 flex-col justify-between">
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
              {ticks.map((tick) => <div key={tick.value} className="border-b border-dashed border-border" />)}
            </div>
            <div className="relative z-10 flex h-full items-end justify-around gap-2 px-2 sm:px-5">
              {data.map((item) => {
                const incomeHeight = Math.min(100, (item.income / maxAxis) * 100);
                const expenseHeight = Math.min(100, (item.expense / maxAxis) * 100);
                return (
                  <button
                    key={item.month}
                    type="button"
                    onFocus={() => setHoveredMonth(item)}
                    onBlur={() => setHoveredMonth(null)}
                    onMouseEnter={() => setHoveredMonth(item)}
                    onMouseLeave={() => setHoveredMonth(null)}
                    aria-label={`${item.month}: income ${formatINR(item.income)}, expenses ${formatINR(item.expense)}`}
                    className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <div className="flex h-52 items-end justify-center gap-1.5">
                      <span style={{ height: `${incomeHeight}%` }} className="w-3 rounded-t-sm bg-income transition-opacity group-hover:opacity-80 sm:w-6" />
                      <span style={{ height: `${expenseHeight}%` }} className="w-3 rounded-t-sm bg-surface-elevated transition-opacity group-hover:opacity-80 sm:w-6" />
                    </div>
                    <span className="text-caption text-muted-foreground group-hover:text-foreground">{item.month}</span>
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
