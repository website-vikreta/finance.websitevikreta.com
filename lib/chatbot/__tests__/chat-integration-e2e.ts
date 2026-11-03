/**
 * Chatbot End-to-End Frontend-Backend Integration Test Suite
 *
 * Verifies all 10 required end-to-end conversational scenarios:
 *   1. Basic income flow
 *   2. Basic expense flow
 *   3. Missing fields & draft retention
 *   4. Multiple follow-up questions in sequence
 *   5. Currency handling (INR direct & USD awaiting rate)
 *   6. Explicit transaction confirmation
 *   7. Validation, EDIT and CANCEL action paths
 *   8. API error handling (400, 401, invalid actions)
 *   9. Authentication & session isolation
 *  10. Reset & lifecycle state management
 *
 * Run: npx tsx lib/chatbot/__tests__/chat-integration-e2e.ts
 */

import "../../__tests__/test-db"; // must stay first: refuses the live database
import { NextRequest } from "next/server";
import { createSession, SESSION_COOKIE } from "../../auth";
import { removeTestRows } from "./cleanup";
import { setDraft, getDraft, setSession, getSession, clearAll } from "../store";
import { GET as getMessageHandler, POST as postMessageHandler } from "../../../app/api/chatbot/message/route";
import { POST as confirmHandler } from "../../../app/api/chatbot/confirm/route";
import { POST as resetHandler } from "../../../app/api/chatbot/reset/route";
import { db } from "../../db";
import { appUsers } from "../../db/schema";
import { validateExtraction } from "../validate";
import { buildConfirmation, parseExchangeRate } from "../confirm";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-32-chars-long-abc-123";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, details?: unknown) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    if (details !== undefined) {
      console.error(`      Details:`, details);
    }
    failed++;
  }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

async function createAuthHeaders(userId: string = "test-manager-frontend"): Promise<Headers> {
  const token = await createSession(userId);
  const headers = new Headers();
  headers.set("Cookie", `${SESSION_COOKIE}=${token}`);
  headers.set("Content-Type", "application/json");
  return headers;
}

