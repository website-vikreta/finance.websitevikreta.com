/**
 * Phase 4/5 unit test runner.
 *
 * Tests the currency conversion service and confirmation builder locally
 * (no Gemini, no HTTP, no database).
 *
 * Uses the same hand-rolled harness pattern as regression.ts.
 *
 * Run:  npx tsx lib/chatbot/__tests__/phase4-phase5.ts
 * Exit code 0 = all pass. Non-zero = failures.
 */

import { buildConfirmation } from '../confirm';
import { getSession, setSession, clearSession } from '../store';
import { mergeDraft, EMPTY_DRAFT } from '../merge';
import { validateExtraction } from '../validate';
import type { ExtractionResult } from '../extract';

// ─── Tiny test harness (same pattern as regression.ts) ───────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function draft(partial: Partial<ExtractionResult>): ExtractionResult {
  return { ...EMPTY_DRAFT, ...partial };
}

// ─── Test 1: INR — no conversion ─────────────────────────────────────────────

section('Phase 4 — INR conversion');

function confirmed(d: ExtractionResult, rate: number | null) {
  const result = buildConfirmation(d, rate);
  if (!result.ok) throw new Error(`buildConfirmation failed: ${result.error}`);
  return result.transaction;
}

const inrResult = confirmed(draft({ type: 'expense', original_amount: 500, original_currency: 'INR', txn_date: '2026-10-09', expense_description: 'Rent' }), null);
assert('INR: exchange_rate is null',        inrResult.exchange_rate,    null);
assert('INR: inr_amount equals original',   inrResult.inr_amount,       500);
assert('INR: original_amount preserved',    inrResult.original_amount,  500);
assert('INR: original_currency preserved',  inrResult.original_currency, 'INR');

// ─── Test 2: USD conversion — exact result ────────────────────────────────────

section('Phase 4 — USD conversion exact result');

const usdDraft = (amount: number) => draft({ type: 'income', original_amount: amount, original_currency: 'USD', txn_date: '2026-10-09', client_name: 'Acme' });
const usdResult = confirmed(usdDraft(500), 88.5);
assert('USD 500 × 88.5 = 44250',            usdResult.inr_amount,       44250);
assert('USD: exchange_rate preserved',       usdResult.exchange_rate,    88.5);
assert('USD: original_amount preserved',     usdResult.original_amount,  500);
assert('USD: original_currency preserved',   usdResult.original_currency, 'USD');

// ─── Test 3: USD conversion — exact decimal arithmetic ──────────────────────

section('Phase 4 — USD exact arithmetic (same rounding as the saved row)');

assert('USD 100 × 83.0 = 8300',             confirmed(usdDraft(100), 83).inr_amount,   8300);
assert('USD 333 × 3.33 = 1108.89 (not .8900000000001)', confirmed(usdDraft(333), 3.33).inr_amount, 1108.89);
assert('USD 1 × 80.025 = 80.02 (half-even, matches persistence)', confirmed(usdDraft(1), 80.025).inr_amount, 80.02);
assert('USD 1 × 80.035 = 80.04 (half-even)', confirmed(usdDraft(1), 80.035).inr_amount, 80.04);

// ─── Test 4: invalid rate is rejected ─────────────────────────────────────────

section('Phase 4 — invalid USD rate');

assert('USD with null rate → ok:false',     buildConfirmation(usdDraft(500), null).ok, false);
assert('USD with negative rate → ok:false', buildConfirmation(usdDraft(500), -1).ok,   false);
assert('USD with zero rate → ok:false',     buildConfirmation(usdDraft(500), 0).ok,    false);
assert('USD with 5-decimal rate → ok:false (stored precision is 4)', buildConfirmation(usdDraft(500), 88.12345).ok, false);

// ─── Test 5: Confirmation object — income ────────────────────────────────────

section('Phase 5 — Confirmation object: income');

