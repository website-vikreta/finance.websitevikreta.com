import { formatINR, formatDate } from "@/lib/format";
import { formatStatementPeriod } from "@/lib/bank-import/period";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ReopenStatementButton } from "@/components/bank-import/reopen-statement";
import type { LineFlag, LineStatus } from "@/lib/bank-import/types";
import {
  STATEMENT_STATUS_LABELS,
  type StatementStatus,
  type StatementDetail,
  type Classification,
} from "@/lib/bank-import/queries";
import { deriveBalancesFromRows } from "@/lib/bank-import/reconciliation";

const STATUS_BADGE: Record<StatementStatus, string> = {
  review: "border-warning/40 bg-warning/15 text-warning",
  importing: "border-primary/40 bg-primary/10 text-primary",
  completed: "border-success/40 bg-success/15 text-success",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  cancelled: "border-border bg-muted text-muted-foreground",
};

const LINE_BADGE: Record<LineStatus, string> = {
  pending: "P",
  ready: "R",
  imported: "I",
  skipped: "S",
  duplicate: "D",
  error: "E",
};

const CLASSIFICATION_LABEL: Record<Classification, string> = {
  unclassified: "Unclassified",
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  refund: "Refund",
  reversal: "Reversal",
  other: "Other",
  non_business: "Non-business",
};

function amount(value: string | null) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <span className="font-mono">{formatINR(Number(value))}</span>;
}

/**
 * Completed-statement Business Description display: the saved staging value
 * first, and the imported transaction's own saved description only when the
 * staging line has none (its real import relationship). Never regenerated,
 * never rewritten — the original narration column above stays untouched.
 */
export function businessDescriptionText(line: {
  businessDescription?: string | null;
  transactionDescription?: string | null;
}): string {
  const fromStaging = line.businessDescription?.trim();
  if (fromStaging) return fromStaging;
  const fromTransaction = line.transactionDescription?.trim();
  if (fromTransaction) return fromTransaction;
  return "—";
}

/**
 * Summary card for one staged statement. Also used by the Phase 3 review
 * workspace, which adds the reconciliation card and the review table around it.
 */
