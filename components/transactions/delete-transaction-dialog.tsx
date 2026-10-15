"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteTransactionAction } from "@/app/transactions/actions";
import { formatDate, formatINR } from "@/lib/format";
import type { LedgerRow } from "@/lib/transactions/queries";
import { restoreWithToast } from "./restore-toast";

interface DeleteTransactionDialogProps {
  row: LedgerRow | null;
  onOpenChange: (open: boolean) => void;
}

export function DeleteTransactionDialog({ row, onOpenChange }: DeleteTransactionDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close(open: boolean) {
    if (!open) setError(null);
    onOpenChange(open);
  }

  function confirm() {
    if (!row) return;
    startTransition(async () => {
      const result = await deleteTransactionAction(row.id);
      if (!result.ok) return setError(result.error);
      close(false);
      toast(`Deleted ${row.title}`, {
        description: `${formatINR(row.amountInr)} · ${formatDate(row.date)}. You can restore it from Recently deleted.`,
        action: { label: "Undo", onClick: () => void restoreWithToast(row.id, row.title) },
      });
    });
  }

  return (
    <Dialog open={row !== null} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-title-md">
                Delete {row.title}, {formatDate(row.date)}?
              </DialogTitle>
              <DialogDescription>
                {formatINR(row.amountInr)} will be removed from the ledger. You can restore it later.
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <p role="alert" className="text-caption text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
                Keep it
              </Button>
              <Button type="button" variant="destructive" onClick={confirm} disabled={pending}>
                {pending ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
