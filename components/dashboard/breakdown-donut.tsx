"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipContentProps, type TooltipValueType } from "recharts";
import { formatINR, formatShare } from "@/lib/format";
import type { Breakdown } from "@/lib/transactions/queries";

const SLOTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const OTHER = "var(--chart-other)";
/** A donut needs at least 3 parts to beat plain share bars. */
const MIN_SLICES = 3;

interface Slice {
  name: string;
  amount: number;
  color: string;
}

function toSlices(items: Breakdown[]): Slice[] {
  const top = items.slice(0, SLOTS.length).map((item, i) => ({ name: item.name, amount: item.amount, color: SLOTS[i] }));
  const rest = items.slice(SLOTS.length);
  if (rest.length === 0) return top;
  return [...top, { name: `Other (${rest.length})`, amount: rest.reduce((s, i) => s + i.amount, 0), color: OTHER }];
}

function SliceTooltip({ active, payload }: TooltipContentProps<TooltipValueType, string | number>) {
  const slice = active ? (payload?.[0]?.payload as (Slice & { total: number }) | undefined) : undefined;
  if (!slice) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-caption shadow-md">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <i className="size-2 rounded-full" style={{ background: slice.color }} aria-hidden />
        {slice.name}
      </p>
      <p className="mt-0.5 font-mono tabular-nums text-muted-foreground">
        {formatINR(slice.amount)} · {formatShare(slice.amount, slice.total)}
      </p>
    </div>
  );
}

interface BreakdownDonutProps {
  title: string;
  items: Breakdown[];
  empty: string;
}

/** Part-to-whole at a glance: top 5 + "Other" as a donut, with a value legend that doubles as the table view. */
export function BreakdownDonut({ title, items, empty }: BreakdownDonutProps) {
  const slices = toSlices(items);
  const total = slices.reduce((s, x) => s + x.amount, 0);
  const data = slices.map((s) => ({ ...s, total }));
  const asDonut = slices.length >= MIN_SLICES;

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card p-6">
      <h2 className="text-title-md">{title}</h2>

      {slices.length === 0 ? (
        <p className="mt-4 text-body-sm text-muted-foreground">{empty}</p>
      ) : (
        <>
          {asDonut ? (
            <div className="relative mx-auto mt-4 size-44" role="img" aria-label={`${title}: ${formatINR(total)} total`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="amount" nameKey="name" innerRadius="64%" outerRadius="100%" stroke="var(--card)" strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
                    {data.map((s) => (
                      <Cell key={s.name} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip content={SliceTooltip} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div>
                  <p className="font-mono text-title-sm tabular-nums text-foreground">{formatINR(total, { compact: true })}</p>
                  <p className="text-micro text-muted-foreground">total</p>
                </div>
              </div>
            </div>
          ) : null}

          <ul className={asDonut ? "mt-5 space-y-2" : "mt-4 space-y-3"}>
            {slices.map((s) => (
              <li key={s.name} className="text-body-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-foreground">
                    <i className="size-2.5 shrink-0 rounded-sm" style={{ background: asDonut ? s.color : "var(--income)" }} aria-hidden />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-foreground">
                    {formatINR(s.amount)} <span className="text-muted-foreground">· {formatShare(s.amount, total)}</span>
                  </span>
                </div>
                {asDonut ? null : (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-income" style={{ width: `${(s.amount / total) * 100}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
