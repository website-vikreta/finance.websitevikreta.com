"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Edit2, FileText, Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ClientFormDialog, type ClientFormData } from "./client-form-dialog";
import { TransactionFormDialog } from "@/components/transactions/transaction-form-dialog";
import { ClientDeleteDialog } from "./client-delete-dialog";
import { cn } from "@/lib/utils";

interface ClientActionsProps {
  client: ClientFormData & { transactionsCount: number; invoicesCount: number };
}

export function ClientActions({ client }: ClientActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingClient, setDeletingClient] = useState<{ id: string; name: string } | null>(null);

  async function handleDelete() {
    if (!client.id) return;
    setDeletingClient({ id: client.id, name: client.name });
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

      {/* One delete icon per client. Permanent deletion is available irrespective of
          linked records; the server resolves the dependency graph inside one transaction. */}
      <Button
        size="sm"
        onClick={handleDelete}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        title="Permanently delete client"
        aria-label="Permanently delete client"
      >
        <Trash2 className="size-3.5" aria-hidden />
      </Button>

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

      <ClientDeleteDialog
        client={deletingClient}
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeletingClient(null);
        }}
        onDeleted={() => router.push("/clients")}
      />
    </div>
  );
}
