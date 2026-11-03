"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { saveDraftAction } from "@/app/invoices/actions";
import type { ClientBilling, InvoiceDetail } from "@/lib/invoices/invoices";
import { GST_RATES, STATES, computeTotals, taxTypeFor, type InvoiceCurrency } from "@/lib/invoices/math";
import { todayInIndia } from "@/lib/transactions/period";

const STATE_ITEMS = STATES.map((s) => ({ value: s.code, label: s.name }));
const RATE_ITEMS = GST_RATES.map((r) => ({ value: r, label: `${r}%` }));
const TAX_LABEL = { cgst_sgst: "CGST + SGST (same state as you)", igst: "IGST (another state)", none: "No GST (export of services)" };

interface Line {
  key: number;
  description: string;
  quantity: string;
  rate: string;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const fmt = (amount: string, currency: InvoiceCurrency) =>
  new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(amount));

interface InvoiceFormProps {
  company: { state: string; defaultGstRate: string; defaultTerms: string | null };
  clients: ClientBilling[];
  /** Edit this draft; omit to create a new one. */
  invoice?: InvoiceDetail | null;
  initialClient?: string;
}

export function InvoiceForm({ company, clients, invoice, initialClient }: InvoiceFormProps) {
  const router = useRouter();
  const today = todayInIndia();
  const knownInit = initialClient ? clients.find((c) => c.name.toLowerCase() === initialClient.trim().toLowerCase()) : null;
  const [clientName, setClientName] = useState(invoice?.clientName ?? knownInit?.name ?? initialClient ?? "");
  const [email, setEmail] = useState(invoice?.billToEmail ?? knownInit?.email ?? "");
  const [address, setAddress] = useState(invoice?.billToAddress ?? knownInit?.address ?? "");
  const [country, setCountry] = useState(invoice?.billToCountry ?? knownInit?.country ?? "India");
  const [state, setState] = useState<string | null>(invoice?.billToState ?? knownInit?.state ?? null);
  const [gstin, setGstin] = useState(invoice?.billToGstin ?? knownInit?.gstin ?? "");
  const [currency, setCurrency] = useState<InvoiceCurrency>(
    invoice?.currency ?? (knownInit && knownInit.country.toLowerCase() !== "india" ? "USD" : "INR"),
  );
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? today);
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? addDays(today, 15));
  const [gstRate, setGstRate] = useState(invoice ? String(Number(invoice.gstRate)) : String(Number(company.defaultGstRate)));
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [terms, setTerms] = useState(invoice?.terms ?? company.defaultTerms ?? "");

  const [lines, setLines] = useState<Line[]>(
    invoice?.items.length
      ? invoice.items.map((it, n) => ({ key: n, description: it.description, quantity: String(Number(it.quantity)), rate: String(Number(it.rate)) }))
      : [{ key: 0, description: "", quantity: "1", rate: "" }],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const india = country.trim().toLowerCase() === "india";
  const taxType = taxTypeFor(company.state, { country, state: india ? state : null });

  // Live totals; incomplete lines count as zero so the preview never throws.
  const safe = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim()) ? v.trim() : "0");
  const totals = computeTotals(lines.map((l) => ({ quantity: safe(l.quantity), rate: safe(l.rate) })), taxType === "none" ? "0" : gstRate, taxType);

  /** Picking a known client fills in their saved billing details. */
  function pickClient(name: string) {
    setClientName(name);
    const known = clients.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (!known) return;
    setEmail(known.email ?? "");
    setAddress(known.address ?? "");
    setCountry(known.country);
    setState(known.state);
    setGstin(known.gstin ?? "");
    if (known.country.toLowerCase() !== "india") setCurrency("USD");
  }

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input = {
      clientName, email, address, country, state: india ? state : null, gstin, currency, issueDate, dueDate, gstRate, notes, terms,
      items: lines.map(({ description, quantity, rate }) => ({ description, quantity, rate })),
    };
    startTransition(async () => {
      const res = await saveDraftAction(invoice?.id ?? null, input);
      if (!res.ok) return setError(res.error);
      router.push(`/invoices/${res.id}`);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="@container space-y-6">
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-title-md">Bill to</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 @2xl:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-client">Client</Label>
            <Input id="inv-client" list="inv-clients" autoComplete="off" value={clientName} onChange={(e) => pickClient(e.target.value)} placeholder="Acme Pvt Ltd" required />
            <datalist id="inv-clients">
              {clients.map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="accounts@client.com" />
          </div>
          <div className="flex flex-col gap-2 @2xl:col-span-2">
            <Label htmlFor="inv-address">Billing address</Label>
            <Textarea id="inv-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-country">Country</Label>
            <Input id="inv-country" autoComplete="off" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          {india ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="inv-state">State</Label>
              <Select items={STATE_ITEMS} value={state} onValueChange={(v) => setState(v === null ? null : String(v))}>
                <SelectTrigger id="inv-state" className="w-full">
                  <SelectValue placeholder="Pick a state" />
                </SelectTrigger>
                <SelectContent>
                  {STATES.map((s) => (
                    <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {india ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="inv-gstin">Client GSTIN (optional)</Label>
              <Input id="inv-gstin" autoComplete="off" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" />
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-title-md">Details</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 @2xl:grid-cols-4">
          <div className="flex flex-col gap-2">
            <Label>Currency</Label>
            <div role="radiogroup" aria-label="Currency" className={segmentedTrack}>
              {(["INR", "USD"] as const).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={currency === c} onClick={() => setCurrency(c)} className={segmentedItem(currency === c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-issue">Invoice date</Label>
            <Input id="inv-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-due">Due date</Label>
            <Input id="inv-due" type="date" value={dueDate} min={issueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-gst">GST</Label>
            {taxType === "none" ? (
              <p className="flex h-10 items-center text-body-sm text-muted-foreground">0%</p>
            ) : (
              <Select items={RATE_ITEMS} value={gstRate} onValueChange={(v) => setGstRate(String(v))}>
                <SelectTrigger id="inv-gst" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GST_RATES.map((r) => (
                    <SelectItem key={r} value={r}>{r}%</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <p className="mt-2 text-caption text-muted-foreground">{TAX_LABEL[taxType]}</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-title-md">Items</h2>
        <div className="mt-4 space-y-3">
          {lines.map((l, n) => (
            <div key={l.key} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-border p-3 @2xl:grid-cols-[1fr_6rem_8rem_8rem_auto] @2xl:items-end @2xl:border-0 @2xl:p-0">
              <div className="col-span-2 flex flex-col gap-2 @2xl:col-span-1">
                <Label htmlFor={`inv-desc-${l.key}`} className={n > 0 ? "@2xl:sr-only" : undefined}>Description</Label>
                <Input id={`inv-desc-${l.key}`} autoComplete="off" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="Website design" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`inv-qty-${l.key}`} className={n > 0 ? "@2xl:sr-only" : undefined}>Qty</Label>
                <Input id={`inv-qty-${l.key}`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`inv-rate-${l.key}`} className={n > 0 ? "@2xl:sr-only" : undefined}>Rate</Label>
                <Input id={`inv-rate-${l.key}`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} placeholder="0.00" />
              </div>
              <p className="col-span-2 self-center text-right font-mono tabular-nums @2xl:col-span-1 @2xl:h-10 @2xl:pt-2.5">{fmt(totals.lines[n], currency)}</p>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove line ${n + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                className="row-start-1 col-start-2 justify-self-end text-muted-foreground hover:text-destructive @2xl:row-auto @2xl:col-auto @2xl:mb-1.5"
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, description: "", quantity: "1", rate: "" }])}>
            <Plus aria-hidden />
            Add line
          </Button>
        </div>

        <dl className="mt-6 ml-auto w-full max-w-xs space-y-1 font-mono text-body-sm tabular-nums">
          <div className="flex justify-between"><dt className="font-sans text-muted-foreground">Subtotal</dt><dd>{fmt(totals.subtotal, currency)}</dd></div>
          {taxType === "cgst_sgst" ? (
            <>
              <div className="flex justify-between"><dt className="font-sans text-muted-foreground">CGST {Number(gstRate) / 2}%</dt><dd>{fmt(totals.cgst, currency)}</dd></div>
              <div className="flex justify-between"><dt className="font-sans text-muted-foreground">SGST {Number(gstRate) / 2}%</dt><dd>{fmt(totals.sgst, currency)}</dd></div>
            </>
          ) : taxType === "igst" ? (
            <div className="flex justify-between"><dt className="font-sans text-muted-foreground">IGST {gstRate}%</dt><dd>{fmt(totals.igst, currency)}</dd></div>
          ) : null}
          <div className="flex justify-between border-t border-border pt-1 font-semibold"><dt className="font-sans">Total</dt><dd>{fmt(totals.total, currency)}</dd></div>
        </dl>
      </section>

      <section className="grid grid-cols-1 gap-6 rounded-xl border border-border bg-card p-6 @2xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="inv-notes">Notes</Label>
          <Textarea id="inv-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Thank you for your business." />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="inv-terms">Terms</Label>
          <Textarea id="inv-terms" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} />
        </div>
      </section>

      <div className="flex flex-col-reverse gap-3 @xl:flex-row @xl:items-center @xl:justify-end">
        {error ? <p role="alert" className="text-caption text-destructive @xl:mr-auto">{error}</p> : null}
        <Link href={invoice ? `/invoices/${invoice.id}` : "/invoices"} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </form>
  );
}