const incomeConfirmation = confirmed(usdDraft(500), 88.5);
assert('income: type correct',                incomeConfirmation.type,                 'income');
assert('income: client_name present',         incomeConfirmation.client_name,          'Acme');
assert('income: expense_description null',    incomeConfirmation.expense_description,  null);
assert('income: txn_date correct',            incomeConfirmation.txn_date,             '2026-10-09');

// ─── Test 6: Confirmation object — expense ───────────────────────────────────

section('Phase 5 — Confirmation object: expense');

const expenseConfirmation = confirmed(
  draft({ type: 'expense', original_amount: 500, original_currency: 'INR', txn_date: '2026-10-09', expense_description: 'Office electricity' }),
  null,
);
assert('expense: type correct',               expenseConfirmation.type,                'expense');
assert('expense: expense_description present',expenseConfirmation.expense_description, 'Office electricity');
assert('expense: client_name null',           expenseConfirmation.client_name,         null);
assert('expense: exchange_rate is null',      expenseConfirmation.exchange_rate,       null);
assert('expense: inr_amount = 500',           expenseConfirmation.inr_amount,          500);

// ─── Test 8: Phase 2 still asks for currency when missing ────────────────────

section('Phase 2 — Currency still asked when missing (no regression)');

const noType = draft({ original_amount: 500, original_currency: 'USD', txn_date: '2026-10-08' });
assert('null type → missingField = type', validateExtraction(noType).missingField, 'type');

const noCurrency = draft({ type: 'income', original_amount: 500, txn_date: '2026-10-08' });
assert('null currency → missingField = original_currency', validateExtraction(noCurrency).missingField, 'original_currency');

const mergedWithNullCurrency = mergeDraft(EMPTY_DRAFT, { ...EMPTY_DRAFT, original_currency: null });
assert('merged null currency → still missing type first', validateExtraction(mergedWithNullCurrency).missingField, 'type');

// ─── Test 9: Status-decision logic ───────────────────────────────────────────

section('Phase 4/5 — Status-decision logic');

// Mirrors the route.ts decision logic as a pure function for testability
function nextStatus(complete: boolean, currency: string | null): string {
  if (!complete) return 'COLLECTING';
  if (currency === 'USD') return 'AWAITING_EXCHANGE_RATE';
  return 'READY_FOR_CONFIRMATION';
}

assert('USD complete → AWAITING_EXCHANGE_RATE',    nextStatus(true, 'USD'),  'AWAITING_EXCHANGE_RATE');
assert('INR complete → READY_FOR_CONFIRMATION',    nextStatus(true, 'INR'),  'READY_FOR_CONFIRMATION');
assert('incomplete → COLLECTING',                  nextStatus(false, 'USD'), 'COLLECTING');
assert('incomplete INR → COLLECTING',              nextStatus(false, 'INR'), 'COLLECTING');

// ─── Test 10: Session store lifecycle ────────────────────────────────────────

section('Phase 4/5 — Session store lifecycle');

const testUserId = '__phase4_phase5_test_user__';

// Fresh user — default COLLECTING
assert('fresh user: status = COLLECTING', getSession(testUserId).status, 'COLLECTING');
assert('fresh user: currency undefined',  getSession(testUserId).currency, undefined);

// Set to READY_FOR_CONFIRMATION with currency
setSession(testUserId, {
  status: 'READY_FOR_CONFIRMATION',
  currency: { original_amount: 500, original_currency: 'INR', exchange_rate: null, inr_amount: 500, exchange_rate_date: '2026-10-09' },
});
assert('after setSession: status = READY_FOR_CONFIRMATION', getSession(testUserId).status, 'READY_FOR_CONFIRMATION');
assert('after setSession: currency defined', getSession(testUserId).currency !== undefined, true);

// Clear session — back to COLLECTING
clearSession(testUserId);
assert('after clearSession: status = COLLECTING', getSession(testUserId).status, 'COLLECTING');
assert('after clearSession: currency undefined',  getSession(testUserId).currency, undefined);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
