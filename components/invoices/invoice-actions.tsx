"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, IndianRupee, Pencil, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExportPdfButton } from "@/components/layout/export-pdf-button";
import { deleteDraftAction, issueInvoiceAction, recordPaymentAction, voidInvoiceAction } from "@/app/invoices/actions";
import type { DisplayStatus } from "@/lib/invoices/math";
import { todayInIndia } from "@/lib/transactions/period";

interface InvoiceActionsProps {
  id: string;
  status: DisplayStatus;
  number: string | null;
  clientName: string;
  currency: "INR" | "USD";
  /** Exact decimal string. */
  balance: string;
  hasPayments: boolean;
}

type Confirm = "issue" | "delete" | "void" | null;

const COPY: Record<Exclude<Confirm, null>, { title: string; body: string; cta: string; destructive?: boolean }> = {
  issue: { title: "Issue this invoice?", body: "It gets the next invoice number and can't be edited after. To change it later, void it and create a new one.", cta: "Issue invoice" },
  delete: { title: "Delete this draft?", body: "It was never issued, so no invoice number is used.", cta: "Delete draft", destructive: true },
  void: { title: "Void this invoice?", body: "It stays in the list as void and its number is not reused. The client no longer owes it.", cta: "Void invoice", destructive: true },
};

export function InvoiceActions({ id, status, number, clientName, currency, balance, hasPayments }: InvoiceActionsProps) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [paying, setPaying] = useState(false);
  const [pending, startTransition] = useTransition();
  const unpaid = status === "sent" || status === "partial" || status === "overdue";
  const fileName = `Invoice ${(number ?? "draft").replaceAll("/", "-")} - ${clientName}`;

  const run = (kind: Exclude<Confirm, null>) =>
    startTransition(async () => {
      const res = kind === "issue" ? await issueInvoiceAction(id) : kind === "delete" ? await deleteDraftAction(id) : await voidInvoiceAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setConfirm(null);
      if (kind === "delete") router.push("/invoices");
      else toast.success(kind === "issue" ? "Invoice issued" : "Invoice voided");
    });

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {status === "draft" ? (
        <>
          <Button onClick={() => setConfirm("issue")}>
            <Send aria-hidden />
            Issue invoice
          </Button>
          <Link href={`/invoices/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden />
            Edit
          </Link>
        </>
      ) : null}
      {unpaid ? (
        <Button onClick={() => setPaying(true)}>
          <IndianRupee aria-hidden />
          Record payment
        </Button>
      ) : null}
      <ExportPdfButton fileName={fileName} label="Download PDF" variant="outline" />
      {status === "draft" ? (
        <Button variant="ghost" onClick={() => setConfirm("delete")} className="text-muted-foreground hover:text-destructive">
          <Trash2 aria-hidden />
          Delete
        </Button>
      ) : null}
      {unpaid ? (
        <Button
          variant="ghost"
          onClick={() => (hasPayments ? toast.error("It has payments recorded. Delete those transactions first, then void it.") : setConfirm("void"))}
          className="text-muted-foreground hover:text-destructive"
        >
          <Ban aria-hidden />
          Void
        </Button>
      ) : null}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          {confirm ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-title-md">{COPY[confirm].title}</DialogTitle>
                <DialogDescription>{COPY[confirm].body}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={pending}>
                  Not now
                </Button>
                <Button variant={COPY[confirm].destructive ? "destructive" : "default"} onClick={() => run(confirm)} disabled={pending}>
                  {pending ? "Working…" : COPY[confirm].cta}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <PaymentDialog open={paying} onOpenChange={setPaying} id={id} currency={currency} balance={balance} />
    </div>
  );
}

function PaymentDialog({ open, onOpenChange, id, currency, balance }: { open: boolean; onOpenChange: (o: boolean) => void; id: string; currency: "INR" | "USD"; balance: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open ? <PaymentForm id={id} currency={currency} balance={balance} onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function PaymentForm({ id, currency, balance, onDone }: { id: string; currency: "INR" | "USD"; balance: string; onDone: () => void }) {
  const today = todayInIndia();
  const [requestId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(String(Number(balance)));
  const [date, setDate] = useState(today);
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const symbol = currency === "USD" ? "$" : "₹";
  const over = Number(amount) > Number(balance);
  const rest = Number(balance) - Number(amount);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await recordPaymentAction(id, { amount, date, rate: currency === "USD" ? rate : null }, requestId);
      if (!res.ok) return setError(res.error);
      toast.success(rest > 0 ? `Payment recorded · ${symbol}${rest.toLocaleString("en-IN")} still due` : "Invoice paid in full");
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="text-title-md">Record payment</DialogTitle>
        <DialogDescription>
          Saves it as income for this client, linked to the invoice. {symbol}
          {Number(balance).toLocaleString("en-IN")} is due.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="pay-amount">Amount received ({currency})</Label>
        <Input id="pay-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={over} />
        {over ? (
          <p role="alert" className="text-caption text-destructive">Only {symbol}{Number(balance).toLocaleString("en-IN")} is due on this invoice.</p>
        ) : rest > 0 && Number(amount) > 0 ? (
          <p className="text-caption text-muted-foreground">{symbol}{rest.toLocaleString("en-IN")} stays due.</p>
        ) : null}
      </div>
      {currency === "USD" ? (
        <div className="grid gap-2">
          <Label htmlFor="pay-rate">Rate received (₹ per $1)</Label>
          <Input id="pay-rate" inputMode="decimal" autoComplete="off" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="88.50" />
        </div>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="pay-date">Date received</Label>
        <Input id="pay-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </div>
      {error ? <p role="alert" className="text-caption text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || over}>
          {pending ? "Saving…" : "Record payment"}
        </Button>
      </DialogFooter>
    </form>
  );
}
