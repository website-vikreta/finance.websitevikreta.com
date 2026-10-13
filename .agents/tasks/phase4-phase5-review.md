# Phase 4 + Phase 5: Currency Conversion and Transaction Confirmation

Phase 4 adds a currency conversion step that runs after the Phase 1–3 draft collection loop completes. Phase 5 introduces a confirmation gate: the system presents the resolved transaction to the manager for explicit approval before anything is saved. The approach uses an in-memory session alongside the existing draft store, with the state machine status (`COLLECTING` → `AWAITING_EXCHANGE_RATE` → `READY_FOR_CONFIRMATION` → `CONFIRMED`/`CANCELLED`) driving the route handler's branch logic. The currency module is isolated under `src/lib/currency/` with no Gemini dependency and no DB calls anywhere in the new code.

Watch for: **confirmed** — the EDIT path in `route.ts` calls `clearDraft` immediately before `clearAll`, making `clearDraft` a no-op redundancy (harmless but indicates copy-paste confusion). **confirmed** — after CONFIRM, the session is set to `CONFIRMED` but the draft is never cleared, meaning a subsequent message falls through to Branch C (COLLECTING) and re-runs Gemini on top of the confirmed draft as if it were a fresh conversation. **confirmed** — `buildConfirmationTransaction` silently omits `client_name` from income transactions when the field is null/empty rather than throwing `ConfirmationBuildError`, which is inconsistent with how the other required-field guards work and means a confirmed income transaction can reach Phase 6 without a client name.

**Verdict**: NEEDS_CHANGES

---

## High-level view

The currency module (`exchange-rate.ts` for types, `convert.ts` for logic) is cleanly separated and never touches Gemini or the database. The INR passthrough (rate=null, inr_amount=original_amount) and USD path (manager-supplied rate, `Math.round(amount × rate × 100) / 100`) both implement the spec exactly. `CurrencyConversionError` is thrown — not swallowed — when USD conversion is attempted without a valid positive rate.

Session state is added to the existing `store.ts` rather than a separate `session.ts`, which is a sensible extension. The `ChatStatus` type covers all five states, `clearAll` atomically resets both stores, and the `AWAITING_EXCHANGE_RATE` branch correctly re-asks the manager when the input is non-numeric or non-positive.

The EDIT path has a structural bug: after neither a confirm nor a cancel keyword, the route calls `clearDraft(userId)` on line 150 and then `clearAll(userId)` on line 151. `clearAll` already calls `clearDraft` internally, so the first call is a redundant no-op. More importantly, the intent is clear — start fresh — but the double call suggests this was written without reading `clearAll`'s implementation.

After a CONFIRM action, `setSession(userId, { status: 'CONFIRMED', ... })` is called but the draft is left intact. The state machine has no branch for `CONFIRMED`, so a follow-up message from the manager falls straight into Branch C (COLLECTING), loads the confirmed draft, and runs Gemini extraction against it — effectively restarting collection silently. Phase 6 will need to read this confirmed draft, but a `CONFIRMED`-state guard in the route handler is still needed to prevent accidental re-entry.

`buildConfirmationTransaction` validates `type`, `original_amount`, `original_currency`, and `txn_date` with explicit null checks that throw `ConfirmationBuildError`. But for `client_name` on income transactions, the check is `if (draft.client_name)` — falsy, not null-check — so an income draft that passed Phase 2 validation (which requires `client_name`) will silently produce a confirmation without it if the value is somehow empty. Since Phase 2's `isMissing` guards against empty strings too, this is unlikely in practice, but the asymmetry between the base-field guards and the type-specific guards is a correctness gap.

---

<details>
<summary>Issues (3)</summary>

1. **Double-clear in EDIT path** — `route.ts` calls `clearDraft(userId)` on line 150 and then `clearAll(userId)` on line 151; `clearAll` already calls `clearDraft`, making the first call a redundant no-op. Remove the standalone `clearDraft` call and keep only `clearAll`.

2. **No CONFIRMED-state guard in route handler** — after a CONFIRM action the session is set to `CONFIRMED` but the draft is never cleared. A subsequent manager message falls into Branch C, loads the confirmed draft, and starts a new Phase 1 extraction silently. Add a branch at the top of the handler that returns an error (or a "transaction already confirmed, use /reset to start over" response) when `session.status === 'CONFIRMED'`.

3. **Silent omission of client_name in income confirmation** — `buildConfirmationTransaction` uses a falsy `if (draft.client_name)` guard rather than an explicit null/undefined/empty check for the income type-specific field. This is inconsistent with the base-field guards that throw `ConfirmationBuildError`. Either throw when `client_name` is missing for income (matching the existing guard pattern) or document explicitly why silent omission is acceptable here.

