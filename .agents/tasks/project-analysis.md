# Project Analysis — Finance Tool (finance.websitevikreta.com)

> Read-only investigation completed on 2026-10-09.
> Sources: package.json, src/ (all files), phases_chat.md, AGENTS.md, DESIGN.md, CLAUDE.md, .env.example, .ai/ (all files), .kiro/, .gitignore.

---

## Summary Answer

This is a **Next.js 16 internal finance tracker** for Website Vikreta managers. Its job: replace scattered spreadsheets with one place to record and read company income/expense in INR and USD. The core chatbot engine (Phases 1–3) is **complete and working** — a manager can type a natural-language transaction and the system will extract fields, remember context across turns, and ask follow-up questions one at a time. What is **not yet built** is everything user-facing: there is no real UI screen, no database, no confirm card, no manual entry form, no transactions list, and no real analytics. The only rendered page (`src/app/page.tsx`) is an explicit demo with hard-coded data. The next planned milestone is Phase 4: the confirmation card + PostgreSQL write that will make the chatbot actually save transactions.

---

## 1. Project Purpose & Tech Stack

### Purpose
Internal tool for Website Vikreta. Managers record income and expenses (INR and USD) via a form or by chatting in plain English. The chatbot extracts transaction fields using Gemini, confirms with the manager, then writes to the database. Dashboard shows income/expense/net at a glance; every number is traceable.

**Not client-facing.** All pages are `robots: noindex`.

### Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 App Router, React 19 |
| Language | TypeScript strict |
| Styling | Tailwind CSS v4 + CSS custom properties |
| UI kit | shadcn/ui (style `base-nova`) in `src/components/ui/` |
| Icons | lucide-react |
| Toasts | sonner |
| LLM | Google Gemini (`gemini-3.8-flash`) via `@google/genai` |
| Auth | JWT (jose) — single hardcoded admin user, SHA-256 password hash in env |
| Database | PostgreSQL (env var `DATABASE_URL` configured) — **not yet connected** |
| Fonts | Inter + JetBrains Mono via next/font |
| Build | Turbopack with `@tailwindcss/turbopack` |

**Design system:** ClickHouse system (`DESIGN.md`) — dark-only, `#0a0a0a` canvas, `#faff69` electric yellow primary. NOT the main Website Vikreta brand.

### Key env vars (from `.env.example`)
- `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET` — auth
- `GEMINI_API_KEY` — chatbot extraction
- `DATABASE_URL` — PostgreSQL (not yet used in code)
- `EXCHANGE_RATE_API_KEY` — placeholder, provider not chosen
- `N8N_WEBHOOK_URL` — automation team boundary, not yet used

---

## 2. What Has Already Been Built

### Auth System (F1 — partial)
**Status: Working**

- `src/lib/auth.ts` — JWT create/verify with `jose`. 8-hour sessions. Cookie name `wv_finance_session`.
- `src/lib/server-auth.ts` — `requireAuth(req)` and `requireAuthAction()` helpers for route handlers and server actions respectively.
- `src/app/login/page.tsx` — fully styled login form. `useActionState` + server action. Show/hide password toggle. Inline error under form with `aria-invalid` + `aria-describedby`. Accessibility-complete.
- `src/app/login/actions.ts` — server action: SHA-256 hash comparison (both fields checked before branching to prevent timing leaks), sets `httpOnly` session cookie, redirects to `/`.
- `src/app/api/auth/login/route.ts` — JSON equivalent for Postman/API clients.
- `src/app/api/auth/logout/route.ts` — clears cookie, redirects to `/login`.
- `src/proxy.ts` — Next.js 16 route guard (not `middleware.ts`). Public prefixes: `/login`, `/api/auth`. API routes get 401 JSON; page routes get 307 redirect. Session cookie cleared on expired token.

**Gap:** Only a single hardcoded admin user. No user management UI (F1 admin features). Auth works but role is always `"admin"` — there is no manager/viewer/admin differentiation yet.

---

### Chatbot Backend — Phase 1: Gemini Extraction (F5)
**Status: Complete**

- `src/lib/chatbot/extract.ts` — `extractTransaction(message, today, context?)` calls `gemini-3.8-flash` with a structured JSON schema. Temperature 0. 4.5 s timeout. Returns `ExtractionResult`:
  ```ts
  { type, original_amount, original_currency, client_name, expense_description, txn_date }
  ```
