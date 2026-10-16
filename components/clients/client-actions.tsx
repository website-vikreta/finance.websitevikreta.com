"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Edit2, FileText, Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClientFormDialog, type ClientFormData } from "./client-form-dialog";
import { TransactionFormDialog } from "@/components/transactions/transaction-form-dialog";
import { deleteClientAction } from "@/app/clients/actions";
import { cn } from "@/lib/utils";

interface ClientActionsProps {
  client: ClientFormData & { transactionsCount: number; invoicesCount: number };
}

export function ClientActions({ client }: ClientActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canDelete = client.transactionsCount === 0 && client.invoicesCount === 0;

  async function handleDelete() {
    if (!client.id) return;
    setDeleting(true);
    const res = await deleteClientAction(client.id);
    setDeleting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Client deleted");
    router.push("/clients");
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
        <Edit2 className="size-3.5" aria-hidden />
        Edit details
      </Button>

      <Link
        href={`/invoices/new?client=${encodeURIComponent(client.name)}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
      >
        <FileText className="size-3.5" aria-hidden />
        New invoice
      </Link>

      <Button size="sm" onClick={() => setIncomeOpen(true)} className="gap-1.5">
        <Plus className="size-3.5" aria-hidden />
        Record payment
      </Button>

      {canDelete ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDeleteOpen(true)}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Delete client"
          aria-label="Delete client"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      ) : null}

      <ClientFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        client={client}
      />

      <TransactionFormDialog
        open={incomeOpen}
        onOpenChange={setIncomeOpen}
        row={null}
        defaultClient={client.name}
        defaultType="income"
      />

      {canDelete ? (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete {client.name}?</DialogTitle>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" disabled={deleting} onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? "Deleting…" : "Delete client"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