</details>

<details>
<summary>Details</summary>

### Double-clear in the EDIT path

When the manager sends a message during `READY_FOR_CONFIRMATION` that is neither a confirm nor a cancel keyword, the route branches to EDIT. The relevant code is:

```typescript
clearDraft(userId);
clearAll(userId);  // clears both draft and session
```

`clearAll` is defined in `store.ts` as:

```typescript
export function clearAll(userId: string): void {
  clearDraft(userId);
  clearSession(userId);
}
```

The standalone `clearDraft` on line 150 runs first, then `clearAll` calls `clearDraft` again. The second call is a Map.delete on a key that no longer exists — harmless in JavaScript/TypeScript, but it confirms the EDIT path was written without consulting `clearAll`'s implementation. **Confirmed** by reading both files.

### CONFIRMED state re-entry gap

After CONFIRM succeeds, the handler does:

```typescript
setSession(userId, { status: 'CONFIRMED', currency: session.currency });
return NextResponse.json({ ok: true, status: 'CONFIRMED', transaction }, { status: 200 });
```

The draft is not cleared. The session is set to `CONFIRMED`. Neither Branch A (checks `=== 'READY_FOR_CONFIRMATION'`) nor Branch B (checks `=== 'AWAITING_EXCHANGE_RATE'`) handles `CONFIRMED`, so the next request from the same manager falls into Branch C with the original confirmed draft still in the store. Branch C runs Gemini extraction, merges into the confirmed draft, re-validates, and if the incoming message happens to look like a new transaction, it will silently overwrite the draft and eventually cycle back to a new `READY_FOR_CONFIRMATION` — all without any indication that a confirmed transaction was in progress. **Confirmed** by tracing the branch conditions in `route.ts` and the draft/session state in `store.ts`.

### Silent client_name omission in income confirmations

`buildConfirmationTransaction` throws `ConfirmationBuildError` for missing `type`, `original_amount`, `original_currency`, and `txn_date`. For the income-specific `client_name` field, it uses:

```typescript
if (draft.client_name) {
  transaction.client_name = draft.client_name;
}
```

A `null`, `undefined`, or empty-string `client_name` is silently dropped from the returned `ConfirmationTransaction`. Phase 2 (`validate.ts`) guards against this during collection, but the asymmetry in `confirmation.ts` means the confirmation builder's behavior does not match its own "throws if any required draft field is null" contract. **Confirmed** by reading the null-check pattern in the base-field section (lines 72–86 of `confirmation.ts`) against the income type-specific section.

### Test coverage

The Phase 4/5 test file covers INR passthrough, USD exact result, float-safety (333 × 3.33), `CurrencyConversionError` on missing/null/negative rates, income and expense confirmation object shapes, `ConfirmationBuildError` on null type and null txn_date, and session store lifecycle (set, get, clear).

Not tested: the CONFIRMED re-entry gap (test 9's `nextStatus` helper mirrors the route logic but does not test the `CONFIRMED` branch because no such branch exists). Not tested: the double-clear in the EDIT path. Not tested: `buildConfirmationTransaction` receiving an income draft with `client_name: null` — the test for `ConfirmationBuildError` only covers `null type` and `null txn_date`.

</details>

---

<details>
<summary>File map</summary>

| File | Change |
|---|---|
| `src/lib/currency/exchange-rate.ts` | New — `SupportedCurrency` type and `CurrencyConversionResult` interface |
| `src/lib/currency/convert.ts` | New — `convertToINR` function and `CurrencyConversionError` |
| `src/lib/chatbot/store.ts` | Extended — added `ChatStatus`, `ChatSessionState`, `getSession`/`setSession`/`clearSession`/`clearAll`; draft exports unchanged |
| `src/lib/chatbot/confirmation.ts` | New — `buildConfirmationTransaction`, `ConfirmationTransaction`, `ConfirmationBuildError` |
| `src/app/api/chatbot/message/route.ts` | Extended — added Branch A (`READY_FOR_CONFIRMATION`), Branch B (`AWAITING_EXCHANGE_RATE`), Phase 4/5 logic in Branch C; GET handler added |
| `src/app/api/chatbot/reset/route.ts` | Updated — `clearDraft` replaced with `clearAll` |
| `src/lib/chatbot/__tests__/phase4-phase5.ts` | New — unit tests for convert, confirm, session lifecycle |

Full diff: run `git diff main` from the repository root.

</details>
