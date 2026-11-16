"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { dueText, leftText, money, toBill } from "@/components/transactions/recurring-display";
import type { BillToLog } from "@/components/transactions/transaction-form-dialog";
import { daysUntil } from "@/lib/transactions/recurring-dates";
import type { RecurringRow } from "@/lib/transactions/recurring";
import { cn } from "@/lib/utils";

// The full transaction form is a large dialog; load it on the first "Mark paid" click.
const TransactionFormDialog = dynamic(
  () => import("@/components/transactions/transaction-form-dialog").then((m) => m.TransactionFormDialog),
  { ssr: false },
);

const WINDOW_DAYS = 35;
const MAX_ROWS = 5;

/** Active bills due within WINDOW_DAYS (overdue first); "Mark paid" opens a prefilled confirm form. */
export function UpcomingBills({ rows, today }: { rows: RecurringRow[]; today: string }) {
  const [logging, setLogging] = useState<BillToLog | null>(null);
  const [formMounted, setFormMounted] = useState(false);
  const due = rows.filter((r) => r.isActive && daysUntil(r.nextDue, today) <= WINDOW_DAYS);

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-title-md">Upcoming bills</h2>
        <Link href="/transactions?view=recurring" className="text-caption font-medium text-foreground hover:underline">
          View all
        </Link>
      </div>
      {due.length === 0 ? (
        <p className="mt-4 text-body-sm text-muted-foreground">No bills due in the next {WINDOW_DAYS} days.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {due.slice(0, MAX_ROWS).map((r) => {
            const d = dueText(r.nextDue, today);
            return (
              <li key={r.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/transactions/recurring/${r.id}`} className="block max-w-full truncate text-body-sm font-medium text-foreground underline-offset-4 hover:underline">
                    {r.description}
                  </Link>
                  <p className={cn("text-caption", d.overdue ? "text-destructive" : "text-muted-foreground")}>{[leftText(r), d.text].filter(Boolean).join(" · ")}</p>
                </div>
                <p className="shrink-0 font-mono text-body-sm font-semibold tabular-nums">{money(r)}</p>
                <Button size="sm" variant="outline" onClick={() => { setFormMounted(true); setLogging(toBill(r)); }}>
                  Mark paid
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {formMounted && (
        <TransactionFormDialog open={logging !== null} onOpenChange={(o) => !o && setLogging(null)} bill={logging} />
      )}
    </section>
  );
}
