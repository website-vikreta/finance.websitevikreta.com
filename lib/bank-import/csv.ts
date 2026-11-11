/**
 * Completed bank-statement CSV export.
 *
 * One flat table with exactly the columns shown on the completed-statement
 * screen: Date, Narration, Business Description, Withdrawal, Deposit, Balance,
 * Classification, Flags, Status. Amounts stay as the exact stored decimal
 * strings — never reformatted, rounded or abbreviated — so the file is safe to
 * reconcile against the statement.
 *
 * Client-safe: pure functions, no DB or Node-only imports.
 */

import { dateCell } from "@/lib/transactions/csv";
import type { Classification, LineFlag, LineStatus } from "./types";
import { CLASSIFICATION_LABELS, LINE_STATUS_LABELS } from "./types";
import { businessDescriptionText, flagsText } from "./display";

export interface StatementCsvLine {
  id: string;
  txnDate: string | null;
  valueDate: string | null;
  narration: string | null;
  businessDescription?: string | null;
  transactionDescription?: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  closingBalance: string | null;
  classification: Classification;
  flags: readonly LineFlag[];
  status: LineStatus;
}

export interface StatementCsvSource {
  lines: readonly StatementCsvLine[];
}

export const STATEMENT_CSV_HEADER = [
  "Date",
  "Narration",
  "Business Description",
  "Withdrawal",
  "Deposit",
  "Balance",
  "Classification",
  "Flags",
  "Status",
] as const;

/** Quote every text cell; neutralise leading =,+,-,@ so spreadsheets don't run statement text as a formula. */
function textCell(value: string | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Amount cells are already numeric database values, so they are quoted without
 * the formula guard: a leading minus must stay a number, not become "'-1003".
 */
function moneyCell(value: string | null): string {
  return `"${(value ?? "").replace(/"/g, '""')}"`;
}

export function statementCsvRow(line: StatementCsvLine): string[] {
  return [
    dateCell(line.txnDate ?? line.valueDate, "—"),
    line.narration?.trim() || "—",
    businessDescriptionText(line),
    line.withdrawalAmount ?? "",
    line.depositAmount ?? "",
    line.closingBalance ?? "",
    CLASSIFICATION_LABELS[line.classification] ?? line.classification,
    flagsText(line.flags),
    LINE_STATUS_LABELS[line.status] ?? line.status,
  ];
}

export function toStatementCsv(source: StatementCsvSource): string {
  const lines = source.lines.map((line) => {
    const cells = statementCsvRow(line);
    return cells
      .map((value, index) => (index >= 3 && index <= 5 ? moneyCell(value) : textCell(value)))
      .join(",");
  });

  // BOM so Excel opens ₹ and non-English narrations correctly.
  return "\uFEFF" + [STATEMENT_CSV_HEADER.map(textCell).join(","), ...lines].join("\r\n");
}
