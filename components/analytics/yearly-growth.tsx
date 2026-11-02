"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from "recharts";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { yearlyGrowthCellSub, yearlyGrowthCellText, yearlyGrowthCellTone, type YearlyData } from "@/lib/analytics/yearly";

const SERIES = [
  { key: "income", label: "Money in", color: "var(--income)" },
  { key: "expense", label: "Money out", color: "var(--expense)" },
] as const;

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };

/** Hover detail for one financial year: money in/out from the plotted series plus the year's
 *  net profit read from the datum (each Bar payload only carries its own key). */
function YearlyTooltip({ active, payload, label }: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as { income?: number; expense?: number; profit?: number } | undefined;
  if (!row) return null;
  const income = Number(row.income ?? 0);
  const expense = Number(row.expense ?? 0);
  const profit = Number(row.profit ?? income - expense);
  return (
    <div className="w-max rounded-lg border border-border bg-popover px-3 py-2 text-caption shadow-md">
      <p className="mb-1 font-medium text-foreground">{String(label ?? "")}</p>
      {SERIES.map((s) => {
        const value = s.key === "income" ? income : expense;
        return (
          <p key={s.key} className="flex items-center justify-between gap-6 text-muted-foreground">
            <span className="flex items-center gap-2">
              <i className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
            <span className="font-mono tabular-nums text-foreground">{formatINR(value)}</span>
          </p>
        );
      })}
      <p className="mt-1 flex items-center justify-between gap-6 border-t border-border pt-1">
        <span className="flex items-center gap-2 text-foreground">
          <i className="size-2 rounded-full bg-foreground" aria-hidden />
          Net profit
        </span>
        <span className={cn("font-mono tabular-nums", profit < 0 && "text-destructive", profit > 0 && "text-success")}>{formatINR(profit)}</span>
      </p>
    </div>
  );
}

/** "Yearly growth" — every financial year on record (April–March): money in/out per year on the
 *  chart, per-year totals, margin and profit growth in the table. Each year — the running one
 *  included — is compared with the FULL previous financial year (Apr 1 – Mar 31). */
export function YearlyGrowth({ yearly }: { yearly: YearlyData | null }) {
  const hasData = yearly !== null && yearly.rows.length > 0;
  const chartRows = yearly === null ? [] : yearly.rows.map((r) => ({ label: r.label, income: r.income, expense: r.expense, profit: r.profit }));
  const chartEmpty = chartRows.every((r) => r.income === 0 && r.expense === 0);
  // Newest year first for the table; the chart reads the history left to right (oldest → newest).
  const tableRows = yearly === null ? [] : [...yearly.rows].reverse();

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-6" aria-labelledby="analytics-yearly-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="analytics-yearly-title" className="text-title-md">Yearly growth</h2>
        <div className="flex items-center gap-4 text-caption text-muted-foreground">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-2">
              <i className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-1 text-caption text-muted-foreground">
        Every financial year on record, April–March. Growth compares each year with the full previous financial year.
      </p>

      {!hasData || chartEmpty ? (
        <p className="mt-6 text-body-sm text-muted-foreground">No transactions on record yet.</p>
      ) : (
        <>
          <div className="mt-5 h-64" role="img" aria-label="Money in and money out per financial year, April to March">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="32%">
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
                <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v: number) => formatINR(v, { compact: true })} tick={axisTick} axisLine={false} tickLine={false} width={56} />
                <Tooltip content={YearlyTooltip} wrapperStyle={{ zIndex: 20 }} cursor={{ fill: "var(--muted)" }} />
                {SERIES.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={40} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-body-sm">
              <thead>
                <tr className="text-caption text-muted-foreground">
                  <th scope="col" className="pb-2 text-left font-semibold">Financial year</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Money in</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Money out</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Net profit</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Margin</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Profit growth</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Entries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tableRows.map((r) => {
                  const tone = yearlyGrowthCellTone(r.profitGrowth);
                  const growthSub = yearlyGrowthCellSub(r.profitGrowth);
                  const growthTitle =
                    r.prevLabel === null
                      ? "No financial year directly before this one on record"
                      : `vs FY ${r.prevLabel}, full April–March totals`;
                  return (
                    <tr key={r.fyStart} className="transition-colors hover:bg-accent/40">
                      <td className="whitespace-nowrap py-2 text-foreground">{r.label}</td>
                      <td className="whitespace-nowrap py-2 text-right font-mono tabular-nums text-foreground">{formatINR(r.income)}</td>
                      <td className="whitespace-nowrap py-2 text-right font-mono tabular-nums text-foreground">{formatINR(r.expense)}</td>
                      <td className={cn("whitespace-nowrap py-2 text-right font-mono tabular-nums", r.profit < 0 ? "text-destructive" : "text-foreground")}>{formatINR(r.profit)}</td>
                      <td className="whitespace-nowrap py-2 text-right font-mono tabular-nums text-muted-foreground">{r.margin === null ? "—" : `${r.margin.toFixed(1)}%`}</td>
                      <td
                        title={growthTitle}
                        className={cn(
                          "whitespace-nowrap py-2 text-right font-mono tabular-nums",
                          tone === "good" && "text-success",
                          tone === "bad" && "text-destructive",
                          tone === "neutral" && "text-muted-foreground",
                        )}
                      >
                        {yearlyGrowthCellText(r.profitGrowth)}
                        {growthSub !== null ? (
                          <span className="block font-sans text-micro text-muted-foreground">{growthSub}</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right font-mono tabular-nums text-muted-foreground">{r.entries}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
