"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { createRecurringAction } from "@/app/transactions/actions";
import { CATEGORIES } from "@/lib/transactions/categories";
import { todayInIndia } from "@/lib/transactions/period";
import type { Frequency } from "@/lib/transactions/recurring-dates";

const CATEGORY_ITEMS = CATEGORIES.map((c) => ({ value: c, label: c }));

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
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

function Form({ onDone }: { onDone: () => void }) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Other");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [firstDue, setFirstDue] = useState(todayInIndia());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createRecurringAction({ description, category, amount: Number(amount), currency, frequency, firstDue });
      if (!res.ok) return setError(res.error);
      toast.success(`Added ${description.trim()}`);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="text-title-md">Add recurring bill</DialogTitle>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor="bill-description">What is it for?</Label>
        <Input id="bill-description" autoComplete="off" maxLength={200} placeholder="Office rent" value={description} onChange={(e) => setDescription(e.target.value)} required />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="bill-category">Category</Label>
        <Select items={CATEGORY_ITEMS} value={category} onValueChange={(v) => setCategory(String(v))}>
          <SelectTrigger id="bill-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="bill-amount">Amount</Label>
          <Input id="bill-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <Segmented label="Currency" value={currency} onChange={setCurrency} options={[["INR", "INR"], ["USD", "USD"]]} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Repeats</Label>
          <Segmented label="Repeats" value={frequency} onChange={setFrequency} options={[["monthly", "Monthly"], ["yearly", "Yearly"]]} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="bill-due">Next due</Label>
          <Input id="bill-due" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} required />
        </div>
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
          {pending ? "Saving…" : "Add bill"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function AddBillDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open ? <Form onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}
