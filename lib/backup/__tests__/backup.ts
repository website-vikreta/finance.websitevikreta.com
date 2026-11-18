/**
 * Offline checks for the backup format. No database connection is opened.
 *
 * Run: npm run test:backup
 */

import assert from "node:assert/strict";
import {
  canonicalDataHash,
  columnKind,
  fileStamp,
  normalizeBoolean,
  normalizeCell,
  normalizeDate,
  normalizeDecimal,
  normalizeNameKey,
  normalizeTimestamp,
  validateHeaders,
  type NormalizedSheet,
} from "../format";
import { BACKUP_FORMAT } from "../types";
import { buildBackupWorkbook, readBackupWorkbook } from "../xlsx";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function rejects(name: string, fn: () => unknown): void {
  assert.throws(fn, Error, name);
  ok(name);
}

async function main(): Promise<void> {
  console.log("Backup format — exact cells");
  assert.equal(normalizeDecimal("500", 2), "500.00");
  assert.equal(normalizeDecimal("500.00", 2), "500.00");
  assert.equal(normalizeDecimal(500.5, 2), "500.50");
  assert.equal(normalizeDecimal("-0.00", 2), "0.00");
  assert.equal(normalizeDecimal("1.2300", 2), "1.23");
  assert.equal(normalizeDecimal("80.0250", 4), "80.0250");
  assert.equal(normalizeDecimal(" 42.10 ", 2), "42.10");
  ok("amounts normalize to the column scale without rounding");

  rejects("rejects more precision than the column stores", () => normalizeDecimal("1.234", 2));
  rejects("rejects exponent notation", () => normalizeDecimal("1e3", 2));
  rejects("rejects a non-numeric amount", () => normalizeDecimal("₹500", 2));

  assert.equal(normalizeDate("2026-11-18"), "2026-11-18");
  assert.equal(normalizeDate(new Date("2026-11-18T00:00:00.000Z")), "2026-11-18");
  assert.equal(normalizeTimestamp("2026-11-18T10:20:30.000Z"), "2026-11-18T10:20:30.000Z");
  rejects("rejects a locale date", () => normalizeDate("18/11/2026"));
  rejects("rejects an Excel serial timestamp", () => normalizeTimestamp(45678));

  assert.equal(normalizeBoolean(true), "true");
  assert.equal(normalizeBoolean("0"), "false");
  rejects("rejects an ambiguous boolean", () => normalizeBoolean("yes"));

  assert.equal(normalizeCell("json", '{"b":1,"a":2}'), '{"b":1,"a":2}');
  rejects("rejects broken JSON", () => normalizeCell("json", "{oops"));

  assert.equal(columnKind("PgTimestamp", "date"), "timestamp");
  assert.equal(columnKind("PgDateString", "string"), "date");
  assert.equal(columnKind("PgNumeric", "string", 2), "decimal");
  assert.equal(columnKind("PgJsonb", "json"), "json");
  assert.equal(columnKind("PgBoolean", "boolean"), "boolean");
  assert.equal(columnKind("PgInteger", "number"), "integer");
  assert.equal(columnKind("PgVarchar", "string"), "text");
  ok("database column types map to the right cell rules");

  assert.equal(normalizeNameKey("  Acme   Studios "), "acme studios");
  assert.match(fileStamp(new Date("2026-11-18T10:20:00.000Z")), /^2026-11-18-\d{4}$/);
  ok("name matching and filename stamps are stable");

  console.log("Backup format — headers and hash");
  assert.equal(validateHeaders(["id", "name"], ["id", "name"]), null);
  assert.equal(validateHeaders(["id", "name"], ["name", "id"]), null);
  assert.match(validateHeaders(["id", "name"], ["id"]) ?? "", /Missing column: name/);
  assert.match(validateHeaders(["id"], ["id", "extra"]) ?? "", /Unknown column: extra/);
  assert.match(validateHeaders(["id"], ["id", "id"]) ?? "", /appears twice/);
  ok("headers are validated as an order-independent set");

  const sheetA: NormalizedSheet = { sheet: "clients", headers: ["id", "name"], rows: [["1", "Acme"]] };
  const sheetB: NormalizedSheet = { sheet: "transactions", headers: ["id", "amount"], rows: [["t1", "500.00"]] };
  const hash = canonicalDataHash([sheetA, sheetB]);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(canonicalDataHash([sheetA, sheetB]), hash);
  assert.notEqual(canonicalDataHash([sheetA, { ...sheetB, rows: [["t1", "500.01"]] }]), hash);
  ok("the data hash is stable and changes with any cell");

  console.log("Backup format — Excel round trip");
  const rows = [
    ["t1", "  keep text spaces  ", "500.50", "2026-11-18", "2026-11-18T10:20:30.000Z", "true"],
    ["t2", "=1+1", "0.00", "2026-04-01", "2026-04-01T00:00:00.000Z", "false"],
    ["t3", "अनुदान — ₹", "123456789.99", "2027-03-31", "2027-03-31T23:59:59.000Z", "true"],
  ];
  const headers = ["id", "description", "amount", "txn_date", "created_at", "paid"];
  const sheets: NormalizedSheet[] = [
    {
      sheet: "transactions",
      headers,
      rows,
    },
  ];
  const dataHash = canonicalDataHash(sheets);
  const bytes = await buildBackupWorkbook({
    meta: {
      format: BACKUP_FORMAT,
      formatVersion: "1",
      exportedAt: "2026-11-18T10:20:00.000Z",
      dataHash,
    },
    readme: ["Website Vikreta Finance — full backup", "Do not edit the data sheets."],
    sheets,
  });
  assert.ok(bytes.length > 1000);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  ok("a real .xlsx workbook is produced");

  const parsed = await readBackupWorkbook(bytes);
  assert.equal(parsed.meta.format, BACKUP_FORMAT);
  assert.equal(parsed.meta.formatVersion, "1");
  assert.equal(parsed.meta.dataHash, dataHash);

  const parsedSheet = parsed.sheets.get("transactions");
  assert.ok(parsedSheet);
  assert.deepEqual(parsedSheet.headers, headers);
  assert.equal(parsedSheet.rows.length, 3);
  assert.equal(parsedSheet.rows[0].cells[1], "  keep text spaces  ");
  assert.equal(parsedSheet.rows[0].cells[2], "500.50");
  assert.equal(parsedSheet.rows[0].cells[3], "2026-11-18");
  assert.equal(parsedSheet.rows[0].cells[5], "true");
  assert.equal(parsedSheet.rows[1].cells[1], "=1+1");
  assert.equal(parsedSheet.rows[2].cells[1], "अनुदान — ₹");
  ok("text, unicode, leading/trailing spaces and formula-looking text survive Excel");

  const roundTripHash = canonicalDataHash([
    {
      sheet: "transactions",
      headers: parsedSheet.headers,
      rows: parsedSheet.rows.map((row) => row.cells.map((cell) => (cell === null || cell === undefined ? null : String(cell)))),
    },
  ]);
  assert.equal(roundTripHash, dataHash);
  ok("the workbook hash matches after a read/write round trip");

  console.log(`\n${passed} backup checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
