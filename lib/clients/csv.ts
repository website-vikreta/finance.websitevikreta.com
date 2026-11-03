/**
 * Clients directory CSV export.
 * Client-safe helper for generating formatted, formula-injection-safe CSV files.
 */

import type { ClientSummary } from "@/lib/transactions/queries";
import type { Owed } from "@/lib/invoices/invoices";
import { dateCell } from "@/lib/transactions/csv";

/** Quote every cell; neutralise leading =,+,-,@ so spreadsheets don't run user text as a formula. */
function cell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const CLIENTS_CSV_HEADER = [
  "Client Name",
  "GSTIN",
  "Email",
  "State",
  "Country",
  "Total Received (INR)",
  "Direct Expenses (INR)",
  "Net Profit (INR)",
  "Owed (INR)",
  "Owed (USD)",
  "Payments",
  "Last Payment",
  "Client Since",
];

export function toClientsCsv(
  clientsList: ClientSummary[],
  owedMap: Record<string, Owed | { INR: number; USD: number; overdue?: number }>,
): string {
  const lines = clientsList.map((c) => {
    const o = owedMap[c.id];
    return [
      c.name,
      c.gstin ?? "",
      c.email ?? "",
      c.state ?? "",
      c.country,
      c.totalReceived.toFixed(2),
      c.totalExpenses.toFixed(2),
      c.netMargin.toFixed(2),
      (o?.INR ?? 0).toFixed(2),
      (o?.USD ?? 0).toFixed(2),
      c.payments,
      dateCell(c.lastPaymentDate, "None"),
      dateCell(c.firstSeen),
    ]
      .map(cell)
      .join(",");
  });

  return "\uFEFF" + [CLIENTS_CSV_HEADER.map(cell).join(","), ...lines].join("\r\n");
}
