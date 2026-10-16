"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatINR, formatTime } from "@/lib/format";
import type { LedgerRow } from "@/lib/transactions/queries";
import { cn } from "@/lib/utils";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

interface TransactionDetailsDialogProps {
  row: LedgerRow | null;
  sourceLabel: (source: string) => string;
  onOpenChange: (open: boolean) => void;
  onEdit: (row: LedgerRow) => void;
  onDelete: (row: LedgerRow) => void;
}

/** Narrow screens show only name + amount per row; everything else lives here. */
export function TransactionDetailsDialog({ row, sourceLabel, onOpenChange, onEdit, onDelete }: TransactionDetailsDialogProps) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-title-md break-words">{row.title}</DialogTitle>
            </DialogHeader>
            <p className={cn("font-mono text-title-lg font-semibold tabular-nums", row.type === "income" ? "text-success" : "text-foreground")}>
              {row.type === "income" ? "+" : "−"}
              {formatINR(row.amountInr, { decimals: row.amountInr % 1 === 0 ? 0 : 2 })}
            </p>
            <dl className="divide-y divide-border text-body-sm">
              <Detail label="Date">{formatDate(row.date)}</Detail>
              <Detail label="Entered at">{formatTime(row.time)}</Detail>
              <Detail label="Type">{row.type === "income" ? "Income" : "Expense"}</Detail>
              {row.type === "expense" && row.category ? <Detail label="Category">{row.category}</Detail> : null}
              {row.type === "expense" && row.clientName ? <Detail label="Client">{row.clientName}</Detail> : null}
              {row.bill ? (
                <Detail label="Bill">
                  <Link href={`/transactions/recurring/${row.bill.id}`} className="underline underline-offset-4">
                    {row.bill.name}
                  </Link>
                </Detail>
              ) : null}
              {row.type === "income" && row.detail ? <Detail label="For">{row.detail}</Detail> : null}
              {row.originalCurrency === "USD" ? (
                <Detail label="Original">
                  {usd.format(row.originalAmount)} @ ₹{row.exchangeRate}
                </Detail>
              ) : null}
              <Detail label="Source">{sourceLabel(row.source)}</Detail>
            </dl>
            <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
              <Button variant="outline" onClick={() => onDelete(row)} className="text-destructive hover:text-destructive">
                <Trash2 aria-hidden />
                Delete
              </Button>
              <Button onClick={() => onEdit(row)}>
                <Pencil aria-hidden />
                Edit
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground tabular-nums">{children}</dd>
    </div>
  );
}
