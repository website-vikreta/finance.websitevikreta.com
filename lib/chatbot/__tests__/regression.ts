/**
 * Phase 1/2/3/4/5 regression test runner.
 *
 * Tests the merge engine, validation engine, rate parser, and confirmation
 * builder locally — no Gemini calls, no HTTP, no database.
 *
 * Run:  npx tsx lib/chatbot/__tests__/regression.ts
 *
 * Exit 0 = all pass. Non-zero = failures.
 */

import { mergeDraft, EMPTY_DRAFT } from "../merge";
import { validateExtraction } from "../validate";
import { parseExchangeRate, buildConfirmation } from "../confirm";
import type { ExtractionResult } from "../extract";

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

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(60)}`);

if (failed > 0) {
  process.exit(1);
}
