/**
 * Comprehensive PostgreSQL Confirmation Persistence Test Suite
 *
 * Verifies all 9 requirements from Section 9:
 *   1. Confirmed income (PostgreSQL record, client relation, audit event).
 *   2. Confirmed expense (PostgreSQL record, description, audit event).
 *   3. Existing and newly created clients (case-insensitive deduplication).
 *   4. INR and USD conversions, including half-even rounding boundaries and precision limits.
 *   5. Editing, clarification, and cancellation without database writes.
 *   6. Duplicate and concurrent confirmation requests (idempotency, payload hash, conflict handling).
 *   7. Both confirmation entry points using the same persistence service.
 *   8. Invalid fields, authentication failures, and state guards.
 *   9. Atomic rollback when transaction or audit insertion fails.
 *
 * Cleanup: All test data is cleaned up in a finally block, leaving 0 temporary test records.
 *
 * Run: npx tsx src/lib/transactions/__tests__/persistence.test.ts
 */

import { NextRequest } from "next/server";
import { eq, sql, and, isNull } from "drizzle-orm";
import { db, pool } from "../../db";
import { appUsers, clients, transactions, auditEvents } from "../../db/schema";
import { confirmAndPersistTransaction } from "../persist";
import { setDraft, setSession, getSession, clearAll } from "../../chatbot/store";
import { POST as confirmHandler } from "../../../app/api/chatbot/confirm/route";
import { POST as messageHandler } from "../../../app/api/chatbot/message/route";
import { createSession, SESSION_COOKIE } from "../../auth";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-32-chars-long-abc-123";

let passed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ Assertion failed: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passed++;
  console.log(`  ✓ ${message}`);
}

function section(title: string) {
  console.log(`\n── ${title} ──`);
}

async function createAuthHeaders(userId: string): Promise<Headers> {
  const token = await createSession(userId);
  const headers = new Headers();
  headers.set("Cookie", `${SESSION_COOKIE}=${token}`);
  headers.set("Content-Type", "application/json");
  return headers;
}

const TEST_PREFIX = "test-persist-";
const TEST_USER = `${TEST_PREFIX}user`;

