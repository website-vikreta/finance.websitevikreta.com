"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportPdfButton } from "@/components/layout/export-pdf-button";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { PERIODS, type Period } from "@/lib/transactions/period";
import { toReportCsv } from "@/lib/reports/csv";
import type { Breakdown, LedgerRow, MonthTotals } from "@/lib/transactions/queries";
import { PrintReport } from "@/components/reports/print-report";
import { StatTile } from "@/components/layout/stat-tile";
import { MonthlyTable } from "@/components/reports/monthly-table";
import { formatINR, formatShare } from "@/lib/format";
import { cn } from "@/lib/utils";

function BreakdownCard({
  title,
  items,
  empty,
  barClass,
}: {
  title: string;
  items: Breakdown[];
  empty: string;
  barClass: string;
}) {
  const total = items.reduce((s, i) => s + i.amount, 0);

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-title-md">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-4 text-body-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-5 space-y-4">
          {items.map((item) => {
            const share = total > 0 ? (item.amount / total) * 100 : 0;
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

interface ReportsViewProps {
  period: Period;
  periodLabel: string;
  from: string | null;
  today: string;
  generatedAt: string;
  income: Breakdown[];
  expenses: Breakdown[];
  yearMonths: MonthTotals[];
  years: number[];
  latestYear: number;
  rows: LedgerRow[];
}

export function ReportsView({
  period,
  periodLabel,
  from,
  today,
  generatedAt,
  income,
  expenses,
  yearMonths: initialYearMonths,
  years,
  latestYear,
  rows,
}: ReportsViewProps) {
  const [selectedYear, setSelectedYear] = useState(latestYear);
  const [currentYearMonths, setCurrentYearMonths] = useState(initialYearMonths);

  const totalIn = income.reduce((s, i) => s + i.amount, 0);
  const totalOut = expenses.reduce((s, i) => s + i.amount, 0);
  const net = totalIn - totalOut;
  const margin = totalIn > 0 ? `${((net / totalIn) * 100).toFixed(1)}% margin` : "No income in this period";

  const handleYearChange = useCallback((year: number, newMonths: MonthTotals[]) => {
    setSelectedYear(year);
    setCurrentYearMonths(newMonths);
  }, []);

  const exportCsv = () => {
    const csv = toReportCsv({
      periodLabel,
      from,
      today,
      generatedAt,
      income,
      expenses,
      months: currentYearMonths,
      selectedYear,
      rows,
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `finance-report-${period}-${today}.csv`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PrintReport
        periodLabel={periodLabel}
        from={from}
        today={today}
        generatedAt={generatedAt}
        income={income}
        expenses={expenses}
        months={currentYearMonths}
        rows={rows}
      />

      <div className="flex flex-col gap-3 print:hidden @xl:flex-row @xl:items-center @xl:justify-between">
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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={exportCsv}
            aria-label="Export CSV"
          >
            <Download aria-hidden />
            <span className="hidden @md:inline">Export CSV</span>
          </Button>
          <ExportPdfButton fileName={`Finance report - ${periodLabel} - ${today}`} />
        </div>
      </div>

      <div className="space-y-6 print:hidden">
        <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-3">
          <StatTile label="Income" value={formatINR(totalIn)} note={`${income.reduce((s, i) => s + i.count, 0)} payments`} />
          <StatTile label="Expenses" value={formatINR(totalOut)} note={`${expenses.reduce((s, i) => s + i.count, 0)} entries`} />
          <StatTile label="Net profit" value={formatINR(net)} note={margin} />
        </div>

        <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
          <BreakdownCard title="Income by client" items={income} empty="No income recorded in this period." barClass="bg-income" />
          <BreakdownCard title="Expenses by category" items={expenses} empty="No expenses recorded in this period." barClass="bg-expense" />
        </div>

        <MonthlyTable
          data={currentYearMonths}
          years={years}
          initialYear={latestYear}
          selectedYear={selectedYear}
          onYearChange={handleYearChange}
        />
      </div>
    </>
  );
}
