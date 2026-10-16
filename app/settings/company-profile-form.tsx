"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { GST_RATES, STATES, stateName } from "@/lib/invoices/math";
import type { CompanyProfile } from "@/lib/invoices/company";
import { saveCompanyProfileAction, type AddMemberResult } from "./actions";

const STATE_ITEMS = STATES.map((s) => ({ value: s.code, label: s.name }));
const RATE_ITEMS = GST_RATES.map((r) => ({ value: r, label: `${r}%` }));

/** Field order and labels, shared by the form and the confirmation panel. */
const FIELDS = [
  ["legalName", "Legal name"],
  ["state", "State"],
  ["address", "Address"],
  ["gstin", "GSTIN"],
  ["pan", "PAN"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["bankName", "Bank"],
  ["accountName", "Account name"],
  ["accountNumber", "Account number"],
  ["ifsc", "IFSC"],
  ["upiId", "UPI ID"],
  ["invoicePrefix", "Invoice prefix"],
  ["defaultGstRate", "Default GST rate"],
  ["defaultTerms", "Default payment terms"],
] as const;
type Key = (typeof FIELDS)[number][0];

/** Same clean-up the server applies, so the panel shows what will really be saved. */
const UPPER: Key[] = ["gstin", "pan", "accountNumber", "ifsc", "invoicePrefix"];
function normalize(key: Key, value: string): string {
  const v = value.trim();
  return UPPER.includes(key) ? v.toUpperCase().replace(/\s+/g, "") : v;
}

function saved(profile: CompanyProfile | null, key: Key): string {
  if (!profile) return "";
  const v = profile[key];
  if (key === "defaultGstRate") return String(Number(v));
  return v == null ? "" : String(v);
}

function show(key: Key, value: string): string {
  if (!value) return "Empty";
  if (key === "state") return stateName(value) ?? value;
  if (key === "defaultGstRate") return `${value}%`;
  return value;
}

function Field({ id, label, value, placeholder, hint, readOnly }: { id: Key; label: string; value: string; placeholder?: string; hint?: string; readOnly: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`company-${id}`}>{label}</Label>
      <Input id={`company-${id}`} name={id} defaultValue={value} placeholder={readOnly ? undefined : placeholder} autoComplete="off" readOnly={readOnly} className={readOnly ? "bg-muted/40" : undefined} />
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Company details printed on every invoice. Admins edit; every save goes through a
 * confirmation panel listing exactly what changes. Managers see the same fields, read-only.
 * The server action also refuses non-admins.
 */
export function CompanyProfileForm({ profile, readOnly }: { profile: CompanyProfile | null; readOnly: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<AddMemberResult & { unchanged?: boolean }>({ ok: false });
  const [changes, setChanges] = useState<{ key: Key; label: string; from: string; to: string }[] | null>(null);
  const [pending, startTransition] = useTransition();
  const value = (key: Key) => saved(profile, key) || (key === "invoicePrefix" ? "WV" : key === "defaultGstRate" ? "18" : "");

  function review(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly) return;
    const data = new FormData(e.currentTarget);
    const diff = FIELDS.flatMap(([key, label]) => {
      const to = normalize(key, String(data.get(key) ?? ""));
      const from = saved(profile, key);
      return to === from ? [] : [{ key, label, from: show(key, from), to: show(key, to) }];
    });
    if (diff.length === 0) return setState({ ok: false, unchanged: true });
    setState({ ok: false });
    setChanges(diff);
  }

  function confirm() {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    startTransition(async () => {
      setState(await saveCompanyProfileAction({ ok: false }, data));
      setChanges(null);
    });
  }

  const select = (name: Key, id: string, items: { value: string; label: string }[], placeholder?: string) => (
    <Select name={name} items={items} defaultValue={value(name) || undefined} disabled={readOnly}>
      <SelectTrigger id={id} className="w-full disabled:opacity-100 disabled:bg-muted/40">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <>
      {readOnly ? <p className="mt-1 text-caption text-muted-foreground">Only admins can edit this.</p> : null}
      <form ref={formRef} onSubmit={review} noValidate className="mt-4 grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        <Field id="legalName" label="Legal name" value={value("legalName")} placeholder="Website Vikreta Pvt Ltd" readOnly={readOnly} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="company-state">State</Label>
          {select("state", "company-state", STATE_ITEMS, "Pick a state")}
        </div>
        <div className="flex flex-col gap-2 @2xl:col-span-2">
          <Label htmlFor="company-address">Address</Label>
          <Textarea id="company-address" name="address" rows={2} defaultValue={value("address")} readOnly={readOnly} className={readOnly ? "bg-muted/40" : undefined} />
        </div>
        <Field id="gstin" label="GSTIN" value={value("gstin")} placeholder="27ABCDE1234F1Z5" readOnly={readOnly} />
        <Field id="pan" label="PAN" value={value("pan")} placeholder="ABCDE1234F" readOnly={readOnly} />
        <Field id="email" label="Email" value={value("email")} placeholder="accounts@websitevikreta.com" readOnly={readOnly} />
        <Field id="phone" label="Phone" value={value("phone")} readOnly={readOnly} />
        <Field id="bankName" label="Bank" value={value("bankName")} placeholder="HDFC Bank" readOnly={readOnly} />
        <Field id="accountName" label="Account name" value={value("accountName")} readOnly={readOnly} />
        <Field id="accountNumber" label="Account number" value={value("accountNumber")} readOnly={readOnly} />
        <Field id="ifsc" label="IFSC" value={value("ifsc")} placeholder="HDFC0001234" readOnly={readOnly} />
        <Field id="upiId" label="UPI ID" value={value("upiId")} placeholder="websitevikreta@hdfcbank" readOnly={readOnly} />
        <Field id="invoicePrefix" label="Invoice prefix" value={value("invoicePrefix")} hint="Numbers look like WV/2026-27/001." readOnly={readOnly} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="company-rate">Default GST rate</Label>
          {select("defaultGstRate", "company-rate", RATE_ITEMS)}
        </div>
        <div className="flex flex-col gap-2 @2xl:col-span-2">
          <Label htmlFor="company-terms">Default payment terms</Label>
          <Textarea id="company-terms" name="defaultTerms" rows={2} defaultValue={value("defaultTerms")} readOnly={readOnly} placeholder={readOnly ? undefined : "Payment due within 15 days."} className={readOnly ? "bg-muted/40" : undefined} />
        </div>
        {readOnly ? null : (
          <div className="flex flex-col gap-2 @2xl:col-span-2 @2xl:flex-row @2xl:items-center @2xl:justify-between">
            {state.error ? (
              <p role="alert" className="text-caption text-destructive">{state.error}</p>
            ) : state.ok ? (
              <p role="status" className="text-caption text-success">Saved.</p>
            ) : state.unchanged ? (
              <p role="status" className="text-caption text-muted-foreground">Nothing changed.</p>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending}>
              Save company profile
            </Button>
          </div>
        )}
      </form>

      <Dialog open={changes !== null} onOpenChange={(o) => !o && !pending && setChanges(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-title-md">Save these changes?</DialogTitle>
            <DialogDescription>Printed on every invoice from now on. Issued invoices keep what they were issued with.</DialogDescription>
          </DialogHeader>
          <dl className="max-h-80 divide-y divide-border overflow-y-auto text-body-sm">
            {changes?.map((c) => (
              <div key={c.key} className="grid gap-1 py-2.5">
                <dt className="text-caption text-muted-foreground">{c.label}</dt>
                <dd className="grid gap-0.5">
                  <span className="text-muted-foreground line-through break-words">{c.from}</span>
                  <span className="font-medium break-words">{c.to}</span>
                </dd>
              </div>
            ))}
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChanges(null)} disabled={pending}>
              Keep editing
            </Button>
            <Button onClick={confirm} disabled={pending}>
              {pending ? "Saving…" : "Yes, save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
