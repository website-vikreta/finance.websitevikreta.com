# Finance Tool Chatbot — Phases Build Log

> Living document. Updated after each phase ships.
> Purpose: one-stop reference for what was built, where it lives, and what each phase does.

---

## Project Context

Internal finance tracker for Website Vikreta managers (`finance.websitevikreta.com`).
The chatbot lets a manager type a natural-language message to record a transaction.
It asks follow-up questions for missing fields, then (in a later phase) confirms and saves.

Stack: Next.js 16, TypeScript, Gemini 3.8 Flash (structured output, new AQ. project key), shadcn/ui, PostgreSQL (future).


---

## Phase 1 — Gemini Extraction ✅ COMPLETE

**Goal:** Turn a raw manager message into a structured `ExtractionResult`.

**Flow:**
```
Manager message → POST /api/chatbot/extract → Gemini → ExtractionResult
```

**Files:**
| File | Role |
|------|------|
| `src/lib/chatbot/extract.ts` | Gemini extraction service. Single responsibility. |
| `src/app/api/chatbot/extract/route.ts` | Test endpoint. Returns raw extraction. |

**ExtractionResult shape:**
```ts
{
  type: "income" | "expense" | null,
  original_amount: number | null,
  original_currency: "INR" | "USD" | null,
  client_name: string | null,
  expense_description: string | null,
  txn_date: string | null   // YYYY-MM-DD
}
```

**Rules enforced in Gemini prompt:**
- Never assume currency — `"500"` alone → `original_currency: null`
- Never invent date — only resolves `"today"` / `"yesterday"` from server date
- Never guess amount or description
- Temperature 0 — deterministic extraction

**Endpoint:** `POST /api/chatbot/extract`
**Body:** `{ "message": "Acme paid $500 today." }`

---

## Phase 2 — Missing-Field Engine ✅ COMPLETE

**Goal:** Given an `ExtractionResult`, determine what field is missing and ask one deterministic question.

**Flow:**
```
ExtractionResult → validateExtraction() → MissingFieldResult { complete, missingField, question }
```

**Files:**
| File | Role |
|------|------|
| `src/lib/chatbot/questions.ts` | Single map of field → question string. Edit here only. |
| `src/lib/chatbot/validate.ts` | Missing-field engine. Priority order. Conditional rules. |
| `src/app/api/chatbot/validate/route.ts` | Test endpoint. Mode A (message) or Mode B (extraction object). |

**Priority order (fixed):**
```
1. type
2. original_amount
3. original_currency
4. txn_date
5. client_name       (income, if PRODUCT_RULES.requireClientForIncome)
6. expense_description (expense, if PRODUCT_RULES.requireDescriptionForExpense)
```

**MissingFieldResult shape:**
```ts
{
  complete: boolean,
  missingField: ExtractionField | null,
  question: string | null
}
```

**Conditional rules** (one place to change in `validate.ts`):
```ts
const PRODUCT_RULES = {
  requireClientForIncome: true,
  requireDescriptionForExpense: true,
};
```

**Endpoint:** `POST /api/chatbot/validate`
**Mode A body:** `{ "message": "Acme paid 500." }`
**Mode B body:** `{ "extraction": { "type": "income", ... } }`

---

## Phase 3 — Conversation State & Multi-Turn Draft ✅ COMPLETE

**Goal:** Remember the partial transaction across multiple manager messages. Merge new information into the existing draft. Never lose previously collected data.

**Flow:**
```
Manager message
    ↓
Phase 1: Gemini extraction → ExtractionResult (new)
    ↓
Phase 3: mergeDraft(existing, new) → merged ExtractionResult
    ↓
Store merged draft (keyed by userId)
    ↓
Phase 2: validateExtraction(merged) → MissingFieldResult
    ↓
Return { extraction, draft, validation }
```

**Files:**
| File | Role |
|------|------|
| `src/lib/chatbot/merge.ts` | Pure merge function. Null never overwrites; latest non-null wins. |
| `src/lib/chatbot/store.ts` | In-memory draft store. Map keyed by userId. One draft per user. |
| `src/app/api/chatbot/message/route.ts` | Main conversational endpoint. POST = send message. GET = inspect draft. |
| `src/app/api/chatbot/reset/route.ts` | Reset endpoint. Clears current user draft. |

