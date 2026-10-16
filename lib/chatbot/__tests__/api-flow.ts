/**
 * Chatbot Phase 1–5 End-to-End API and State Machine Verification.
 *
 * Runs full lifecycle testing of:
 *   - /api/chatbot/validate (Phase 2)
 *   - /api/chatbot/message (GET and POST, Phase 3/4/5)
 *   - /api/chatbot/confirm (Phase 5)
 *   - /api/chatbot/reset (Atomic reset)
 *
 * Run:  npx tsx lib/chatbot/__tests__/api-flow.ts
 */

import { NextRequest } from "next/server";
import { createSession, SESSION_COOKIE } from "../../auth";
import { removeTestRows } from "./cleanup";
import { setDraft, getDraft, setSession, getSession, clearAll } from "../store";
import { POST as validateHandler } from "../../../app/api/chatbot/validate/route";
import { GET as getMessageHandler, POST as postMessageHandler } from "../../../app/api/chatbot/message/route";
import { POST as confirmHandler } from "../../../app/api/chatbot/confirm/route";
import { POST as resetHandler } from "../../../app/api/chatbot/reset/route";

// Setup environment for testing
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

async function createAuthHeaders(userId: string = "test-manager"): Promise<Headers> {
  const token = await createSession(userId);
  const headers = new Headers();
  headers.set("Cookie", `${SESSION_COOKIE}=${token}`);
  headers.set("Content-Type", "application/json");
  return headers;
}

