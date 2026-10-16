"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { createRecurringAction, createTransactionAction, updateTransactionAction } from "@/app/transactions/actions";
import { convertUsdToInrDecimal } from "@/lib/currency/precision";
import { formatDate, formatINR } from "@/lib/format";
import type { LedgerRow } from "@/lib/transactions/queries";
import { todayInIndia } from "@/lib/transactions/period";
import { CATEGORIES } from "@/lib/transactions/categories";
import { advanceDue, type Frequency, type PaymentMode } from "@/lib/transactions/recurring-dates";

const CATEGORY_ITEMS = CATEGORIES.map((c) => ({ value: c, label: c }));

type TxnType = "income" | "expense";

/** A recurring bill being marked paid: the form starts filled in from it and asks for confirmation. */
export interface BillToLog {
  id: string;
  /** The occurrence being logged (YYYY-MM-DD); the bill moves past it once saved. */
  due: string;
  description: string;
  category: string;
  /** What is still due on this occurrence (the full bill minus part payments). */
  amount: number;
  /** The full bill amount. */
  fullAmount: number;
  currency: "INR" | "USD";
}
type Currency = "INR" | "USD";

interface TransactionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this row; omit to create a new transaction. */
  row?: LedgerRow | null;
  bill?: BillToLog | null;
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

