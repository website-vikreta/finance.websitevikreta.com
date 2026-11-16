"use client";

import { useState } from "react";
import { formatINR, formatMonthShort } from "@/lib/format";
import type { MonthTotals } from "@/lib/transactions/queries";
import { SERIES } from "./trend-series";

export type ChartType = "bar" | "line" | "area";

const TICKS = 4;

/** Round the axis top up to 1/2/5 × 10ⁿ so the tallest bar never touches the grid. */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const unit = value / power;
  const step = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return step * power;
}

function TrendTooltip({ row }: { row: MonthTotals }) {
  return (
    <div className="w-max rounded-lg border border-border bg-popover px-3 py-2 text-caption shadow-md">
      <p className="mb-1 font-medium text-foreground">
        {formatMonthShort(row.month)} {row.month.slice(0, 4)}
      </p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center justify-between gap-6 text-muted-foreground">
          <span className="flex items-center gap-2">
            <i className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.label}
          </span>
          <span className="font-mono tabular-nums text-foreground">{formatINR(row[s.key])}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Income vs expenses, hand-drawn: two series on a percentage scale. Bars use CSS,
 * line/area use an SVG stretched over the plot. No charting library, so the
 * dashboard ships ~286 KB less JavaScript and hydrates faster.
 */
export function TrendCanvas({ rows, type }: { rows: MonthTotals[]; type: ChartType }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = niceCeil(Math.max(...rows.flatMap((r) => [r.income, r.expense]), 0));
  const count = rows.length;

  const x = (i: number) => ((i + 0.5) / count) * 100;
  const y = (value: number) => 100 - (value / max) * 100;

  const paint = (key: (typeof SERIES)[number]["key"]) =>
    rows.map((r, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(r[key])}`).join(" ");

  return (
    <div className="relative flex h-full gap-2">
      {/* Y axis */}
      <div className="relative w-12 shrink-0" aria-hidden>
        {Array.from({ length: TICKS + 1 }, (_, i) => (
          <span
            key={i}
            className="absolute right-0 -translate-y-1/2 whitespace-nowrap text-micro tabular-nums text-muted-foreground"
            style={{ top: `${(1 - i / TICKS) * 100}%` }}
          >
            {formatINR((max / TICKS) * i, { compact: true })}
          </span>
        ))}
      </div>

      {/* Plot + X axis */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1" onMouseLeave={() => setHovered(null)}>
          {/* Horizontal grid */}
          {Array.from({ length: TICKS + 1 }, (_, i) => (
            <div
              key={i}
              className="absolute inset-x-0 border-t border-dashed border-border"
              style={{ top: `${(1 - i / TICKS) * 100}%` }}
              aria-hidden
            />
          ))}

          {type === "bar" ? (
            <div className="absolute inset-0 flex items-end justify-around">
              {rows.map((r) => (
                <div key={r.month} className="flex h-full flex-1 items-end justify-center gap-[2px]">
                  {SERIES.map((s) => (
                    <div
                      key={s.key}
                      className="w-[30%] max-w-[14px] rounded-t"
                      style={{ height: `${(r[s.key] / max) * 100}%`, background: s.color }}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <>
              <svg
                className="absolute inset-0 size-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
              >
                {type === "area" ? (
                  SERIES.map((s) => (
                    <path
                      key={`area-${s.key}`}
                      d={`${paint(s.key)} L${x(count - 1)},100 L${x(0)},100 Z`}
                      fill={s.color}
                      fillOpacity={0.12}
                    />
                  ))
                ) : null}
                {SERIES.map((s) => (
                  <path
                    key={`line-${s.key}`}
                    d={paint(s.key)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              {/* Dots stay round at every width */}
              {SERIES.map((s) =>
                rows.map((r, i) => (
                  <span
                    key={`${s.key}-${r.month}`}
                    className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ left: `${x(i)}%`, top: `${y(r[s.key])}%`, background: s.color }}
                    aria-hidden
                  />
                )),
              )}
            </>
          )}

          {/* Hover targets + tooltip */}
          <div className="absolute inset-0 flex">
            {rows.map((r, i) => (
              <div
                key={r.month}
                className="h-full flex-1"
                onMouseEnter={() => setHovered(i)}
                aria-hidden
              />
            ))}
          </div>
          {hovered !== null && rows[hovered] ? (
            <div
              className="pointer-events-none absolute top-0 z-20 -translate-x-1/2"
              style={{ left: `${x(hovered)}%` }}
            >
              <TrendTooltip row={rows[hovered]} />
            </div>
          ) : null}
        </div>

        {/* X axis */}
        <div className="mt-2 flex justify-around text-micro text-muted-foreground" aria-hidden>
          {rows.map((r) => (
            <span key={r.month} className="flex-1 text-center">
              {formatMonthShort(r.month)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
