import { formatDate, formatINR, formatTime } from "@/lib/format";
import { formatStatementPeriod } from "@/lib/bank-import/period";
import { deriveBalancesFromRows } from "@/lib/bank-import/reconciliation";
import { businessDescriptionText, flagsText } from "@/lib/bank-import/display";
import {
  CLASSIFICATION_LABELS,
  LINE_STATUS_LABELS,
  STATEMENT_STATUS_LABELS,
} from "@/lib/bank-import/types";
import type { StatementDetail } from "@/lib/bank-import/queries";
import { PrintSection, PrintTable } from "@/components/layout/print-table";
import { timeInIndia, todayInIndia } from "@/lib/transactions/period";

/** Full money values: whole amounts keep the ledger's no-paise display. */
function amountText(value: string | null): string {
  if (!value) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return formatINR(amount, { decimals: Math.abs(amount % 1) > 0 ? 2 : 0 });
}

/** Same date fallback as the completed-statement table: transaction date, then value date. */
function dateText(line: { txnDate: string | null; valueDate: string | null }): string {
  const date = line.txnDate ?? line.valueDate;
  return date ? formatDate(date) : "—";
}

/**
 * Completed statement → Export PDF. Renders only in print, matching the
 * Transactions / Reports / Clients documents: same title, yellow badge,
 * yellow-ruled sections and black-header tables.
 *
 * The table is intentionally landscape (see .print-bank-statement in
 * globals.css) because nine columns cannot carry a full narration and a full
 * business description on a portrait A4 page without truncating them.
 */
export function PrintStatement({ detail }: { detail: StatementDetail }) {
  const { statement, account, lines } = detail;
  const derived = deriveBalancesFromRows(lines);
  const openingBalance = statement.openingBalance ?? derived.opening;
  const closingBalance = statement.closingBalance ?? derived.closing;
  const today = todayInIndia();
  const generatedAt = timeInIndia();

  return (
    <div className="print-document print-bank-statement hidden text-foreground print:block">
      <header>
        <h1 className="flex items-center gap-3 text-title-lg">
          Bank statement report
          <span className="rounded-md bg-primary px-2 py-0.5 text-caption font-semibold text-primary-foreground">
            {STATEMENT_STATUS_LABELS[statement.status] ?? statement.status}
          </span>
        </h1>
        <p className="mt-1 text-caption text-muted-foreground">
          Website Vikreta · {account.displayName} ·{" "}
          {formatStatementPeriod(statement.periodFrom, statement.periodTo)} · generated{" "}
          {formatDate(today)}, {formatTime(generatedAt)} IST · amounts in INR
        </p>
      </header>

      <PrintSection title="Summary">
        <PrintTable
          head={["Detail", "Value"]}
          align={["left", "right"]}
          rows={[
            { key: "file", cells: ["File", statement.fileName] },
            { key: "account", cells: ["Account", account.displayName] },
            {
              key: "period",
              cells: ["Period", formatStatementPeriod(statement.periodFrom, statement.periodTo)],
            },
            { key: "rows", cells: ["Rows", String(statement.lineCount)] },
            { key: "imported", cells: ["Imported", String(statement.importedCount)] },
            { key: "duplicates", cells: ["Duplicates", String(statement.duplicateCount)] },
            { key: "skipped", cells: ["Skipped", String(statement.skippedCount)] },
            {
              key: "pending-errors",
              cells: ["Pending / errors", `${statement.pendingCount} / ${statement.errorCount}`],
            },
            { key: "opening", cells: ["Opening balance", amountText(openingBalance)] },
            { key: "closing", cells: ["Closing balance", amountText(closingBalance)] },
            { key: "withdrawals", cells: ["Total withdrawals", amountText(statement.withdrawalTotal)] },
            { key: "deposits", cells: ["Total deposits", amountText(statement.depositTotal)] },
          ]}
        />
      </PrintSection>

      <PrintSection title={`Statement rows (${lines.length})`} breakable>
        {lines.length === 0 ? (
          <p className="text-caption text-muted-foreground">No rows in this statement.</p>
        ) : (
          <PrintTable
            head={[
              "Date",
              "Narration",
              "Business Description",
              "Withdrawal",
              "Deposit",
              "Balance",
              "Classification",
              "Flags",
              "Status",
            ]}
            align={["left", "left", "left", "right", "right", "right", "left", "left", "left"]}
            rows={lines.map((line) => ({
              key: line.id,
              cells: [
                dateText(line),
                line.narration?.trim() || "—",
                businessDescriptionText(line),
                amountText(line.withdrawalAmount),
                amountText(line.depositAmount),
                amountText(line.closingBalance),
                CLASSIFICATION_LABELS[line.classification] ?? line.classification,
                flagsText(line.flags),
                LINE_STATUS_LABELS[line.status] ?? line.status,
              ],
            }))}
          />
        )}
      </PrintSection>
    </div>
  );
}