- Rules: never assumes currency, never invents amount/date, resolves "today"/"yesterday" from server date.
- `ExtractionContext` interface added for Phase 3 bug fix — tells Gemini which field is being collected so short answers like `"USD"` or `"500"` extract correctly.
- Full validation of Gemini's response before returning (shape check + enum check + ISO date format check).
- `src/app/api/chatbot/extract/route.ts` — `POST /api/chatbot/extract`, auth-guarded test endpoint.

---

### Chatbot Backend — Phase 2: Missing-Field Engine (F5)
**Status: Complete**

- `src/lib/chatbot/questions.ts` — single map of field → question string. One place to edit wording.
- `src/lib/chatbot/validate.ts` — `validateExtraction(data)` checks fields in fixed priority order:
  1. type → 2. original_amount → 3. original_currency → 4. txn_date → 5. client_name (income) → 6. expense_description (expense)
- Returns `MissingFieldResult: { complete, missingField, question }`. One question per call.
- `PRODUCT_RULES` flags control conditional fields (`requireClientForIncome`, `requireDescriptionForExpense`).
- `src/app/api/chatbot/validate/route.ts` — `POST /api/chatbot/validate`, Mode A (message) or Mode B (pre-extracted object).

---

### Chatbot Backend — Phase 3: Conversation State & Multi-Turn Draft (F5)
**Status: Complete (with bug fix)**

- `src/lib/chatbot/merge.ts` — `mergeDraft(existing, incoming)` pure function. Null never overwrites; non-null always updates (enables corrections).
- `src/lib/chatbot/store.ts` — in-memory `Map<userId, ExtractionResult>`. Keyed by JWT userId. Resets on server restart. Acknowledged as temporary (Phase 4 will persist to DB).
- `src/app/api/chatbot/message/route.ts` — main conversational endpoint:
  - `POST`: load draft → validate existing (get pending question) → extract with context → merge → validate merged → return.
  - `GET`: inspect current draft without sending a message.
- `src/app/api/chatbot/reset/route.ts` — `POST /api/chatbot/reset`, clears draft for authenticated user.
- **Bug fixed:** short follow-up answers ("USD", "Today", "500") now extract correctly because the missing field + pending question are passed to Gemini as `ExtractionContext`.

---

### Regression Test Suite
**Status: 25/25 passing**

- `src/lib/chatbot/__tests__/regression.ts` — custom minimal test harness. Tests merge engine + validation priority + short-answer simulation. No Gemini/HTTP calls.
- Run: `npx tsx src/lib/chatbot/__tests__/regression.ts`

---

### Money Formatter
**Status: Done (utility only)**

- `src/lib/money.ts` — `formatMoney(minor, currency)` using `Intl.NumberFormat`. Stores/works in integer minor units (paise/cents). Used in the demo dashboard.

---

### Design System / UI Kit
**Status: Tokens complete, components installed, no real screens**

- `src/app/globals.css` — all design tokens from `DESIGN.md` mapped to CSS custom properties: full color palette, type scale (display-xl through code), radius scale, chart colors.
- `src/components/ui/` — **20 shadcn components** installed and themed:
  `accordion`, `avatar`, `badge`, `button`, `card`, `checkbox`, `dialog`, `dropdown-menu`, `input`, `label`, `navigation-menu`, `select`, `separator`, `sheet`, `skeleton`, `sonner`, `switch`, `table`, `tabs`, `textarea`, `tooltip`
- `src/app/layout.tsx` — root layout: Inter + JetBrains Mono fonts, `dark` class on `<html>`, `TooltipProvider`, `Toaster`.

---

### Demo Dashboard (non-functional)
**Status: Exists as design proof-of-concept only**

- `src/app/page.tsx` — explicitly marked `// Demo dashboard with hard-coded data`. Shows sidebar nav, KPI cards, bar chart (CSS divs), spend-by-category bars, recent transactions table, quick entry form, audit entry card, and badge/skeleton/state examples. All data is hardcoded constants. No real data flow.
- **This is not the real F8 dashboard.** The comment in the file reads: `// Replace with the real F8 dashboard once data exists.`

---

## 3. What Is In-Progress or Partially Built

