"use client";

import { useState, useCallback } from "react";
import { formatINR, formatMonthShort } from "@/lib/format";
import { financialYearLabel } from "@/lib/transactions/period";
import { cn } from "@/lib/utils";
import type { MonthTotals } from "@/lib/transactions/queries";

/** Reports monthly table with a dynamic year dropdown. */
export function MonthlyTable({
  data,
  years,
  initialYear,
  selectedYear: controlledYear,
  onYearChange,
}: {
  data: MonthTotals[];
  years: number[];
  initialYear: number;
  selectedYear?: number;
  onYearChange?: (year: number, months: MonthTotals[]) => void;
}) {
  const [internalYear, setInternalYear] = useState(initialYear);
  const [internalData, setInternalData] = useState(data);

  const selectedYear = controlledYear ?? internalYear;
  const tableData = controlledYear !== undefined ? data : internalData;

  const handleYearChange = useCallback(async (year: number) => {
    if (controlledYear === undefined) setInternalYear(year);
    if (year === initialYear) {
      if (controlledYear === undefined) setInternalData(data);
      onYearChange?.(year, data);
      return;
    }
    const res = await fetch(`/api/reports/monthly?year=${year}`);
    const json = await res.json();
    if (controlledYear === undefined) setInternalData(json.months);
    onYearChange?.(year, json.months);
  }, [initialYear, data, controlledYear, onYearChange]);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <h2 className="text-title-md">Monthly summary</h2>
        <select
          id="reports-year-select"
          value={selectedYear}
          onChange={(e) => handleYearChange(Number(e.target.value))}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-caption font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {years.map((y) => <option key={y} value={y}>{financialYearLabel(y)}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-body-sm">
          <thead className="bg-muted/60">
            <tr className="text-caption text-muted-foreground">
              <th scope="col" className="px-6 py-3 text-left font-semibold">Month</th>
              <th scope="col" className="px-6 py-3 text-right font-semibold">Income</th>
              <th scope="col" className="px-6 py-3 text-right font-semibold">Expenses</th>
              <th scope="col" className="px-6 py-3 text-right font-semibold">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono tabular-nums">
            {[...tableData].reverse().map((m) => {
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
  );
}