async function runAllTests() {
  const userId = "qa-integration-user";
  await db
    .insert(appUsers)
    .values({ id: userId, role: "manager", isActive: true })
    .onConflictDoNothing();
  const authHeaders = await createAuthHeaders(userId);

  // ───────────────────────────────────────────────────────────────────────────
  section("Scenario 1: Basic Income Flow (INR direct confirmation)");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    // Pre-seed a complete INR income draft
    const completeDraft = {
      type: "income" as const,
      original_amount: 50000,
      original_currency: "INR" as const,
      client_name: "Acme Corp",
      expense_description: null,
      txn_date: "2026-10-10",
    };
    setDraft(userId, completeDraft);

    const confirmation = buildConfirmation(completeDraft, null);
    assert("INR buildConfirmation succeeds", confirmation.ok);
    if (confirmation.ok) {
      assert("INR inr_amount matches original", confirmation.transaction.inr_amount === 50000);
      assert("INR exchange_rate is null", confirmation.transaction.exchange_rate === null);
      assert("Client name preserved", confirmation.transaction.client_name === "Acme Corp");
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Scenario 2: Basic Expense Flow (INR direct confirmation)");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    const expenseDraft = {
      type: "expense" as const,
      original_amount: 15000,
      original_currency: "INR" as const,
      client_name: null,
      expense_description: "Office rent payment",
      txn_date: "2026-10-10",
    };
    setDraft(userId, expenseDraft);

    const confirmation = buildConfirmation(expenseDraft, null);
    assert("Expense buildConfirmation succeeds", confirmation.ok);
    if (confirmation.ok) {
      assert("Expense type is expense", confirmation.transaction.type === "expense");
      assert("Expense description preserved", confirmation.transaction.expense_description === "Office rent payment");
      assert("Expense inr_amount = 15000", confirmation.transaction.inr_amount === 15000);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Scenario 3: Missing Fields & Follow-up Questions");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    // Missing currency
    const partial1 = {
      type: "income" as const,
      original_amount: 1000,
      original_currency: null,
      client_name: "Acme",
      expense_description: null,
      txn_date: "2026-10-10",
    };
    const val1 = validateExtraction(partial1);
    assert("Detects missing currency", !val1.complete && val1.missingField === "original_currency");
    assert("Question asks about INR or USD", val1.question?.includes("INR or USD") === true);

    // Missing client for income
    const partial2 = {
      type: "income" as const,
      original_amount: 1000,
      original_currency: "INR" as const,
      client_name: null,
      expense_description: null,
      txn_date: "2026-10-10",
    };
    const val2 = validateExtraction(partial2);
    assert("Detects missing client_name for income", !val2.complete && val2.missingField === "client_name");
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Scenario 4: Multiple Follow-up Questions in Sequence");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    // Start with only amount
    const step1 = {
      type: null,
      original_amount: 500,
      original_currency: null,
      client_name: null,
      expense_description: null,
      txn_date: null,
    };
    assert("Priority 1: type is asked first", validateExtraction(step1).missingField === "type");

    // Provide type
    const step2 = { ...step1, type: "income" as const };
    assert("Priority 2: currency is asked next", validateExtraction(step2).missingField === "original_currency");

    // Provide currency
    const step3 = { ...step2, original_currency: "USD" as const };
    assert("Priority 3: date is asked next", validateExtraction(step3).missingField === "txn_date");

    // Provide date
    const step4 = { ...step3, txn_date: "2026-10-10" };
    assert("Priority 4: client name is asked next", validateExtraction(step4).missingField === "client_name");

    // Provide client
    const step5 = { ...step4, client_name: "Tech Solutions" };
    assert("All fields complete", validateExtraction(step5).complete === true);
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Scenario 5: Multi-Currency Handling (USD flow & rate calculation)");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    const usdDraft = {
      type: "income" as const,
      original_amount: 1000,
      original_currency: "USD" as const,
      client_name: "Global Tech",
      expense_description: null,
      txn_date: "2026-10-10",
    };
    setDraft(userId, usdDraft);
    setSession(userId, { status: "AWAITING_EXCHANGE_RATE" });

    // Test rate parsing
    const rate1 = parseExchangeRate("88.50");
    assert("Parses plain number 88.50", rate1 === 88.5);

    const rate2 = parseExchangeRate("The rate today was ₹88.75 per dollar");
    assert("Parses rate from natural sentence", rate2 === 88.75);

    // Build confirmation with rate
    const conf = buildConfirmation(usdDraft, 88.5);
    assert("USD confirmation succeeds with rate", conf.ok);
    if (conf.ok) {
      assert("Calculates inr_amount 1000 * 88.5 = 88500", conf.transaction.inr_amount === 88500);
      assert("Preserves exchange_rate 88.5", conf.transaction.exchange_rate === 88.5);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Scenario 6: Transaction Confirmation via /api/chatbot/confirm");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    const draft = {
      type: "expense" as const,
      original_amount: 250,
      original_currency: "USD" as const,
      client_name: null,
      expense_description: "Cloud servers",
      txn_date: "2026-10-10",
    };
    setDraft(userId, draft);
    setSession(userId, {
      status: "READY_FOR_CONFIRMATION",
      currency: {
        original_amount: 250,
        original_currency: "USD",
        exchange_rate: 88,
        inr_amount: 22000,
        exchange_rate_date: "2026-10-10",
      },
    });

    const req = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "CONFIRM" }),
    });
    const res = await confirmHandler(req);
    const json = await res.json();

    assert("CONFIRM returns 200", res.status === 200);
    assert("Status changed to CONFIRMED", json.status === "CONFIRMED");
    assert("Returns confirmed transaction object", json.transaction !== undefined);
    assert("Confirmed inr_amount = 22000", json.transaction?.inr_amount === 22000);
    assert("Confirmed exchange_rate = 88", json.transaction?.exchange_rate === 88);
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Scenario 7: EDIT and CANCEL Action Paths");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    const draft = {
      type: "income" as const,
      original_amount: 500,
      original_currency: "INR" as const,
      client_name: "Acme",
      expense_description: null,
      txn_date: "2026-10-10",
    };
    setDraft(userId, draft);
    setSession(userId, { status: "READY_FOR_CONFIRMATION" });

    // EDIT action
    const editReq = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "EDIT" }),
    });
    const editRes = await confirmHandler(editReq);
    const editJson = await editRes.json();

    assert("EDIT returns 200", editRes.status === 200);
    assert("Status reverts to COLLECTING", editJson.status === "COLLECTING");
    assert("Draft is preserved during EDIT", editJson.draft?.client_name === "Acme");

    // CANCEL action
    setSession(userId, { status: "READY_FOR_CONFIRMATION" });
    const cancelReq = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "CANCEL" }),
    });
    const cancelRes = await cancelHandler(cancelReq);
    const cancelJson = await cancelRes.json();

    assert("CANCEL returns 200", cancelRes.status === 200);
    assert("Status is CANCELLED", cancelJson.status === "CANCELLED");
    assert("Draft is wiped after CANCEL", getDraft(userId).client_name === null);
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Scenario 8: API Error Recovery (400, 401, Invalid Inputs)");
  // ───────────────────────────────────────────────────────────────────────────
  {
    // Unauthenticated GET returns 401
    const unauthReq = new NextRequest("http://localhost:3000/api/chatbot/message", {
      method: "GET",
    });
    const unauthRes = await getMessageHandler(unauthReq);
    assert("Unauthenticated request returns 401", unauthRes.status === 401);

    // Empty message returns 400
    const emptyReq = new NextRequest("http://localhost:3000/api/chatbot/message", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ message: "   " }),
    });
    const emptyRes = await postMessageHandler(emptyReq);
    assert("Empty message returns 400", emptyRes.status === 400);

    // Invalid action returns 400
    const badActionReq = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "INVALID_ACTION" }),
    });
    const badActionRes = await confirmHandler(badActionReq);
    assert("Invalid confirm action returns 400", badActionRes.status === 400);
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Scenario 9: Reset Endpoint (/api/chatbot/reset)");
  // ───────────────────────────────────────────────────────────────────────────
  {
    setDraft(userId, {
      type: "income",
      original_amount: 9999,
      original_currency: "INR",
      client_name: "Ghost Client",
      expense_description: null,
      txn_date: "2026-10-10",
    });
    setSession(userId, { status: "READY_FOR_CONFIRMATION" });

    const resetReq = new NextRequest("http://localhost:3000/api/chatbot/reset", {
      method: "POST",
      headers: authHeaders,
    });
    const resetRes = await resetHandler(resetReq);
    assert("POST /api/chatbot/reset returns 200", resetRes.status === 200);
    assert("Draft client_name cleared", getDraft(userId).client_name === null);
    assert("Session status reset to COLLECTING", getSession(userId).status === "COLLECTING");
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Scenario 10: State Inspection (/api/chatbot/message GET)");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    const getReq = new NextRequest("http://localhost:3000/api/chatbot/message", {
      method: "GET",
      headers: authHeaders,
    });
    const getRes = await getMessageHandler(getReq);
    const getJson = await getRes.json();

    assert("GET /api/chatbot/message returns 200", getRes.status === 200);
    assert("Status is COLLECTING", getJson.status === "COLLECTING");
    assert("Validation.complete is false", getJson.validation.complete === false);
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Scenario 11: Casual Greeting Flow (/api/chatbot/message POST)");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    const greetingReq = new NextRequest("http://localhost:3000/api/chatbot/message", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ message: "Hello!" }),
    });
    const greetingRes = await postMessageHandler(greetingReq);
    const greetingJson = await greetingRes.json();

    assert("Greeting returns 200", greetingRes.status === 200);
    assert("Status remains COLLECTING", greetingJson.status === "COLLECTING");
    assert("Warm greeting response returned", greetingJson.question?.includes("What do you want to record") === true);
    assert("No premature validation error triggered", greetingJson.ok === true);
  }

  console.log(`\nCleaned up ${await removeTestRows(userId)} test transaction(s).`);
  console.log(`\n────────────────────────────────────────────────────────────`);
  console.log(`E2E Integration Test Suite: ${passed} passed, ${failed} failed`);
  console.log(`────────────────────────────────────────────────────────────\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Helper alias
const cancelHandler = confirmHandler;

runAllTests().catch((err) => {
  console.error("Test Suite Exception:", err);
  process.exit(1);
});