### Database Layer — Not started but configured
- `DATABASE_URL=postgresql://...` is in `.env.example`, which means the decision to use PostgreSQL has been made (the `session.md` note "decided: PostgreSQL" and the `business.md` open question "Keep MongoDB?" are resolved in favor of PostgreSQL per `.env.example`).
- However, **zero database code exists** in `src/lib/db/` — the folder doesn't exist. No schema, no migration files, no ORM config, no query helpers. The SRS and builder.md both mention `src/lib/db/` as the intended location.

### Currency Handling (F6) — Partially designed, not coded
- `EXCHANGE_RATE_API_KEY` is a placeholder in `.env.example` — provider is not chosen.
- `data-safety.md` defines how USD→INR should work (store original + rate + inr_amount, rate is immutable per transaction, manual fallback with `rate_source = manual`).
- Zero code in `src/lib/currency.ts` — this file is referenced in standards but does not exist.

---

## 4. What Is Planned But Not Yet Started

Based on `phases_chat.md`, `business.md`, and the SRS features F1–F10:

### Phase 4 — Confirmation Card & Database Write (explicitly "NOT STARTED")
From `phases_chat.md`:
- Currency conversion (USD → INR at stored rate)
- Confirmation card shown to manager
- Confirm / Edit / Cancel flow
- `INSERT` transaction to PostgreSQL
- Audit log entry
- n8n webhook trigger

This is the **immediate next milestone**.

### F2 — Income Tracking (not started)
Record money received, linked to a client. Requires database.

### F3 — Expense Tracking (not started)
Record money spent, with category and note. Requires database.

### F4 — Manual Entry Form (not started)
The demo shows a placeholder "Quick entry" form but it has no action, no validation, no server function. The real form must share the same write path as the chatbot.

### F6 — Currency Handling (not started in code)
USD→INR conversion at fetch-or-manual rate. `src/lib/currency.ts` doesn't exist.

### F7 — Client Records (not started)
Client profile pages, linking all payments to a client. Routes `/clients` and `/clients/[id]` don't exist.

### F8 — Real Analytics Dashboard (not started)
The demo `page.tsx` is a placeholder. Real dashboard needs live DB queries, filters by date/client/category/currency, chart data from aggregations, and the KPI numbers wired to real data.

### F9 — Data Safety / Audit Log (partially designed)
Standards are fully documented in `data-safety.md` but zero implementation: no soft delete, no audit log table, no audit write helper.

### F10 — Search & Export (not started)
Find any entry, download reports. Requires database and transactions list.

### App Shell (not started)
- `src/components/layout/` — sidebar, topbar, page header do not exist as real components. The demo page inlines the sidebar as static HTML with `href="#"` links.
- Route groups `src/app/(app)/` — no route group exists; the routing architecture in `builder.md` (transactions, chat, clients, analytics, admin) is planned but none of it is built.

### Admin Routes (not started)
`/admin/users`, `/admin/categories`, `/admin/audit` per `builder.md`.

---

## 5. Architecture & Code Quality Observations

### Strengths

**Exceptional phase discipline.** The chatbot backend is split into pure, single-responsibility modules that never call each other in circles: extract → merge → validate are three separate files with explicit "MUST NOT" lists in their headers. This makes Phase 3 bug fixes surgical (only `message/route.ts` and `extract.ts` changed).

**Defense-in-depth auth.** Both the proxy (`proxy.ts`) and every individual route handler call `requireAuth`. The proxy is described as the first gate, not the only gate — this is the correct pattern for Next.js 16.

**Correct money handling.** `formatMoney` uses `Intl.NumberFormat`, amounts in the demo are expressed in paise as integer minor units, and `data-safety.md` forbids floats. The money library is tiny but correct.

**No silent chatbot saves.** Phase 4 has not been started precisely to uphold this rule. The chatbot backend only extracts and stores a draft — it never writes to any database. This is the correct approach.

**Well-instrumented AI workflow.** The `.ai/` folder is a polished multi-agent system with Designer → Builder → Critic personas, anti-slop writing guidelines, a conventions learning log (`learning.md`), and macro/micro command recipes. This gives the project a coherent development methodology.

**TypeScript strict, 0 errors** (verified per `session.md` 2026-10-08).

**Accessibility on login.** The login page uses `aria-invalid`, `aria-describedby`, `role="alert"`, proper `htmlFor`, `autoComplete`, and disabled states during submit. This is the correct baseline.

---

### Risks & Gaps

**1. No actual app screens exist.**
`session.md` lists "Screens Completed: _None yet_". The demo page is all hard-coded. No route group, no app shell, no real data flow anywhere in the UI layer.

