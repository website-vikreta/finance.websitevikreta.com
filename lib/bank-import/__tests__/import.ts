/**
 * Offline Phase 4 checks — pure import logic, no DB.
 *
 * - Idempotency key scheme for line attempts.
 * - Direction/classification agreement at import time.
 * - Exact invoice-balance arithmetic (BigInt, no floats).
 * - Finance-AI isolation: the import module must never touch the chatbot
 *   pathway, and its transaction rows must be marked `bank_import`.
 *
 * DB-backed behavior (locking, atomicity, exactly-once, concurrency) lives in
 * import-db.ts, guarded by TEST_DATABASE_URL.
 *
 * Run: tsx lib/bank-import/__tests__/import.ts
 */

import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
  computeImportKey,
  evaluateInvoicePayment,
  formatMinorUnits,
  MAX_IMPORT_BATCH,
} from "../import";
import { validateImportDirection, validateLineForImport } from "../validate";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ── Idempotency keys ─────────────────────────────────────────────────────────
{
  const lineId = "9e1f7a4c-2b8d-4c1e-a5d3-7f6b9c2e4a10";
  assert.equal(computeImportKey(lineId, 1), `bank-line:${lineId}:a1`);
  assert.equal(computeImportKey(lineId, 2), `bank-line:${lineId}:a2`);
  assert.notEqual(computeImportKey(lineId, 1), computeImportKey(lineId, 2));
  ok("keys: attempt-scoped keys never repeat for one line");

  const otherLine = "9e1f7a4c-2b8d-4c1e-a5d3-7f6b9c2e4a11";
  assert.notEqual(computeImportKey(lineId, 2), computeImportKey(otherLine, 2));
  ok("keys: two lines never share a key at the same attempt");
}

// ── Direction gate ───────────────────────────────────────────────────────────
{
  assert.equal(validateImportDirection("deposit", "income"), null);
  assert.equal(validateImportDirection("withdrawal", "expense"), null);
  ok("direction: income deposits and expense withdrawals pass");

  assert.equal(validateImportDirection("withdrawal", "income"), "Income lines import from deposits only.");
  assert.equal(validateImportDirection("deposit", "expense"), "Expense lines import from withdrawals only.");
  ok("direction: a deposit classed as expense (and vice versa) is rejected");
}

/**
 * A full classification pass must require both gates: the content gate
 * (validateLineForImport) and the direction agreement. A malformed-but-valid
 * income line whose money left the account clears the content gate in valid
 * mapping terms and then must be caught by the direction gate.
 */
{
  const validIncomeDeposit = {
    txnDate: "2026-04-13",
    valueDate: "2026-04-13",
    narration: "UPI/P2A/ACME",
    withdrawalAmount: null,
    depositAmount: "1000.00",
    direction: "deposit" as const,
    classification: "income" as const,
    flags: [],
  };
  assert.ok(validateLineForImport({ ...validIncomeDeposit, clientId: "x", categoryId: null }).ok);
  assert.equal(validateImportDirection(validIncomeDeposit.direction, validIncomeDeposit.classification), null);
  ok("gates: a well-formed importable line passes content and direction");

  const crossed = { ...validIncomeDeposit, withdrawalAmount: "1000.00", depositAmount: null, direction: "withdrawal" as const };
  assert.ok(validateLineForImport({ ...crossed, clientId: "x", categoryId: null }).ok);
  assert.equal(validateImportDirection(crossed.direction, crossed.classification), "Income lines import from deposits only.");
  ok("gates: income mapped over a withdrawal is stopped by the direction gate");
}

// ── Invoice arithmetic ───────────────────────────────────────────────────────
{
  const check = evaluateInvoicePayment({ total: "1000.00", paid: "600.00", payment: "400.00" });
  assert.ok(check.ok);
  if (check.ok) assert.equal(check.outstanding, "0.00");
  ok("invoice: an exact payoff is allowed");

  const reject = evaluateInvoicePayment({ total: "1000.00", paid: "600.00", payment: "400.01" });
  assert.ok(!reject.ok);
  ok("invoice: one paisa over the balance is rejected");

  const partial = evaluateInvoicePayment({ total: "1000.00", paid: "250.00", payment: "400.00" });
  assert.ok(partial.ok);
  if (partial.ok) assert.equal(partial.outstanding, "350.00");
  ok("invoice: partial payments report the exact remaining balance");

  const zero = evaluateInvoicePayment({ total: "1000.00", paid: "0.00", payment: "0.00" });
  assert.ok(zero.ok);
  ok("invoice: zero payments keep the balance untouched and pass the guard");

  assert.throws(() => evaluateInvoicePayment({ total: "1000.005", paid: "0.00", payment: "1.00" }));
  ok("invoice: amounts with sub-paisa precision never enter the balance math");

  const normal = evaluateInvoicePayment({ total: "1000.00", paid: "0.00", payment: "0.11" });
  assert.ok(normal.ok);
  ok("invoice: normal amounts never throw");
}

// ── Exact minor-unit formatting ──────────────────────────────────────────────
{
  // BigInt literals need ES2020; the precision module works with plain ints
  // in minor units everywhere, and so do these checks.
  const big = BigInt(1234567); // 12,345.67 in minor units
  assert.equal(formatMinorUnits(big), "12345.67");
  assert.equal(formatMinorUnits(BigInt(-150)), "-1.50");
  assert.equal(formatMinorUnits(BigInt(5)), "0.05");
  ok("format: minor units render as canonical currency strings");
}

// ── Batch bounds ─────────────────────────────────────────────────────────────
{
  assert.ok(MAX_IMPORT_BATCH >= 1 && MAX_IMPORT_BATCH <= 500);
  ok("batch: the per-action cap keeps every import inside action time limits");
}

// ── Finance-AI isolation (static) ────────────────────────────────────────────
{
  const source = fs.readFileSync(path.resolve(__dirname, "../import.ts"), "utf8");
  assert.ok(!source.includes("lib/chatbot"), "import must not import the chatbot modules");
  assert.ok(!source.includes("chat_sessions"), "import must not touch chat session rows");
  assert.ok(!source.includes("getDraft"), "import must not read Finance AI drafts");
  assert.ok(!source.includes("setSession"), "import must not write Finance AI session state");
  assert.ok(source.includes('source: "bank_import"'), "transactions must carry the bank_import source");
  assert.ok(source.includes("FOR UPDATE"), "the line and invoice rows must be locked");
  ok("isolation: the import path never reads or writes Finance AI state");
}

console.log(`\nimport: ${passed} checks passed`);
