"use client";

import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatINR } from "@/lib/format";
import type { DeletedRow } from "@/lib/transactions/queries";
import { restoreWithToast } from "./restore-toast";

function RestoreButton({ row }: { row: DeletedRow }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => restoreWithToast(row.id, row.title))}
      aria-label={`Restore ${row.title}, ${formatDate(row.date)}`}
    >
      <RotateCcw aria-hidden />
      {pending ? "Restoring…" : "Restore"}
    </Button>
  );
}

/** Collapsed list of transactions deleted through the app in the last 30 days. */
export function RecentlyDeleted({ rows }: { rows: DeletedRow[] }) {
  if (rows.length === 0) return null;

  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-6 py-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <span>
          <span className="text-title-sm">Recently deleted</span>
          <span className="ml-2 text-caption text-muted-foreground">{rows.length} in the last 30 days</span>
        </span>
        <span className="text-caption text-muted-foreground group-open:hidden">Show</span>
        <span className="hidden text-caption text-muted-foreground group-open:inline">Hide</span>
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-3 px-6 py-3 @xl:flex-row @xl:items-center @xl:justify-between">
            <div className="min-w-0">
              <p className="truncate text-body-sm font-medium text-foreground">{row.title}</p>
              <p className="text-caption text-muted-foreground tabular-nums">
                {row.type === "income" ? "Income" : "Expense"} · {formatDate(row.date)} · {formatINR(row.amountInr)} · deleted{" "}
                {formatDate(row.deletedAt)}
              </p>
            </div>
            <RestoreButton row={row} />
          </li>
        ))}
      </ul>
    </details>
  );
}
