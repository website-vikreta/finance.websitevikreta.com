"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClientAction, updateClientAction } from "@/app/clients/actions";
import { STATES } from "@/lib/invoices/math";

const STATE_ITEMS = STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }));

export interface ClientFormData {
  id?: string;
  name: string;
  email?: string | null;
  billingAddress?: string | null;
  state?: string | null;
  country?: string | null;
  gstin?: string | null;
}

interface ClientFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ClientFormData | null;
  onSuccess?: (id: string) => void;
}

function ClientFormInner({
  client,
  onClose,
  onSuccess,
}: {
  client?: ClientFormData | null;
  onClose: () => void;
  onSuccess?: (id: string) => void;
}) {
  const isEditing = Boolean(client?.id);
  const [name, setName] = useState(client?.name ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [country, setCountry] = useState(client?.country ?? "India");
  const [state, setState] = useState<string | null>(client?.state ?? null);
  const [gstin, setGstin] = useState(client?.gstin ?? "");
  const [address, setAddress] = useState(client?.billingAddress ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isIndia = country.trim().toLowerCase() === "india";

  function handleGstinChange(val: string) {
    const cleaned = val.toUpperCase().replace(/\s+/g, "");
    setGstin(cleaned);
    if (isIndia && cleaned.length >= 2) {
      const code = cleaned.slice(0, 2);
      if (STATES.some((s) => s.code === code)) {
        setState(code);
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = {
      name,
      email: email.trim() || null,
      country,
      state: isIndia ? state : null,
      gstin: gstin.trim() || null,
      address: address.trim() || null,
    };

    startTransition(async () => {
      const res = isEditing && client?.id
        ? await updateClientAction(client.id, payload)
        : await createClientAction(payload);

      if (!res.ok) {
        setError(res.error);
        return;
      }

      toast.success(isEditing ? "Client updated" : "Client created");
      onClose();
      if (res.id && onSuccess) {
        onSuccess(res.id);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>{isEditing ? "Edit client" : "Add client"}</DialogTitle>
        <DialogDescription>
          {isEditing
            ? "Update billing details and GST info for this client."
            : "Add a client to track their receivables, invoices, and payments."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-caption text-destructive">
            {error}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="client-name">Company or client name *</Label>
          <Input
            id="client-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Technologies Pvt Ltd"
            required
            autoFocus
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="client-email">Billing email</Label>
            <Input
              id="client-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="accounts@acme.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client-country">Country</Label>
            <Input
              id="client-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="India"
            />
          </div>
        </div>

        {isIndia ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="client-state">State (GST)</Label>
              <Select
                items={STATE_ITEMS}
                value={state}
                onValueChange={(val) => setState(val ? String(val) : null)}
              >
                <SelectTrigger id="client-state" className="w-full">
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {STATE_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="client-gstin">GSTIN</Label>
              <Input
                id="client-gstin"
                value={gstin}
                maxLength={15}
                onChange={(e) => handleGstinChange(e.target.value)}
                placeholder="27ABCDE1234F1Z5"
                className="font-mono uppercase"
              />
            </div>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="client-address">Billing address</Label>
          <Textarea
            id="client-address"
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street address, city, postal code"
          />
        </div>
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEditing ? "Save changes" : "Add client"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ClientFormDialog({ open, onOpenChange, client, onSuccess }: ClientFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <ClientFormInner
            key={client?.id ?? "new"}
            client={client}
            onClose={() => onOpenChange(false)}
            onSuccess={onSuccess}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
