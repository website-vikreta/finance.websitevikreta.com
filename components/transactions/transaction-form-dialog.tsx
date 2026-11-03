"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import {
  createRecurringAction,
  createTransactionAction,
  listActiveClientsAction,
  updateTransactionAction,
} from "@/app/transactions/actions";
import { convertUsdToInrDecimal } from "@/lib/currency/precision";
import { formatDate, formatINR } from "@/lib/format";
import type { LedgerRow } from "@/lib/transactions/queries";
import { todayInIndia } from "@/lib/transactions/period";
import { CATEGORIES } from "@/lib/transactions/categories";
import { advanceDue, calculateEndDate, MAX_MONTHS, parseMonths, type PaymentMode } from "@/lib/transactions/recurring-dates";

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
  /** The bill's client, so each month's expense keeps its client tag. */
  client: string | null;
}
type Currency = "INR" | "USD";

interface TransactionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this row; omit to create a new transaction. */
  row?: LedgerRow | null;
  bill?: BillToLog | null;
  defaultClient?: string;
  defaultType?: TxnType;
  clients?: string[];
  /** "Add bill": start as a monthly expense to pay later. */
  newBill?: boolean;
}

/** INR the server will save, using the same half-even conversion. Null while input is incomplete. */
function previewInr(amount: string, rate: string): number | null {
  try {
    return Number(convertUsdToInrDecimal(amount.trim(), rate.trim()));
  } catch {
    return null;
  }
}

