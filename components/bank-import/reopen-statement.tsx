"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reopenStatementAction } from "@/app/bank-connections/actions";

/**
 * Rescue action on a `completed` statement whose imported transactions were
 * deleted from /transactions while the automatic ledger-sync was not yet in
 * place. Reopening stops the stale "Completed" claim and hands the statement
 * back to review, where the dead rows offer Restore and re-import.
 */
export function ReopenStatementButton({
  statementId,
  deadCount,
}: {
  statementId: string;
  /** Number of imported rows whose transaction is not live any more. */
  deadCount: number;
}) {
  const [pending, startTransition] = useTransition();

  function reopen() {
    if (pending) return;
    startTransition(async () => {
      let result: { ok: boolean; error?: string };
      try {
        result = await reopenStatementAction(statementId);
      } catch {
        result = { ok: false, error: "The statement could not be reopened. Try again." };
      }
      if (!result.ok) {
        toast.error(result.error ?? "The statement could not be reopened. Try again.");
        return;
      }
      toast.success("Statement reopened — the deleted rows can be restored or re-imported.");
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={reopen}
      disabled={pending}
      title={`Reopen for the ${deadCount} deleted import${deadCount === 1 ? "" : "s"}`}
    >
      {pending ? (
        <RefreshCcw className="size-3.5 animate-spin" />
      ) : (
        <RefreshCcw className="size-3.5" />
      )}
      Reopen statement
    </Button>
  );
}
