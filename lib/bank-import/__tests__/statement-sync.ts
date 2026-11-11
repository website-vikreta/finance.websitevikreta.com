/**
 * Offline statement-status sync policy: the ledger (delete / restore of a
 * bank-import transaction) decides what an owning statement may claim. No DB
 * queries.
 *
 * Run: tsx lib/bank-import/__tests__/statement-sync.ts
 */
import assert from "node:assert/strict";
import {
  canClaimComplete,
  ledgerStatementSyncDecision,
} from "../statement-sync";
import type { StatementStatus } from "../types";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const counts = (pending: number, ready: number, error: number, deadImports = 0) => ({
  pending,
  ready,
  error,
  deadImports,
});

// ── Completeness predicate (mirrors finalizeStatement) ───────────────────────
{
  assert.equal(canClaimComplete(counts(0, 0, 0)), true);
  assert.equal(canClaimComplete(counts(0, 0, 1)), false);
  assert.equal(canClaimComplete(counts(0, 1, 0)), false);
  assert.equal(canClaimComplete(counts(1, 0, 0)), false);
  ok("policy: completeness means no pending, ready or error line");
}

// ── Dead imports keep the statement open ─────────────────────────────────────
{
  assert.equal(
    canClaimComplete(counts(0, 0, 0, 1)),
    false,
    "an imported row whose ledger transaction was deleted is unresolved",
  );
  assert.equal(
    canClaimComplete(counts(0, 0, 0, 3)),
    false,
    "every dead import counts, not just the first",
  );
  ok("policy: deleted imports keep a completed claim from returning");
}

// ── Ledger delete demotes only a completed claim ─────────────────────────────
{
  assert.deepEqual(
    ledgerStatementSyncDecision("completed", counts(0, 0, 0), "ledger_delete"),
    { action: "demote", from: "completed", to: "review" },
  );
  ok("policy: deleting an import demotes a completed statement to review");

  for (const status of ["review", "importing", "failed", "cancelled"] as StatementStatus[]) {
    assert.deepEqual(
      ledgerStatementSyncDecision(status, counts(1, 1, 0), "ledger_delete"),
      { action: "none" },
    );
  }
  ok("policy: review/importing/failed/cancelled statements are already honest on delete");
}

// ── Ledger restore promotes only a still-open, fully settled statement ───────
{
  assert.deepEqual(
    ledgerStatementSyncDecision("review", counts(0, 0, 0), "ledger_restore"),
    { action: "promote", from: "review", to: "completed" },
  );
  assert.deepEqual(
    ledgerStatementSyncDecision("importing", counts(0, 0, 0), "ledger_restore"),
    { action: "promote", from: "importing", to: "completed" },
  );
  ok("policy: restoring an import completes an open statement with nothing unresolved");

  assert.deepEqual(
    ledgerStatementSyncDecision("review", counts(1, 0, 0), "ledger_restore"),
    { action: "none" },
  );
  assert.deepEqual(
    ledgerStatementSyncDecision("review", counts(0, 1, 0), "ledger_restore"),
    { action: "none" },
  );
  assert.deepEqual(
    ledgerStatementSyncDecision("review", counts(0, 0, 1), "ledger_restore"),
    { action: "none" },
  );
  assert.deepEqual(
    ledgerStatementSyncDecision("review", counts(0, 0, 0, 1), "ledger_restore"),
    { action: "none" },
    "another dead import still blocks completion",
  );
  ok("policy: any unresolved line keeps the statement open after a restore");

  for (const status of ["completed", "failed", "cancelled"] as StatementStatus[]) {
    assert.deepEqual(
      ledgerStatementSyncDecision(status, counts(0, 0, 0), "ledger_restore"),
      { action: "none" },
    );
  }
  ok("policy: completed/failed/cancelled statements are not re-claimed by a restore");
}

console.log(`\n${passed} statement-sync policy checks passed`);
if (passed === 0) process.exit(1);
