"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { createTransactionAction, updateTransactionAction } from "@/app/transactions/actions";
import { convertUsdToInrDecimal } from "@/lib/currency/precision";
import { formatINR } from "@/lib/format";
import type { LedgerRow } from "@/lib/transactions/queries";
import { todayInIndia } from "@/lib/transactions/period";

type TxnType = "income" | "expense";
type Currency = "INR" | "USD";

interface TransactionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this row; omit to create a new transaction. */
  row?: LedgerRow | null;
}

/** INR the server will save, using the same half-even conversion. Null while input is incomplete. */
function previewInr(amount: string, rate: string): number | null {
  try {
    return Number(convertUsdToInrDecimal(amount.trim(), rate.trim()));
  } catch {
    return null;
  }
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className={segmentedTrack}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={segmentedItem(value === v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Form({ row, onDone }: { row?: LedgerRow | null; onDone: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<TxnType>(row?.type ?? "expense");
  const [currency, setCurrency] = useState<Currency>(row?.originalCurrency ?? "INR");
  const [amount, setAmount] = useState(row ? String(row.originalAmount) : "");
  const [rate, setRate] = useState(row?.exchangeRate ? String(row.exchangeRate) : "");
  const [client, setClient] = useState(row?.type === "income" ? row.title : "");
  const [description, setDescription] = useState(row?.type === "expense" ? row.title : "");
  const [date, setDate] = useState(row?.date ?? todayInIndia());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const inr = currency === "USD" ? previewInr(amount, rate) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input = {
      type,
      currency,
      amount: Number(amount),
      rate: currency === "USD" ? Number(rate) : null,
      client: type === "income" ? client : null,
      description: type === "expense" ? description : null,
      date,
    };
    startTransition(async () => {
      const result = row ? await updateTransactionAction(row.id, input) : await createTransactionAction(input, requestId);
      if (!result.ok) return setError(result.error);
      const label = type === "income" ? client.trim() : description.trim();
      toast.success(row ? `Saved changes to ${label}` : `Added ${label}`);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="text-title-md">{row ? "Edit transaction" : "Add transaction"}</DialogTitle>
      </DialogHeader>

      <Choice label="Type" value={type} onChange={setType} options={[["income", "Money in"], ["expense", "Money out"]]} />

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="txn-amount">Amount</Label>
          <Input id="txn-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <Choice label="Currency" value={currency} onChange={setCurrency} options={[["INR", "INR"], ["USD", "USD"]]} />
      </div>

      {currency === "USD" ? (
        <div className="grid gap-2">
          <Label htmlFor="txn-rate">Rate (₹ per $1)</Label>
          <Input id="txn-rate" inputMode="decimal" autoComplete="off" placeholder="88.50" value={rate} onChange={(e) => setRate(e.target.value)} required />
          <p className="text-caption text-muted-foreground tabular-nums" aria-live="polite">
            {inr !== null ? `Saves as ${formatINR(inr, { decimals: inr % 1 === 0 ? 0 : 2 })}` : "Max 2 decimals for amount, 4 for rate."}
          </p>
        </div>
      ) : null}

      {type === "income" ? (
        <div className="grid gap-2">
          <Label htmlFor="txn-client">Client</Label>
          <Input id="txn-client" autoComplete="off" maxLength={200} placeholder="Who paid?" value={client} onChange={(e) => setClient(e.target.value)} required />
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="txn-description">What was it for?</Label>
          <Input id="txn-description" autoComplete="off" maxLength={200} placeholder="Office rent" value={description} onChange={(e) => setDescription(e.target.value)} required />
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="txn-date">Date</Label>
        <Input id="txn-date" type="date" value={date} max={todayInIndia()} onChange={(e) => setDate(e.target.value)} required />
      </div>

      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : row ? "Save changes" : "Add transaction"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TransactionFormDialog({ open, onOpenChange, row }: TransactionFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remount per open so each form gets fresh state and a fresh requestId. */}
        {open ? <Form key={row?.id ?? "new"} row={row} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
