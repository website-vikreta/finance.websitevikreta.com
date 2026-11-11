/**
 * Offline checks for the completed-statement CSV export.
 *
 * The PDF uses the same display helpers, so these cases pin the values both
 * exports are required to show: full narration, full business description,
 * exact amounts, raw flags (or an explicit dash), and full status labels.
 *
 * Run: npm run test:bank-import
 */
import assert from "node:assert/strict";
import { toStatementCsv, STATEMENT_CSV_HEADER, type StatementCsvLine } from "../csv";
import { LINE_STATUS_LABELS } from "../types";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** Minimal CSV reader for the exact files this module writes (quoted cells). */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function csvRows(csv: string): string[][] {
  return csv.replace(/^\uFEFF/, "").split("\r\n").map(parseCsvLine);
}

const base: StatementCsvLine = {
  id: "line-1",
  txnDate: "2026-04-07",
  valueDate: "2026-04-07",
  narration: "DEBIT CARD PRORATA FEE",
  businessDescription: "Debit card fee",
  transactionDescription: null,
  withdrawalAmount: "1003.00",
  depositAmount: null,
  closingBalance: "627813.00",
  classification: "expense",
  flags: [],
  status: "duplicate",
};

// ── Header and complete row values ───────────────────────────────────────────
{
  const csv = toStatementCsv({ lines: [base] });
  assert.ok(csv.startsWith("\uFEFF"), "BOM keeps Excel from mangling ₹ and names");
  const [head, row] = csvRows(csv);
  assert.deepEqual(head, [...STATEMENT_CSV_HEADER]);
  assert.deepEqual(row, [
    " 2026-04-07",
    "DEBIT CARD PRORATA FEE",
    "Debit card fee",
    "1003.00",
    "",
    "627813.00",
    "Expense",
    "—",
    "Duplicate",
  ]);
  ok("csv: exact nine-column header and full row values");
}

// ── Full labels, raw flags and the description fallback ──────────────────────
{
  const csv = toStatementCsv({
    lines: [
      {
        ...base,
        id: "line-2",
        narration: null,
        businessDescription: null,
        transactionDescription: "Imported description",
        withdrawalAmount: null,
        depositAmount: "23133.00",
        classification: "income",
        flags: ["NOT_A_DUPLICATE", "BALANCE_MISMATCH"],
        status: "imported",
      },
    ],
  });
  const [, row] = csvRows(csv);
  assert.equal(row[2], "Imported description", "transaction description fills a missing staging value");
  assert.equal(row[3], "");
  assert.equal(row[4], "23133.00");
  assert.equal(row[6], "Income");
  assert.equal(row[7], "NOT_A_DUPLICATE; BALANCE_MISMATCH");
  assert.equal(row[8], "Imported");
  assert.equal(LINE_STATUS_LABELS.imported, "Imported");
  assert.equal(LINE_STATUS_LABELS.duplicate, "Duplicate");
  ok("csv: Imported / Duplicate spellings, raw flags and description fallback");
}

// ── Long narrator text stays whole and is escaped correctly ───────────────────
{
  const narration = 'POS 416021XXXXXX0456 6101, "GITHUB" — full narration';
  const csv = toStatementCsv({
    lines: [
      {
        ...base,
        id: "line-3",
        narration,
        withdrawalAmount: "-93.00",
        closingBalance: null,
        txnDate: null,
        valueDate: null,
        flags: ["NEGATIVE_AMOUNT"],
        status: "error",
      },
    ],
  });
  const [, row] = csvRows(csv);
  assert.equal(row[0], "—", "a missing date is an explicit dash");
  assert.equal(row[1], narration, "narration is never truncated");
  assert.equal(row[3], "-93.00", "a negative amount stays numeric, not apostrophe-guarded");
  assert.equal(row[5], "");
  assert.equal(row[7], "NEGATIVE_AMOUNT");
  assert.equal(row[8], "Error");
  ok("csv: full comma/quote narration, exact negative amount and null cells");
}

// ── Every ledger status maps to its full label, never a single letter ────────
{
  const statuses = Object.entries(LINE_STATUS_LABELS);
  for (const [status, label] of statuses) {
    const csv = toStatementCsv({
      lines: [{ ...base, id: `line-${status}`, status: status as StatementCsvLine["status"] }],
    });
    const [, row] = csvRows(csv);
    assert.equal(row[8], label);
    assert.notEqual(row[8], status.charAt(0).toUpperCase(), `${status} must not print as its initial`);
  }
  ok("csv: every status prints its full label");
}

console.log(`\nexport: ${passed} checks passed.`);
