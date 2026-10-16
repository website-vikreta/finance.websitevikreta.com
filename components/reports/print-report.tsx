import { formatDate, formatINR, formatMonthShort, formatShare, formatTime } from "@/lib/format";
import { SOURCE_LABELS } from "@/lib/transactions/csv";
import type { Breakdown, LedgerRow, MonthTotals } from "@/lib/transactions/queries";
import { cn } from "@/lib/utils";

interface PrintReportProps {
  periodLabel: string;
  /** YYYY-MM-DD, or null for all time. */
  from: string | null;
  today: string;
  /** HH:MM, India time. */
  generatedAt: string;
  income: Breakdown[];
  expenses: Breakdown[];
  months: MonthTotals[];
  rows: LedgerRow[];
}

/**
 * Reports → Export PDF. A plain document (title, meta line, yellow-ruled sections, black-header
 * tables), rendered only in print; the on-screen dashboard cards are hidden there.
 */
export function PrintReport({ periodLabel, from, today, generatedAt, income, expenses, months, rows }: PrintReportProps) {
  const totalIn = income.reduce((s, i) => s + i.amount, 0);
  const totalOut = expenses.reduce((s, i) => s + i.amount, 0);
  const net = totalIn - totalOut;
  const inCount = income.reduce((s, i) => s + i.count, 0);
  const outCount = expenses.reduce((s, i) => s + i.count, 0);
  const activeMonths = [...months].reverse().filter((m) => (!from || m.month >= from.slice(0, 7) + "-01") && (m.income || m.expense));
  const signed = (n: number) => `${n < 0 ? "−" : ""}${formatINR(Math.abs(n))}`;

  return (
    <div className="print-document hidden text-foreground print:block">
      <header>
        <h1 className="flex items-center gap-3 text-title-lg">
          Finance report
          <span className="rounded-md bg-primary px-2 py-0.5 text-caption font-semibold text-primary-foreground">{periodLabel}</span>
        </h1>
        <p className="mt-1 text-caption text-muted-foreground">
          Website Vikreta · {from ? `${formatDate(from)} to ${formatDate(today)}` : `All time to ${formatDate(today)}`} · generated {formatDate(today)}, {formatTime(generatedAt)} IST · amounts in INR
        </p>
      </header>

      <Section title="Summary">
        <Table
          head={["", "Count", "Amount"]}
          align={["left", "right", "right"]}
          rows={[
            { key: "in", cells: ["Income", `${inCount} payments`, formatINR(totalIn)] },
            { key: "out", cells: ["Expenses", `${outCount} entries`, formatINR(totalOut)] },
            { key: "net", cells: ["Net", totalIn > 0 ? `${((net / totalIn) * 100).toFixed(1)}% margin` : "", signed(net)], strong: true, negative: net < 0 },
          ]}
        />
      </Section>

      <Section title={`Income by client (${income.length})`}>
        <Breakdowns items={income} total={totalIn} label="Client" countLabel="Payments" empty="No income in this period." />
      </Section>

      <Section title={`Expenses by category (${expenses.length})`}>
        <Breakdowns items={expenses} total={totalOut} label="Category" countLabel="Entries" empty="No expenses in this period." />
      </Section>

      {activeMonths.length > 1 ? (
        <Section title={`By month (${activeMonths.length})`}>
          <Table
            head={["Month", "Income", "Expenses", "Net"]}
            align={["left", "right", "right", "right"]}
            rows={activeMonths.map((m) => ({
              key: m.month,
              cells: [`${formatMonthShort(m.month)} ${m.month.slice(0, 4)}`, formatINR(m.income), formatINR(m.expense), signed(m.income - m.expense)],
              negative: m.income < m.expense,
            }))}
          />
        </Section>
      ) : null}

      <Section title={`Transactions (${rows.length})`} breakable>
        {rows.length === 0 ? (
          <p className="text-caption text-muted-foreground">Nothing recorded in this period.</p>
        ) : (
          <Table
            head={["Date", "Description", "Category", "Source", "Amount"]}
            align={["left", "left", "left", "left", "right"]}
            rows={rows.map((r) => ({
              key: r.id,
              cells: [
                formatDate(r.date),
                r.title,
                r.type === "income" ? "Income" : (r.category ?? "Expense"),
                SOURCE_LABELS[r.source] ?? r.source,
                `${r.type === "income" ? "+" : "−"}${formatINR(r.amountInr, { decimals: r.amountInr % 1 === 0 ? 0 : 2 })}`,
              ],
            }))}
          />
        )}
      </Section>
    </div>
  );
}

function Section({ title, children, breakable = false }: { title: string; children: React.ReactNode; breakable?: boolean }) {
  return (
    <section className={cn("mt-7", !breakable && "break-inside-avoid")}>
      <h2 className="border-b-2 border-primary pb-1 text-title-sm">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

type Cell = string;
interface TableRow {
  key: string;
  cells: Cell[];
  strong?: boolean;
  /** Colours the last (amount) cell red. */
  negative?: boolean;
}

function Table({ head, align, rows }: { head: string[]; align: ("left" | "right")[]; rows: TableRow[] }) {
  const alignClass = (i: number) => (align[i] === "right" ? "text-right whitespace-nowrap" : "text-left");
  return (
    <table className="w-full border-collapse text-caption font-normal">
      <thead>
        <tr className="bg-foreground text-background">
          {head.map((h, i) => (
            <th key={i} scope="col" className={cn("px-2.5 py-1.5 font-semibold", alignClass(i))}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={cn("break-inside-avoid border-b border-border even:bg-muted", r.strong && "font-semibold")}>
            {r.cells.map((c, i) => (
              <td key={i} className={cn("px-2.5 py-1.5 align-top tabular-nums", alignClass(i), i === r.cells.length - 1 && r.negative && "text-destructive")}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Breakdowns({ items, total, label, countLabel, empty }: { items: Breakdown[]; total: number; label: string; countLabel: string; empty: string }) {
  if (items.length === 0) return <p className="text-caption text-muted-foreground">{empty}</p>;
  return (
    <Table
      head={[label, countLabel, "Share", "Amount"]}
      align={["left", "right", "right", "right"]}
      rows={items.map((i) => ({ key: i.name, cells: [i.name, String(i.count), formatShare(i.amount, total), formatINR(i.amount)] }))}
    />
  );
}
