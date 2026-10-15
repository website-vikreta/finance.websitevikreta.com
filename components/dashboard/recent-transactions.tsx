import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatDate, formatINR } from "@/lib/format";
import type { LedgerRow } from "@/lib/transactions/queries";
import { cn } from "@/lib/utils";

export function RecentTransactions({ rows }: { rows: LedgerRow[] }) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-title-md">Recent transactions</h2>
        <Link href="/transactions" className="text-caption font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          View all
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-body-sm text-muted-foreground">No transactions yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((row) => {
            const isIncome = row.type === "income";
            return (
              <li key={row.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full",
                    isIncome ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {isIncome ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm font-medium text-foreground">{row.title}</p>
                  <p className="text-caption text-muted-foreground">{formatDate(row.date)}</p>
                </div>
                <p className={cn("shrink-0 font-mono text-body-sm font-semibold tabular-nums", isIncome ? "text-success" : "text-foreground")}>
                  {isIncome ? "+" : "−"}
                  {formatINR(row.amountInr, { decimals: row.amountInr % 1 === 0 ? 0 : 2 })}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