export function StatementSummaryCard({ detail }: { detail: StatementDetail }) {
  const { statement, account } = detail;
  const flags: LineFlag[] = [...new Set(detail.lines.flatMap((line) => line.flags))];
  // Declared summary balances first; the printed row balances fill a gap.
  const derived = deriveBalancesFromRows(detail.lines);
  const openingBalance = statement.openingBalance ?? derived.opening;
  const closingBalance = statement.closingBalance ?? derived.closing;

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <CardTitle className="truncate">{statement.fileName}</CardTitle>
            <p className="text-caption text-muted-foreground">
              {account.displayName} ·{" "}
              {formatStatementPeriod(statement.periodFrom, statement.periodTo)}
            </p>
          </div>
          <Badge
            variant="outline"
            className={STATUS_BADGE[statement.status] ?? STATUS_BADGE.review}
          >
            {STATEMENT_STATUS_LABELS[statement.status] ?? statement.status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-4 pt-0">
        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 text-body-sm sm:grid-cols-3">
          <div>
            <p className="text-caption text-muted-foreground">
              Opening balance{statement.openingBalance ? "" : " (derived)"}
            </p>
            <p className="font-mono">{amount(openingBalance)}</p>
          </div>
          <div>
            <p className="text-caption text-muted-foreground">
              Closing balance{statement.closingBalance ? "" : " (derived)"}
            </p>
            <p className="font-mono">{amount(closingBalance)}</p>
          </div>
          <div>
            <p className="text-caption text-muted-foreground">Pages</p>
            <p>{statement.pageCount}</p>
          </div>
          <div>
            <p className="text-caption text-muted-foreground">Rows</p>
            <p>{statement.lineCount}</p>
          </div>
          <div>
            <p className="text-caption text-muted-foreground">Pending / errors</p>
            <p>
              {statement.pendingCount} / {statement.errorCount}
            </p>
          </div>
          <div>
            <p className="text-caption text-muted-foreground">Imported / skipped / dup</p>
            <p>
              {statement.importedCount} / {statement.skippedCount} / {statement.duplicateCount}
            </p>
          </div>
          <div>
            <p className="text-caption text-muted-foreground">Ready to import</p>
            <p>{statement.readyCount}</p>
          </div>
          <div>
            <p className="text-caption text-muted-foreground">Uploaded</p>
            <p>{formatDate(statement.createdAt.slice(0, 10))}</p>
          </div>
        </div>

        {flags.length > 0 ? (
          <p className="mt-5 text-caption text-muted-foreground">
            Flag categories:{" "}
            {flags.map((flag) => (
              <Badge key={flag} variant="outline" className="mr-1 text-caption">
                {flag}
              </Badge>
            ))}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Those are the read-only staging rows a manager reviews before Phase 3. */
export function StatementDetailScreen({ detail }: { detail: StatementDetail }) {
  const { lines } = detail;
  const statementId = detail.statement.id;
  // Imports deleted in the ledger while this statement already claimed
  // "completed": per-row marks below, plus an explicit reopen rescue here.
  const deadImports = lines.filter(
    (line) => line.status === "imported" && line.importLive === false,
  ).length;

  return (
    <div className="space-y-6">
      <StatementSummaryCard detail={detail} />

      {deadImports > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
          <div className="space-y-0.5">
            <p className="text-body-sm text-foreground">
              {deadImports} imported row{deadImports === 1 ? "" : "s"} deleted in the ledger
            </p>
            <p className="text-caption text-muted-foreground">
              These staged rows no longer have live transactions. Reopen the statement to review
              and re-import them.
            </p>
          </div>
          <ReopenStatementButton statementId={statementId} deadCount={deadImports} />
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-0">
          <CardTitle>Staging rows</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Date</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead>Business Description</TableHead>
                <TableHead className="text-right">Withdrawal</TableHead>
                <TableHead className="text-right">Deposit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead className="pr-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="pl-4 font-mono whitespace-nowrap">
                    {line.txnDate
                      ? formatDate(line.txnDate)
                      : line.valueDate
                        ? formatDate(line.valueDate)
                        : "None"}
                  </TableCell>
                  <TableCell className="max-w-[14rem] truncate" title={line.narration ?? undefined}>
                    {line.narration || "—"}
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={businessDescriptionText(line) === "—" ? undefined : businessDescriptionText(line)}>
                    {businessDescriptionText(line)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{amount(line.withdrawalAmount)}</TableCell>
                  <TableCell className="text-right font-mono">{amount(line.depositAmount)}</TableCell>
                  <TableCell className="text-right font-mono">{amount(line.closingBalance)}</TableCell>
                  <TableCell>{CLASSIFICATION_LABEL[line.classification] ?? line.classification}</TableCell>
                  <TableCell>
                    <p className="max-w-[12rem] truncate text-wrap">
                      {line.flags.map((flag) => (
                        <Badge
                          key={flag}
                          variant="outline"
                          className="mr-1 text-caption"
                          title={flag}
                        >
                          {flag}
                        </Badge>
                      ))}
                    </p>
                  </TableCell>
                  <TableCell className="font-mono pr-4">
                    {LINE_BADGE[line.status]}
                    {line.status === "imported" && line.importLive === false ? (
                      <p
                        className="mt-1 text-caption text-destructive"
                        title="The imported transaction was deleted in the ledger."
                      >
                        Import deleted
                      </p>
                    ) : line.status === "imported" &&
                      line.importLive === true &&
                      line.postImportEdited ? (
                      <p
                        className="mt-1 text-caption text-warning"
                        title="The ledger transaction was edited after this import."
                      >
                        Edited in ledger
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