**2. Database layer is completely absent.**
`DATABASE_URL` is configured but `src/lib/db/` doesn't exist. There is no schema, no ORM, no migration tooling. This is the critical path blocker: Phase 4, F2, F3, F4, F7, F8, F9, F10 all depend on it. The choice of ORM/query builder has not been recorded (Prisma? Drizzle? raw pg?).

**3. PostgreSQL vs. MongoDB open question is partially resolved.**
`.env.example` has `DATABASE_URL=postgresql://...` which implies PostgreSQL was chosen, but `session.md` still lists it as an open question, and `business.md` also lists it as open. These three places disagree — this should be locked in `session.md` and `business.md` explicitly.

**4. In-memory draft store is not production-safe.**
`store.ts` is a module-level `Map` — it resets on every server restart and would not work correctly if the app ran as multiple Node.js processes (e.g., with a load balancer or serverless). This is acknowledged in the code and must be replaced in Phase 4 with a DB-backed or Redis-backed session.

**5. The Gemini model name is unusual.**
`extract.ts` uses `gemini-3.8-flash` with a comment "new AQ. project key requires this — gemini-2.5-flash is not available". As of the last session (2026-10-08), live Gemini calls were returning 503 (Google-side high demand). This is a production dependency risk that should be tracked.

**6. Exchange-rate source is unresolved.**
`EXCHANGE_RATE_API_KEY` is a placeholder. Until the source is chosen, F6 cannot be fully built, and USD transactions cannot be confirmed+saved.

**7. Route groups / shell architecture not started.**
`builder.md` proposes `src/app/(app)/` route groups with a shared layout for the authenticated shell. Without this, every new page will need to copy the sidebar markup (as the demo page does). This should be created before any new screens.

**8. `src/lib/utils.ts` exists but is trivially thin.**
It only exports `cn()` (the class merge utility). That is correct — don't put more here until needed.

**9. No error boundaries or loading states.**
No `error.tsx` or `loading.tsx` files anywhere in the route tree. Code standards require them per route group.

**10. No real tests beyond the chatbot regression suite.**
The regression suite covers merge + validation logic (offline). There are no tests for auth, money math, currency conversion, duplicate detection, or role checks — all flagged as required in `data-safety.md`.

---

## Conclusions & Recommendations

### Immediate next steps (in dependency order)

1. **Lock the database + ORM choice.** Update `session.md` and `business.md`. Without this, no server-side work can proceed. Given the stack (Next.js, TypeScript), Drizzle ORM with the `postgres` client is a natural fit; Prisma is also viable. Choose one and record it.

2. **Build the app shell before any new screen.** Create `src/app/(app)/layout.tsx` with the sidebar and topbar as real components in `src/components/layout/`. Use the demo page as the pixel reference but wired to routing. This unblocks every subsequent screen.

3. **Phase 4 — confirmation card + DB write.** This is the capstone of the chatbot work. It requires: `src/lib/db/` schema + write function for transactions, `src/lib/currency.ts` for USD→INR conversion, the confirm card UI component, and the audit log write. The confirm endpoint should complete the loop: `POST /api/chatbot/confirm` → validate draft → duplicate check → persist → audit → emit event → clear draft.

4. **Create `src/lib/currency.ts`** for USD→INR conversion. Even if the rate source is manual for now (manager enters the rate), the conversion logic and rounding rules should live here so it works the same way for both the chatbot and the manual form.

5. **Manual entry form (F4) + Transactions list** once the DB and app shell exist. These are the core day-to-day workflows.

6. **Wire the real dashboard (F8).** Replace `src/app/page.tsx` hard-coded demo with live DB aggregations. The visual design is already proven by the demo — it just needs real data.

### Recommendations

- **Resolve the PostgreSQL ambiguity explicitly.** Three places in the project give conflicting signals. One decision, one place.
- **Replace the in-memory store before any production deployment.** A Redis session or a `chat_sessions` DB table are both good options; the API surface in `store.ts` is clean enough that swapping the implementation is a targeted change.
- **Add `error.tsx` and `loading.tsx` to every route group** as part of building the app shell, not as a followup task.
- **Add test coverage for money math and role checks** before the DB layer ships. These are the highest-trust paths.
- **Keep the chatbot's zero-save rule sacred.** The confirm step (Phase 4) must be the only place a transaction is written. The current separation of concerns makes this easy to verify.
