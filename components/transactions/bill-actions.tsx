"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RecurringRow } from "@/lib/transactions/recurring";
import { EditBillDialog } from "./edit-bill-dialog";
import { toBill } from "./recurring-list";
import { TransactionFormDialog, type BillToLog } from "./transaction-form-dialog";

/** Mark paid (active bills) and Edit on the bill page; the same dialogs as the bills list. */
export function BillActions({ bill }: { bill: RecurringRow }) {
  const [logging, setLogging] = useState<BillToLog | null>(null);
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={() => setEditing(true)}>
        <Pencil aria-hidden />
        Edit
      </Button>
      {bill.isActive ? <Button onClick={() => setLogging(toBill(bill))}>Mark paid</Button> : null}
      <TransactionFormDialog open={logging !== null} onOpenChange={(o) => !o && setLogging(null)} bill={logging} />
      <EditBillDialog bill={editing ? bill : null} onOpenChange={(o) => !o && setEditing(false)} />
    </div>
  );
}