function Form({ row, bill, onDone }: { row?: LedgerRow | null; bill?: BillToLog | null; onDone: () => void }) {
  const today = todayInIndia();
  const [requestId] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<TxnType>(row?.type ?? "expense");
  const [currency, setCurrency] = useState<Currency>(row?.originalCurrency ?? bill?.currency ?? "INR");
  const [amount, setAmount] = useState(row ? String(row.originalAmount) : bill ? String(bill.amount) : "");
  const [rate, setRate] = useState(row?.exchangeRate ? String(row.exchangeRate) : "");
  const [client, setClient] = useState(row?.type === "income" ? row.title : "");
  const [description, setDescription] = useState(row?.type === "expense" ? row.title : (bill?.description ?? ""));
  const [category, setCategory] = useState<string>(row?.category ?? bill?.category ?? "Other");
  // A bill due later than today is logged as paid today (dates can't be in the future).
  const [date, setDate] = useState(row?.date ?? (bill && bill.due <= today ? bill.due : today));
  const [repeats, setRepeats] = useState<"no" | Frequency>("no");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("partial");
  // Paying less than what's due, in the bill's currency: ask whether the rest is still owed.
  const short = bill && currency === bill.currency && Number(amount) > 0 && Number(amount) < bill.amount ? bill.amount - Number(amount) : null;
  // Paying more than is owed in the bill's currency would record money that isn't due.
  const over = bill && currency === bill.currency && Number(amount) > bill.amount;
  const fmt = (n: number) => (currency === "USD" ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : formatINR(n, { decimals: n % 1 === 0 ? 0 : 2 }));
  const canRepeat = !row && !bill && type === "expense";
  const [error, setError] = useState<string | null>(null);
  // Server's likely-duplicate warning, tied to the exact values it was about: editing any field clears it.
  const [warned, setWarned] = useState<{ key: string; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const inr = currency === "USD" ? previewInr(amount, rate) : null;
  const valuesKey = [type, currency, amount, rate, client, description, category, date].join("|");
  const duplicate = warned?.key === valuesKey ? warned.message : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const allowDuplicate = duplicate !== null;
    const input = {
      type,
      currency,
      amount: Number(amount),
      rate: currency === "USD" ? Number(rate) : null,
      client: type === "income" ? client : null,
      description: type === "expense" ? description : null,
      category: type === "expense" ? category : null,
      date,
    };
    startTransition(async () => {
      const result = row
        ? await updateTransactionAction(row.id, input, allowDuplicate)
        : await createTransactionAction(input, requestId, allowDuplicate, bill ? { id: bill.id, due: bill.due, mode: short !== null ? paymentMode : "full" } : undefined);
      if (!result.ok) return result.duplicate ? setWarned({ key: valuesKey, message: result.error }) : setError(result.error);
      const label = type === "income" ? client.trim() : description.trim();
      if (canRepeat && repeats !== "no") {
        const day = Number(date.slice(8, 10));
        const recurring = await createRecurringAction({ description, category, amount: Number(amount), currency, frequency: repeats, firstDue: advanceDue(date, repeats, day) });
        if (!recurring.ok) toast.error(`Added ${label}, but couldn't set it to repeat: ${recurring.error}`);
        else toast.success(`Added ${label} · repeats ${repeats}`);
      } else {
        toast.success(
          row
            ? `Saved changes to ${label}`
            : bill
              ? short !== null && paymentMode === "partial"
                ? `Saved part payment for ${label} · ${fmt(short)} still due`
                : `Marked ${label} as paid`
              : `Added ${label}`,
        );
      }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="text-title-md">{row ? "Edit transaction" : bill ? `Mark ${bill.description} as paid?` : "Add transaction"}</DialogTitle>
        {bill ? (
          <DialogDescription>
            This saves {fmt(Number(amount) || 0)} as an expense on {formatDate(date)}.{" "}
            {short !== null && paymentMode === "partial"
              ? `${fmt(short)} stays due on ${formatDate(bill.due)}.`
              : "The bill moves to its next due date."}{" "}
            {bill.amount < bill.fullAmount ? `${fmt(bill.fullAmount - bill.amount)} of ${fmt(bill.fullAmount)} was already paid.` : null}
          </DialogDescription>
        ) : null}
      </DialogHeader>

      {bill ? null : <Choice label="Type" value={type} onChange={setType} options={[["income", "Money in"], ["expense", "Money out"]]} />}

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

      {type === "expense" ? (
        <div className="grid gap-2">
          <Label htmlFor="txn-category">Category</Label>
          <Select items={CATEGORY_ITEMS} value={category} onValueChange={(v) => setCategory(String(v))}>
            <SelectTrigger id="txn-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="txn-date">Date</Label>
        <Input id="txn-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
      </div>

      {short !== null ? (
        <div role="radiogroup" aria-label="Is the rest still due?" className="grid gap-2 rounded-lg border border-border p-3">
          <p className="text-caption text-muted-foreground">
            {fmt(Number(amount))} of {fmt(bill!.amount)}
          </p>
          {(
            [
              ["partial", `Part payment: ${fmt(short)} still due`],
              ["full", "Paid in full: the bill was lower this time"],
            ] as [PaymentMode, string][]
          ).map(([mode, label]) => (
            <label key={mode} className="flex cursor-pointer items-center gap-2 text-body-sm">
              <input type="radio" name="payment-mode" value={mode} checked={paymentMode === mode} onChange={() => setPaymentMode(mode)} className="size-4 accent-foreground" />
              {label}
            </label>
          ))}
        </div>
      ) : null}

      {canRepeat ? (
        <div className="grid gap-2">
          <Label>Repeats</Label>
          <Choice label="Repeats" value={repeats} onChange={setRepeats} options={[["no", "No"], ["monthly", "Monthly"], ["yearly", "Yearly"]]} />
        </div>
      ) : null}

      {over ? (
        <p role="alert" className="text-caption text-destructive">
          Only {fmt(bill.amount)} is left on this bill. Enter {fmt(bill.amount)} or less.
        </p>
      ) : error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : duplicate ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-foreground">
          {duplicate} Save it anyway?
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          {bill ? "Not yet" : "Cancel"}
        </Button>
        <Button type="submit" disabled={pending || Boolean(over)}>
          {pending ? "Saving…" : duplicate ? "Save anyway" : row ? "Save changes" : bill ? "Yes, it's paid" : "Add transaction"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TransactionFormDialog({ open, onOpenChange, row, bill }: TransactionFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remount per open so each form gets fresh state and a fresh requestId. */}
        {open ? <Form key={row?.id ?? bill?.id ?? "new"} row={row} bill={bill} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