**Merge rule:**
```ts
merged.field = incoming.field ?? existing.field
// null from Gemini never erases a previously stored value
// non-null from Gemini always updates (enables corrections)
```

**State isolation:** Draft is keyed by `userId` from the JWT session. No user sees another user's draft.

**State lifetime:** In-memory (current server process). Resets on `npm run dev` restart. Phase 4 will optionally persist to DB.

**Endpoints:**

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/chatbot/message` | Send a message. Returns extraction + merged draft + validation. |
| `GET`  | `/api/chatbot/message` | Inspect current draft without sending anything. |
| `POST` | `/api/chatbot/reset`   | Clear current draft. Start fresh. |

**Response shape (POST /api/chatbot/message):**
```json
{
  "ok": true,
  "extraction": { "type": "income", "original_amount": 500, "original_currency": null, ... },
  "draft":      { "type": "income", "original_amount": 500, "original_currency": null, ... },
  "validation": { "complete": false, "missingField": "original_currency", "question": "What currency was the payment in — INR or USD?" }
}
```

---

## Phase 3 — Bug Fix: Context-Aware Extraction ✅

**Problem:** Short follow-up answers like `"USD"`, `"Today"`, `"500"`, `"Acme"` were returning all-null extractions from Gemini. Without any transaction context, Gemini correctly followed the "extract only explicit info" rule and returned nulls — there was no signal to map `"USD"` to `original_currency`.

**Root cause:** `extractTransaction()` was called with no knowledge of which field was currently being collected. Gemini had no context to interpret ambiguous short answers.

**Fix — context-aware extraction:**
Before calling Gemini, the message handler now:
1. Validates the existing draft with Phase 2 to find the current `missingField` + `pendingQuestion`
2. Passes that as `ExtractionContext` to `extractTransaction()`
3. Gemini's system prompt gains a "Follow-up answer context" block — it tells Gemini exactly what field is being answered, enabling correct extraction of short replies

**New flow in `message/route.ts`:**
```
load existing draft
    ↓
Phase 2: validate existing draft → currentMissingField + pendingQuestion
    ↓
Phase 1: extractTransaction(message, today, { missingField, pendingQuestion })
    ↓
Phase 3: mergeDraft(existing, extraction)
    ↓
Phase 2: validateExtraction(merged draft) → next question
```

**Files changed:**
| File | Change |
|------|--------|
| `src/lib/chatbot/extract.ts` | Added `ExtractionContext` interface + optional `context` param to `extractTransaction()` and `buildSystemPrompt()`. Added "Follow-up answer context" block to system prompt. |
| `src/app/api/chatbot/message/route.ts` | Reordered: load draft → validate → build context → extract (with context) → merge → validate. |

**Phase 2 (`validate.ts`) — NOT changed.**
**Phase 3 (`merge.ts`, `store.ts`) — NOT changed.**

**New extraction results after fix:**
| Input (with currency context) | `original_currency` | Other fields |
|-------------------------------|---------------------|-------------|
| `"USD"` | `"USD"` | all null |
| `"INR"` | `"INR"` | all null |

| Input (with amount context) | `original_amount` | Other fields |
|-----------------------------|-------------------|-------------|
| `"500"` | `500` | all null |

| Input (with date context) | `txn_date` | Other fields |
|---------------------------|-----------|-------------|
| `"Today"` | `"2026-10-08"` | all null |
| `"Yesterday"` | `"2026-10-07"` | all null |

**Regression tests:** `src/lib/chatbot/__tests__/regression.ts` — 25 tests, all pass (exit 0).
Run: `npx tsx src/lib/chatbot/__tests__/regression.ts`

---

## Phase 4 — Currency Processing ✅ COMPLETE

**Goal:** After Phase 2 declares `validation.complete = true`, compute the INR equivalent of the transaction. Gemini is never involved in rate decisions.

**INR path:**
```
original_currency = INR
→ exchange_rate = null
→ inr_amount = original_amount
```

**USD path:**
```
original_currency = USD
→ status = AWAITING_EXCHANGE_RATE
→ manager types the rate (e.g. "88.50")
→ parseExchangeRate() extracts the largest positive number from free text
→ inr_amount = Math.round(original_amount × rate × 100) / 100
```

**Files:**
| File | Role |
|------|------|
| `src/lib/chatbot/confirm.ts` | `parseExchangeRate()` + `buildConfirmation()` — pure, no side-effects |
| `src/lib/chatbot/store.ts` | `ChatStatus`, `ChatSessionState`, `getSession`, `setSession`, `clearAll` |
| `src/app/api/chatbot/message/route.ts` | Detects complete draft → routes to INR or USD path |

**Business rules enforced:**
- Gemini never calculates or guesses rates.
- Zero exchange rate → rejected.
- Negative or non-numeric message while AWAITING_RATE → repeat the question.
- Rate precision: 2 decimal places (half-up rounding). Phase 6 converts to integer paise.

---

## Phase 5 — Confirmation ✅ COMPLETE

**Goal:** Once Phase 4 produces a confirmed `inr_amount`, present the transaction to the manager for explicit approval before Phase 6 persists it.

**State machine:**
```
COLLECTING
    ↓ (validation.complete + INR)
