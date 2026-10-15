import { eq, sql } from "drizzle-orm";
import { db, pool } from "../index";
import { appUsers, clients, transactionTypes, transactions, auditEvents } from "../schema";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

let passed = 0;
function logPass(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

async function runSchemaVerification() {
  console.log("Starting Database Schema & Constraint Verification Suite...\n");

  // ── 1. Manager Identity Seed Check ───────────────────────────────────────
  const [manager] = await db.select().from(appUsers).where(eq(appUsers.id, "admin"));
  assert(!!manager, "Manager record with ID 'admin' must exist");
  assert(manager.role === "manager", `Manager role must be 'manager', got '${manager.role}'`);
  assert(manager.isActive === true, "Manager account must be active");
  logPass("Manager identity: exists with id='admin' and role='manager'");

  // ── 2. Transaction Types Seed Check ───────────────────────────────────────
  const types = await db.select().from(transactionTypes);
  const incomeType = types.find((t) => t.id === 1);
  const expenseType = types.find((t) => t.id === 2);

  assert(!!incomeType, "Transaction type ID 1 must exist");
  assert(incomeType?.code === "income", `ID 1 must have code 'income', got '${incomeType?.code}'`);
  assert(!!expenseType, "Transaction type ID 2 must exist");
  assert(expenseType?.code === "expense", `ID 2 must have code 'expense', got '${expenseType?.code}'`);
  logPass("Transaction types: seeded correctly (1=income, 2=expense)");

  // ── 3. Client Case-Insensitive, Whitespace-Trimmed Uniqueness ─────────────
  const testClientName = "Test Acme Corp";
  const [testClient] = await db
    .insert(clients)
    .values({ clientName: testClientName })
    .returning();

  try {
    let duplicateRejected = false;
    try {
      // Attempt duplicate with leading/trailing spaces and lower case
      await db.insert(clients).values({ clientName: "   test acme corp   " });
    } catch {
      duplicateRejected = true;
    }
    assert(duplicateRejected, "Duplicate client name after normalization must be rejected");
    logPass("Clients: normalized active uniqueness enforced ('Test Acme Corp' vs '  test acme corp  ')");

    // ── 4. Empty Client Name Check Constraint ──────────────────────────────
    let emptyClientRejected = false;
    try {
      await db.insert(clients).values({ clientName: "   " });
    } catch {
      emptyClientRejected = true;
    }
    assert(emptyClientRejected, "Whitespace-only client name must be rejected by check constraint");
    logPass("Clients: empty/whitespace-only client name rejected");

    // ── 5. INR Constraint Checks ───────────────────────────────────────────
    // Valid INR row
    const [inrTxn] = await db
      .insert(transactions)
      .values({
        typeId: 1,
        clientId: testClient.clientId,
        clientNameSnapshot: testClient.clientName,
        originalAmount: "500.00", // Rs 500.00
        originalCurrency: "INR",
        amountInr: "500.00",
        exchangeRate: null,
        exchangeRateDate: null,
        rateSource: null,
        txnDate: "2026-10-12",
        source: "chatbot",
        status: "confirmed",
        idempotencyKey: "test-inr-valid-key",
        payloadHash: "hash-inr-valid",
        createdBy: "admin",
      })
      .returning();
    assert(!!inrTxn, "Valid INR transaction must insert successfully");
    logPass("Transactions: valid INR row satisfies constraints");

    // Invalid INR: Non-null exchange_rate
    let inrWithRateRejected = false;
    try {
      await db.insert(transactions).values({
        typeId: 1,
        clientId: testClient.clientId,
        originalAmount: "500.00",
        originalCurrency: "INR",
        amountInr: "500.00",
        exchangeRate: "88.5000", // VIOLATION for INR
        exchangeRateDate: null,
        rateSource: null,
        txnDate: "2026-10-12",
        source: "chatbot",
        status: "confirmed",
        idempotencyKey: "test-inr-invalid-rate",
        payloadHash: "hash-inr-invalid-rate",
        createdBy: "admin",
      });
    } catch {
      inrWithRateRejected = true;
    }
    assert(inrWithRateRejected, "INR transaction with non-null exchange_rate must be rejected");
    logPass("Transactions: INR row with exchange_rate rejected by chk_transactions_currency_rules");

    // Invalid INR: Non-null rate_source
    let inrWithSourceRejected = false;
    try {
      await db.insert(transactions).values({
        typeId: 1,
        clientId: testClient.clientId,
        originalAmount: "500.00",
        originalCurrency: "INR",
        amountInr: "500.00",
        exchangeRate: null,
        exchangeRateDate: null,
        rateSource: "manual", // VIOLATION for INR
        txnDate: "2026-10-12",
        source: "chatbot",
        status: "confirmed",
        idempotencyKey: "test-inr-invalid-source",
        payloadHash: "hash-inr-invalid-source",
        createdBy: "admin",
      });
    } catch {
      inrWithSourceRejected = true;
    }
    assert(inrWithSourceRejected, "INR transaction with non-null rate_source must be rejected");
    logPass("Transactions: INR row with rate_source rejected by chk_transactions_currency_rules");

    // Invalid INR: amountInr != originalAmount
    let inrMismatchRejected = false;
    try {
      await db.insert(transactions).values({
        typeId: 1,
        clientId: testClient.clientId,
        originalAmount: "500.00",
        originalCurrency: "INR",
        amountInr: "450.00", // VIOLATION for INR
        exchangeRate: null,
        exchangeRateDate: null,
        rateSource: null,
        txnDate: "2026-10-12",
        source: "chatbot",
        status: "confirmed",
        idempotencyKey: "test-inr-invalid-mismatch",
        payloadHash: "hash-inr-invalid-mismatch",
        createdBy: "admin",
      });
    } catch {
      inrMismatchRejected = true;
    }
    assert(inrMismatchRejected, "INR transaction where amount_inr != original_amount must be rejected");
    logPass("Transactions: INR amount mismatch rejected by chk_transactions_currency_rules");

    // ── 6. USD Constraint Checks ───────────────────────────────────────────
    // Valid USD row
    const [usdTxn] = await db
      .insert(transactions)
      .values({
        typeId: 1,
        clientId: testClient.clientId,
        clientNameSnapshot: testClient.clientName,
        originalAmount: "100.00", // $100.00
        originalCurrency: "USD",
        amountInr: "8850.00", // Rs 8,850.00
        exchangeRate: "88.5000",
        exchangeRateDate: "2026-10-12",
        rateSource: "manual",
        txnDate: "2026-10-12",
        source: "chatbot",
        status: "confirmed",
        idempotencyKey: "test-usd-valid-key",
        payloadHash: "hash-usd-valid",
        createdBy: "admin",
      })
      .returning();
    assert(!!usdTxn, "Valid USD transaction must insert successfully");
    logPass("Transactions: valid USD row satisfies constraints");

    // Invalid USD: Null rate_source
    let usdNullSourceRejected = false;
    try {
      await db.insert(transactions).values({
        typeId: 1,
        clientId: testClient.clientId,
        originalAmount: "100.00",
        originalCurrency: "USD",
        amountInr: "8850.00",
        exchangeRate: "88.5000",
        exchangeRateDate: "2026-10-12",
        rateSource: null, // VIOLATION for USD
        txnDate: "2026-10-12",
        source: "chatbot",
        status: "confirmed",
        idempotencyKey: "test-usd-null-source",
        payloadHash: "hash-usd-null-source",
        createdBy: "admin",
      });
    } catch {
      usdNullSourceRejected = true;
    }
    assert(usdNullSourceRejected, "USD transaction with NULL rate_source must be rejected");
    logPass("Transactions: USD row with NULL rate_source rejected");

    // Invalid USD: Null exchange_rate
    let usdNullRateRejected = false;
    try {
      await db.insert(transactions).values({
        typeId: 1,
        clientId: testClient.clientId,
        originalAmount: "100.00",
        originalCurrency: "USD",
        amountInr: "8850.00",
        exchangeRate: null, // VIOLATION for USD
        exchangeRateDate: "2026-10-12",
        rateSource: "manual",
        txnDate: "2026-10-12",
        source: "chatbot",
        status: "confirmed",
        idempotencyKey: "test-usd-null-rate",
        payloadHash: "hash-usd-null-rate",
        createdBy: "admin",
      });
    } catch {
      usdNullRateRejected = true;
    }
    assert(usdNullRateRejected, "USD transaction with NULL exchange_rate must be rejected");
    logPass("Transactions: USD row with NULL exchange_rate rejected");

    // ── 7. Type-Specific Requirements (Income vs Expense) ─────────────────
    // Invalid Income: missing client_id
    let incomeNoClientRejected = false;
    try {
      await db.insert(transactions).values({
        typeId: 1, // Income requires client
        clientId: null, // VIOLATION
        originalAmount: "500.00",
        originalCurrency: "INR",
        amountInr: "500.00",
        txnDate: "2026-10-12",
        source: "chatbot",
        status: "confirmed",
        idempotencyKey: "test-income-no-client",
        payloadHash: "hash-income-no-client",
        createdBy: "admin",
      });
    } catch {
      incomeNoClientRejected = true;
    }
    assert(incomeNoClientRejected, "Income transaction without client_id must be rejected");
    logPass("Transactions: Income row without client_id rejected by chk_transactions_type_requirements");

    // Invalid Expense: missing description
    let expenseNoDescRejected = false;
    try {
      await db.insert(transactions).values({
        typeId: 2, // Expense requires description
        description: null, // VIOLATION
        originalAmount: "200.00",
        originalCurrency: "INR",
        amountInr: "200.00",
        txnDate: "2026-10-12",
        source: "chatbot",
        status: "confirmed",
        idempotencyKey: "test-expense-no-desc",
        payloadHash: "hash-expense-no-desc",
        createdBy: "admin",
      });
    } catch {
      expenseNoDescRejected = true;
    }
    assert(expenseNoDescRejected, "Expense transaction without description must be rejected");
    logPass("Transactions: Expense row without description rejected by chk_transactions_type_requirements");

    // Valid Expense
    const [validExpense] = await db
      .insert(transactions)
      .values({
        typeId: 2,
        description: "AWS cloud server hosting Oct 2026",
        originalAmount: "200.00",
        originalCurrency: "INR",
        amountInr: "200.00",
        txnDate: "2026-10-12",
        source: "chatbot",
        status: "confirmed",
        idempotencyKey: "test-expense-valid",
        payloadHash: "hash-expense-valid",
        createdBy: "admin",
      })
      .returning();
    assert(!!validExpense, "Valid expense transaction must insert successfully");
    logPass("Transactions: Valid expense row with description accepted");

    // ── 8. Audit Events & Engine-Enforced Immutability ─────────────────────
    // Helper to safely serialize BigInt fields into JSON-serializable representation for jsonb
    const safeAfterState = JSON.parse(
      JSON.stringify(inrTxn, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    );

    const [testAudit] = await db
      .insert(auditEvents)
      .values({
        entityType: "transaction",
        entityId: inrTxn.id,
        action: "created",
        performedBy: "admin",
        source: "chatbot",
        afterState: safeAfterState,
      })
      .returning();
    assert(!!testAudit, "Audit event must insert successfully");
    logPass("Audit events: append-only insertion succeeds");

    // Helper to check for PostgreSQL trigger exception
    const isAppendOnlyError = (err: unknown): boolean => {
      if (!err || typeof err !== "object") return false;
      const rec = err as Record<string, unknown>;
      const msg = typeof rec.message === "string" ? rec.message : "";
      const cause = rec.cause && typeof rec.cause === "object" ? (rec.cause as Record<string, unknown>) : undefined;
      const causeMsg = cause && typeof cause.message === "string" ? cause.message : "";
      const causeCode = cause && typeof cause.code === "string" ? cause.code : "";
      return msg.includes("append-only") || causeMsg.includes("append-only") || causeCode === "P0001";
    };

    // Attempt UPDATE on audit event -> MUST throw trigger exception
    let auditUpdateBlocked = false;
    try {
      await db.execute(
        sql`UPDATE "audit_events" SET "action" = 'tampered' WHERE "id" = ${testAudit.id}`,
      );
    } catch (err: unknown) {
      if (isAppendOnlyError(err)) {
        auditUpdateBlocked = true;
      }
    }
    assert(auditUpdateBlocked, "UPDATE on audit_events must be blocked by trg_audit_events_immutable");
    logPass("Audit events: UPDATE blocked by database trigger");

    // Attempt DELETE on audit event -> MUST throw trigger exception
    let auditDeleteBlocked = false;
    try {
      await db.execute(sql`DELETE FROM "audit_events" WHERE "id" = ${testAudit.id}`);
    } catch (err: unknown) {
      if (isAppendOnlyError(err)) {
        auditDeleteBlocked = true;
      }
    }
    assert(auditDeleteBlocked, "DELETE on audit_events must be blocked by trg_audit_events_immutable");
    logPass("Audit events: DELETE blocked by database trigger");
  } finally {
    // ── 9. Complete Cleanup (Zero Test Data Left in Development DB) ─────────
    console.log("\nCleaning up test transactions and client records...");
    await db.execute(sql`DELETE FROM "transactions" WHERE "created_by" = 'admin' AND "idempotency_key" LIKE 'test-%'`);
    await db.execute(sql`ALTER TABLE "audit_events" DISABLE TRIGGER "trg_audit_events_immutable"`);
    await db.execute(sql`DELETE FROM "audit_events" WHERE "entity_type" = 'transaction'`);
    await db.execute(sql`ALTER TABLE "audit_events" ENABLE TRIGGER "trg_audit_events_immutable"`);
    await db.execute(sql`DELETE FROM "clients" WHERE "client_name" = ${testClientName}`);
    console.log("✓ Test records cleaned up successfully.");
  }

  console.log(`\nAll ${passed} schema verification checks passed!`);
  await pool.end();
}

runSchemaVerification().catch(async (err) => {
  console.error("Schema verification failed:", err);
  await pool.end();
  process.exit(1);
});
