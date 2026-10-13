# Implementation Plan — Phase 4 + Phase 5 (Finance Chatbot)

> **Scope:** Currency conversion (Phase 4) and confirmation flow (Phase 5).  
> **Constraint:** Phases 1–3 files (`extract.ts`, `validate.ts`, `questions.ts`, `merge.ts`) are READ-ONLY. Every item below must leave the codebase buildable.

---

## Codebase summary (from actual reading)

- `store.ts` — Module-level `Map<string, ExtractionResult>`. Exports `getDraft / setDraft / clearDraft`. No session concept yet.
- `message/route.ts` — POST handler: loads draft → Phase 1 (Gemini) → Phase 3 merge → Phase 2 validate → returns `{ ok, extraction, draft, validation }`. GET exposes draft read. No state machine yet.
- `reset/route.ts` — POST handler: calls `clearDraft(userId)` only. No session clear yet.
- `money.ts` — Formats minor-unit integers for display; does NOT do multiplication. No existing safe-multiply utility.
- `regression.ts` — 25 tests using `mergeDraft` + `validateExtraction` directly. Run with `npx ts-node --project tsconfig.json src/lib/chatbot/__tests__/regression.ts` (or `npx tsx`). No Jest/Vitest configured — uses a hand-rolled harness with `process.exit(1)` on failure.
- No `src/lib/currency/` directory exists yet.
- No `ChatStatus` / session concept exists yet.
- TypeScript path alias `@/*` → `./src/*`.

---

## Implementation plan

- [ ] 1. Create `src/lib/currency/exchange-rate.ts` — types only.

      Define:
      - `type SupportedCurrency = 'INR' | 'USD'`
      - `interface CurrencyConversionResult` with fields: `original_amount`, `original_currency`, `exchange_rate` (number | null), `inr_amount`, `exchange_rate_date` (YYYY-MM-DD string)

      No logic — types file only. Other modules import from here.

      Files: `src/lib/currency/exchange-rate.ts`

      Verify: `npx tsc --noEmit` — no TypeScript errors.

---

- [ ] 2. Create `src/lib/currency/convert.ts` — `convertToINR()` function.

      Import `CurrencyConversionResult` and `SupportedCurrency` from `./exchange-rate`.

      Implement `convertToINR(original_amount: number, original_currency: SupportedCurrency, exchange_rate?: number | null): CurrencyConversionResult`:

      - INR path: `exchange_rate = null`, `inr_amount = original_amount`, `exchange_rate_date = today (YYYY-MM-DD)`.
      - USD path: `exchange_rate` must be a finite positive number. If missing/null/invalid, **throw** a `CurrencyConversionError` (a plain `Error` subclass — just `class CurrencyConversionError extends Error {}`). Calculate `inr_amount` as:
        ```
        inr_amount = Math.round(original_amount * exchange_rate * 100) / 100
        ```
        This avoids floating-point drift. `exchange_rate_date = today`.
      - Export `CurrencyConversionError` so the route handler can catch it specifically.
      - `today` is computed inside the function as `new Date().toISOString().slice(0, 10)` — do not accept a date parameter (keeps the function pure and the tests simple).

      Files: `src/lib/currency/convert.ts`

      Verify: `npx tsc --noEmit` — no TypeScript errors.

---

