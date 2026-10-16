"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TransactionFormDialog } from "@/components/transactions/transaction-form-dialog";

/** Opens the manual entry form; the floating bot covers chat entry. */
export function NewTransactionButton({ label = "New transaction" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Plus aria-hidden />
        {label}
      </Button>
      <TransactionFormDialog open={open} onOpenChange={setOpen} row={null} />
    </>
  );
}
