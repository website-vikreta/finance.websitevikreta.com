import { formatDate, formatINR, formatTime } from "@/lib/format";
import { SOURCE_LABELS } from "@/lib/transactions/csv";
import type { LedgerRow } from "@/lib/transactions/queries";
import { PrintSection, PrintTable } from "@/components/layout/print-table";

interface PrintTransactionsProps {
  filtered: LedgerRow[];
  filter: "all" | "income" | "expense";
  currency: string;
  category: string;
  from: string;
  to: string;
  search: string;
  today: string;
  generatedAt: string;
  totalIn: number;
  totalOut: number;
}

/**
 * Transactions → Export PDF. A clean, styled document rendered only in print;
 * on-screen filters, search, and pagination are hidden.
 */
export function PrintTransactions({
  filtered,
  filter,
  currency,
  category,
  from,
  to,
  search,
  today,
  generatedAt,
  totalIn,
  totalOut,
}: PrintTransactionsProps) {
  const net = totalIn - totalOut;
  const inCount = filtered.filter((r) => r.type === "income").length;
  const outCount = filtered.filter((r) => r.type === "expense").length;
  const signed = (n: number) => `${n < 0 ? "−" : ""}${formatINR(Math.abs(n))}`;

  const filterBadges: string[] = [];
  if (filter !== "all") filterBadges.push(filter === "income" ? "Money in" : "Money out");
  if (currency !== "all") filterBadges.push(`Currency: ${currency}`);
  if (category !== "all") filterBadges.push(`Category: ${category}`);
  if (from && to) filterBadges.push(`${formatDate(from)} to ${formatDate(to)}`);
  else if (from) filterBadges.push(`From ${formatDate(from)}`);
  else if (to) filterBadges.push(`To ${formatDate(to)}`);
  if (search) filterBadges.push(`Search: "${search}"`);

  return (
    <div className="print-document hidden text-foreground print:block">
      <header>
        <h1 className="flex items-center gap-3 text-title-lg">
          Transactions report
          <span className="rounded-md bg-primary px-2 py-0.5 text-caption font-semibold text-primary-foreground">
            {filter === "all" ? "All" : filter === "income" ? "Money in" : "Money out"}
          </span>
        </h1>
        <p className="mt-1 text-caption text-muted-foreground">
          Website Vikreta · {filterBadges.length > 0 ? filterBadges.join(" · ") + " · " : ""}generated {formatDate(today)}, {formatTime(generatedAt)} IST · amounts in INR
        </p>
      </header>

      <PrintSection title="Summary">
        <PrintTable
          head={["Type", "Count", "Amount (INR)"]}
          align={["left", "right", "right"]}
          rows={[
            { key: "in", cells: ["Money in (Income)", `${inCount} payments`, formatINR(totalIn)] },
            { key: "out", cells: ["Money out (Expenses)", `${outCount} entries`, formatINR(totalOut)] },
            {
              key: "net",
              cells: ["Net", inCount > 0 ? `${((net / totalIn) * 100).toFixed(1)}% margin` : "", signed(net)],
              strong: true,
              negative: net < 0,
            },
          ]}
        />
      </PrintSection>

      <PrintSection title={`Transactions (${filtered.length})`} breakable>
        {filtered.length === 0 ? (
          <p className="text-caption text-muted-foreground">No transactions match the selected filters.</p>
        ) : (
          <PrintTable
            head={["Date", "Time", "Type", "Client / Description", "Category", "Source", "Amount"]}
            align={["left", "left", "left", "left", "left", "left", "right"]}
            rows={filtered.map((r) => ({
              key: r.id,
              cells: [
                formatDate(r.date),
                formatTime(r.time),
                r.type === "income" ? "Income" : "Expense",
                r.title,
                r.type === "income" ? "Income" : (r.category ?? "Expense"),
                SOURCE_LABELS[r.source] ?? r.source,
                `${r.type === "income" ? "+" : "−"}${formatINR(r.amountInr, { decimals: r.amountInr % 1 === 0 ? 0 : 2 })}${r.originalCurrency === "USD" ? ` ($${r.originalAmount.toFixed(2)})` : ""}`,
              ],
              negative: r.type === "expense",
            }))}
          />
        )}
      </PrintSection>
    </div>
  );
}
