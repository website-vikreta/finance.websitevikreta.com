"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Pause, Pencil, Play, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { setRecurringActiveAction, stopRecurringAction } from "@/app/transactions/actions";
import { formatDate, formatINR } from "@/lib/format";
import { daysUntil, remaining } from "@/lib/transactions/recurring-dates";
import type { FinishedBill, RecurringRow } from "@/lib/transactions/recurring";
import { cn } from "@/lib/utils";
import { EditBillDialog } from "./edit-bill-dialog";
import { TransactionFormDialog, type BillToLog } from "./transaction-form-dialog";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const money = (r: Pick<RecurringRow, "amount" | "currency">) =>
  r.currency === "USD" ? usd.format(r.amount) : formatINR(r.amount, { decimals: r.amount % 1 === 0 ? 0 : 2 });

/** "Due today", "Due in 3 days", "Overdue by 2 days", or the date when further out. */
export function dueText(due: string, today: string): { text: string; overdue: boolean } {
  const d = daysUntil(due, today);
  if (d < 0) return { text: `Overdue by ${-d} day${d === -1 ? "" : "s"}`, overdue: true };
  if (d === 0) return { text: "Due today", overdue: false };
  if (d <= 7) return { text: `Due in ${d} day${d === 1 ? "" : "s"}`, overdue: false };
  return { text: `Due ${formatDate(due)}`, overdue: false };
}

export const toBill = (r: RecurringRow): BillToLog => ({
  id: r.id,
  due: r.nextDue,
  description: r.description,
  category: r.category,
  amount: remaining(r),
  fullAmount: r.amount,
  currency: r.currency,
  client: r.clientName,
});

/** "₹58,000 left" once part of the current bill is paid. */
export const leftText = (r: RecurringRow) => (r.paid > 0 ? `${money({ amount: remaining(r), currency: r.currency })} left` : null);

export function RecurringList({ rows, finished, today }: { rows: RecurringRow[]; finished: FinishedBill[]; today: string }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecurringRow | null>(null);
  const [logging, setLogging] = useState<BillToLog | null>(null);
  const [stopping, setStopping] = useState<RecurringRow | null>(null);
  const [pending, startTransition] = useTransition();

  const active = rows.filter((r) => r.isActive);
  const inrPerMonth = active.filter((r) => r.currency === "INR").reduce((s, r) => s + r.amount, 0);
  const usdPerMonth = active.filter((r) => r.currency === "USD").reduce((s, r) => s + r.amount, 0);

  const toggle = (r: RecurringRow) =>
    startTransition(async () => {
      const res = await setRecurringActiveAction(r.id, !r.isActive);
      if (!res.ok) toast.error(res.error);
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 @xl:flex-row @xl:items-center @xl:justify-between">
        <div>
          <p className="text-caption text-muted-foreground">Fixed costs per month</p>
          <p className="font-mono text-title-lg font-semibold tabular-nums">
            {formatINR(Math.round(inrPerMonth))}
            {usdPerMonth > 0 ? <span className="text-body-sm text-muted-foreground"> + {usd.format(usdPerMonth)}</span> : null}
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Add bill
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <p className="px-4 py-14 text-center text-body-sm text-muted-foreground">No recurring bills yet. Add rent, subscriptions or salaries to see what&apos;s due.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const due = dueText(r.nextDue, today);
              return (
                <li key={r.id} className={cn("flex flex-col gap-3 px-4 py-3.5 @xl:flex-row @xl:items-center", !r.isActive && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <Link href={`/transactions/recurring/${r.id}`} className="block max-w-full truncate font-medium text-foreground underline-offset-4 hover:underline">
                      {r.description}
                    </Link>
                    <p className="truncate text-caption text-muted-foreground">
                      {r.category} · Monthly{r.clientName ? ` · ${r.clientName}` : ""}{r.endDate ? ` · Until ${formatDate(r.endDate)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 @xl:justify-end">
                    <div className="text-left @xl:text-right">
                      <p className="font-mono font-semibold tabular-nums">{money(r)}</p>
                      <p className={cn("text-caption", r.isActive && due.overdue ? "text-destructive" : "text-muted-foreground")}>
                        {r.isActive ? [leftText(r), due.text].filter(Boolean).join(" · ") : "Paused"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {r.isActive ? (
                        <Button size="sm" onClick={() => setLogging(toBill(r))} disabled={pending}>
                          Mark paid
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.description}`} onClick={() => setEditing(r)} disabled={pending} className="text-muted-foreground">
                        <Pencil aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`${r.isActive ? "Pause" : "Resume"} ${r.description}`} onClick={() => toggle(r)} disabled={pending} className="text-muted-foreground">
                        {r.isActive ? <Pause aria-hidden /> : <Play aria-hidden />}
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Stop ${r.description}`} onClick={() => setStopping(r)} disabled={pending} className="text-muted-foreground hover:text-destructive">
                        <X aria-hidden />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {finished.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-title-sm text-muted-foreground">Finished</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {finished.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-4 py-3 text-muted-foreground">
                <div className="min-w-0 flex-1">
                  <Link href={`/transactions/recurring/${f.id}`} className="block max-w-full truncate font-medium underline-offset-4 hover:underline">
                    {f.description}
                  </Link>
                  <p className="truncate text-caption">
                    {[f.category, f.clientName, `Ended ${formatDate(f.endDate)}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <p className="shrink-0 font-mono tabular-nums">{money(f)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <TransactionFormDialog open={adding} onOpenChange={setAdding} newBill />
      <EditBillDialog bill={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <TransactionFormDialog open={logging !== null} onOpenChange={(o) => !o && setLogging(null)} bill={logging} />
      <StopBillDialog row={stopping} onOpenChange={(o) => !o && setStopping(null)} />
    </div>
  );
}

function StopBillDialog({ row, onOpenChange }: { row: RecurringRow | null; onOpenChange: (open: boolean) => void }) {
  const [pending, startTransition] = useTransition();
  const stop = () =>
    row &&
    startTransition(async () => {
      const res = await stopRecurringAction(row.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onOpenChange(false);
    });
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-title-md">Stop {row.description}?</DialogTitle>
              <DialogDescription>It won&apos;t show as due any more. Payments already saved stay in the ledger.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Keep
              </Button>
              <Button variant="destructive" onClick={stop} disabled={pending}>
                {pending ? "Stopping…" : "Stop"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
