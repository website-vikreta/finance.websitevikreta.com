import { STATUS_LABEL, type DisplayStatus } from "@/lib/invoices/math";
import { cn } from "@/lib/utils";

const TONE: Record<DisplayStatus, string> = {
  draft: "border-border bg-muted text-muted-foreground",
  sent: "border-border bg-card text-foreground",
  partial: "border-warning/40 bg-warning/10 text-foreground",
  overdue: "border-destructive/30 bg-destructive/10 text-destructive",
  paid: "border-success/30 bg-success/10 text-success",
  void: "border-border bg-muted text-muted-foreground line-through",
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-caption font-medium whitespace-nowrap", TONE[status])}>{STATUS_LABEL[status]}</span>;
}
