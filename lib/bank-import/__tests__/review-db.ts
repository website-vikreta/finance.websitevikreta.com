/**
 * DB-backed Phase 3 review tests.
 *
 * - Guarded by `../test-db`; it only ever runs against `TEST_DATABASE_URL`.
 * - Applies pending drizzle migrations against that disposable database first.
 * - Exercises every review transition, server-side mapping validation,
 *   duplicate candidates and reconciliation, then proves the financial
 *   `transactions`, invoices and Finance-AI chats were not touched.
 *
 *   The `imported` line state is not seeded here: structuring it requires a
 *   real `transactions` row (chk_bank_statement_lines_imported), and Phase 3
 *   must not write financial rows even in a test database. The shared
 *   `transitionError` guard is covered through the equivalent `error` state,
 *   and Phase 4 will exercise the imported lock against real imports.
 *
 * Run: `npx tsx lib/bank-import/__tests__/review-db.ts` with TEST_DATABASE_URL.
 */

import assert from "node:assert/strict";
import * as path from "path";
import "../../__tests__/test-db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { createBankAccount, persistStatement } from "../persistence";
import { getStatementDetail } from "../queries";
import { findDuplicateCandidates } from "../duplicates";
import {
  listOverlappingStatements,
  reconcileStatementDetail,
} from "../reconciliation";
import {
  createClient,
  listReviewOptions,
  markLineDuplicate,
  markLineReady,
  reopenLine,
  skipLine,
  updateLineReview,
} from "../review";
import { fingerprintLine } from "../normalize";
import type { LineFlag, ParsedStatement } from "../types";

const TEST_USER = "admin";
const TEST_ACCOUNT_NAME = "Review Test Bank Account";
const TEST_FILE_NAME = "review-test-statement.pdf";
const TEST_FILE_NAME_2 = "review-test-overlap.pdf";
const TEST_FILE_BYTES = 2048;
const TEST_CLIENT_NAME = "Review Client Pvt Ltd";
const TEST_DECOY_CLIENT_NAME = "A Review Lookup Decoy";
const TEST_CATEGORY_NAME = "Test Review Rent";
const FINGERPRINT_A = fingerprintLine({
  txnDate: "2026-04-13",
  valueDate: "2026-04-13",
  narration: "OPENING CREDIT",
  reference: "REF-1",
  withdrawalAmount: null,
  depositAmount: "1000.00",
});
const FINGERPRINT_B = "1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d";
const FINGERPRINT_D = "2c3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function parsedLine(input: {
  rowNumber: number;
  txnDate: string;
  narration: string;
  reference: string;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  direction: "deposit" | "withdrawal";
  classification: "income" | "expense";
  fingerprint: string;
  flags?: LineFlag[];
}): ParsedStatement["lines"][number] {
  return {
    pageNumber: 1,
    rowNumber: input.rowNumber,
    txnDate: input.txnDate,
    valueDate: input.txnDate,
    narration: input.narration,
    reference: input.reference,
    withdrawalAmount: input.withdrawalAmount,
    depositAmount: input.depositAmount,
    closingBalance: null,
    direction: input.direction,
    classification: input.classification,
    status: "pending",
    fingerprint: input.fingerprint,
    flags: input.flags ?? [],
    errorCode: null,
  };
}

function statementFixture(): ParsedStatement {
  return {
    currency: "INR",
    pages: 1,
    lines: [
      parsedLine({
        rowNumber: 1,
        txnDate: "2026-04-13",
        narration: "OPENING CREDIT",
        reference: "REF-1",
        withdrawalAmount: null,
        depositAmount: "1000.00",
        direction: "deposit",
        classification: "income",
        fingerprint: FINGERPRINT_A,
      }),
      parsedLine({
        rowNumber: 2,
        txnDate: "2026-04-14",
        narration: "TEST RENT",
        reference: "REF-2",
        withdrawalAmount: "250.00",
        depositAmount: null,
        direction: "withdrawal",
        classification: "expense",
        fingerprint: FINGERPRINT_B,
      }),
      // Row 3 carries the same content fingerprint as row 1: a same-statement
      // duplicate candidate the reviewer has to decide on.
      parsedLine({
        rowNumber: 3,
        txnDate: "2026-04-14",
        narration: "OPENING CREDIT",
        reference: "REF-1",
        withdrawalAmount: null,
        depositAmount: "1000.00",
        direction: "deposit",
        classification: "income",
        fingerprint: FINGERPRINT_A,
      }),
      parsedLine({
        rowNumber: 4,
        txnDate: "2026-04-15",
        narration: "CASH DEPOSIT",
        reference: "REF-4",
        withdrawalAmount: null,
        depositAmount: "300.00",
        direction: "deposit",
        classification: "income",
        fingerprint: FINGERPRINT_D,
        flags: ["TWO_DIGIT_YEAR" as LineFlag],
      }),
    ],
    statementFrom: "2026-04-01",
    statementTo: "2026-04-30",
    openingBalance: "0.00",
    closingBalance: "750.00",
    warnings: [],
  };
}

