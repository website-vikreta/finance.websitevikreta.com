"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listActiveClientsAction, updateRecurringAction } from "@/app/transactions/actions";
import { CATEGORIES } from "@/lib/transactions/categories";
import type { RecurringRow } from "@/lib/transactions/recurring";

const CATEGORY_ITEMS = CATEGORIES.map((c) => ({ value: c, label: c }));

function Form({ bill, onDone }: { bill: RecurringRow; onDone: () => void }) {
  const [description, setDescription] = useState(bill.description);
  const [category, setCategory] = useState(bill.category);
  const [amount, setAmount] = useState(String(bill.amount));
  const [client, setClient] = useState(bill.clientName ?? "");
  const [clients, setClients] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    listActiveClientsAction().then(setClients);
  }, []);
  const clientNames = client && !clients.includes(client) ? [client, ...clients] : clients;
  const clientItems = [{ value: "none", label: "None" }, ...clientNames.map((c) => ({ value: c, label: c }))];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updateRecurringAction(bill.id, { description, category, amount: Number(amount), client: client || null });
      if (!res.ok) return setError(res.error);
      toast.success(`Saved ${description.trim()}`);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="text-title-md">Edit bill</DialogTitle>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor="bill-description">What is it for?</Label>
        <Input id="bill-description" autoComplete="off" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} required />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="bill-amount">Amount ({bill.currency})</Label>
        <Input id="bill-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} required />
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

      <div className="grid gap-2">
        <Label htmlFor="bill-client">Client</Label>
        <Select items={clientItems} value={client || "none"} onValueChange={(v) => setClient(v === "none" ? "" : String(v))}>
          <SelectTrigger id="bill-client" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {clientItems.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function EditBillDialog({ bill, onOpenChange }: { bill: RecurringRow | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={bill !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{bill ? <Form key={bill.id} bill={bill} onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}
