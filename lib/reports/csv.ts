import { formatDate, formatMonthShort, formatShare, formatTime } from "@/lib/format";
import { SOURCE_LABELS } from "@/lib/transactions/csv";
import type { Breakdown, LedgerRow, MonthTotals } from "@/lib/transactions/queries";

/** Quote every cell; neutralise leading =,+,-,@ so spreadsheets don't run user text as a formula. */
function cell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export interface ReportCsvData {
  periodLabel: string;
  from: string | null;
  today: string;
  generatedAt: string;
  income: Breakdown[];
  expenses: Breakdown[];
  months: MonthTotals[];
  selectedYear?: number;
  rows: LedgerRow[];
}

/**
 * Generates a structured, multi-section CSV file containing all financial report
 * data matching the PDF report: Summary, Income by client, Expenses by category,
 * Monthly summary (for selected year), and period transactions.
 */
export function toReportCsv({
  periodLabel,
  from,
  today,
  generatedAt,
  income,
  expenses,
  months,
  selectedYear,
  rows,
}: ReportCsvData): string {
  const totalIn = income.reduce((s, i) => s + i.amount, 0);
  const totalOut = expenses.reduce((s, i) => s + i.amount, 0);
  const net = totalIn - totalOut;
  const inCount = income.reduce((s, i) => s + i.count, 0);
  const outCount = expenses.reduce((s, i) => s + i.count, 0);
  const marginStr = totalIn > 0 ? `${((net / totalIn) * 100).toFixed(1)}%` : "0.0%";

  const lines: string[] = [];

  // Title & Metadata
  lines.push([`Finance Report - ${periodLabel} - ${today}`].map(cell).join(","));
  lines.push(["Generated", `${formatDate(today)}, ${formatTime(generatedAt)} IST`].map(cell).join(","));
  lines.push(["Period", from ? `${formatDate(from)} to ${formatDate(today)}` : `All time to ${formatDate(today)}`].map(cell).join(","));
  lines.push(["Base Currency", "INR"].map(cell).join(","));
  lines.push("");

  // Section 1: Summary
  lines.push(["SUMMARY"].map(cell).join(","));
  lines.push(["Metric", "Count", "Amount (INR)", "Margin"].map(cell).join(","));
  lines.push(["Income", `${inCount} payments`, totalIn.toFixed(2), ""].map(cell).join(","));
  lines.push(["Expenses", `${outCount} entries`, totalOut.toFixed(2), ""].map(cell).join(","));
  lines.push(["Net Profit", "", net.toFixed(2), marginStr].map(cell).join(","));
  lines.push("");

  // Section 2: Income by Client
  lines.push([`INCOME BY CLIENT (${income.length})`].map(cell).join(","));
  lines.push(["Client", "Payments", "Share", "Amount (INR)"].map(cell).join(","));
  if (income.length === 0) {
    lines.push(["No income recorded in this period", "", "", ""].map(cell).join(","));
  } else {
    for (const item of income) {
      lines.push([item.name, item.count, formatShare(item.amount, totalIn), item.amount.toFixed(2)].map(cell).join(","));
    }
  }
  lines.push("");

  // Section 3: Expenses by Category
  lines.push([`EXPENSES BY CATEGORY (${expenses.length})`].map(cell).join(","));
  lines.push(["Category", "Entries", "Share", "Amount (INR)"].map(cell).join(","));
  if (expenses.length === 0) {
    lines.push(["No expenses recorded in this period", "", "", ""].map(cell).join(","));
  } else {
    for (const item of expenses) {
      lines.push([item.name, item.count, formatShare(item.amount, totalOut), item.amount.toFixed(2)].map(cell).join(","));
    }
  }
  lines.push("");

  // Section 4: Monthly Summary
  const yearSuffix = selectedYear ? ` (${selectedYear})` : "";
  lines.push([`MONTHLY SUMMARY${yearSuffix}`].map(cell).join(","));
  lines.push(["Month", "Income (INR)", "Expenses (INR)", "Net (INR)"].map(cell).join(","));
  if (months.length === 0) {
    lines.push(["No monthly data for this period", "", "", ""].map(cell).join(","));
  } else {
    for (const m of [...months].reverse()) {
      const monthNet = m.income - m.expense;
      lines.push([
        `${formatMonthShort(m.month)} ${m.month.slice(0, 4)}`,
        m.income.toFixed(2),
        m.expense.toFixed(2),
        monthNet.toFixed(2),
      ].map(cell).join(","));
    }
  }
  lines.push("");

  // Section 5: Transactions
  lines.push([`TRANSACTIONS (${rows.length})`].map(cell).join(","));
  lines.push(["Date", "Time", "Type", "Client / Description", "Category", "Source", "Amount (INR)"].map(cell).join(","));
  if (rows.length === 0) {
    lines.push(["No transactions recorded in this period", "", "", "", "", "", ""].map(cell).join(","));
  } else {
    for (const r of rows) {
      lines.push([
        formatDate(r.date),
        formatTime(r.time),
        r.type === "income" ? "Income" : "Expense",
        r.title,
        r.type === "income" ? "Income" : (r.category ?? "Expense"),
        SOURCE_LABELS[r.source] ?? r.source,
        (r.type === "income" ? "+" : "-") + r.amountInr.toFixed(2),
      ].map(cell).join(","));
    }
  }

  return "\uFEFF" + lines.join("\r\n");
}
