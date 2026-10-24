import { AlertTriangle, CircleAlert, CircleCheck, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/format";
import type { StatementReconciliation } from "@/lib/bank-import/reconciliation";

const STATUS_META: Record<
  StatementReconciliation["status"],
  { label: string; badge: string; icon: React.ReactNode }
> = {
  balanced: {
    label: "Balanced",
    badge: "border-success/40 bg-success/15 text-success",
    icon: <CircleCheck className="size-4" />,
  },
  unbalanced: {
    label: "Unbalanced",
    badge: "border-destructive/40 bg-destructive/10 text-destructive",
    icon: <CircleAlert className="size-4" />,
  },
  insufficient_data: {
    label: "Needs data",
    badge: "border-warning/40 bg-warning/15 text-warning",
    icon: <Info className="size-4" />,
  },
};

function money(value: string | null) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <span className="font-mono">{formatINR(Number(value), { decimals: 2 })}</span>;
}

/**
 * Read-only reconciliation summary for a staged statement. It never mutates
 * anything; the reviewer decides what the numbers mean.
 */
export function ReconciliationCard({
  reconciliation,
}: {
  reconciliation: StatementReconciliation;
}) {
  const meta = STATUS_META[reconciliation.status];

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Reconciliation</CardTitle>
          <Badge variant="outline" className={`${meta.badge} gap-1.5 px-2.5 py-1`}>
            {meta.icon}
            {meta.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-4 pt-0">
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-body-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <p className="text-caption text-muted-foreground">Opening</p>
            {money(reconciliation.openingBalance)}
          </div>
          <div>
            <p className="text-caption text-muted-foreground">Deposits</p>
            {money(reconciliation.depositsTotal)}
          </div>
          <div>
            <p className="text-caption text-muted-foreground">Withdrawals</p>
            {money(reconciliation.withdrawalsTotal)}
          </div>
          <div>
            <p className="text-caption text-muted-foreground">Counted closing</p>
            {money(reconciliation.expectedClosing)}
          </div>
          <div>
            <p className="text-caption text-muted-foreground">Declared closing</p>
            {money(reconciliation.closingBalance)}
          </div>
          <div>
            <p className="text-caption text-muted-foreground">Difference</p>
            {money(reconciliation.difference)}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-caption">
          <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
            {reconciliation.parsedCount} parsed
          </Badge>
          <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
            {reconciliation.readyCount} ready
          </Badge>
          <Badge variant="outline" className="border-warning/40 bg-warning/15 text-warning">
            {reconciliation.pendingCount} pending
          </Badge>
          <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
            {reconciliation.skippedCount} skipped
          </Badge>
          <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
            {reconciliation.duplicateCount} duplicates
          </Badge>
          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
            {reconciliation.errorCount} errors
          </Badge>
          {reconciliation.unresolvedCount > 0 ? (
            <Badge variant="outline" className="border-warning/50 bg-warning/20 text-warning">
              {reconciliation.unresolvedCount} unresolved
            </Badge>
          ) : null}
        </div>

        {reconciliation.warnings.length > 0 ? (
          <ul className="mt-4 space-y-1.5 text-body-sm text-muted-foreground">
            {reconciliation.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 flex items-center gap-2 text-body-sm text-success">
            <CircleCheck className="size-3.5" />
            No reconciliation warnings for this statement.
          </p>
        )}

        {reconciliation.overlappingStatements.length > 0 ? (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
            <p className="text-caption text-warning">Overlapping statement periods</p>
            <ul className="mt-1 space-y-0.5 text-body-sm">
              {reconciliation.overlappingStatements.map((overlap) => (
                <li key={overlap.id} className="text-muted-foreground">
                  {overlap.fileName}
                  {overlap.statementFrom
                    ? ` · ${overlap.statementFrom} → ${overlap.statementTo ?? "?"}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