async function runTests() {
  const userId = "test-manager-e2e";
  const authHeaders = await createAuthHeaders(userId);

  // ───────────────────────────────────────────────────────────────────────────
  section("1. Security: Unauthenticated requests are rejected (401)");
  // ───────────────────────────────────────────────────────────────────────────
  {
    const req = new NextRequest("http://localhost:3000/api/chatbot/message", {
      method: "GET",
    });
    const res = await getMessageHandler(req);
    assert("GET /api/chatbot/message without session returns 401", res.status === 401);
  }
  {
    const req = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
      method: "POST",
      body: JSON.stringify({ action: "CONFIRM" }),
    });
    const res = await confirmHandler(req);
    assert("POST /api/chatbot/confirm without session returns 401", res.status === 401);
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("2. Initial state & Reset endpoint");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    const req = new NextRequest("http://localhost:3000/api/chatbot/message", {
      method: "GET",
      headers: authHeaders,
    });
    const res = await getMessageHandler(req);
    const json = await res.json();
    assert("GET returns 200", res.status === 200);
    assert("Initial status is COLLECTING", json.status === "COLLECTING");
    assert("Validation complete is false", json.validation.complete === false);
    assert("Missing field is 'type'", json.validation.missingField === "type");
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("3. Phase 2: Missing-Field Engine (/api/chatbot/validate Mode B)");
  // ───────────────────────────────────────────────────────────────────────────
  {
    // Test: Income missing client
    const req = new NextRequest("http://localhost:3000/api/chatbot/validate", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        extraction: {
          type: "income",
          original_amount: 500,
          original_currency: "USD",
          client_name: null,
          expense_description: null,
          txn_date: "2026-10-09",
        },
      }),
    });
    const res = await validateHandler(req);
    const json = await res.json();
    assert("Validate detects missing client_name for income", json.validation.missingField === "client_name");
    assert("Validation question asks for client name", json.validation.question.includes("client"));
  }
  {
    // Test: Expense missing description
    const req = new NextRequest("http://localhost:3000/api/chatbot/validate", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        extraction: {
          type: "expense",
          original_amount: 1200,
          original_currency: "INR",
          client_name: null,
          expense_description: null,
          txn_date: "2026-10-09",
        },
      }),
    });
    const res = await validateHandler(req);
    const json = await res.json();
    assert("Validate detects missing expense_description", json.validation.missingField === "expense_description");
    assert("Validation question asks what expense was for", json.validation.question.includes("expense"));
  }
  {
    // Test: Fully complete income
    const req = new NextRequest("http://localhost:3000/api/chatbot/validate", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        extraction: {
          type: "income",
          original_amount: 500,
          original_currency: "USD",
          client_name: "Acme Corp",
          expense_description: null,
          txn_date: "2026-10-09",
        },
      }),
    });
    const res = await validateHandler(req);
    const json = await res.json();
    assert("Validate marks complete: true when all fields present", json.validation.complete === true);
    assert("Missing field is null when complete", json.validation.missingField === null);
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("4. Phase 4 & 5: Complete INR flow & Confirmation Actions");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    // Setup complete INR draft
    setDraft(userId, {
      type: "income",
      original_amount: 25000,
      original_currency: "INR",
      client_name: "Zenith Inc",
      expense_description: null,
      txn_date: "2026-10-09",
    });

    // Inspect GET
    const getReq = new NextRequest("http://localhost:3000/api/chatbot/message", {
      method: "GET",
      headers: authHeaders,
    });
    const getRes = await getMessageHandler(getReq);
    const getJson = await getRes.json();
    assert("Complete draft validates as complete", getJson.validation.complete === true);

    // Simulate trigger to READY_FOR_CONFIRMATION
    setSession(userId, {
      status: "READY_FOR_CONFIRMATION",
      currency: {
        original_amount: 25000,
        original_currency: "INR",
        exchange_rate: null,
        inr_amount: 25000,
        exchange_rate_date: "2026-10-09",
      },
    });

    // POST /api/chatbot/confirm with action: CONFIRM
    const confReq = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "CONFIRM" }),
    });
    const confRes = await confirmHandler(confReq);
    const confJson = await confRes.json();
    assert("CONFIRM action returns 200", confRes.status === 200);
    assert("Status is CONFIRMED", confJson.status === "CONFIRMED");
    assert("INR amount matches original amount", confJson.transaction.inr_amount === 25000);
    assert("Exchange rate is null for INR", confJson.transaction.exchange_rate === null);
    assert("Client name preserved", confJson.transaction.client_name === "Zenith Inc");
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("5. Vulnerability check: Clean restart after CONFIRMED");
  // ───────────────────────────────────────────────────────────────────────────
  {
    // Session is currently CONFIRMED for Zenith Inc (from step 4)
    assert("Current status is CONFIRMED", getSession(userId).status === "CONFIRMED");

    // Next POST /api/chatbot/reset cleanly wipes both draft & session
    const resetReq = new NextRequest("http://localhost:3000/api/chatbot/reset", {
      method: "POST",
      headers: authHeaders,
    });
    const resetRes = await resetHandler(resetReq);
    const resetJson = await resetRes.json();
    assert("Reset returns 200", resetRes.status === 200);
    assert("Reset confirmation message returned", resetJson.ok === true);
    assert("Session status reset to default COLLECTING", getSession(userId).status === "COLLECTING");
    assert("Draft client_name cleared", getDraft(userId).client_name === null);
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("6. Phase 4: USD Flow — AWAITING_EXCHANGE_RATE & Rate parsing");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    // Setup complete USD draft awaiting rate
    setDraft(userId, {
      type: "income",
      original_amount: 1000,
      original_currency: "USD",
      client_name: "Stripe",
      expense_description: null,
      txn_date: "2026-10-09",
    });
    setSession(userId, { status: "AWAITING_EXCHANGE_RATE" });

    // Step A: Manager sends invalid/non-numeric reply
    const invalidRateReq = new NextRequest("http://localhost:3000/api/chatbot/message", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ message: "I don't know the rate" }),
    });
    const invalidRes = await postMessageHandler(invalidRateReq);
    const invalidJson = await invalidRes.json();
    assert("Invalid rate keeps status as AWAITING_EXCHANGE_RATE", invalidJson.status === "AWAITING_EXCHANGE_RATE");
    assert("Re-asks the exchange rate question", invalidJson.question.includes("exchange rate"));

    // Step B: Manager sends natural sentence with exchange rate
    const validRateReq = new NextRequest("http://localhost:3000/api/chatbot/message", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ message: "Current rate is 88.50 INR per dollar" }),
    });
    const validRes = await postMessageHandler(validRateReq);
    const validJson = await validRes.json();
    assert("Valid rate advances status to READY_FOR_CONFIRMATION", validJson.status === "READY_FOR_CONFIRMATION");
    assert("Calculates inr_amount = 1000 * 88.50 = 88500", validJson.currency.inr_amount === 88500);
    assert("Preserves exchange_rate = 88.5", validJson.currency.exchange_rate === 88.5);

    // Step C: Manager confirms via conversational 'confirm' in chat
    const chatConfirmReq = new NextRequest("http://localhost:3000/api/chatbot/message", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ message: "confirm" }),
    });
    const chatConfirmRes = await postMessageHandler(chatConfirmReq);
    const chatConfirmJson = await chatConfirmRes.json();
    assert("Conversational 'confirm' returns status CONFIRMED", chatConfirmJson.status === "CONFIRMED");
    assert("Returned confirmed transaction inr_amount = 88500", chatConfirmJson.transaction.inr_amount === 88500);
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("7. Phase 5: EDIT and CANCEL action paths");
  // ───────────────────────────────────────────────────────────────────────────
  {
    clearAll(userId);
    setDraft(userId, {
      type: "expense",
      original_amount: 500,
      original_currency: "USD",
      client_name: null,
      expense_description: "Figma license",
      txn_date: "2026-10-09",
    });
    setSession(userId, {
      status: "READY_FOR_CONFIRMATION",
      currency: {
        original_amount: 500,
        original_currency: "USD",
        exchange_rate: 88,
        inr_amount: 44000,
        exchange_rate_date: "2026-10-09",
      },
    });

    // Test EDIT action
    const editReq = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "EDIT" }),
    });
    const editRes = await confirmHandler(editReq);
    const editJson = await editRes.json();
    assert("EDIT returns 200", editRes.status === 200);
    assert("EDIT reverts status to COLLECTING", editJson.status === "COLLECTING");
    assert("EDIT preserves existing draft for editing", editJson.draft.expense_description === "Figma license");

    // Test CANCEL via conversational 'cancel' message
    setSession(userId, {
      status: "READY_FOR_CONFIRMATION",
      currency: {
        original_amount: 500,
        original_currency: "USD",
        exchange_rate: 88,
        inr_amount: 44000,
        exchange_rate_date: "2026-10-09",
      },
    });
    const cancelReq = new NextRequest("http://localhost:3000/api/chatbot/message", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ message: "cancel" }),
    });
    const cancelRes = await postMessageHandler(cancelReq);
    const cancelJson = await cancelRes.json();
    assert("Conversational 'cancel' returns CANCELLED", cancelJson.status === "CANCELLED");
    assert("Draft is wiped after CANCEL", getDraft(userId).expense_description === null);
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("8. Error Guards & Invariant Enforcement");
  // ───────────────────────────────────────────────────────────────────────────
  {
    // Try to confirm when status is COLLECTING
    setSession(userId, { status: "COLLECTING" });
    const invalidConfirmReq = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "CONFIRM" }),
    });
    const invalidConfirmRes = await confirmHandler(invalidConfirmReq);
    assert("Cannot CONFIRM when status is COLLECTING (returns 400)", invalidConfirmRes.status === 400);

    // Invalid action string
    const badActionReq = new NextRequest("http://localhost:3000/api/chatbot/confirm", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "INVALID_ACTION" }),
    });
    const badActionRes = await confirmHandler(badActionReq);
    assert("Invalid action string returns 400", badActionRes.status === 400);
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log(`\nCleaned up ${await removeTestRows(userId)} test transaction(s).`);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`E2E API Test Results: ${passed} passed, ${failed} failed`);
  console.log(`${"─".repeat(60)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Unhandled test error:", err);
  process.exit(1);
});
