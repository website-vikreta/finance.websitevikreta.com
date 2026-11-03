"use client";

import Link from "next/link";
import { useState } from "react";
import { Clock, FileText, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import type { StatementSummary, StatementStatus } from "@/lib/bank-import/queries";
import { deleteStatementAction } from "@/app/bank-connections/actions";

const STATUS_METADATA: Record<StatementStatus, { label: string; className: string }> = {
  review: { label: "For review", className: "bg-warning/15 text-warning border-warning/40" },
  importing: { label: "Importing", className: "bg-primary/10 text-primary border-primary/40" },
  completed: { label: "Completed", className: "bg-success/15 text-success border-success/40" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive border-destructive/40" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground border-border" },
};

function statusBadge(status: StatementStatus) {
  const metadata = STATUS_METADATA[status];
  if (metadata) return <Badge variant="outline" className={metadata.className}>{metadata.label}</Badge>;
  return <Badge variant="outline" className="border-border text-muted-foreground">{status}</Badge>;
}

interface DeleteDialogProps {
  statement: StatementSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}

function DeleteStatementDialog({
  statement,
  open,
  onOpenChange,
  onDelete,
}: DeleteDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this bank statement?</DialogTitle>
          <DialogDescription>
            The statement’s review data and its staging lines are removed
            permanently. Imported ledger transactions move to Recently deleted,
            where they can be restored.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-body-sm">
          <p>
            <strong>File:</strong> {statement.fileName}
          </p>
          <p>
            <strong>Account:</strong> {statement.accountName}
          </p>
          <p>
            <strong>Period:</strong>{" "}
            {statement.statementFrom
              ? `${formatDate(statement.statementFrom)} → ${
                  statement.statementTo ? formatDate(statement.statementTo) : "Ongoing"
                }`
              : "Statement period unavailable"}
          </p>
          <p>
            <strong>Lines:</strong> {statement.lineCount} total &nbsp;·&nbsp;
            {statement.importedCount} imported &nbsp;·&nbsp;
            {statement.skippedCount} skipped &nbsp;·&nbsp;
            {statement.pendingCount} pending
          </p>
          {statement.importedCount > 0 ? (
            <p>
              {statement.importedCount} imported transaction
              {statement.importedCount === 1 ? "" : "s"} will move to{" "}
              <strong>Recently deleted</strong> on the Transactions page and can
              be restored there.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={async () => {
              setSubmitting(true);
              try {
                await onDelete();
                toast.success("Statement deleted.");
              } catch {
                toast.error("Deletion failed. Try again.");
              } finally {
                setSubmitting(false);
                onOpenChange(false);
              }
            }}
            disabled={submitting}
          >
            {submitting ? "Deleting…" : "Delete statement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A minimal, non-financial history line so managers can reopen a statement. */
export function StatementList({ statements }: { statements: StatementSummary[] }) {
  // Controlled dialog state: open only while a delete was explicitly
  // requested, closed otherwise — no stale open state survives a reload.
  const [deleteId, setDeleteId] = useState<string | null>(null);

  return statements.map((statement) => (
    <Card key={statement.id}>
      <CardContent className="p-4">
        <article className="flex items-center justify-between gap-6">
          {/* The link wraps only the descriptive block; the delete control must
              stay outside it, or the click navigates instead of opening the
              confirm dialog. */}
          <Link
            href={`/bank-connections/${statement.id}`}
            className="block min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-caption text-muted-foreground">
                <FileText className="size-3.5" aria-hidden />
                <span className="truncate">{statement.fileName}</span>
              </div>
              <p className="mt-0.5 truncate text-body-sm font-medium">
                {statement.statementFrom
                  ? `${formatDate(statement.statementFrom)} → ${
                      statement.statementTo ? formatDate(statement.statementTo) : "Ongoing"
                    }`
                  : "Statement period unavailable"}
              </p>
              <p className="mt-1 text-caption text-muted-foreground">
                {statement.accountName} · {statement.lineCount} rows · {statement.pageCount}{" "}
                {statement.pageCount === 1 ? "page" : "pages"} · {statement.pendingCount} pending ·{" "}
                {statement.errorCount} errors
              </p>
            </div>
          </Link>

          <div className="shrink-0 flex items-center gap-2">
            {statusBadge(statement.status)}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setDeleteId(statement.id)}
              aria-label={`Delete ${statement.fileName}`}
            >
              <Trash2 className="size-4" />
            </Button>
            <p className="mt-1 flex items-center justify-end gap-1 text-caption text-muted-foreground">
              <Clock className="size-3" aria-hidden />
              {formatDate(statement.createdAt.slice(0, 10))}
            </p>
          </div>
        </article>

        <DeleteStatementDialog
          statement={statement}
          open={deleteId === statement.id}
          onOpenChange={(open) => setDeleteId(open ? statement.id : null)}
          onDelete={async () => {
            const result = await deleteStatementAction(statement.id);
            if (!result.ok) {
              toast.error(result.error);
              throw new Error(result.error);
            }
          }}
        />
      </CardContent>
    </Card>
  ));
}