- [ ] 3. Extend `src/lib/chatbot/store.ts` — add session state alongside draft store.

      DO NOT touch `getDraft / setDraft / clearDraft`.

      Add at the top of the file (after existing imports):

      ```typescript
      import type { CurrencyConversionResult } from '@/lib/currency/exchange-rate';

      export type ChatStatus =
        | 'COLLECTING'
        | 'AWAITING_EXCHANGE_RATE'
        | 'READY_FOR_CONFIRMATION'
        | 'CONFIRMED'
        | 'CANCELLED';

      export interface ChatSessionState {
        status: ChatStatus;
        currency?: CurrencyConversionResult;
      }
      ```

      Add a second module-level Map:
      ```typescript
      const sessionStore = new Map<string, ChatSessionState>();
      ```

      Add three new exports:
      ```typescript
      export function getSession(userId: string): ChatSessionState
      export function setSession(userId: string, state: ChatSessionState): void
      export function clearSession(userId: string): void
      ```

      `getSession` returns `{ status: 'COLLECTING' }` when no entry exists (default).

      Also add a combined helper:
      ```typescript
      export function clearAll(userId: string): void   // calls clearDraft + clearSession
      ```

      `clearAll` is what the reset endpoint and CANCEL action will use.

      Files: `src/lib/chatbot/store.ts`

      Verify: `npx tsc --noEmit` — no errors. Existing regression tests still pass:
      `npx tsx src/lib/chatbot/__tests__/regression.ts`

---

- [ ] 4. Create `src/lib/chatbot/confirmation.ts` — `buildConfirmationTransaction()` helper.

      Define:

      ```typescript
      export interface ConfirmationTransaction {
        type: 'income' | 'expense';
        original_amount: number;
        original_currency: 'INR' | 'USD';
        client_name?: string;
        expense_description?: string;
        txn_date: string;
        exchange_rate: number | null;
        inr_amount: number;
      }
      ```

      Implement:

      ```typescript
      export function buildConfirmationTransaction(
        draft: ExtractionResult,
        currency: CurrencyConversionResult,
      ): ConfirmationTransaction
      ```

      Rules:
      - Assert all required draft fields are non-null (type, original_amount, original_currency, txn_date). If any are null, **throw** a `ConfirmationBuildError extends Error`.
      - For income: include `client_name` (from draft), omit `expense_description`.
      - For expense: include `expense_description` (from draft), omit `client_name`.
      - Copy `exchange_rate` and `inr_amount` from the `CurrencyConversionResult` argument.
      - Export `ConfirmationBuildError` for the route handler to catch.

      Files: `src/lib/chatbot/confirmation.ts`

      Verify: `npx tsc --noEmit` — no errors.

---

