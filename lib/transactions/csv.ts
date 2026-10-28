/**
 * Ledger CSV, shared by the server export (Settings → Export all) and the
 * Transactions page (exports exactly the filtered list in the browser).
 */

import { formatTime } from "@/lib/format";
import type { LedgerRow } from "@/lib/transactions/queries";

export const SOURCE_LABELS: Record<string, string> = {
  chatbot: "Finance AI",
  manual: "Manual",
  bank_import: "Bank Statement",
};

/** Quote every cell; neutralise leading =,+,-,@ so spreadsheets don't run user text as a formula. */
function cell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * A date column value for every CSV export (ledger, clients, reports).
 *
 * Plain date strings are auto-converted by Excel into date cells, which then
 * re-render in its regional format or collapse to "######" when the default
 * column is narrow. So dates are written as a fixed YYYY-MM-DD value forced to
 * text: the leading space stops every spreadsheet from converting it, the year
 * sorts correctly, and old and new entries read exactly alike (server and
 * browser CSVs use the same path).
 *
 * Returns the raw cell text — the caller quotes it with its own cell().
 */
export function dateCell(value: string | null | undefined, fallback = ""): string {
  const text = (value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? " " + text : text || fallback;
}

const HEADER = ["Date", "Time", "Type", "Client / Expense", "Category", "Description", "Amount (INR)", "Original amount", "Currency", "Exchange rate", "Source"];

export function toCsv(rows: LedgerRow[]): string {
  const lines = rows.map((r) =>
    [
      dateCell(r.date),
      formatTime(r.time),
      r.type === "income" ? "Income" : "Expense",
      r.title,
      r.category,
      r.detail,
      r.amountInr.toFixed(2),
      r.originalAmount.toFixed(2),
      r.originalCurrency,
      r.exchangeRate,
      SOURCE_LABELS[r.source] ?? r.source,
    ]
      .map(cell)
      .join(","),
  );
  // BOM so Excel opens ₹ and non-English names correctly.
  return "﻿" + [HEADER.map(cell).join(","), ...lines].join("\r\n");
}
