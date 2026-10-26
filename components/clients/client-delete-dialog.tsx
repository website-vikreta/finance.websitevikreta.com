"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clientDeletionPreviewAction, deleteClientAction } from "@/app/clients/actions";
import type { ClientDeletionScope } from "@/lib/clients/clients";

interface ClientDeleteDialogProps {
  client: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the server transaction commits and the client is gone from the database. */
  onDeleted?: () => void;
}

export function ClientDeleteDialog({
  client,
  open,
  onOpenChange,
  onDeleted,
}: ClientDeleteDialogProps) {
  const [scope, setScope] = useState<ClientDeletionScope | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived: true while the server-side dependency counts are being loaded.
  const loadingScope = scope === null && !error && open && !!client;

  // Load the authoritative dependency counts when the dialog opens (server-side).
  // The DialogContent is keyed by client id so it remounts (resetting all state)
  // whenever a different client is selected or the dialog closes.
  useEffect(() => {
    if (!open || !client) return;
    let cancelled = false;
    clientDeletionPreviewAction(client.id)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setScope(res.scope);
        else setError(res.error);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load deletion details. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, client]);

  const ready = scope !== null && !loadingScope;
  const confirmed =
    ready && scope ? confirmName.trim() === scope.clientName : false;

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!client || !scope || deleting || !confirmed) return;
    setDeleting(true);
    setError(null);
    const res = await deleteClientAction(client.id, confirmName.trim());
    setDeleting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success("Client deleted permanently");
    onOpenChange(false);
    onDeleted?.();
  }

  if (!open) return null;
  if (!client) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent key={client.id} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Permanently delete {client.name}?</DialogTitle>
          <DialogDescription className="text-destructive">
            This cannot be undone. The client will be removed from the active and
            recoverable client records and will not appear in the client list again.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-caption text-destructive">
            {error}
          </p>
        ) : null}

        {!ready ? (
          <div className="space-y-2 py-4">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <p className="text-caption text-muted-foreground">Loading dependent records&hellip;</p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-body-sm text-foreground">
              Deleting <b>{client.name}</b> will also permanently remove the dependent records listed
              below. These records are specific to this client only; other clients and their records
              are not touched.
            </p>

            <div className="mb-4 space-y-2 text-body-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>Client-linked transactions</span>
                <span className="font-mono">{scope.transactions}</span>
              </div>
              <div className="flex justify-between">
                <span>Invoices issued to this client</span>
                <span className="font-mono">{scope.invoices}</span>
              </div>
              <div className="flex justify-between">
                <span>Invoice items on those invoices</span>
                <span className="font-mono">{scope.invoiceItems}</span>
              </div>
              <div className="flex justify-between">
                <span>Recurring bills tagged to this client</span>
                <span className="font-mono">{scope.recurringExpenses}</span>
              </div>
              <div className="flex justify-between">
                <span>Bank-import lines mapped to this client</span>
                <span className="font-mono">{scope.bankStatementLines}</span>
              </div>
            </div>

            <p className="mb-4 text-body-sm text-foreground">
              The permanently deleted transactions and invoices will no longer be available through
              the application&rsquo;s normal history or the Restore interface.
            </p>

            <div className="rounded-lg border border-border bg-muted/50 px-3 py-3 text-caption text-muted-foreground mb-4">
              <p className="mb-1">What is retained:</p>
              <ul className="list-disc pl-5 space-y-1 text-body-sm">
                <li>
                  Original bank statement source records, raw narration, bank reference and source
                  lineage are preserved for reconciliation; only this client&rsquo;s relationship to them
                  is removed.
                </li>
                <li>
                  Mandatory audit history is never deleted. A minimal deletion audit event (client
                  id only) is recorded and kept permanently.
                </li>
              </ul>
            </div>

            <form onSubmit={handleDelete} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="delete-confirm-name">
                  Type the exact client name to confirm
                </Label>
                <Input
                  id="delete-confirm-name"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={client.name}
                  disabled={deleting}
                  className="font-mono"
                />
                <p className="text-caption text-muted-foreground">
                  The deletion is only enabled when the name matches exactly.
                </p>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  disabled={deleting || !ready}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={deleting || !ready || !confirmed}
                >
                  {deleting ? "Deleting&hellip;" : "Permanently delete client"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