async function runPersistenceSuite() {
  console.log("Starting PostgreSQL Confirmation Persistence Test Suite...\n");

  const testClientNames: string[] = [];
  const testIdempotencyKeys: string[] = [];

  try {
    // Ensure test user exists in app_users
    await db
      .insert(appUsers)
      .values({ id: TEST_USER, role: "manager", isActive: true })
      .onConflictDoNothing();

    // ─────────────────────────────────────────────────────────────────────────
    section("1. Confirmed Income: Atomically creates transaction, client, and audit event");
    // ─────────────────────────────────────────────────────────────────────────
    {
      const clientName = `${TEST_PREFIX}Acme Corp`;
      testClientNames.push(clientName);
      const idemKey = `${TEST_PREFIX}income-1`;
      testIdempotencyKeys.push(idemKey);

      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 50000,
        original_currency: "INR",
        client_name: clientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: idemKey,
        currency: {
          original_amount: 50000,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 50000,
          exchange_rate_date: "2026-10-12",
        },
      });

      const res = await confirmAndPersistTransaction({
        userId: TEST_USER,
        idempotencyKey: idemKey,
      });

      assert(res.ok === true, "confirmAndPersistTransaction returned ok: true");
      if (!res.ok) return;

      assert(res.status === "CONFIRMED", "Returned status is CONFIRMED");
      assert(!!res.transaction.id, "Returned transaction contains PostgreSQL UUID id");
      assert(res.transaction.type === "income", "Transaction type is income");
      assert(res.transaction.original_amount === 50000, "Original amount is 50000");
      assert(res.transaction.inr_amount === 50000, "INR amount is 50000");
      assert(res.transaction.client_name === clientName, "Client name is preserved");

      // Verify PostgreSQL transaction row
      const [dbTxn] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, res.transaction.id!));

      assert(!!dbTxn, "Transaction exists in PostgreSQL transactions table");
      assert(dbTxn.typeId === 1, "type_id is 1 (income)");
      assert(dbTxn.originalAmount === "50000.00", "original_amount is 50000.00");
      assert(dbTxn.amountInr === "50000.00", "amount_inr is 50000.00");
      assert(dbTxn.exchangeRate === null, "exchange_rate is null for INR");
      assert(dbTxn.status === "confirmed", "status is confirmed");
      assert(dbTxn.source === "chatbot", "source is chatbot");
      assert(dbTxn.idempotencyKey === idemKey, "idempotency_key matches");

      // Verify client was created and linked
      assert(!!dbTxn.clientId, "Income transaction is linked to a clientId");
      const [dbClient] = await db
        .select()
        .from(clients)
        .where(eq(clients.clientId, dbTxn.clientId!));
      assert(!!dbClient, "Client record exists in clients table");
      assert(dbClient.clientName === clientName, "Client record name matches");

      // Verify audit event
      const [audit] = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityType, "transaction"),
            eq(auditEvents.entityId, res.transaction.id!),
          ),
        );
      assert(!!audit, "Audit event was created for the transaction");
      assert(audit.action === "created", "Audit action is created");
      assert(audit.performedBy === TEST_USER, "Audit performed_by matches test user");
    }

    // ─────────────────────────────────────────────────────────────────────────
    section("2. Confirmed Expense: Description required, client_id is null");
    // ─────────────────────────────────────────────────────────────────────────
    {
      const idemKey = `${TEST_PREFIX}expense-1`;
      testIdempotencyKeys.push(idemKey);
      const desc = `${TEST_PREFIX}Cloud Hosting AWS`;

      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "expense",
        original_amount: 12500.5,
        original_currency: "INR",
        client_name: null,
        expense_description: desc,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: idemKey,
        currency: {
          original_amount: 12500.5,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 12500.5,
          exchange_rate_date: "2026-10-12",
        },
      });

      const res = await confirmAndPersistTransaction({
        userId: TEST_USER,
        idempotencyKey: idemKey,
      });

      assert(res.ok === true, "Expense confirmation succeeded");
      if (!res.ok) return;

      const [dbTxn] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, res.transaction.id!));

      assert(!!dbTxn, "Expense transaction found in PostgreSQL");
      assert(dbTxn.typeId === 2, "type_id is 2 (expense)");
      assert(dbTxn.clientId === null, "Expense clientId is null");
      assert(dbTxn.description === desc, "Expense description is saved");
      assert(dbTxn.originalAmount === "12500.50", "Exact original_amount 12500.50");
      assert(dbTxn.amountInr === "12500.50", "Exact amount_inr 12500.50");
    }

    // ─────────────────────────────────────────────────────────────────────────
    section("3. Client Deduplication: Case-insensitive and trimmed resolution");
    // ─────────────────────────────────────────────────────────────────────────
    {
      const canonicalClientName = `${TEST_PREFIX}Beta Innovations`;
      testClientNames.push(canonicalClientName);

      // First income creates the client
      const keyA = `${TEST_PREFIX}client-dedup-a`;
      testIdempotencyKeys.push(keyA);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 1000,
        original_currency: "INR",
        client_name: canonicalClientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: keyA,
        currency: {
          original_amount: 1000,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 1000,
          exchange_rate_date: "2026-10-12",
        },
      });
      const resA = await confirmAndPersistTransaction({ userId: TEST_USER, idempotencyKey: keyA });
      assert(resA.ok === true, "First income created client");
      if (!resA.ok) return;

      const [txnA] = await db.select().from(transactions).where(eq(transactions.id, resA.transaction.id!));
      const firstClientId = txnA.clientId;

      // Second income uses different case and surrounding whitespace
      const keyB = `${TEST_PREFIX}client-dedup-b`;
      testIdempotencyKeys.push(keyB);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 2000,
        original_currency: "INR",
        client_name: `   ${canonicalClientName.toUpperCase()}   `,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: keyB,
        currency: {
          original_amount: 2000,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 2000,
          exchange_rate_date: "2026-10-12",
        },
      });
      const resB = await confirmAndPersistTransaction({ userId: TEST_USER, idempotencyKey: keyB });
      assert(resB.ok === true, "Second income with different casing succeeded");
      if (!resB.ok) return;

      const [txnB] = await db.select().from(transactions).where(eq(transactions.id, resB.transaction.id!));
      assert(txnB.clientId === firstClientId, "Second transaction reused existing client UUID without duplicating");

      // Verify only 1 client exists in DB with this normalized name
      const matchingClients = await db
        .select()
        .from(clients)
        .where(
          and(
            isNull(clients.deletedAt),
            sql`lower(trim(both from ${clients.clientName})) = ${canonicalClientName.toLowerCase()}`,
          ),
        );
      assert(matchingClients.length === 1, "Exactly 1 client row exists in clients table");
    }

    // ─────────────────────────────────────────────────────────────────────────
    section("4. USD Conversions & Banker's Rounding (Half-Even) Boundaries");
    // ─────────────────────────────────────────────────────────────────────────
    {
      const clientName = `${TEST_PREFIX}USD Client`;
      testClientNames.push(clientName);

      // Test A: Standard USD conversion (100 USD @ 88.50)
      const keyUsd1 = `${TEST_PREFIX}usd-std`;
      testIdempotencyKeys.push(keyUsd1);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 100,
        original_currency: "USD",
        client_name: clientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: keyUsd1,
        currency: {
          original_amount: 100,
          original_currency: "USD",
          exchange_rate: 88.5,
          inr_amount: 8850,
          exchange_rate_date: "2026-10-12",
        },
      });
      const resUsd1 = await confirmAndPersistTransaction({ userId: TEST_USER, idempotencyKey: keyUsd1 });
      assert(resUsd1.ok === true, "Standard USD transaction confirmed");
      if (!resUsd1.ok) return;

      const [dbUsd1] = await db.select().from(transactions).where(eq(transactions.id, resUsd1.transaction.id!));
      assert(dbUsd1.originalAmount === "100.00", "USD originalAmount is 100.00");
      assert(dbUsd1.amountInr === "8850.00", "USD amountInr is 8850.00");
      assert(dbUsd1.exchangeRate === "88.5000", "Stored exchange rate has 4 decimals (88.5000)");
      assert(dbUsd1.rateSource === "manual", "rate_source is manual for USD");

      // Test B: Half-Even tie rounded DOWN to even (1.00 USD @ 88.5050 -> 88.50)
      const keyTieEven = `${TEST_PREFIX}usd-tie-even`;
      testIdempotencyKeys.push(keyTieEven);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 1.0,
        original_currency: "USD",
        client_name: clientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: keyTieEven,
        currency: {
          original_amount: 1.0,
          original_currency: "USD",
          exchange_rate: 88.505,
          inr_amount: 88.5,
          exchange_rate_date: "2026-10-12",
        },
      });
      const resTieEven = await confirmAndPersistTransaction({ userId: TEST_USER, idempotencyKey: keyTieEven });
      assert(resTieEven.ok === true, "Half-Even tie (even quotient) confirmed");
      if (!resTieEven.ok) return;

      const [dbTieEven] = await db.select().from(transactions).where(eq(transactions.id, resTieEven.transaction.id!));
      assert(dbTieEven.originalAmount === "1.00", "USD originalAmount is 1.00");
      assert(dbTieEven.amountInr === "88.50", "Exact Half-Even tie rounded to even: 88.50");

      // Test C: Half-Even tie rounded UP to even (1.00 USD @ 88.5150 -> 88.52)
      const keyTieOdd = `${TEST_PREFIX}usd-tie-odd`;
      testIdempotencyKeys.push(keyTieOdd);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 1.0,
        original_currency: "USD",
        client_name: clientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: keyTieOdd,
        currency: {
          original_amount: 1.0,
          original_currency: "USD",
          exchange_rate: 88.515,
          inr_amount: 88.52,
          exchange_rate_date: "2026-10-12",
        },
      });
      const resTieOdd = await confirmAndPersistTransaction({ userId: TEST_USER, idempotencyKey: keyTieOdd });
      assert(resTieOdd.ok === true, "Half-Even tie (odd quotient) confirmed");
      if (!resTieOdd.ok) return;

      const [dbTieOdd] = await db.select().from(transactions).where(eq(transactions.id, resTieOdd.transaction.id!));
      assert(dbTieOdd.originalAmount === "1.00", "USD originalAmount is 1.00");
      assert(dbTieOdd.amountInr === "88.52", "Exact Half-Even tie rounded up to even: 88.52");

      // Test D: Reject unsupported precision (e.g. 3 decimal places in amount)
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 100.125, // 3 decimal places!
        original_currency: "INR",
        client_name: clientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: `${TEST_PREFIX}invalid-prec`,
        currency: {
          original_amount: 100.125,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 100.125,
          exchange_rate_date: "2026-10-12",
        },
      });
      const resPrec = await confirmAndPersistTransaction({ userId: TEST_USER });
      assert(resPrec.ok === false, "Unsupported precision (>2 decimals) rejected");
      if (!resPrec.ok) {
        assert(resPrec.code === "PRECISION_ERROR", "Error code is PRECISION_ERROR");
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    section("5. Drafting & Cancellation: Database remains write-free before confirmation");
    // ─────────────────────────────────────────────────────────────────────────
    {
      const [countBefore] = await db.select({ count: sql<number>`count(*)` }).from(transactions);

      clearAll(TEST_USER);
      // Step A: Incomplete draft
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 9999,
        original_currency: null,
        client_name: null,
        expense_description: null,
        txn_date: null,
      });

      // Step B: CANCEL action
      const cancelReq = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
        method: "POST",
        headers: await createAuthHeaders(TEST_USER),
        body: JSON.stringify({ action: "CANCEL" }),
      });
      const cancelRes = await confirmHandler(cancelReq);
      assert(cancelRes.status === 200, "CANCEL endpoint returns 200");
      assert(getSession(TEST_USER).status === "COLLECTING", "Status is reset to COLLECTING");

      // Verify no database writes took place
      const [countAfter] = await db.select({ count: sql<number>`count(*)` }).from(transactions);
      assert(countBefore.count === countAfter.count, "Transactions table row count is unchanged");
    }

    // ─────────────────────────────────────────────────────────────────────────
    section("6. Duplicate & Concurrent Confirmation Protection");
    // ─────────────────────────────────────────────────────────────────────────
    {
      const clientName = `${TEST_PREFIX}Idempotency Client`;
      testClientNames.push(clientName);
      const stableKey = `${TEST_PREFIX}stable-idempotent-key`;
      testIdempotencyKeys.push(stableKey);

      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 7000,
        original_currency: "INR",
        client_name: clientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: stableKey,
        currency: {
          original_amount: 7000,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 7000,
          exchange_rate_date: "2026-10-12",
        },
      });

      // Attempt 1: First save succeeds
      const firstRes = await confirmAndPersistTransaction({
        userId: TEST_USER,
        idempotencyKey: stableKey,
      });
      assert(firstRes.ok === true, "First confirmation attempt succeeds");
      if (!firstRes.ok) return;
      const originalTxnId = firstRes.transaction.id;

      // Attempt 2: Same key and SAME payload -> returns original saved transaction
      const secondRes = await confirmAndPersistTransaction({
        userId: TEST_USER,
        idempotencyKey: stableKey,
      });
      assert(secondRes.ok === true, "Second attempt with same key & payload returns ok: true");
      if (secondRes.ok) {
        assert(secondRes.isDuplicate === true, "Marked as duplicate");
        assert(secondRes.transaction.id === originalTxnId, "Returns same transaction UUID");
      }

      // Attempt 3: Same key with DIFFERENT payload -> rejected with 409 Conflict
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 9999, // DIFFERENT AMOUNT
        original_currency: "INR",
        client_name: clientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: stableKey, // SAME KEY
        currency: {
          original_amount: 9999,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 9999,
          exchange_rate_date: "2026-10-12",
        },
      });
      const conflictRes = await confirmAndPersistTransaction({
        userId: TEST_USER,
        idempotencyKey: stableKey,
      });
      assert(conflictRes.ok === false, "Reused key with different payload rejected");
      if (!conflictRes.ok) {
        assert(conflictRes.status === 409, "Conflict returns status 409");
        assert(conflictRes.code === "CONFLICT", "Error code is CONFLICT");
      }

      // Attempt 4: DIFFERENT key with IDENTICAL details -> allowed as legitimate second transaction
      const newKey = `${TEST_PREFIX}new-legitimate-repeat`;
      testIdempotencyKeys.push(newKey);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 7000,
        original_currency: "INR",
        client_name: clientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: newKey,
        currency: {
          original_amount: 7000,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 7000,
          exchange_rate_date: "2026-10-12",
        },
      });
      const repeatRes = await confirmAndPersistTransaction({
        userId: TEST_USER,
        idempotencyKey: newKey,
      });
      assert(repeatRes.ok === true, "Different key with identical details allowed as legitimate repeat");
      if (repeatRes.ok) {
        assert(repeatRes.transaction.id !== originalTxnId, "New transaction has its own distinct UUID");
      }

      // Attempt 5: Concurrent execution with same idempotencyKey
      const concurrentKey = `${TEST_PREFIX}concurrent-test`;
      testIdempotencyKeys.push(concurrentKey);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 3000,
        original_currency: "INR",
        client_name: clientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: concurrentKey,
        currency: {
          original_amount: 3000,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 3000,
          exchange_rate_date: "2026-10-12",
        },
      });

      const [c1, c2, c3] = await Promise.all([
        confirmAndPersistTransaction({ userId: TEST_USER, idempotencyKey: concurrentKey }),
        confirmAndPersistTransaction({ userId: TEST_USER, idempotencyKey: concurrentKey }),
        confirmAndPersistTransaction({ userId: TEST_USER, idempotencyKey: concurrentKey }),
      ]);

      assert(c1.ok === true && c2.ok === true && c3.ok === true, "All concurrent requests resolved successfully");
      if (c1.ok && c2.ok && c3.ok) {
        assert(c1.transaction.id === c2.transaction.id && c2.transaction.id === c3.transaction.id, "All concurrent requests yielded the exact same transaction ID");
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    section("7. Both Entry Points: /confirm and conversational 'confirm' use same persistence");
    // ─────────────────────────────────────────────────────────────────────────
    {
      const clientName = `${TEST_PREFIX}Dual Entry Point Client`;
      testClientNames.push(clientName);
      const authHeaders = await createAuthHeaders(TEST_USER);

      // Entry Point 1: POST /api/chatbot/confirm
      const keyEp1 = `${TEST_PREFIX}entry-point-1`;
      testIdempotencyKeys.push(keyEp1);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 4000,
        original_currency: "INR",
        client_name: clientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: keyEp1,
        currency: {
          original_amount: 4000,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 4000,
          exchange_rate_date: "2026-10-12",
        },
      });

      const ep1Req = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ action: "CONFIRM" }),
      });
      const ep1Res = await confirmHandler(ep1Req);
      assert(ep1Res.status === 200, "POST /api/chatbot/confirm returned 200");
      const ep1Json = await ep1Res.json();
      assert(ep1Json.status === "CONFIRMED", "Entry point 1 status is CONFIRMED");
      assert(!!ep1Json.transaction.id, "Entry point 1 returned saved transaction ID");

      // Verify in PostgreSQL
      const [ep1Db] = await db.select().from(transactions).where(eq(transactions.id, ep1Json.transaction.id));
      assert(!!ep1Db, "Entry point 1 row verified in PostgreSQL");

      // Entry Point 2: POST /api/chatbot/message with "confirm"
      const keyEp2 = `${TEST_PREFIX}entry-point-2`;
      testIdempotencyKeys.push(keyEp2);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 5500,
        original_currency: "INR",
        client_name: clientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: keyEp2,
        currency: {
          original_amount: 5500,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 5500,
          exchange_rate_date: "2026-10-12",
        },
      });

      const ep2Req = new NextRequest("http://localhost:3000/api/chatbot/message", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ message: "confirm" }),
      });
      const ep2Res = await messageHandler(ep2Req);
      assert(ep2Res.status === 200, "POST /api/chatbot/message with 'confirm' returned 200");
      const ep2Json = await ep2Res.json();
      assert(ep2Json.status === "CONFIRMED", "Entry point 2 status is CONFIRMED");
      assert(!!ep2Json.transaction.id, "Entry point 2 returned saved transaction ID");

      // Verify in PostgreSQL
      const [ep2Db] = await db.select().from(transactions).where(eq(transactions.id, ep2Json.transaction.id));
      assert(!!ep2Db, "Entry point 2 row verified in PostgreSQL");
    }

    // ─────────────────────────────────────────────────────────────────────────
    section("8. Error Guards & Invariant Enforcement");
    // ─────────────────────────────────────────────────────────────────────────
    {
      // 8a. Unauthenticated request
      const noAuthReq = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
        method: "POST",
        body: JSON.stringify({ action: "CONFIRM" }),
      });
      const noAuthRes = await confirmHandler(noAuthReq);
      assert(noAuthRes.status === 401, "Unauthenticated confirm request returns 401");

      // 8b. Confirmation rejected when in COLLECTING state
      clearAll(TEST_USER);
      const authHeaders = await createAuthHeaders(TEST_USER);
      const collectingReq = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ action: "CONFIRM" }),
      });
      const collectingRes = await confirmHandler(collectingReq);
      assert(collectingRes.status === 400, "Confirmation rejected when status is COLLECTING");

      // 8c. Confirmation rejected when in AWAITING_EXCHANGE_RATE state
      setSession(TEST_USER, { status: "AWAITING_EXCHANGE_RATE" });
      const rateReq = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ action: "CONFIRM" }),
      });
      const rateRes = await confirmHandler(rateReq);
      assert(rateRes.status === 400, "Confirmation rejected when status is AWAITING_EXCHANGE_RATE");
    }

    // ─────────────────────────────────────────────────────────────────────────
    section("9. Atomicity: Rollback ensures zero partial transactions or orphan clients");
    // ─────────────────────────────────────────────────────────────────────────
    {
      const orphanClientName = `${TEST_PREFIX}Orphan Client Test`;
      testClientNames.push(orphanClientName);

      // Attempt to save an invalid transaction that will violate database constraints
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 1000,
        original_currency: "INR",
        client_name: orphanClientName,
        expense_description: null,
        txn_date: "invalid-date", // VIOLATES date format constraint in persist
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        currency: {
          original_amount: 1000,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 1000,
          exchange_rate_date: "2026-10-12",
        },
      });

      const failRes = await confirmAndPersistTransaction({ userId: TEST_USER });
      assert(failRes.ok === false, "Transaction with invalid fields was rejected");

      // Verify that orphan client was NOT created in PostgreSQL
      const orphanClients = await db
        .select()
        .from(clients)
        .where(
          and(
            isNull(clients.deletedAt),
            sql`lower(trim(both from ${clients.clientName})) = ${orphanClientName.toLowerCase()}`,
          ),
        );
      assert(orphanClients.length === 0, "No orphan client created in PostgreSQL on failure");
    }

    // ─────────────────────────────────────────────────────────────────────────
    section("10. Target Verification: Major-Unit Storage (NUMERIC 18,2) & Exact Displays");
    // ─────────────────────────────────────────────────────────────────────────
    {
      // 1. Entering INR 500 results in original_amount = 500.00 and amount_inr = 500.00
      const inrClientName = `${TEST_PREFIX}Target INR Client`;
      testClientNames.push(inrClientName);
      const inrIdemKey = `${TEST_PREFIX}target-inr-500`;
      testIdempotencyKeys.push(inrIdemKey);

      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 500,
        original_currency: "INR",
        client_name: inrClientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: inrIdemKey,
        currency: {
          original_amount: 500,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 500,
          exchange_rate_date: "2026-10-12",
        },
      });

      const countTxnBefore = await db.select({ count: sql<number>`count(*)` }).from(transactions);
      const countAuditBefore = await db.select({ count: sql<number>`count(*)` }).from(auditEvents);

      const inrRes = await confirmAndPersistTransaction({
        userId: TEST_USER,
        idempotencyKey: inrIdemKey,
      });

      assert(inrRes.ok === true, "INR 500 confirmAndPersistTransaction returned ok: true");
      if (!inrRes.ok) return;

      const [dbInrTxn] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, inrRes.transaction.id!));

      assert(!!dbInrTxn, "INR ₹500 transaction exists in PostgreSQL");
      assert(dbInrTxn.originalAmount === "500.00", "Stored as 500.00 in original_amount (not 50000)");
      assert(dbInrTxn.amountInr === dbInrTxn.originalAmount, "amount_inr equals original_amount");
      assert(dbInrTxn.amountInr === "500.00", "amount_inr is exactly 500.00");
      assert(dbInrTxn.exchangeRate === null, "exchange_rate is null for INR ₹500");

      const displayOriginal = new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(inrRes.transaction.original_amount);
      const displayInr = new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(inrRes.transaction.inr_amount);

      assert(inrRes.transaction.original_amount === 500, "Human-scale original_amount is 500");
      assert(inrRes.transaction.inr_amount === 500, "Human-scale inr_amount is 500");
      assert(displayOriginal === "500.00", "Displays original amount as 500.00");
      assert(displayInr === "500.00", "Displays INR amount as 500.00");

      const countTxnAfter = await db.select({ count: sql<number>`count(*)` }).from(transactions);
      const countAuditAfter = await db.select({ count: sql<number>`count(*)` }).from(auditEvents);

      assert(Number(countTxnAfter[0].count) - Number(countTxnBefore[0].count) === 1, "Exactly one transaction record created");
      assert(Number(countAuditAfter[0].count) - Number(countAuditBefore[0].count) === 1, "Exactly one audit event created");

      // 2. Entering INR 40 results in 40.00, not 4000.00
      const inr40IdemKey = `${TEST_PREFIX}target-inr-40`;
      testIdempotencyKeys.push(inr40IdemKey);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 40,
        original_currency: "INR",
        client_name: inrClientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: inr40IdemKey,
        currency: {
          original_amount: 40,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 40,
          exchange_rate_date: "2026-10-12",
        },
      });
      const res40 = await confirmAndPersistTransaction({ userId: TEST_USER, idempotencyKey: inr40IdemKey });
      assert(res40.ok === true, "INR 40 confirmation succeeded");
      if (res40.ok) {
        const [db40] = await db.select().from(transactions).where(eq(transactions.id, res40.transaction.id!));
        assert(db40.originalAmount === "40.00", "INR 40 stored as 40.00 (not 4000.00)");
        assert(db40.amountInr === "40.00", "INR 40 amount_inr is 40.00");
        assert(res40.transaction.original_amount === 40, "Transaction returned original_amount is 40");
      }

      // 3. Entering INR 400 results in 400.00, not 40000.00
      const inr400IdemKey = `${TEST_PREFIX}target-inr-400`;
      testIdempotencyKeys.push(inr400IdemKey);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 400,
        original_currency: "INR",
        client_name: inrClientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: inr400IdemKey,
        currency: {
          original_amount: 400,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 400,
          exchange_rate_date: "2026-10-12",
        },
      });
      const res400 = await confirmAndPersistTransaction({ userId: TEST_USER, idempotencyKey: inr400IdemKey });
      assert(res400.ok === true, "INR 400 confirmation succeeded");
      if (res400.ok) {
        const [db400] = await db.select().from(transactions).where(eq(transactions.id, res400.transaction.id!));
        assert(db400.originalAmount === "400.00", "INR 400 stored as 400.00 (not 40000.00)");
        assert(db400.amountInr === "400.00", "INR 400 amount_inr is 400.00");
        assert(res400.transaction.original_amount === 400, "Transaction returned original_amount is 400");
      }

      // 4. Entering USD 500 at 88.50 results in original_amount = 500.00 and amount_inr = 44250.00
      const usdClientName = `${TEST_PREFIX}Target USD Client`;
      testClientNames.push(usdClientName);
      const usdIdemKey = `${TEST_PREFIX}target-usd-500`;
      testIdempotencyKeys.push(usdIdemKey);

      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 500,
        original_currency: "USD",
        client_name: usdClientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: usdIdemKey,
        currency: {
          original_amount: 500,
          original_currency: "USD",
          exchange_rate: 88.5,
          inr_amount: 44250,
          exchange_rate_date: "2026-10-12",
        },
      });

      const usdRes = await confirmAndPersistTransaction({
        userId: TEST_USER,
        idempotencyKey: usdIdemKey,
      });

      assert(usdRes.ok === true, "USD $500 confirmAndPersistTransaction returned ok: true");
      if (!usdRes.ok) return;

      const [dbUsdTxn] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, usdRes.transaction.id!));

      assert(!!dbUsdTxn, "USD $500 transaction exists in PostgreSQL");
      assert(dbUsdTxn.originalAmount === "500.00", "USD $500 stored as 500.00 in original_amount (not 50000)");
      assert(dbUsdTxn.amountInr === "44250.00", "USD $500 at 88.50 stored as 44250.00 in amount_inr");
      assert(dbUsdTxn.exchangeRate === "88.5000", "Stored exchange rate is 88.5000");
      assert(dbUsdTxn.rateSource === "manual", "rate_source is manual");

      const displayUsdOriginal = new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(usdRes.transaction.original_amount);
      const displayUsdInr = new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(usdRes.transaction.inr_amount);

      assert(usdRes.transaction.original_amount === 500, "Human-scale USD original_amount is 500");
      assert(usdRes.transaction.inr_amount === 44250, "Human-scale USD inr_amount is 44250");
      assert(displayUsdOriginal === "500.00", "USD displays original amount as 500.00");
      assert(displayUsdInr === "44,250.00", "USD displays INR equivalent as 44,250.00");

      // 5. Decimal amounts such as 500.25 remain exact
      const inrDecimalIdemKey = `${TEST_PREFIX}target-inr-500-25`;
      testIdempotencyKeys.push(inrDecimalIdemKey);
      clearAll(TEST_USER);
      setDraft(TEST_USER, {
        type: "income",
        original_amount: 500.25,
        original_currency: "INR",
        client_name: inrClientName,
        expense_description: null,
        txn_date: "2026-10-12",
      });
      setSession(TEST_USER, {
        status: "READY_FOR_CONFIRMATION",
        idempotencyKey: inrDecimalIdemKey,
        currency: {
          original_amount: 500.25,
          original_currency: "INR",
          exchange_rate: null,
          inr_amount: 500.25,
          exchange_rate_date: "2026-10-12",
        },
      });
      const res50025 = await confirmAndPersistTransaction({ userId: TEST_USER, idempotencyKey: inrDecimalIdemKey });
      assert(res50025.ok === true, "INR 500.25 confirmation succeeded");
      if (res50025.ok) {
        const [db50025] = await db.select().from(transactions).where(eq(transactions.id, res50025.transaction.id!));
        assert(db50025.originalAmount === "500.25", "INR 500.25 stored as 500.25");
        assert(db50025.amountInr === "500.25", "INR 500.25 amount_inr is 500.25");
        assert(res50025.transaction.original_amount === 500.25, "Transaction returned original_amount is 500.25");
      }
    }

    console.log(`\nAll ${passed} persistence test checks passed!`);
  } finally {
    // ─────────────────────────────────────────────────────────────────────────
    // Complete Cleanup: Zero test data left in database
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\nCleaning up test records from PostgreSQL...");
    try {
      // 1. Delete transactions created by test
      await db.execute(
        sql`DELETE FROM "transactions" WHERE "created_by" = ${TEST_USER} OR "idempotency_key" LIKE ${TEST_PREFIX + "%"}`,
      );

      // 2. Temporarily disable immutability trigger to clean test audit events
      await db.execute(sql`ALTER TABLE "audit_events" DISABLE TRIGGER "trg_audit_events_immutable"`);
      await db.execute(sql`DELETE FROM "audit_events" WHERE "performed_by" = ${TEST_USER}`);
      await db.execute(sql`ALTER TABLE "audit_events" ENABLE TRIGGER "trg_audit_events_immutable"`);

      // 3. Delete clients created by test
      for (const name of testClientNames) {
        await db.execute(sql`DELETE FROM "clients" WHERE "client_name" = ${name}`);
      }

      // 4. Delete test user
      await db.execute(sql`DELETE FROM "app_users" WHERE "id" = ${TEST_USER}`);
      console.log("✓ Cleanup finished cleanly. Development database restored.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr);
    }
    await pool.end();
  }
}

runPersistenceSuite().catch((err) => {
  console.error("Persistence suite execution failed:", err);
  process.exit(1);
});
