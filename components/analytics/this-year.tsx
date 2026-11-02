import type { CSSProperties } from "react";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ThisYearData, ThisYearMonthCell } from "@/lib/analytics/this-year";

/** Colour + depth for one strip cell, straight from design tokens. Future months stay
 *  hollow (dashed outline); flat months sit on a muted block; kept months go success-green
 *  and lost months red, with |net| relative to the year's biggest move as the depth. */
function stripStyle(cell: ThisYearMonthCell): CSSProperties | undefined {
  if (cell.state === "future") return undefined;
  if (cell.net === 0) return { background: "var(--muted)", opacity: 0.6 };
  return {
    background: cell.net > 0 ? "var(--success)" : "var(--destructive)",
    opacity: 0.35 + 0.6 * (cell.intensity ?? 0),
  };
}

/** The four behaviour stats under the story line — pace, milestone, rhythm, last money. */
function ThisYearStats({ thisYear }: { thisYear: ThisYearData }) {
  const toYear = thisYear.fy.to.slice(0, 4);
  const milestone = thisYear.milestone;
  const rhythm = thisYear.rhythm;

  return (
    <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 @4xl:grid-cols-4">
      {/* At this pace — the year-to-date day-rates, projected to full-year. Never a promise. */}
      <div>
        <p className="text-caption text-muted-foreground">At this pace</p>
        <p className="mt-1 font-mono text-title-sm font-medium tabular-nums text-foreground">
          {thisYear.pace === null ? "—" : formatINR(thisYear.pace.income, { compact: true })}
        </p>
        {thisYear.pace === null ? (
          <p className="mt-1 text-micro text-muted-foreground">no money recorded yet</p>
        ) : (
          <>
            <p className="mt-1 text-micro text-muted-foreground">projected money in by 31 Mar {toYear}</p>
            <p className="mt-0.5 text-micro text-muted-foreground">
              {formatINR(thisYear.pace.dailyIncome)} in · {formatINR(thisYear.pace.dailyExpense)} out a day
            </p>
          </>
        )}
      </div>

      {/* Milestone — income so far vs the previous FY's FULL year. 100%+ clears it. */}
      <div className="@2xl:border-l @2xl:border-border @2xl:pl-5">
        <p className="text-caption text-muted-foreground">Milestone</p>
        {milestone === null || milestone.pct === null ? (
          <>
            <p className="mt-1 font-mono text-title-sm font-medium tabular-nums text-foreground">—</p>
            <p className="mt-1 text-micro text-muted-foreground">
              {milestone === null ? "no previous year on record" : `FY ${milestone.prevLabel} had no income to clear`}
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 font-mono text-title-sm font-medium tabular-nums text-foreground">
              {Math.round(milestone.pct).toLocaleString("en-IN")}%
            </p>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, milestone.pct)}%` }} />
            </div>
            <p className="mt-1 text-micro text-muted-foreground">
              {milestone.passed
                ? `crossed FY ${milestone.prevLabel}'s full-year income`
                : `of FY ${milestone.prevLabel}'s full-year income`}
            </p>
          </>
        )}
      </div>

      {/* Profit rhythm — of the months gone by, how many kept money, and the strongest one. */}
      <div className="@2xl:border-l @2xl:border-border @2xl:pl-5">
        <p className="text-caption text-muted-foreground">Profit rhythm</p>
        <p className="mt-1 font-mono text-title-sm font-medium tabular-nums text-foreground">{rhythm.count}</p>
        <p className="mt-1 text-micro text-muted-foreground">
          of {rhythm.total} months so far kept money
        </p>
        <p className="mt-0.5 text-micro text-muted-foreground">
          {rhythm.best === null
            ? "no profitable month yet"
            : `best ${rhythm.best.label} · ${formatINR(rhythm.best.net, { compact: true })} net`}
        </p>
      </div>

      {/* Last money in — the freshest income the ledger holds, however far back. */}
      <div className="@2xl:border-l @2xl:border-border @2xl:pl-5">
        <p className="text-caption text-muted-foreground">Last money in</p>
        <p className="mt-1 text-title-sm font-medium text-foreground">
          {thisYear.lastIncome === null
            ? "—"
            : thisYear.lastIncome.daysAgo === 0
              ? "today"
              : thisYear.lastIncome.daysAgo === 1
                ? "yesterday"
                : `${thisYear.lastIncome.daysAgo} days ago`}
        </p>
        <p className="mt-1 text-micro text-muted-foreground">
          {thisYear.lastIncome === null
            ? "no income recorded yet"
            : formatDate(thisYear.lastIncome.date)}
        </p>
      </div>
    </div>
  );
}

/** "This year" — the current financial year's behaviour, as a quiet hero: what the year has
 *  earned and kept, one line of plain story, four behaviour stats, and a 12-month net strip
 *  (April → March) that doubles as a rhythm picture. Server component; tooltips are native. */
export function ThisYear({ thisYear }: { thisYear: ThisYearData | null }) {
  if (thisYear === null) return null;
  const fromYear = thisYear.fy.from.slice(0, 4);
  const toYear = thisYear.fy.to.slice(0, 4);
  const daysLeft = thisYear.daysIn - thisYear.daysUsed;

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-6" aria-labelledby="analytics-this-year-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="analytics-this-year-title" className="text-title-md">This year</h2>
          <span
            className="rounded-full bg-primary px-2.5 py-1 font-mono text-micro font-semibold text-primary-foreground"
            title={`1 April ${fromYear} – 31 March ${toYear}`}
          >
            {thisYear.label}
          </span>
        </div>
        <p className="text-caption text-muted-foreground">
          Day {thisYear.daysUsed} of {thisYear.daysIn}
          {daysLeft === 0 ? " · the year closes today" : ` · ${daysLeft} days to go`}
        </p>
      </div>

      {thisYear.story === null ? (
        <p className="mt-4 max-w-3xl text-body-sm text-muted-foreground">No money recorded since 1 April yet.</p>
      ) : (
        <p className="mt-4 max-w-3xl text-body-sm text-foreground">{thisYear.story}</p>
      )}

      <ThisYearStats thisYear={thisYear} />

      {/* The year at a glance: one cell per month, colour = kept or lost, depth = how much. */}
      <div className="mt-7 border-t border-border pt-5">
        <p className="text-caption text-muted-foreground">The year at a glance — each month&apos;s net (money in − out)</p>
        <div
          role="img"
          aria-label={`Money strip, April ${fromYear} to March ${toYear}: one cell per month, colour shows whether the month kept money, depth shows how big the movement was`}
          className="mt-2 grid grid-cols-12 gap-1.5"
        >
          {thisYear.strip.map((cell) => (
            <div key={cell.month} className="flex min-w-0 flex-col items-center gap-1.5">
              <div
                title={cell.title}
                className={cn(
                  "h-5 w-full rounded-sm",
                  cell.state === "future" && "border border-dashed border-border",
                  cell.state === "current" && "ring-1 ring-foreground/40 ring-offset-1 ring-offset-card",
                )}
                style={stripStyle(cell)}
              />
              <span
                className={cn(
                  "hidden text-micro leading-none @2xl:block",
                  cell.state === "current" ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {cell.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