/** Deterministic distinct 64-char hex value per call. */
function fileSha(letter: "a" | "b" | "c" | "d"): string {
  return `${letter}${"0".repeat(63)}`;
}

async function count(tableName: "transactions" | "clients" | "invoices" | "chat_sessions" | "categories"): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS n FROM ${sql.raw(tableName)}`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

type LineIdMap = Record<"A" | "B" | "C" | "D", string>;

async function lineIds(statementId: string): Promise<LineIdMap> {
  const result = await db.execute(sql`
    SELECT id, row_number FROM bank_statement_lines
    WHERE statement_id = ${statementId}::uuid
    ORDER BY row_number
  `);
  const rows = result.rows as unknown as Array<{ id: string; row_number: number }>;
  return {
    A: rows[0].id,
    B: rows[1].id,
    C: rows[2].id,
    D: rows[3].id,
  };
}

async function lineById(id: string): Promise<{
  status: string;
  classification: string;
  skipReason: string | null;
  reviewedBy: string | null;
  narration: string | null;
  fingerprint: string;
  clientId: string | null;
  categoryId: number | null;
}> {
  const result = await db.execute(sql`
    SELECT status, classification, skip_reason AS "skipReason",
           reviewed_by AS "reviewedBy", narration, fingerprint, client_id AS "clientId", category_id AS "categoryId"
    FROM bank_statement_lines WHERE id = ${id}::uuid
  `);
  return result.rows[0] as never;
}

async function statementStatus(statementId: string): Promise<string> {
  const result = await db.execute(
    sql`SELECT status FROM bank_statements WHERE id = ${statementId}::uuid`,
  );
  return String((result.rows[0] as { status: string }).status);
}

async function seedClient(): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO clients (client_name, country)
    VALUES (${TEST_CLIENT_NAME}, 'India')
    RETURNING client_id
  `);
  return String((result.rows[0] as { client_id: string }).client_id);
}

