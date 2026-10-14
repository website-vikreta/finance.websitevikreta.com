/**
 * Phase 1/2/3/4/5 regression test runner.
 *
 * Tests the merge engine, validation engine, rate parser, and confirmation
 * builder locally — no Gemini calls, no HTTP, no database.
 *
 * Run:  npx tsx src/lib/chatbot/__tests__/regression.ts
 *
 * Exit 0 = all pass. Non-zero = failures.
 */

import { mergeDraft, EMPTY_DRAFT } from "../merge";
import { validateExtraction } from "../validate";
import { parseExchangeRate, buildConfirmation } from "../confirm";
import {
  normalizeClientName,
  normalizeExpenseDescription,
  extractExplicitExchangeRate,
  detectContradictions,
  tryDeterministicExtraction,
  type ExtractionResult,
} from "../extract";

// ─── Tiny test harness ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    console.error(`      expected: ${JSON.stringify(expected)}`);
    console.error(`      actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

function draft(partial: Partial<ExtractionResult>): ExtractionResult {
  return { ...EMPTY_DRAFT, ...partial };
}

// ─── Phase 2: Validation priority tests ─────────────────────────────────────

section("Phase 2 — Priority order");

assert("missing type first",
  validateExtraction(draft({ original_amount: 500, original_currency: "USD", txn_date: "2026-10-08" })).missingField,
  "type"
);
assert("missing amount second",
  validateExtraction(draft({ type: "income", original_currency: "USD", txn_date: "2026-10-08" })).missingField,
  "original_amount"
);
assert("missing currency third",
  validateExtraction(draft({ type: "income", original_amount: 500, txn_date: "2026-10-08" })).missingField,
  "original_currency"
);
assert("missing date fourth",
  validateExtraction(draft({ type: "income", original_amount: 500, original_currency: "USD", client_name: "Acme" })).missingField,
  "txn_date"
);
assert("income — missing client fifth",
  validateExtraction(draft({ type: "income", original_amount: 500, original_currency: "USD", txn_date: "2026-10-08" })).missingField,
  "client_name"
);
assert("expense — missing description fifth",
  validateExtraction(draft({ type: "expense", original_amount: 500, original_currency: "INR", txn_date: "2026-10-08" })).missingField,
  "expense_description"
);
assert("income complete",
  validateExtraction(draft({ type: "income", original_amount: 500, original_currency: "USD", txn_date: "2026-10-08", client_name: "Acme" })).complete,
  true
);
assert("expense complete",
  validateExtraction(draft({ type: "expense", original_amount: 500, original_currency: "INR", txn_date: "2026-10-08", expense_description: "office rent" })).complete,
  true
);

// ─── Phase 3: Merge rule tests ───────────────────────────────────────────────

section("Phase 3 — Merge: null never erases existing value");

const base = draft({ type: "income", original_amount: 500, client_name: "Acme" });

const afterCurrency = mergeDraft(base, draft({ original_currency: "USD" }));
assert("USD merges in, preserves amount", afterCurrency.original_amount, 500);
assert("USD merges in, preserves client", afterCurrency.client_name, "Acme");
assert("USD sets currency", afterCurrency.original_currency, "USD");

const afterDate = mergeDraft(afterCurrency, draft({ txn_date: "2026-10-08" }));
assert("date merges in, preserves currency", afterDate.original_currency, "USD");
assert("date merges in, preserves amount", afterDate.original_amount, 500);
assert("date sets txn_date", afterDate.txn_date, "2026-10-08");

section("Phase 3 — Merge: corrections (latest non-null wins)");

const corrected = mergeDraft(
  draft({ type: "income", original_amount: 500, original_currency: "USD" }),
  draft({ original_amount: 750 })
);
assert("correction updates amount", corrected.original_amount, 750);
assert("correction preserves currency", corrected.original_currency, "USD");

section("Phase 3 — Merge: short answer simulation");

const simUSD = draft({ original_currency: "USD" });
const simINR = draft({ original_currency: "INR" });
const sim500 = draft({ original_amount: 500 });
const simToday = draft({ txn_date: "2026-10-08" });
const simYesterday = draft({ txn_date: "2026-10-07" });
const simAcme = draft({ client_name: "Acme" });

const existingDraft = draft({ type: "income", original_amount: 500, client_name: "Acme" });

assert("'USD' extraction merged correctly → currency set",
  mergeDraft(existingDraft, simUSD).original_currency, "USD");
assert("'INR' extraction merged correctly → currency set",
  mergeDraft(existingDraft, simINR).original_currency, "INR");
assert("'500' extraction merged correctly → amount preserved",
  mergeDraft(draft({ type: "expense", original_currency: "USD" }), sim500).original_amount, 500);
assert("'Today' extraction merged correctly → date set",
  mergeDraft(existingDraft, simToday).txn_date, "2026-10-08");
assert("'Yesterday' extraction merged correctly → date set",
  mergeDraft(existingDraft, simYesterday).txn_date, "2026-10-07");
assert("'Acme' extraction merged correctly → client set",
  mergeDraft(draft({ type: "income", original_amount: 500, original_currency: "USD", txn_date: "2026-10-08" }), simAcme).client_name, "Acme");

section("Phase 3 — Merge: full sentence answer simulation");

const fullSentence = draft({ original_amount: 500, original_currency: "USD" });
const afterFullSentence = mergeDraft(draft({ type: "income", client_name: "Acme" }), fullSentence);
assert("full sentence: amount set", afterFullSentence.original_amount, 500);
assert("full sentence: currency set", afterFullSentence.original_currency, "USD");
assert("full sentence: client preserved", afterFullSentence.client_name, "Acme");

// ─── Phase 4: Rate parser ────────────────────────────────────────────────────

section("Phase 4 — parseExchangeRate");

assert("plain number '88.5'", parseExchangeRate("88.5"), 88.5);
assert("plain integer '88'", parseExchangeRate("88"), 88);
assert("natural sentence", parseExchangeRate("Rate is 88.50"), 88.50);
assert("context sentence", parseExchangeRate("1 USD = 88.50 INR"), 88.50);
assert("comma thousands '1,234.56'", parseExchangeRate("1,234.56"), 1234.56);
assert("rupee prefix ignored", parseExchangeRate("₹88.5 per dollar"), 88.5);
assert("empty string → null", parseExchangeRate(""), null);
assert("no number → null", parseExchangeRate("yes please"), null);
assert("zero → null", parseExchangeRate("0"), null);
assert("negative text treated as null (no leading -)", parseExchangeRate("rate is -88"), null);

// ─── Phase 4: buildConfirmation — INR path ───────────────────────────────────

section("Phase 4 — buildConfirmation: INR income");

const completeINRIncome = draft({
  type: "income",
  original_amount: 500,
  original_currency: "INR",
  client_name: "Acme",
  txn_date: "2026-10-08",
});

const inrIncomeResult = buildConfirmation(completeINRIncome, null);
assert("INR income: ok", inrIncomeResult.ok, true);
if (inrIncomeResult.ok) {
  assert("INR income: type", inrIncomeResult.transaction.type, "income");
  assert("INR income: original_amount", inrIncomeResult.transaction.original_amount, 500);
  assert("INR income: original_currency", inrIncomeResult.transaction.original_currency, "INR");
  assert("INR income: exchange_rate null", inrIncomeResult.transaction.exchange_rate, null);
  assert("INR income: inr_amount = original_amount", inrIncomeResult.transaction.inr_amount, 500);
  assert("INR income: client_name", inrIncomeResult.transaction.client_name, "Acme");
  assert("INR income: txn_date", inrIncomeResult.transaction.txn_date, "2026-10-08");
}

section("Phase 4 — buildConfirmation: INR expense");

const completeINRExpense = draft({
  type: "expense",
  original_amount: 12000,
  original_currency: "INR",
  expense_description: "office rent",
  txn_date: "2026-10-08",
});

const inrExpenseResult = buildConfirmation(completeINRExpense, null);
assert("INR expense: ok", inrExpenseResult.ok, true);
if (inrExpenseResult.ok) {
  assert("INR expense: type", inrExpenseResult.transaction.type, "expense");
  assert("INR expense: inr_amount", inrExpenseResult.transaction.inr_amount, 12000);
  assert("INR expense: exchange_rate null", inrExpenseResult.transaction.exchange_rate, null);
  assert("INR expense: description", inrExpenseResult.transaction.expense_description, "office rent");
}

section("Phase 4 — buildConfirmation: USD income");

const completeUSDIncome = draft({
  type: "income",
  original_amount: 500,
  original_currency: "USD",
  client_name: "Acme",
  txn_date: "2026-10-08",
});

const usdIncomeResult = buildConfirmation(completeUSDIncome, 88.5);
assert("USD income: ok", usdIncomeResult.ok, true);
if (usdIncomeResult.ok) {
  assert("USD income: original_currency", usdIncomeResult.transaction.original_currency, "USD");
  assert("USD income: exchange_rate", usdIncomeResult.transaction.exchange_rate, 88.5);
  assert("USD income: inr_amount = 500 × 88.5", usdIncomeResult.transaction.inr_amount, 44250);
  assert("USD income: original_amount unchanged", usdIncomeResult.transaction.original_amount, 500);
}

section("Phase 4 — buildConfirmation: USD expense");

const completeUSDExpense = draft({
  type: "expense",
  original_amount: 100,
  original_currency: "USD",
  expense_description: "software",
  txn_date: "2026-10-08",
});

const usdExpenseResult = buildConfirmation(completeUSDExpense, 88.5);
assert("USD expense: ok", usdExpenseResult.ok, true);
if (usdExpenseResult.ok) {
  assert("USD expense: inr_amount = 100 × 88.5", usdExpenseResult.transaction.inr_amount, 8850);
  assert("USD expense: exchange_rate", usdExpenseResult.transaction.exchange_rate, 88.5);
  assert("USD expense: description", usdExpenseResult.transaction.expense_description, "software");
}

section("Phase 4 — buildConfirmation: USD without rate → error");

const usdNoRate = buildConfirmation(completeUSDIncome, null);
assert("USD without rate: ok = false", usdNoRate.ok, false);

section("Phase 4 — Correction: amount updated, INR recalculated");

// Simulate Test 6: manager said 500 USD, then corrected to 750 USD
const draft500 = draft({ type: "income", original_amount: 500, original_currency: "USD", client_name: "Acme", txn_date: "2026-10-08" });
const correctionExtraction = draft({ original_amount: 750 });
const correctedDraft = mergeDraft(draft500, correctionExtraction);

assert("correction: amount updated to 750", correctedDraft.original_amount, 750);
assert("correction: currency preserved", correctedDraft.original_currency, "USD");
assert("correction: client preserved", correctedDraft.client_name, "Acme");

const correctedConfirm = buildConfirmation(correctedDraft, 88.5);
assert("correction: new inr_amount = 750 × 88.5 = 66375", 
  correctedConfirm.ok ? correctedConfirm.transaction.inr_amount : null, 66375);

section("Phase 4 — Test 7: no Gemini assumption for ambiguous amount");

// EMPTY_DRAFT with only amount — currency must remain null
const ambiguous = draft({ original_amount: 500 });
assert("ambiguous amount: currency stays null", ambiguous.original_currency, null);

// ─── TASK Requirements: 12 Focused Scenarios ──────────────────────────────

section("TASK 1 — 'From the Reliance' stores clean name 'Reliance'");
assert("normalizeClientName 'From the Reliance'", normalizeClientName("From the Reliance"), "Reliance");
assert("normalizeClientName 'from the Reliance'", normalizeClientName("from the Reliance"), "Reliance");
assert("normalizeClientName 'from Reliance'", normalizeClientName("from Reliance"), "Reliance");
assert("mergeDraft normalizes 'From the Reliance'",
  mergeDraft(EMPTY_DRAFT, { ...EMPTY_DRAFT, client_name: "From the Reliance" }).client_name,
  "Reliance"
);

section("TASK 2 — Company names such as 'From Software' are not accidentally corrupted");
assert("preserve 'From Software'", normalizeClientName("From Software"), "From Software");
assert("preserve 'From Software Inc'", normalizeClientName("From Software Inc"), "From Software Inc");
assert("preserve 'From Software, Inc.'", normalizeClientName("From Software, Inc."), "From Software, Inc.");
assert("clean 'from From Software' → 'From Software'", normalizeClientName("from From Software"), "From Software");
assert("clean 'payment received from From Software' → 'From Software'",
  normalizeClientName("payment received from From Software"), "From Software");

section("TASK 3 — Income and expense client/vendor names normalized consistently");
assert("payment received from Tata Consultancy Services",
  normalizeClientName("payment received from Tata Consultancy Services"), "Tata Consultancy Services");
assert("paid to Acme Technologies",
  normalizeClientName("paid to Acme Technologies"), "Acme Technologies");
assert("paid by Acme Technologies",
  normalizeClientName("paid by Acme Technologies"), "Acme Technologies");
assert("vendor: Acme Technologies",
  normalizeClientName("vendor: Acme Technologies"), "Acme Technologies");
assert("client is Acme Technologies",
  normalizeClientName("client is Acme Technologies"), "Acme Technologies");

section("TASK 4 — Multi-field message extracts amount, currency, description, and date");
const multiField = tryDeterministicExtraction("I bought a new laptop for $60 today", "2026-10-13", {
  missingField: "original_amount",
  pendingQuestion: "What was the payment amount?",
});
assert("multi-field: amount is 60", multiField?.original_amount, 60);
assert("multi-field: currency is USD", multiField?.original_currency, "USD");
assert("multi-field: description is 'New laptop'", multiField?.expense_description, "New laptop");
assert("multi-field: date is '2026-10-13'", multiField?.txn_date, "2026-10-13");
assert("multi-field: type is 'expense'", multiField?.type, "expense");

section("TASK 5 — Providing multiple missing fields updates draft correctly");
const priorDraft = draft({ type: "expense" });
const mergedMulti = mergeDraft(priorDraft, multiField!);
assert("merged draft: amount preserved", mergedMulti.original_amount, 60);
assert("merged draft: currency preserved", mergedMulti.original_currency, "USD");
assert("merged draft: description preserved", mergedMulti.expense_description, "New laptop");
assert("merged draft: date preserved", mergedMulti.txn_date, "2026-10-13");
assert("merged draft: type is expense", mergedMulti.type, "expense");

section("TASK 6 — Chatbot asks only for genuinely missing information");
const completeCheck = validateExtraction(mergedMulti);
assert("all fields present → complete is true", completeCheck.complete, true);
assert("all fields present → missingField is null", completeCheck.missingField, null);
assert("all fields present → question is null", completeCheck.question, null);

const partialIncome = draft({ type: "income", original_amount: 500, original_currency: "INR", txn_date: "2026-10-13" });
const partialCheck = validateExtraction(partialIncome);
assert("income missing client → complete is false", partialCheck.complete, false);
assert("income missing client → missingField is 'client_name'", partialCheck.missingField, "client_name");

section("TASK 7 — Contradictory information triggers clarification");
const amountContradiction = detectContradictions("I bought a laptop for $50 or $60 today");
assert("amount contradiction detected", amountContradiction?.field, "original_amount");
assert("amount contradiction asks clarification",
  amountContradiction?.question, "Could you clarify which payment amount is correct?");

const dateContradiction = detectContradictions("Paid ₹500 today or yesterday");
assert("date contradiction detected", dateContradiction?.field, "txn_date");
assert("date contradiction asks clarification",
  dateContradiction?.question, "Could you clarify which payment date is correct?");

const typeContradiction = detectContradictions("income or expense");
assert("type contradiction detected", typeContradiction?.field, "type");

const currencyContradiction = detectContradictions("usd or inr");
assert("currency contradiction detected", currencyContradiction?.field, "original_currency");

const extractionWithContradiction = tryDeterministicExtraction("I bought a laptop for $50 or $60 today", "2026-10-13");
assert("amount is null when contradictory amounts given", extractionWithContradiction?.original_amount, null);
assert("currency is still extracted as USD", extractionWithContradiction?.original_currency, "USD");

section("TASK 8 — Editing an existing field works as before");
const beforeEdit = draft({ type: "expense", original_amount: 60, original_currency: "USD", expense_description: "New laptop", txn_date: "2026-10-13" });
const editUpdate = draft({ original_amount: 80 });
const afterEdit = mergeDraft(beforeEdit, editUpdate);
assert("edit updates amount to 80", afterEdit.original_amount, 80);
assert("edit preserves currency USD", afterEdit.original_currency, "USD");
assert("edit preserves description", afterEdit.expense_description, "New laptop");
assert("edit preserves date", afterEdit.txn_date, "2026-10-13");

section("TASK 9 — INR/USD handling and exchange-rate clarification");
const inrDraft = draft({ type: "income", original_amount: 10000, original_currency: "INR", client_name: "Reliance", txn_date: "2026-10-13" });
const inrConf = buildConfirmation(inrDraft, null);
assert("INR confirmation succeeds without rate", inrConf.ok, true);
assert("INR inr_amount equals original", inrConf.ok ? inrConf.transaction.inr_amount : null, 10000);

const usdDraft = draft({ type: "expense", original_amount: 100, original_currency: "USD", expense_description: "Cloud hosting", txn_date: "2026-10-13" });
const usdConf = buildConfirmation(usdDraft, 88.5);
assert("USD confirmation succeeds with rate", usdConf.ok, true);
assert("USD inr_amount calculated (100 * 88.5)", usdConf.ok ? usdConf.transaction.inr_amount : null, 8850);

const rateContradiction = detectContradictions("Rate is 88.50 or 89");
assert("rate contradiction on amount", rateContradiction?.field, "original_amount");

section("TASK 10 — Review card displays normalized, updated transaction details");
const cardDraft = draft({
  type: "income",
  original_amount: 50000,
  original_currency: "INR",
  client_name: "From the Reliance",
  txn_date: "2026-10-13",
});
const normalizedCardDraft = mergeDraft(EMPTY_DRAFT, cardDraft);
assert("review card draft has normalized client 'Reliance'", normalizedCardDraft.client_name, "Reliance");
const cardConfirm = buildConfirmation(normalizedCardDraft, null);
assert("confirmation transaction client_name is 'Reliance'",
  cardConfirm.ok ? cardConfirm.transaction.client_name : null, "Reliance");

section("TASK 11 — Ambiguous client name returns null (never saves garbage)");
assert("ambiguous 'from' returns null", normalizeClientName("from"), null);
assert("ambiguous 'from the' returns null", normalizeClientName("from the"), null);
assert("ambiguous empty returns null", normalizeClientName("   "), null);

section("TASK 12 — normalizeExpenseDescription cleans conversational prefixes");
assert(
  "cleans 'the expense is for buying the new PC setup in the office'",
  normalizeExpenseDescription("the expense is for buying the new PC setup in the office"),
  "New PC setup for the office",
);
assert(
  "cleans 'buying the new PC setup in the office'",
  normalizeExpenseDescription("buying the new PC setup in the office"),
  "New PC setup for the office",
);
assert(
  "cleans 'for buying office snacks'",
  normalizeExpenseDescription("for buying office snacks"),
  "Office snacks",
);

section("TASK 13 — extractExplicitExchangeRate recognizes exchange rates across phrasings");
assert(
  "'the exchange rate is 80 per dollar' -> 80",
  extractExplicitExchangeRate("the exchange rate is 80 per dollar"),
  80,
);
assert(
  "'rate is 88.50' -> 88.5",
  extractExplicitExchangeRate("rate is 88.50"),
  88.5,
);
assert(
  "'80 per dollar' -> 80",
  extractExplicitExchangeRate("80 per dollar"),
  80,
);
assert(
  "'1 USD = 80 INR' -> 80",
  extractExplicitExchangeRate("1 USD = 80 INR"),
  80,
);
assert(
  "'No rate here for $500' -> null",
  extractExplicitExchangeRate("I spent $500 on dinner"),
  null,
);

section("TASK 14 — Exact example: 'Payment date is today, the exchange rate is 80 per dollar, and the expense is for buying the new PC setup in the office.'");
const todayStr = "2026-10-14";
const exactExtraction = tryDeterministicExtraction(
  "Payment date is today, the exchange rate is 80 per dollar, and the expense is for buying the new PC setup in the office.",
  todayStr,
);
assert("Type is expense", exactExtraction?.type, "expense");
assert("Date is today", exactExtraction?.txn_date, todayStr);
assert("Exchange rate is 80", exactExtraction?.exchange_rate, 80);
assert("Description is 'New PC setup for the office'", exactExtraction?.expense_description, "New PC setup for the office");
assert("Amount is null (never guessed)", exactExtraction?.original_amount, null);
assert("Currency is null (never guessed)", exactExtraction?.original_currency, null);

section("TASK 15 — Multi-field merge preserves explicitly provided exchange rate");
const initialDraft = mergeDraft(EMPTY_DRAFT, exactExtraction!);
assert("Initial draft has exchange_rate 80", initialDraft.exchange_rate, 80);
const followUpAmount = {
  ...EMPTY_DRAFT,
  original_amount: 1200,
  original_currency: "USD" as const,
};
const mergedDraft = mergeDraft(initialDraft, followUpAmount);
assert("Merged draft has amount 1200", mergedDraft.original_amount, 1200);
assert("Merged draft has currency USD", mergedDraft.original_currency, "USD");
assert("Merged draft PRESERVES exchange_rate 80", mergedDraft.exchange_rate, 80);
assert("Merged draft PRESERVES description", mergedDraft.expense_description, "New PC setup for the office");
assert("Merged draft PRESERVES date", mergedDraft.txn_date, todayStr);
assert("Merged draft is complete", validateExtraction(mergedDraft).complete, true);


// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(60)}`);

if (failed > 0) {
  process.exit(1);
}