- [ ] 5. Rewrite `src/app/api/chatbot/message/route.ts` — extend with Phase 4 + 5 state machine.

      **Rule:** keep the COLLECTING path's response shape identical to Phase 1–3. Only add new response shapes for the new statuses.

      **Approach — embed the state machine directly in the existing POST handler.** Read session state at the start of every request, branch on status, then fall through to existing Phase 1→3→2 chain when COLLECTING.

      ### Full POST logic (pseudocode → implement exactly):

      ```
      auth check (existing)
      parse body / validate "message" string (existing)

      existing = getDraft(userId)
      session  = getSession(userId)

      ── Branch A: status == READY_FOR_CONFIRMATION ──────────────────────────
      keyword = message.trim().toLowerCase()
      CONFIRM keywords : 'confirm', 'yes', 'ok', 'approve', 'confirmed', 'correct', 'right'
      CANCEL  keywords : 'cancel', 'no', 'reject', 'abort', 'cancelled', 'nope'

      if matches CONFIRM:
        if session.currency is undefined → return 500 "Internal: currency missing"
        transaction = buildConfirmationTransaction(existing, session.currency)
        setSession(userId, { status: 'CONFIRMED', currency: session.currency })
        return { ok: true, status: 'CONFIRMED', transaction }

      if matches CANCEL:
        clearAll(userId)
        return { ok: true, status: 'CANCELLED', message: 'Transaction cancelled. You can start a new one.' }

      // else: treat as EDIT → fall through to Phase 1→3→2 below
      // reset currency in session so Phase 4 will recalculate
      clearDraft(userId)          // start draft fresh for EDIT
      clearSession(userId)        // reset to COLLECTING
      existing = getDraft(userId) // now empty draft
      session  = getSession(userId)

      ── Branch B: status == AWAITING_EXCHANGE_RATE ──────────────────────────
      rateValue = parseFloat(message.trim())
      if isNaN(rateValue) or rateValue <= 0:
        return { ok: true, status: 'AWAITING_EXCHANGE_RATE', draft: existing,
                 question: 'Please enter a numeric exchange rate (e.g. 88.5).' }

      // valid rate — run Phase 4 USD conversion
      currency = convertToINR(existing.original_amount, 'USD', rateValue)
      transaction = buildConfirmationTransaction(existing, currency)
      setSession(userId, { status: 'READY_FOR_CONFIRMATION', currency })
      return { ok: true, status: 'READY_FOR_CONFIRMATION', draft: existing,
               currency: { exchange_rate: currency.exchange_rate, inr_amount: currency.inr_amount, exchange_rate_date: currency.exchange_rate_date },
               confirmation: { required: true, transaction } }

      ── Branch C: COLLECTING (default) ──────────────────────────────────────
      (existing Phase 1→3→2 chain, no change)

      extractResult = await extractTransaction(message, today, context)
      if !extractResult.ok → return error (existing)

      draft = mergeDraft(existing, extractResult.data)
      setDraft(userId, draft)
      validation = validateExtraction(draft)

      if !validation.complete:
        // EXISTING response — must be identical
        return { ok: true, extraction, draft, validation }

      // Draft complete — Phase 4
      if draft.original_currency == 'INR':
        currency = convertToINR(draft.original_amount, 'INR')
        transaction = buildConfirmationTransaction(draft, currency)
        setSession(userId, { status: 'READY_FOR_CONFIRMATION', currency })
        return { ok: true, status: 'READY_FOR_CONFIRMATION', draft,
                 currency: { exchange_rate: null, inr_amount: currency.inr_amount, exchange_rate_date: currency.exchange_rate_date },
                 confirmation: { required: true, transaction } }

      if draft.original_currency == 'USD':
        setSession(userId, { status: 'AWAITING_EXCHANGE_RATE' })
        return { ok: true, status: 'AWAITING_EXCHANGE_RATE', draft,
                 question: 'What is today's USD to INR exchange rate?' }
      ```

      **Error handling inside Phase 4/5:**
      - Catch `CurrencyConversionError` → return `{ ok: false, error: 'Currency conversion failed. Please try again.' }` with status 500.
      - Catch `ConfirmationBuildError` → return `{ ok: false, error: 'Could not build confirmation. Please try again.' }` with status 500.

      **GET handler:** extend to also return `session` in the response:
      ```json
      { "ok": true, "draft": {...}, "validation": {...}, "session": { "status": "..." } }
      ```

      Files: `src/app/api/chatbot/message/route.ts`

      Verify:
      1. `npx tsc --noEmit` — no errors.
      2. `npx tsx src/lib/chatbot/__tests__/regression.ts` — all 25 pass (regression tests don't touch the route).

---

- [ ] 6. Update `src/app/api/chatbot/reset/route.ts` — call `clearAll` instead of `clearDraft`.

      Replace the `clearDraft(userId)` call with `clearAll(userId)`.
      Update the import line to import `clearAll` from store (instead of or alongside `clearDraft`).
      Response remains `{ ok: true, message: 'Draft cleared.' }` — no change to response shape.

      Files: `src/app/api/chatbot/reset/route.ts`

      Verify: `npx tsc --noEmit` — no errors.

---

- [ ] 7. Create `src/lib/chatbot/__tests__/phase4-phase5.ts` — unit tests.

      Use the same hand-rolled harness pattern from `regression.ts` (no Jest/Vitest).
      Run with: `npx tsx src/lib/chatbot/__tests__/phase4-phase5.ts`
      Exit code 0 = all pass.

      **Test cases (8 required):**

      1. **INR conversion — no external call:**
         `convertToINR(500, 'INR')` → `{ exchange_rate: null, inr_amount: 500, original_amount: 500, original_currency: 'INR' }`
         Assert `result.exchange_rate === null` and `result.inr_amount === 500`.

      2. **USD conversion — exact result:**
         `convertToINR(500, 'USD', 88.5)` → `inr_amount === 44250`.

      3. **USD conversion — floating-point safety:**
         `convertToINR(100, 'USD', 83.0)` → `inr_amount === 8300`.
         (Also verify: `convertToINR(333, 'USD', 3.33)` → `inr_amount === 1108.89`, not `1108.8900000000001`.)

      4. **Confirmation object — income:**
         Build a complete income draft (`type='income'`, `original_amount=500`, `original_currency='USD'`, `txn_date='2026-10-09'`, `client_name='Acme'`).
         `buildConfirmationTransaction(draft, convertToINR(500,'USD',88.5))`.
         Assert: has `client_name='Acme'`, NO `expense_description` key (or undefined).
         Assert: `inr_amount === 44250`, `exchange_rate === 88.5`.

      5. **Confirmation object — expense:**
         Build a complete expense draft (`type='expense'`, `original_amount=500`, `original_currency='INR'`, `txn_date='2026-10-09'`, `expense_description='Office electricity'`).
         `buildConfirmationTransaction(draft, convertToINR(500,'INR'))`.
         Assert: has `expense_description='Office electricity'`, NO `client_name` key (or undefined).
         Assert: `exchange_rate === null`, `inr_amount === 500`.

      6. **Gemini extraction schema — currency not assumed:**
         Merge `EMPTY_DRAFT` with `{ ...EMPTY_DRAFT, original_currency: null }`.
         `validateExtraction(merged).missingField` must equal `'type'` (first missing field, not currency).
         Then create draft with all base fields set but `original_currency: null` → `validateExtraction` returns `missingField === 'original_currency'`.
         Assert Phase 2 still asks for currency when it's missing.

      7. **AWAITING_EXCHANGE_RATE — logic test:**
         When `validation.complete === true` and `draft.original_currency === 'USD'`, the correct next status is `'AWAITING_EXCHANGE_RATE'`.
         Test this logic as a pure function: extract the status-decision function from route.ts, OR test inline:
         ```typescript
         function nextStatus(complete: boolean, currency: string | null): string {
           if (!complete) return 'COLLECTING';
           if (currency === 'USD') return 'AWAITING_EXCHANGE_RATE';
           return 'READY_FOR_CONFIRMATION';
         }
         assert('USD complete → AWAITING_EXCHANGE_RATE', nextStatus(true, 'USD'), 'AWAITING_EXCHANGE_RATE');
         assert('INR complete → READY_FOR_CONFIRMATION', nextStatus(true, 'INR'), 'READY_FOR_CONFIRMATION');
         assert('incomplete → COLLECTING', nextStatus(false, 'USD'), 'COLLECTING');
         ```
         (The inline function here mirrors the real route logic — if the route logic is extracted into a helper later, update this test to call the real function.)

      8. **READY_FOR_CONFIRMATION only when currency resolved:**
         `getSession(userId)` for a fresh user → status is `'COLLECTING'`.
         After `setSession(userId, { status: 'READY_FOR_CONFIRMATION', currency: convertToINR(500,'INR') })` → `getSession(userId).status === 'READY_FOR_CONFIRMATION'` and `getSession(userId).currency` is defined.
         After `clearSession(userId)` → `getSession(userId).status === 'COLLECTING'`.

      Files: `src/lib/chatbot/__tests__/phase4-phase5.ts`

      Verify: `npx tsx src/lib/chatbot/__tests__/phase4-phase5.ts` — exits 0, all 8 tests pass.

---

- [ ] 8. Create `.agents/tasks/phase4-phase5-report.md` — post-implementation report.

      Fill in after all prior items pass. Include:

      **Files created:**
      - `src/lib/currency/exchange-rate.ts`
      - `src/lib/currency/convert.ts`
      - `src/lib/chatbot/confirmation.ts`
      - `src/lib/chatbot/__tests__/phase4-phase5.ts`

      **Files modified:**
      - `src/lib/chatbot/store.ts` — added ChatStatus type, ChatSessionState interface, sessionStore map, getSession/setSession/clearSession/clearAll exports
      - `src/app/api/chatbot/message/route.ts` — added Phase 4 + 5 state machine, new response shapes
      - `src/app/api/chatbot/reset/route.ts` — switched from clearDraft to clearAll

      **Files untouched (confirmed):**
      - `src/lib/chatbot/extract.ts`
      - `src/lib/chatbot/validate.ts`
      - `src/lib/chatbot/questions.ts`
      - `src/lib/chatbot/merge.ts`
      - `src/lib/money.ts`
      - `src/lib/server-auth.ts`
      - `src/lib/chatbot/__tests__/regression.ts`
      - `src/app/api/chatbot/extract/route.ts`
      - `src/app/api/chatbot/validate/route.ts`

      **API changes — new status values and response shapes:**

      COLLECTING (incomplete) — UNCHANGED:
      ```json
      { "ok": true, "extraction": {...}, "draft": {...}, "validation": { "complete": false, "missingField": "...", "question": "..." } }
      ```

      AWAITING_EXCHANGE_RATE:
      ```json
      { "ok": true, "status": "AWAITING_EXCHANGE_RATE", "draft": {...}, "question": "What is today's USD to INR exchange rate?" }
      ```

      READY_FOR_CONFIRMATION:
      ```json
      {
        "ok": true,
        "status": "READY_FOR_CONFIRMATION",
        "draft": { "type": "income", "original_amount": 500, "original_currency": "USD", ... },
        "currency": { "exchange_rate": 88.5, "inr_amount": 44250, "exchange_rate_date": "2026-10-09" },
        "confirmation": { "required": true, "transaction": { "type": "income", "original_amount": 500, ... } }
      }
      ```

      CONFIRMED:
      ```json
      { "ok": true, "status": "CONFIRMED", "transaction": { "type": "income", ... } }
      ```

      CANCELLED:
      ```json
      { "ok": true, "status": "CANCELLED", "message": "Transaction cancelled. You can start a new one." }
      ```

      **Postman test cases:**

      | # | Method | URL | Body | Expected status | Notes |
      |---|--------|-----|------|-----------------|-------|
      | 1 | POST | /api/chatbot/message | `{"message":"Acme paid 500 INR today for design work"}` | 200 `READY_FOR_CONFIRMATION` | Full INR income — completes in one turn |
      | 2 | POST | /api/chatbot/message | `{"message":"confirm"}` | 200 `CONFIRMED` | After test 1 |
      | 3 | POST | /api/chatbot/reset | (none) | 200 | Reset session |
      | 4 | POST | /api/chatbot/message | `{"message":"Acme paid 500 USD today for design work"}` | 200 `AWAITING_EXCHANGE_RATE` | USD income — asks for rate |
      | 5 | POST | /api/chatbot/message | `{"message":"88.5"}` | 200 `READY_FOR_CONFIRMATION` | inr_amount should be 44250 |
      | 6 | POST | /api/chatbot/message | `{"message":"yes"}` | 200 `CONFIRMED` | Confirm USD income |
      | 7 | POST | /api/chatbot/reset | (none) | 200 | Reset |
      | 8 | POST | /api/chatbot/message | `{"message":"Paid 500 INR for office rent today"}` | 200 COLLECTING incomplete | Missing txn_date or type — Phase 1–3 unchanged |
      | 9 | POST | /api/chatbot/message | `{"message":"Paid 500 INR for office rent today"}` | 200 `READY_FOR_CONFIRMATION` | Full expense INR — one turn complete |
      | 10 | POST | /api/chatbot/message | `{"message":"cancel"}` | 200 `CANCELLED` | Cancel the pending confirmation |
      | 11 | POST | /api/chatbot/reset | (none) | 200 | Reset |
      | 12 | POST | /api/chatbot/message | `{"message":"Acme paid 500 USD today for design work"}` | 200 `AWAITING_EXCHANGE_RATE` | Setup for EDIT test |
      | 13 | POST | /api/chatbot/message | `{"message":"88.5"}` | 200 `READY_FOR_CONFIRMATION` | Provide rate |
      | 14 | POST | /api/chatbot/message | `{"message":"actually it was 750 USD"}` | 200 `AWAITING_EXCHANGE_RATE` | EDIT — re-runs Phase 1→3→2→4 |
      | 15 | POST | /api/chatbot/message | `{"message":"not a number"}` | 200 `AWAITING_EXCHANGE_RATE` | Invalid rate — re-asks |

      **Test results:** (fill in after running)

      **Known limitations:**
      - Session state is in-memory — lost on server restart (same as existing draft store; Phase 6 will own persistence).
      - Only INR and USD are supported currencies. Adding new currencies requires code changes in `exchange-rate.ts` and `message/route.ts`.
      - Exchange rate is manager-entered; no external rate API is integrated (by design — managers are the source of truth for rates).
      - CONFIRMED status does not save to DB (Phase 6 responsibility).
      - Keyword matching for CONFIRM/CANCEL is simple substring; a natural-language message starting with "confirm" will be treated as CONFIRM even if the manager typed a full correction sentence. Recommend Phase 6 use a dedicated `action` field instead.

      Files: `.agents/tasks/phase4-phase5-report.md`

      Verify: file exists and is readable.

---

## Dependency order

```
Item 1 (exchange-rate.ts types)
  └── Item 2 (convert.ts) depends on Item 1
        └── Item 4 (confirmation.ts) depends on Items 1+2 and existing extract.ts types
Item 3 (store.ts extension) is independent of Items 1+2 but must exist before Item 5
Items 1+2+3+4 must all be done before Item 5 (route.ts)
Item 6 (reset/route.ts) depends on Item 3 (clearAll export)
Item 7 (tests) depends on Items 1+2+3+4
Item 8 (report) depends on all prior items
```

## Build and test commands

```bash
# TypeScript type check (after each item)
npx tsc --noEmit

# Phase 1–3 regression tests (must stay green throughout)
npx tsx src/lib/chatbot/__tests__/regression.ts

# Phase 4–5 unit tests (after item 7)
npx tsx src/lib/chatbot/__tests__/phase4-phase5.ts
```

## Key design decisions

1. **No external exchange-rate API** — Manager enters rate manually. `convertToINR` throws `CurrencyConversionError` if called for USD without a rate, making the failure explicit and impossible to silently swallow.

2. **Session store as a separate Map** — Rather than replacing the draft store, a second `Map<string, ChatSessionState>` is added to `store.ts`. This keeps draft and session co-located (same module) but cleanly separated. The existing `getDraft/setDraft/clearDraft` contract is unchanged.

3. **`clearAll` as the canonical reset** — Both the reset endpoint and the CANCEL action call `clearAll`. This guarantees draft and session are always reset atomically, preventing ghost state.

4. **`Math.round(amount * rate * 100) / 100`** — Chosen over Decimal.js or big.js (not installed, would add a dependency). Two decimal precision is sufficient for this finance tracker. The regression test case `333 × 3.33 = 1108.89` validates the guard against IEEE 754 drift.

5. **EDIT flow clears draft before re-extraction** — When the manager sends a correction in READY_FOR_CONFIRMATION state, both draft and session are cleared before re-running Phase 1. This avoids stale merged values interfering with the correction. The full Phase 1→3→2→4 chain then runs fresh.

6. **CONFIRM/CANCEL detection by simple keywords** — Per the spec, no Gemini call for intent detection. Simple `message.toLowerCase().includes(keyword)` check. CONFIRM is checked first; CANCEL second; any non-match falls through to EDIT.