READY_FOR_CONFIRMATION ←─────────────────────────────────────────┐
    ↓ (validation.complete + USD)                                │
AWAITING_EXCHANGE_RATE                                           │
    ↓ (manager supplies valid rate)                              │
READY_FOR_CONFIRMATION                                           │
    ├── POST /confirm { action: "CONFIRM" } → CONFIRMED          │
    ├── POST /confirm { action: "CANCEL"  } → CANCELLED + reset  │
    └── POST /confirm { action: "EDIT"   } → COLLECTING ─────────┘
                                             (draft preserved for correction)
```

**Correction flow (Test 6):**
Any new message while `READY_FOR_CONFIRMATION` resets the phase to `COLLECTING` and re-runs the full Phase 1→3→2→4 pipeline. The old confirmation is discarded.

**Files:**
| File | Role |
|------|------|
| `src/app/api/chatbot/confirm/route.ts` | `POST /api/chatbot/confirm` — handles CONFIRM / CANCEL / EDIT |
| `src/app/api/chatbot/message/route.ts` | Sets READY_FOR_CONFIRMATION, handles AWAITING_RATE replies |

**API endpoints:**

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/chatbot/message` | Send message (now routes through Phase 4+5) |
| `GET`  | `/api/chatbot/message` | Inspect draft + status + currency |
| `POST` | `/api/chatbot/confirm` | CONFIRM / CANCEL / EDIT actions |
| `POST` | `/api/chatbot/reset`   | Atomic clearAll (draft + session) |

**POST /api/chatbot/confirm response shapes:**

CONFIRM (from READY_FOR_CONFIRMATION):
```json
{
  "ok": true,
  "status": "CONFIRMED",
  "transaction": {
    "type": "income",
    "original_amount": 500,
    "original_currency": "USD",
    "client_name": "Acme",
    "expense_description": null,
    "txn_date": "2026-10-09",
    "exchange_rate": 88.5,
    "inr_amount": 44250
  }
}
```

CANCEL:
```json
{ "ok": true, "status": "CANCELLED", "message": "Transaction discarded. Start a new message to record another." }
```

EDIT:
```json
{ "ok": true, "status": "COLLECTING", "message": "Ready for your correction.", "draft": {} }
```

**What Phase 5 does NOT do (Phase 6 boundary):**
- No `INSERT` to database.
- No audit log entry.
- No n8n webhook.
- No duplicate check.

---

## Phase 6 — Database Save 🔜 NOT STARTED

Phase 6 picks up the `CONFIRMED` transaction from Phase 5 and:
- Converts amounts to integer minor units (paise).
- Duplicate check (same type + amount + currency + client + date).
- `INSERT` to PostgreSQL with `source: "chatbot"`.
- Writes audit log entry.
- Emits `transaction.created` event for automation team.

---

## Architecture Invariants (all phases)

- Gemini extracts only. Never generates questions. Never invents values. Never calculates rates.
- Phase 2 is the single source of truth for validation priority and questions.
- Phase 3 merges only. Never validates. Never writes to DB.
- Phase 4 converts currency. Never calls Gemini or external rate APIs.
- Phase 5 confirms only. Never saves to DB. Never skips manager confirmation.
- One write path for manual + chatbot entries (Phase 6).
- No phase modifies another phase's files unnecessarily.
- Auth check inside every route handler (defense-in-depth).
- TypeScript strict — 0 errors across all phases.
- `clearAll()` is the canonical reset — clears both draft store and session store atomically.
