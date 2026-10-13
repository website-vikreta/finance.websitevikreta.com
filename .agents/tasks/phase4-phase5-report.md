# Phase 4 + Phase 5 — Post-Implementation Report

## Status: COMPLETE ✅

All verification steps passed:
- `npx tsc --noEmit` — 0 errors
- `npx tsx src/lib/chatbot/__tests__/regression.ts` — 25/25 passed (no regressions)
- `npx tsx src/lib/chatbot/__tests__/phase4-phase5.ts` — 41/41 passed

---

## Files created

| File | Purpose |
|------|---------|
| `src/lib/currency/exchange-rate.ts` | `SupportedCurrency` type, `CurrencyConversionResult` interface |
| `src/lib/currency/convert.ts` | `convertToINR()`, `CurrencyConversionError` |
| `src/lib/chatbot/confirmation.ts` | `buildConfirmationTransaction()`, `ConfirmationTransaction` interface, `ConfirmationBuildError` |
| `src/lib/chatbot/__tests__/phase4-phase5.ts` | 41 unit tests for Phase 4/5 modules |

## Files modified

| File | Changes |
|------|---------|
| `src/lib/chatbot/store.ts` | Added `ChatStatus` type, `ChatSessionState` interface, `sessionStore` map, `getSession`/`setSession`/`clearSession`/`clearAll` exports |
| `src/app/api/chatbot/message/route.ts` | Added Phase 4 + 5 state machine (3 branches), kept COLLECTING response shape identical |
| `src/app/api/chatbot/reset/route.ts` | Changed `clearDraft(userId)` → `clearAll(userId)` |

## Files confirmed untouched

- `src/lib/chatbot/extract.ts`
- `src/lib/chatbot/validate.ts`
- `src/lib/chatbot/questions.ts`
- `src/lib/chatbot/merge.ts`
- `src/lib/money.ts`
- `src/lib/server-auth.ts`
- `src/lib/chatbot/__tests__/regression.ts`

---

## API response shapes

### COLLECTING (incomplete draft) — UNCHANGED from Phase 1–3

```json
{
  "ok": true,
  "extraction": { "type": "income", "original_amount": 500, ... },
  "draft": { "type": "income", "original_amount": 500, ... },
  "validation": { "complete": false, "missingField": "txn_date", "question": "What was the payment date?" }
}
```

### AWAITING_EXCHANGE_RATE

```json
{
  "ok": true,
  "status": "AWAITING_EXCHANGE_RATE",
  "draft": { "type": "income", "original_amount": 500, "original_currency": "USD", ... },
  "question": "What is today's USD to INR exchange rate?"
}
```

### READY_FOR_CONFIRMATION

```json
{
  "ok": true,
  "status": "READY_FOR_CONFIRMATION",
  "draft": { "type": "income", "original_amount": 500, "original_currency": "USD", "client_name": "Acme", "txn_date": "2026-10-09" },
  "currency": { "exchange_rate": 88.5, "inr_amount": 44250, "exchange_rate_date": "2026-10-09" },
  "confirmation": {
    "required": true,
    "transaction": {
      "type": "income",
      "original_amount": 500,
      "original_currency": "USD",
      "client_name": "Acme",
      "txn_date": "2026-10-09",
      "exchange_rate": 88.5,
      "inr_amount": 44250
    }
  }
}
```

### CONFIRMED

```json
{
  "ok": true,
  "status": "CONFIRMED",
  "transaction": {
    "type": "income",
    "original_amount": 500,
    "original_currency": "USD",
    "client_name": "Acme",
    "txn_date": "2026-10-09",
    "exchange_rate": 88.5,
    "inr_amount": 44250
  }
}
```

### CANCELLED

```json
{
  "ok": true,
  "status": "CANCELLED",
  "message": "Transaction cancelled. You can start a new one."
}
```

---

## Postman test cases

| # | Method | URL | Body | Expected status | Notes |
|---|--------|-----|------|-----------------|-------|
| 1 | POST | /api/chatbot/message | `{"message":"Acme paid 500 INR today for design work"}` | 200 `READY_FOR_CONFIRMATION` | Full INR income |
| 2 | POST | /api/chatbot/message | `{"message":"confirm"}` | 200 `CONFIRMED` | After test 1 |
| 3 | POST | /api/chatbot/reset | — | 200 | Reset |
| 4 | POST | /api/chatbot/message | `{"message":"Acme paid 500 USD today for design work"}` | 200 `AWAITING_EXCHANGE_RATE` | USD income |
| 5 | POST | /api/chatbot/message | `{"message":"88.5"}` | 200 `READY_FOR_CONFIRMATION` | inr_amount=44250 |
| 6 | POST | /api/chatbot/message | `{"message":"yes"}` | 200 `CONFIRMED` | Confirm USD income |
| 7 | POST | /api/chatbot/reset | — | 200 | Reset |
| 8 | POST | /api/chatbot/message | `{"message":"Paid 500 INR for office rent today"}` | 200 `READY_FOR_CONFIRMATION` | Full expense INR |
| 9 | POST | /api/chatbot/message | `{"message":"cancel"}` | 200 `CANCELLED` | Cancel pending confirmation |
| 10 | POST | /api/chatbot/reset | — | 200 | Reset |
| 11 | POST | /api/chatbot/message | `{"message":"Acme paid 500 USD today for design work"}` | 200 `AWAITING_EXCHANGE_RATE` | Setup EDIT test |
| 12 | POST | /api/chatbot/message | `{"message":"88.5"}` | 200 `READY_FOR_CONFIRMATION` | Provide rate |
| 13 | POST | /api/chatbot/message | `{"message":"actually it was 750 USD"}` | 200 `AWAITING_EXCHANGE_RATE` | EDIT — re-runs Phase 1→4 |
| 14 | POST | /api/chatbot/message | `{"message":"not a number"}` | 200 `AWAITING_EXCHANGE_RATE` | Invalid rate — re-asks |

---

## Key design decisions

1. **No external exchange-rate API** — Manager enters rate manually. `convertToINR` throws `CurrencyConversionError` if called for USD without a rate, making the failure explicit and impossible to silently swallow.

2. **Session store as a separate Map in store.ts** — Rather than replacing the draft store, a second `Map<string, ChatSessionState>` was added to `store.ts`. The existing `getDraft/setDraft/clearDraft` contract is unchanged.

3. **`clearAll` as the canonical reset** — Both the reset endpoint and the CANCEL action call `clearAll`. This guarantees draft and session are always reset atomically.

4. **`Math.round(amount * rate * 100) / 100`** — Chosen over adding Decimal.js (not installed). Validated by test: `333 × 3.33 = 1108.89` (not `1108.8900000000001`).

5. **EDIT flow clears draft before re-extraction** — When the manager sends a correction in READY_FOR_CONFIRMATION state, both draft and session are cleared before re-running Phase 1. Avoids stale merged values interfering with the correction.

6. **CONFIRM/CANCEL detection by simple keywords** — Per the spec, no Gemini call for intent detection. Exact `Set.has(keyword)` match on lowercased trimmed message. CONFIRM is checked first; CANCEL second; any non-match falls through to EDIT.

## Known limitations

- Session state is in-memory — lost on server restart (same as existing draft store; Phase 6 will own persistence).
- Only INR and USD are supported currencies. Adding new currencies requires changes in `exchange-rate.ts` and `message/route.ts`.
- Exchange rate is manager-entered; no external rate API is integrated (by design).
- CONFIRMED status does not save to DB (Phase 6 responsibility).
- Keyword matching is exact on the full lowercased message; "confirm please" would fall through to EDIT. Phase 6 should use a dedicated `action` field.