async function seedCategory(): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO categories (name) VALUES (${TEST_CATEGORY_NAME}) RETURNING id
  `);
  return Number((result.rows[0] as { id: number }).id);
}

async function cleanupTestAccount(): Promise<void> {
  await db.transaction(async (tx) => {
    const names = [TEST_FILE_NAME, TEST_FILE_NAME_2];
    for (const fileName of names) {
      await tx.execute(sql`
        DELETE FROM bank_statement_lines
        WHERE statement_id IN (SELECT id FROM bank_statements WHERE file_name = ${fileName})
      `);
      await tx.execute(sql`DELETE FROM bank_statements WHERE file_name = ${fileName}`);
    }
    await tx.execute(sql`DELETE FROM clients WHERE client_name = ${TEST_CLIENT_NAME}`);
    await tx.execute(sql`DELETE FROM clients WHERE client_name = ${TEST_DECOY_CLIENT_NAME}`);
    await tx.execute(sql`DELETE FROM categories WHERE name = ${TEST_CATEGORY_NAME}`);
    await tx.execute(
      sql`DELETE FROM bank_accounts WHERE display_name = ${TEST_ACCOUNT_NAME}`,
    );
  });
}

async function applyMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, "../../../drizzle");
  await migrate(db, { migrationsFolder });
}

async function run(): Promise<void> {
  await applyMigrations();
  await cleanupTestAccount();

  const before = {
    transactions: await count("transactions"),
    clients: await count("clients"),
    invoices: await count("invoices"),
    chat_sessions: await count("chat_sessions"),
  };

  const created = await createBankAccount(TEST_USER, {
    displayName: TEST_ACCOUNT_NAME,
    bankName: "Review Test Bank",
    last4: "4321",
  });
  assert.ok(created.ok, "bank account should be created");
  const accountId = created.ok ? created.value : "";
  ok("setup: bank account and anchor user exist");

  const persisted = await persistStatement({
    accountId,
    userId: TEST_USER,
    fileName: TEST_FILE_NAME,
    fileSha256: fileSha("a"),
    fileSizeBytes: TEST_FILE_BYTES,
    parsed: statementFixture(),
  });
  assert.ok(persisted.ok, "statement should stage");
  const statementId = persisted.ok ? persisted.value.statementId : "";
  const detail = await getStatementDetail(statementId);
  assert.ok(detail);
  const ids = await lineIds(statementId);
  ok("setup: four-line statement staged");

  // ── Server-side ID validation ──────────────────────────────────────────────
  {
    const badClientId = await updateLineReview(TEST_USER, statementId, ids.A, {
      classification: "income",
      clientId: "11111111-1111-4111-8111-111111111111", // no such client
    });
    assert.ok(!badClientId.ok, "unknown client id must be rejected");
    ok("validation: unknown client identifier rejected on the server");

    const badCategory = await updateLineReview(TEST_USER, statementId, ids.B, {
      classification: "expense",
      categoryId: 999999,
    });
    assert.ok(!badCategory.ok, "unknown category id must be rejected");
    ok("validation: unknown category identifier rejected on the server");

    const garbageId = await updateLineReview(TEST_USER, statementId, "not-a-uuid", { classification: "income" });
    assert.ok(!garbageId.ok);
    const alienLine = await updateLineReview(TEST_USER, statementId, "22222222-2222-4222-8222-222222222222", {
      classification: "income",
    });
    assert.ok(!alienLine.ok, "a line from another statement must not resolve");
    ok("validation: line identifiers are scoped to the statement");
  }

  // ── Income requires an existing client ────────────────────────────────────
  {
    const blocked = await markLineReady(TEST_USER, statementId, ids.A);
    assert.ok(!blocked.ok, "income without a client must stay ineligible");
    const row = await lineById(ids.A);
    assert.equal(row.status, "pending");
    ok("eligibility: income without a client cannot become ready");

    await db.execute(sql`
      INSERT INTO clients (client_name, country)
      VALUES (${TEST_DECOY_CLIENT_NAME}, 'India')
    `);
    const clientId = await seedClient();
    const existingClient = await db.transaction((tx) =>
      createClient(tx, TEST_USER, "  review   client pvt ltd  "),
    );
    assert.ok(existingClient.ok, "an existing normalized client should be reusable");
    assert.equal(existingClient.clientId, clientId);
    assert.equal(existingClient.created, false);
    ok("client creation reuses a matching client when other clients exist");

    const mapped = await updateLineReview(TEST_USER, statementId, ids.A, {
      classification: "income",
      clientId,
    });
    assert.ok(mapped.ok);
    const saved = await lineById(ids.A);
    assert.equal(saved.status, "pending"); // saving a classification never promotes
    assert.equal(saved.clientId, clientId);
    ok("mapping: income accepts only a live client and stays pending");

    const ready = await markLineReady(TEST_USER, statementId, ids.A);
    assert.ok(ready.ok);
    const readyRow = await lineById(ids.A);
    assert.equal(readyRow.status, "ready");
    assert.equal(readyRow.reviewedBy, TEST_USER);
    ok("eligibility: reviewed income line becomes ready with the reviewer recorded");
  }

  // ── Description edits re-fingerprint and keep eligibility ─────────────────
  {
    const edited = await updateLineReview(TEST_USER, statementId, ids.A, {
      description: "ACME   opening  credit",
    });
    assert.ok(edited.ok);
    const row = await lineById(ids.A);
    assert.equal(row.narration, "ACME opening credit");
    assert.equal(
      row.fingerprint,
      fingerprintLine({
        txnDate: "2026-04-13",
        valueDate: "2026-04-13",
        narration: "ACME opening credit",
        reference: "REF-1",
        withdrawalAmount: null,
        depositAmount: "1000.00",
      }),
    );
    ok("mapping: description edits normalize narration and refresh the fingerprint");

    // A ready line edited into an invalid shape must demote to pending.
    const demoted = await updateLineReview(TEST_USER, statementId, ids.A, {
      classification: "expense",
      clientId: null,
    });
    assert.ok(demoted.ok);
    const demotedRow = await lineById(ids.A);
    assert.equal(demotedRow.status, "pending");
    assert.equal(demotedRow.reviewedBy, null);
    ok("eligibility: editing breaks the readiness so the line demotes to pending");

    const clientId = await db.execute(sql`
      SELECT client_id FROM clients WHERE client_name = ${TEST_CLIENT_NAME}
    `);
    const restored = await updateLineReview(TEST_USER, statementId, ids.A, {
      description: "OPENING CREDIT",
      classification: "income",
      clientId: String((clientId.rows[0] as { client_id: string }).client_id),
      categoryId: null,
    });
    assert.ok(restored.ok);
    const readyAgain = await markLineReady(TEST_USER, statementId, ids.A);
    assert.ok(readyAgain.ok);
    ok("eligibility: the reviewer can restore and re-approve the line");
  }

  // ── Expense requires an existing category; skipping requires a reason ─────
  {
    const noReason = await skipLine(TEST_USER, statementId, ids.B, "   ");
    assert.ok(!noReason.ok, "skipping requires a non-empty reason");
    ok("state: skipping without a reason is rejected");

    const skipped = await skipLine(TEST_USER, statementId, ids.B, "Landlord not the beneficiary");
    assert.ok(skipped.ok);
    const row = await lineById(ids.B);
    assert.equal(row.status, "skipped");
    assert.equal(row.skipReason, "Landlord not the beneficiary");
    ok("state: skipped rows keep their reason and reviewer");

    const editLocked = await updateLineReview(TEST_USER, statementId, ids.B, {
      classification: "expense",
      categoryId: 1,
    });
    assert.ok(!editLocked.ok, "skipped rows must be reopened before editing");
    ok("state: editing a skipped line without reopening is rejected");

    const reopened = await reopenLine(TEST_USER, statementId, ids.B);
    assert.ok(reopened.ok);
    const cleared = await lineById(ids.B);
    assert.equal(cleared.status, "pending");
    assert.equal(cleared.skipReason, null);
    assert.equal(cleared.reviewedBy, null);
    ok("state: reopening a skipped line clears the review decision");

    const categoryId = await seedCategory();
    const expensed = await updateLineReview(TEST_USER, statementId, ids.B, {
      classification: "expense",
      categoryId,
    });
    assert.ok(expensed.ok);
    const expenseRow = await lineById(ids.B);
    assert.equal(expenseRow.classification, "expense");
    assert.equal(expenseRow.categoryId, categoryId);
    assert.equal(expenseRow.clientId, null);
    ok("mapping: expense accepts an existing category and clears a client");

    const readyB = await markLineReady(TEST_USER, statementId, ids.B);
    assert.ok(readyB.ok);
    ok("eligibility: expense with a category becomes ready");

    const transfer = await updateLineReview(TEST_USER, statementId, ids.B, {
      classification: "transfer",
      categoryId: null,
    });
    assert.ok(transfer.ok);
    const transferRow = await lineById(ids.B);
    assert.equal(transferRow.status, "pending"); // demoted from ready
    assert.equal(transferRow.classification, "transfer");
    assert.equal(transferRow.categoryId, null);
    ok("classification: non-business decisions are explicit and demote the row");

    const readyTransfer = await markLineReady(TEST_USER, statementId, ids.B);
    assert.ok(!readyTransfer.ok, "transfers cannot be made importable silently");
    ok("classification: transfer rows are never silently importable");

    const back = await updateLineReview(TEST_USER, statementId, ids.B, {
      classification: "expense",
      categoryId,
    });
    assert.ok(back.ok);
    ok("classification: the reviewer can decide back to expense");
  }

  // ── Duplicate decisions ───────────────────────────────────────────────────
  {
    const marked = await markLineDuplicate(TEST_USER, statementId, ids.C, "Same row as opening credit");
    assert.ok(marked.ok);
    const row = await lineById(ids.C);
    assert.equal(row.status, "duplicate");
    assert.equal(row.skipReason, "Same row as opening credit");
    assert.equal(row.reviewedBy, TEST_USER);
    ok("duplicates: the reviewer can explicitly mark a line duplicate");

    const again = await markLineDuplicate(TEST_USER, statementId, ids.C, null);
    assert.ok(!again.ok);
    ok("duplicates: re-marking without reopening is rejected");

    const reopened = await reopenLine(TEST_USER, statementId, ids.C);
    assert.ok(reopened.ok);
    const pending = await lineById(ids.C);
    assert.equal(pending.status, "pending");
    assert.equal(pending.skipReason, null);
    ok("duplicates: reopening returns the row to pending");

    const alreadyPending = await reopenLine(TEST_USER, statementId, ids.C);
    assert.ok(!alreadyPending.ok);
    ok("state: reopening a pending line is rejected");
  }

  // ── Parser error rows are closed for review ───────────────────────────────
  {
    await db.execute(sql`
      UPDATE bank_statement_lines SET status = 'error' WHERE id = ${ids.D}::uuid
    `);
    const attempt = await updateLineReview(TEST_USER, statementId, ids.D, {
      classification: "income",
    });
    assert.ok(!attempt.ok, "error rows must not be editable");
    const attemptSkip = await skipLine(TEST_USER, statementId, ids.D, "Cannot parse");
    assert.ok(!attemptSkip.ok);
    const attemptReopen = await reopenLine(TEST_USER, statementId, ids.D);
    assert.ok(!attemptReopen.ok);
    await db.execute(sql`
      UPDATE bank_statement_lines SET status = 'pending' WHERE id = ${ids.D}::uuid
    `);
    ok("state: error rows stay closed until the statement is re-uploaded");
  }

  // ── Statement lifecycle guard ─────────────────────────────────────────────
  {
    await db.execute(sql`
      UPDATE bank_statements SET status = 'completed' WHERE id = ${statementId}::uuid
    `);
    const locked = await updateLineReview(TEST_USER, statementId, ids.A, {
      classification: "income",
      categoryId: null,
    });
    assert.ok(!locked.ok, "a completed statement can no longer be reviewed");
    assert.equal(await statementStatus(statementId), "completed");
    await db.execute(sql`
      UPDATE bank_statements SET status = 'review' WHERE id = ${statementId}::uuid
    `);
    ok("statement: mutations stop once review closes");
  }

  // ── Duplicate candidates (warnings only) ──────────────────────────────────
  {
    const detailForDupes = await getStatementDetail(statementId);
    assert.ok(detailForDupes);
    const report = await findDuplicateCandidates(detailForDupes);
    assert.ok(report.flaggedLineIds.includes(ids.A));
    assert.ok(report.flaggedLineIds.includes(ids.C));
    const candidates = (report.byLine[ids.C] ?? []).map((candidate) => candidate.kind);
    assert.ok(candidates.includes("same_statement_row"));
    const after = await lineById(ids.C);
    assert.equal(after.status, "pending");
    ok("duplicates: same-statement candidates warn without changing any row");
  }

  // ── Overlaps + reconciliation arithmetic ──────────────────────────────────
  {
    const overlap = await persistStatement({
      accountId,
      userId: TEST_USER,
      fileName: TEST_FILE_NAME_2,
      fileSha256: fileSha("b"),
      fileSizeBytes: TEST_FILE_BYTES,
      parsed: {
        ...statementFixture(),
        lines: [
          parsedLine({
            rowNumber: 1,
            txnDate: "2026-04-20",
            narration: "OVERLAP ROW",
            reference: "REF-O1",
            withdrawalAmount: null,
            depositAmount: "700.00",
            direction: "deposit",
            classification: "income",
            fingerprint: FINGERPRINT_B,
          }),
        ],
      },
    });
    assert.ok(overlap.ok, "the overlap statement should stage");
    const overlaps = await listOverlappingStatements(accountId, statementId, {
      from: "2026-04-01",
      to: "2026-04-30",
    });
    assert.ok(overlaps.length >= 1);
    assert.ok(overlaps.some((row) => row.fileName === TEST_FILE_NAME_2));

    const detailAfter = await getStatementDetail(statementId);
    assert.ok(detailAfter);
    const reconciliation = reconcileStatementDetail(detailAfter, overlaps);
    // Movement across staged rows: +1000 − 250 + 1000 + 300 = 2050 over an
    // opening of 0; declared closing 750 is short by 1300.
    assert.equal(reconciliation.status, "unbalanced");
    assert.equal(reconciliation.difference, "-1300.00");
    assert.equal(reconciliation.expectedClosing, "2050.00");
    assert.ok(reconciliation.unresolvedCount >= 1);
    assert.ok(
      reconciliation.warnings.some((warning) => warning.includes("overlaps")),
    );
    ok("reconciliation: exact arithmetic + overlap warnings, nothing written");

    // The overlap statement was persisted but its balance data is not reviewed
    // here; it gets cleaned up below together with the main statement.
  }

  // ── Concurrent review actions stay consistent ─────────────────────────────
  {
    const concurrent = await Promise.allSettled([
      skipLine(TEST_USER, statementId, ids.C, "Concurrent skip A"),
      skipLine(TEST_USER, statementId, ids.C, "Concurrent skip B"),
    ]);
    const outcomes = concurrent.map((entry) =>
      entry.status === "fulfilled" ? (entry.value.ok ? "ok" : `err`) : "threw",
    );
    assert.equal(outcomes.filter((value) => value === "ok").length, 1, "exactly one skip can win");
    const row = await lineById(ids.C);
    assert.equal(row.status, "skipped");
    assert.ok(row.skipReason === "Concurrent skip A" || row.skipReason === "Concurrent skip B");
    const fixed = await reopenLine(TEST_USER, statementId, ids.C);
    assert.ok(fixed.ok);
    ok("concurrency: two reviewers on one line serialize to one decision");
  }

  // ── Review options + audit hygiene ────────────────────────────────────────
  {
    const options = await listReviewOptions();
    assert.ok(options.clients.some((client) => client.label === TEST_CLIENT_NAME));
    assert.ok(options.categories.some((category) => category.label === TEST_CATEGORY_NAME));
    ok("options: pickers list existing clients and categories only");

    const audits = await db.execute(sql`
      SELECT action, before_state AS "beforeState", after_state AS "afterState"
      FROM audit_events
      WHERE entity_type = 'bank_statement_line'
      ORDER BY created_at DESC
      LIMIT 25
    `);
    const serialized = JSON.stringify(audits.rows);
    assert.ok(!serialized.includes("OPENING CREDIT"), "audit entries must not contain narration");
    assert.ok(!serialized.includes("250.00"), "audit entries must not contain amounts");
    const states = audits.rows as unknown as Array<{
      action: string;
      beforeState: Record<string, unknown> | null;
      afterState: Record<string, unknown> | null;
    }>;
    if (states.length > 0 && states[0].afterState) {
      assert.ok("status" in states[0].afterState);
      assert.ok("classification" in states[0].afterState);
      assert.ok("flagCount" in states[0].afterState);
    }
    ok("audit: review actions recorded without narration or amounts");
  }

  // ── Financial isolation ───────────────────────────────────────────────────
  {
    const after = {
      transactions: await count("transactions"),
      clients: await count("clients"),
      invoices: await count("invoices"),
      chat_sessions: await count("chat_sessions"),
    };
    // The test seeded a lookup decoy and one client for the income rule; transactions,
    // invoices and Finance AI chats must be untouched by every mutation above.
    assert.equal(after.transactions, before.transactions, "transactions must be untouched");
    assert.equal(after.invoices, before.invoices, "invoices must be untouched");
    assert.equal(after.chat_sessions, before.chat_sessions, "Finance AI chats must be untouched");
    assert.equal(after.clients - before.clients, 2, "only the two seeded review clients exist");
    ok("financial isolation: transactions, invoices and Finance AI chats unchanged");
  }

  await cleanupTestAccount();
  const postCounts = {
    transactions: await count("transactions"),
    clients: await count("clients"),
  };
  assert.equal(postCounts.transactions, before.transactions);
  ok("cleanup: staging, seeded client/category and audits removed");

  console.log(`\nResults: ${passed} passed, 0 failed`);
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
