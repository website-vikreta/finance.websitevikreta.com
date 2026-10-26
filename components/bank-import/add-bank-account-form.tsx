"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBankAccountAction } from "@/app/bank-connections/actions";

export function AddBankAccountForm() {
  const [displayName, setDisplayName] = useState("");
  const [bankName, setBankName] = useState("");
  const [last4, setLast4] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createBankAccountAction({
        displayName,
        bankName: bankName || null,
        last4: last4 || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Bank account added");
      setDisplayName("");
      setBankName("");
      setLast4("");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-caption text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="displayName">Account display name</Label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Acme current account"
          required
          maxLength={120}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bankName">Bank name (optional)</Label>
        <Input
          id="bankName"
          value={bankName}
          onChange={(event) => setBankName(event.target.value)}
          placeholder="HDFC Bank"
          maxLength={120}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="last4">Last four digits (optional)</Label>
        <Input
          id="last4"
          value={last4}
          onChange={(event) => {
            const value = event.target.value.replace(/\D/g, "").slice(0, 4);
            setLast4(value);
          }}
          inputMode="numeric"
          pattern="\d{4}"
          title="Exactly four digits"
          placeholder="1234"
        />
      </div>

      <div className="flex items-center justify-end">
        <Button type="submit" disabled={pending}>
          <Plus data-icon="inline-start" />
          Add account
        </Button>
      </div>
    </form>
  );
}