function Choice<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={segmentedTrack}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)} className={segmentedItem(value === v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Form({
  row,
  bill,
  defaultClient,
  defaultType,
  clients: clientsProp,
  newBill,
  onDone,
}: {
  row?: LedgerRow | null;
  bill?: BillToLog | null;
  defaultClient?: string;
  defaultType?: TxnType;
  clients?: string[];
  newBill?: boolean;
  onDone: () => void;
}) {
  const today = todayInIndia();
  const [requestId] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<TxnType>(row?.type ?? defaultType ?? "expense");
  const [currency, setCurrency] = useState<Currency>(row?.originalCurrency ?? bill?.currency ?? "INR");
  const [amount, setAmount] = useState(row ? String(row.originalAmount) : bill ? String(bill.amount) : "");
  const [rate, setRate] = useState(row?.exchangeRate ? String(row.exchangeRate) : "");
  const [client, setClient] = useState(row?.type === "income" ? row.title : (row?.clientName ?? bill?.client ?? defaultClient ?? ""));
  const [description, setDescription] = useState(row?.type === "expense" ? row.title : (row?.detail ?? bill?.description ?? ""));
  const [category, setCategory] = useState<string>(row?.category ?? bill?.category ?? "Other");
  // A bill due later than today is logged as paid today (dates can't be in the future).
  const [date, setDate] = useState(row?.date ?? (bill && bill.due <= today ? bill.due : today));
  const [repeats, setRepeats] = useState<"no" | "monthly">(newBill ? "monthly" : "no");
  const [recurringPaymentMode, setRecurringPaymentMode] = useState<"paid" | "schedule">(newBill ? "schedule" : "paid");
  const [duration, setDuration] = useState<"ongoing" | "3" | "6" | "custom">("ongoing");
  const [customMonths, setCustomMonths] = useState("3");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("partial");

  const totalMonths = duration === "custom" ? parseMonths(customMonths) : duration === "ongoing" ? null : Number(duration);
  const day = Number(date.slice(8, 10));
  const endDatePreview = totalMonths && totalMonths > 0 ? calculateEndDate(date, totalMonths, day) : null;

  const [clientList, setClientList] = useState<string[]>(clientsProp ?? []);

  useEffect(() => {
    if (!clientsProp || clientsProp.length === 0) {
      listActiveClientsAction().then((names) => {
        if (names && names.length > 0) setClientList(names);
      });
    }
  }, [clientsProp]);

  const allClients = client && !clientList.includes(client) ? [client, ...clientList] : clientList;
  const clientSelectItems = [
    { value: "none", label: "None (General overhead)" },
    ...allClients.map((c) => ({ value: c, label: c })),
  ];
  // Paying less than what's due, in the bill's currency: ask whether the rest is still owed.
  const short = bill && currency === bill.currency && Number(amount) > 0 && Number(amount) < bill.amount ? bill.amount - Number(amount) : null;
  // Paying more than is owed in the bill's currency would record money that isn't due.
  const over = bill && currency === bill.currency && Number(amount) > bill.amount;
  const fmt = (n: number) => (currency === "USD" ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : formatINR(n, { decimals: n % 1 === 0 ? 0 : 2 }));
  const canRepeat = !row && !bill && type === "expense";
  const repeating = canRepeat && repeats === "monthly";
  /** "Pay later": only the bill is saved, no expense today. */
  const scheduling = repeating && recurringPaymentMode === "schedule";
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
    if (repeating && duration === "custom" && totalMonths === null) {
      setError(`Enter 1 to ${MAX_MONTHS} months.`);
      return;
    }

    // If scheduling a future recurring bill without paying today
    if (scheduling) {
      if (date < today) {
        setError("The first due date can't be in the past.");
        return;
      }
      if (!description.trim()) {
        setError("What is this bill for?");
        return;
      }
      if (!amount || Number(amount) <= 0) {
        setError("Enter an amount greater than zero.");
        return;
      }
      startTransition(async () => {
        const recurring = await createRecurringAction({
          description: description.trim(),
          category,
          amount: Number(amount),
          currency,
          firstDue: date,
          endDate: endDatePreview,
          client: client.trim() || null,
        });
        if (!recurring.ok) {
          setError(recurring.error);
        } else {
          toast.success(`Scheduled ${description.trim()} · due on ${formatDate(date)}${endDatePreview ? ` (Ends ${formatDate(endDatePreview)})` : ""}`);
          onDone();
        }
      });
      return;
    }

    const allowDuplicate = duplicate !== null;
    const input = {
      type,
      currency,
      amount: Number(amount),
      rate: currency === "USD" ? Number(rate) : null,
      client: client.trim() ? client.trim() : null,
      description: description.trim() ? description.trim() : null,
      category: type === "expense" ? category : null,
      date,
    };
    // A 1-month "repeat" is just this expense.
    const repeat = repeating && totalMonths !== 1 ? { months: totalMonths } : undefined;
    startTransition(async () => {
      const result = row
        ? await updateTransactionAction(row.id, input, allowDuplicate)
        : await createTransactionAction(input, requestId, allowDuplicate, bill ? { id: bill.id, due: bill.due, mode: short !== null ? paymentMode : "full" } : undefined, repeat);
      if (!result.ok) return result.duplicate ? setWarned({ key: valuesKey, message: result.error }) : setError(result.error);
      const label = type === "income" ? client.trim() : description.trim();
      if (repeat) {
        toast.success(`Added ${label} · next due on ${formatDate(advanceDue(date, day))}${endDatePreview ? ` (Ends ${formatDate(endDatePreview)})` : ""}`);
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

  const [title, submitLabel] = row
    ? ["Edit transaction", "Save changes"]
    : bill
      ? [`Mark ${bill.description} as paid?`, "Yes, it's paid"]
      : defaultType === "income"
        ? [defaultClient ? `Record payment from ${defaultClient}` : "Add transaction", "Record payment"]
        : scheduling
          ? ["Add bill", "Add bill"]
          : ["Add transaction", "Add transaction"];

  return (
    <form onSubmit={submit} noValidate className="grid gap-3.5">
      <DialogHeader>
        <DialogTitle className="text-title-md">
          {title}
        </DialogTitle>
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

      {bill || defaultType || newBill || row?.bill ? null : (
        <Choice
          label="Type"
          value={type}
          onChange={(t) => {
            setType(t);
            if (!row && !bill) {
              if (t === "expense") {
                if (!defaultClient) setClient("");
                setCategory("Other");
              }
            }
          }}
          options={[
            ["income", "Money in"],
            ["expense", "Money out"],
          ]}
        />
      )}

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="txn-amount">Amount</Label>
          <Input id="txn-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={Boolean(row?.bill)} aria-describedby={row?.bill ? "txn-amount-locked" : undefined} required />
        </div>
        <Choice label="Currency" value={currency} onChange={setCurrency} options={[["INR", "INR"], ["USD", "USD"]]} disabled={Boolean(row?.bill)} />
      </div>
      {row?.bill ? (
        <p id="txn-amount-locked" className="-mt-1.5 text-caption text-muted-foreground">
          Paid {row.bill.name}. To change the amount, delete it and mark the bill paid again.
        </p>
      ) : null}

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
        <>
          <div className="grid gap-2">
            <Label htmlFor="txn-client">Client</Label>
            <Input
              id="txn-client"
              list="income-clients-list"
              autoComplete="off"
              maxLength={200}
              placeholder="Who paid?"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              required
            />
            <datalist id="income-clients-list">
              {allClients.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="txn-income-for">
              What was it for? <span className="text-caption font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="txn-income-for"
              autoComplete="off"
              maxLength={200}
              placeholder="e.g. Domain renewal, DB hosting, Website advance"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-2">
            <Label htmlFor="txn-description">What was it for?</Label>
            <Input id="txn-description" autoComplete="off" maxLength={200} placeholder="Office rent" value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="txn-client-tag">
              Client <span className="text-caption font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Select
              items={clientSelectItems}
              value={client ? client : "none"}
              onValueChange={(v) => setClient(v === "none" ? "" : String(v))}
            >
              <SelectTrigger id="txn-client-tag" className="w-full">
                <SelectValue placeholder="None (General overhead)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (General overhead)</SelectItem>
                {allClients.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
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

      {canRepeat ? (
        <div className="grid gap-2">
          <Label>Repeats</Label>
          <Choice
            label="Repeats"
            value={repeats}
            onChange={(freq) => {
              setRepeats(freq);
              if (freq === "no" && date > today) setDate(today);
            }}
            options={[
              ["no", "No"],
              ["monthly", "Monthly"],
            ]}
          />
        </div>
      ) : null}

      {repeating ? (
        <div className="grid gap-2">
          <Label>Duration</Label>
          <Choice
            label="Duration"
            value={duration}
            onChange={setDuration}
            options={[
              ["ongoing", "Ongoing"],
              ["3", "3 months"],
              ["6", "6 months"],
              ["custom", "Custom"],
            ]}
          />
          {duration === "custom" ? (
            <div className="flex items-center gap-2 pt-1">
              <Input
                id="txn-custom-months"
                type="number"
                min={1}
                max={MAX_MONTHS}
                placeholder="Months"
                value={customMonths}
                onChange={(e) => setCustomMonths(e.target.value)}
                className="w-28"
              />
              <span className="text-caption text-muted-foreground">months</span>
            </div>
          ) : null}
          {endDatePreview ? <p className="text-caption text-muted-foreground">Ends {formatDate(endDatePreview)}</p> : null}
        </div>
      ) : null}

      {repeating ? (
        <div className="grid gap-2">
          <Label>First month</Label>
          <Choice
            label="First month"
            value={recurringPaymentMode}
            onChange={(mode) => {
              setRecurringPaymentMode(mode);
              if (mode === "paid" && date > today) setDate(today);
            }}
            options={[
              ["paid", "Paid today"],
              ["schedule", "Pay later"],
            ]}
          />
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="txn-date">
          {scheduling ? "First due date" : "Date"}
        </Label>
        <Input
          id="txn-date"
          type="date"
          value={date}
          min={scheduling ? today : undefined}
          max={scheduling ? undefined : today}
          onChange={(e) => setDate(e.target.value)}
          required
        />
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
          {pending ? "Saving…" : duplicate ? "Save anyway" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TransactionFormDialog({ open, onOpenChange, row, bill, defaultClient, defaultType, clients, newBill }: TransactionFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        {/* Remount per open so each form gets fresh state and a fresh requestId. */}
        {open ? (
          <Form
            key={row?.id ?? bill?.id ?? defaultClient ?? defaultType ?? "new"}
            row={row}
            bill={bill}
            defaultClient={defaultClient}
            defaultType={defaultType}
            clients={clients}
            newBill={newBill}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
