"use client";

import { Check, CheckCircle2, Edit2, X, XCircle, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { ConfirmationTransaction } from "./types";

interface TransactionSummaryCardProps {
  transaction: ConfirmationTransaction;
  isConfirmed?: boolean;
  isCancelled?: boolean;
  /** Label for a card that is no longer actionable (default "Discarded"). */
  discardedLabel?: string;
  isPendingAction?: boolean;
  /** Likely-duplicate warning from the server. */
  duplicate?: string;
  onConfirm?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
}

export function TransactionSummaryCard({
  transaction,
  isConfirmed = false,
  isCancelled = false,
  discardedLabel = "Discarded",
  isPendingAction = false,
  duplicate,
  onConfirm,
  onEdit,
  onCancel,
}: TransactionSummaryCardProps) {
  const isIncome = transaction.type === "income";
  const isUSD = transaction.original_currency === "USD";

  const formattedOriginalAmount = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(transaction.original_amount);

  const formattedInrAmount = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(transaction.inr_amount);

  return (
    <div
      className={cn(
        "my-3 w-full rounded-xl border bg-card/90 p-4 transition-all",
        isConfirmed
          ? "border-success/40 bg-success/5"
          : isCancelled
            ? "border-border bg-muted/40 opacity-70"
            : "border-primary/40 bg-card ring-1 ring-primary/20"
      )}
    >
      {/* Header: Type and Status */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          {isIncome ? (
            <Badge
              variant="outline"
              className="border-success/30 bg-success/10 text-success gap-1 px-2.5 py-1 text-caption font-semibold"
            >
              <ArrowDownLeft className="size-3.5" aria-hidden />
              <span>Income</span>
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-destructive/30 bg-destructive/10 text-destructive gap-1 px-2.5 py-1 text-caption font-semibold"
            >
              <ArrowUpRight className="size-3.5" aria-hidden />
              <span>Expense</span>
            </Badge>
          )}
          <span className="text-caption text-muted-foreground whitespace-nowrap">
            {formatDate(transaction.txn_date)}
          </span>
        </div>

        <div>
          {isConfirmed ? (
            <span className="flex items-center gap-1.5 text-caption font-medium text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              <span>Confirmed</span>
            </span>
          ) : isCancelled ? (
            <span className="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
              <XCircle className="size-4" aria-hidden />
              <span>{discardedLabel}</span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Primary Financial Display */}
      <div className="mt-3.5 space-y-3">
        <div>
          <p className="text-caption text-muted-foreground">{isIncome ? "Client" : "For"}</p>
          <p className="mt-0.5 text-title-sm font-semibold text-foreground">
            {isIncome
              ? transaction.client_name || "Unknown client"
              : transaction.expense_description || "No description"}
          </p>
          {!isIncome && transaction.category ? (
            <p className="text-caption text-muted-foreground">{transaction.category}</p>
          ) : null}
        </div>

        <div className={cn("grid gap-3 rounded-lg border border-border/50 bg-background/50 p-3", isUSD && "grid-cols-2")}>
          <div>
            <p className="text-caption text-muted-foreground">Amount</p>
            <p className="mt-0.5 text-title-sm font-mono font-semibold tabular-nums text-foreground">
              {isUSD ? "$" : "₹"}
              {formattedOriginalAmount}{" "}
              <span className="text-caption font-normal text-muted-foreground">
                {transaction.original_currency}
              </span>
            </p>
          </div>

          {isUSD ? (
            <div>
              <p className="text-caption text-muted-foreground">In INR</p>
              <p
                className={cn(
                  "mt-0.5 text-title-sm font-mono font-semibold tabular-nums",
                  isIncome ? "text-success" : "text-foreground"
                )}
              >
                ₹{formattedInrAmount}
              </p>
            </div>
          ) : null}
        </div>

        {/* Exchange Rate breakdown if USD */}
        {isUSD && transaction.exchange_rate !== null && (
          <div className="flex items-center justify-between text-caption text-muted-foreground border-t border-border/40 pt-2">
            <span>Exchange rate</span>
            <span className="font-mono font-semibold text-foreground tabular-nums">
              1 USD = ₹{transaction.exchange_rate.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* Confirmation actions */}
      {!isConfirmed && !isCancelled ? (
        <div className="mt-4 space-y-2.5 border-t border-border/60 pt-3">
          {duplicate ? (
            <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-foreground">
              {duplicate} Confirm only if it&apos;s a separate payment.
            </p>
          ) : (
            <p className="text-caption text-muted-foreground">
              Nothing is saved until you confirm.
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={isPendingAction}
              onClick={onConfirm}
              className="font-semibold"
            >
              <Check className="size-3.5" aria-hidden />
              Confirm
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPendingAction}
              onClick={onEdit}
              className="gap-1.5"
            >
              <Edit2 className="size-3.5" aria-hidden />
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isPendingAction}
              onClick={onCancel}
              className="gap-1 text-muted-foreground hover:text-destructive"
            >
              <X className="size-3.5" aria-hidden />
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
