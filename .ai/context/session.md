# Session State — Live Scratchpad

> Update this file at the end of every task. Loaded by default with every task. Keep it under 100 lines.

---

## Current Task

2026-10-15: Real data everywhere + PR #6 port (branch `feat/supabase-real-data`, on top of PR #7 flatten).
- Dashboard, Transactions, Clients, Reports, Settings read Supabase through `lib/transactions/queries.ts`; `lib/mock-data.ts` deleted. Invoices and Bank connections show `ComingSoon` (no tables yet).
- CSV export: `GET /api/reports/export?period=month|fy|all` (auth-guarded, formula-injection safe). Navbar Export and Reports/Settings use it.
- From PR #6 (not merged): stated exchange rate in the same message, contradiction clarification, client-name cleanup (`lib/chatbot/clarify.ts`, 31 checks in `__tests__/clarify.ts`).
- Chat cards lock after confirm/cancel/replace; pages refresh after a save.
- DB cleanup: 38 test-suite transactions + 2 test-only clients (Stripe, Zenith Inc) soft-deleted with 40 audit events. The api/integration/persistence suites still write to the live DB; don't run them against production until they get a separate database.
- Docs moved to the light theme (DESIGN.md rewritten, design-system.md, brand.md, AGENTS.md, learning.md).


2026-10-09: Chatbot Phases 4+5 complete.
- Phase 4: currency processing — INR direct, USD via manager-entered rate (`parseExchangeRate` + `buildConfirmation`)
- Phase 5: confirmation state machine — `COLLECTING → AWAITING_EXCHANGE_RATE → READY_FOR_CONFIRMATION → CONFIRMED/CANCELLED`
- `lib/chatbot/confirm.ts` — pure Phase 4+5 logic (no side-effects)
- `lib/chatbot/store.ts` — `ChatStatus`, `ChatSessionState`, `getSession`, `setSession`, `clearAll` (was already scaffolded)
- `app/api/chatbot/message/route.ts` — now routes through Phase 4+5 after validation.complete
- `app/api/chatbot/confirm/route.ts` — NEW: CONFIRM / CANCEL / EDIT endpoint
- `app/api/chatbot/reset/route.ts` — updated to call `clearAll()` (atomic draft+session reset)

**Verification (2026-10-09):**
- TypeScript: 0 errors (`npx tsc --noEmit`)
- Regression suite (offline): **63/63 pass** — Phase 2 validation priority, Phase 3 merge rules, Phase 4 rate parser, Phase 4 confirmation builder (INR/USD income/expense), correction flow, ambiguous-amount guard
- Phase 4/5 unit suite: **41/41 pass** — Currency conversion, confirmation transaction, session store lifecycle
- E2E API flow suite: **37/37 pass** (`api-flow.ts`) — Auth guards (401), Phase 2 Mode B validation, INR complete flow, USD AWAITING_EXCHANGE_RATE, natural conversational confirm/cancel, POST /confirm (CONFIRM/EDIT/CANCEL), clean state restart after CONFIRMED
- State hygiene fix: Added auto-reset on `CONFIRMED` in `message/route.ts` to prevent old transaction data bleeding into new manager transactions, plus conversational `confirm` / `cancel` keyword support.

2026-10-10: End-to-End Frontend Chatbot Integration complete.
- Connected FinanceAIDrawer (`components/chat/finance-ai-drawer.tsx`) to chatbot APIs (`/api/chatbot/message`, `/api/chatbot/confirm`, `/api/chatbot/reset`).
- Created modular chat components:
  - `components/chat/types.ts`: Strongly typed API and message structures.
  - `components/chat/chat-api.ts`: Typed fetch helper with 401, 400, 429, 500 error handling.
  - `components/chat/transaction-summary-card.tsx`: Transaction review, exchange rate display, and explicit confirmation controls.
  - `components/chat/chat-message-list.tsx`: Chat bubble thread, typing indicators, retry action.
  - `components/chat/chat-input.tsx`: Responsive textarea with Enter-key submit and loading guards.
- Preserved server-side multi-turn conversation state & draft isolation.
- Verified with 45/45 E2E tests (`chat-integration-e2e.ts`), 37/37 API flow tests, 63/63 regression tests, 41/41 unit tests, clean ESLint, clean TypeScript (`npx tsc --noEmit`), and production build (`npm run build`).

2026-10-10: UI Refinement & Casual Greeting Enhancement for Finance Chat Bot.
- Global rebranding: Updated all references and headers to `Finance Chat Bot`.
- Dedicated Welcome Card: Implemented assistant welcome message with bottom-right timestamp.
- Quick action oval pill badges: Added interactive `Add Expense` and `Add Income` pills beneath the welcome card.
- Post-confirmation re-rendering: Action pills re-render upon confirmation/cancellation to easily initiate subsequent transactions.
- Casual greeting support: Backend message route intercepts greetings (`hi`, `hello`, `hey`, `good morning`, `how are you`, etc.) with a friendly prompt ("Hello! 👋 What would you like to record today — income or an expense? 😊") without premature validation errors.

2026-10-12: Chatbot Conversation Logic, Exchange-Rate Editing & Resizable Chat Panel with Arrow Controls complete.
- Fixed conversation logic across states: greetings ('hi', 'hello', 'thanks', etc.) are handled gracefully during `COLLECTING`, `READY_FOR_CONFIRMATION`, and `AWAITING_EXCHANGE_RATE` without resetting draft or re-validating prematurely.
- Added direct exchange-rate editing intent detection ("Change the exchange rate to 90") during `READY_FOR_CONFIRMATION` and `AWAITING_EXCHANGE_RATE`, cleanly recalculating `inr_amount` without routing to generic LLM field correction.
- Resizable chat panel: added draggable divider between main dashboard and chat panel (300px–700px range, clamped on window resize).
- Easy viewing arrow controls: centered handle pill with ChevronLeft (<) to expand (+40px), ChevronRight (>) to shrink (-40px), live monospace pixel width indicator (`{chatWidth}px`), double-click reset to default (380px), and keyboard arrow navigation.
- Verified: `npm run typecheck` (0 errors), `npm test` (all 186 automated test assertions across regression, phase4/5, api-flow, and integration suites pass).

2026-10-12: Phase 6 — PostgreSQL Confirmation Persistence complete.
- Shared persistence service: `lib/transactions/persist.ts`.
- Connected both explicit confirmation entry points:
  1. `POST /api/chatbot/confirm` (`action === "CONFIRM"`)
  2. `POST /api/chatbot/message` (conversational `"confirm"` / `"yes"`)
- Database write rule strictly enforced: all pre-confirmation steps (drafting, editing, questions, cancellation) remain 100% write-free.
- Transaction atomicity: financial record and immutable audit event written in the same PostgreSQL transaction with automatic rollback.
- Client resolution: income counterparty resolved by normalized name; created only on explicit confirmation within the same DB transaction. Expense descriptions strictly validated with client_id = null.
- Financial accuracy: BigInt minor units (paise/cents), Banker's Rounding (Half-Even) via `precision.ts`, max 2 fraction digits for amounts, max 4 for exchange rates.
- Duplicate protection: stable idempotency key + canonical payload SHA-256 hash. Replays return original saved row without re-inserting; concurrent attempts safely deduplicated; differing payloads reject with 409 conflict; distinct keys allow legitimate repeated entries.
2026-10-12: Transaction Amount Conversion Audit & Target Verification complete.
- Complete data-path trace: verified `extract.ts` -> `validate.ts` -> `confirm.ts` -> `persist.ts` -> `schema.ts` -> `transaction-summary-card.tsx`.
- Confirmed minor-unit storage convention: PostgreSQL columns `original_amount_minor` and `inr_amount_minor` store integer paise / cents (e.g. ₹500.00 = 50,000 paise; $500.00 = 50,000 cents and 4,425,000 INR paise at 88.50). This is expected financial integer arithmetic and not a duplicate conversion bug.
- Display conversion verified: `mapRowToConfirmationTransaction` divides minor units by 100 exactly once (`/ 100`), and `TransactionSummaryCard` formats to human-readable strings (`₹500.00`, `$500.00`, `₹44,250.00`).
- Target verification test suite added: 91/91 checks in `persistence.test.ts` (all 277 assertions across 5 test suites pass). TypeScript clean (`tsc --noEmit`), ESLint clean (0 errors).

**Current next up:** Phase 7 — Analytics connection, transaction history views, n8n webhook event emission.


2026-10-10: Finance Chat Bot navigation persistence and drawer scrolling complete.
- Added root-level `ChatSessionProvider` so messages, timestamps, draft UI state, confirmation cards, and scroll position survive App Router navigation across every shell page without browser storage or backend changes.
- Bound the shell to the dynamic viewport and made the chat message pane the only scrollable drawer section; the header and input remain fixed.
- Guarded initial session reads against later sends, confirm actions, and resets so stale responses cannot overwrite newer UI state.
- Verified: TypeScript, chat lint, 63 regression, 41 Phase 4/5, 37 API flow, 45 integration checks, and production build.

## Locked Decisions

- Visual system: `DESIGN.md` (light Website Vikreta finance theme). Light only. `#FFD600` primary on `#F8F8F4` canvas, white cards. Inter + JetBrains Mono. Rewritten 2026-10-15 to match the live UI (the ClickHouse dark spec is retired).
- UI kit: shadcn/ui, style `base-nova`, Base UI primitives, lucide icons. Components live in `components/ui/`.
- Framework: Next.js 16 App Router, React 19, Tailwind v4, TypeScript strict.
- INR is the base currency. All analytics use `inr_amount`.
- Rate is stored per transaction and never recalculated.
- Chatbot never saves without an explicit confirm.
- Deletes are soft. Every create / edit / delete writes an audit entry.
- Automation team owns n8n/webhooks. We only emit events.
- Internal tool: no SEO, no marketing pages, `robots: noindex`.
- Git flow: feature → `releases/YYYY-MM` → `stage` → `main` (prod, monthly, admin-only merge). Current release `releases/2026-10`. See `AGENTS.md` → Git Flow.

## Latest completed work

2026-10-10: Login UI refreshed from the supplied Figma reference.
- `app/login/page.tsx` now uses a responsive split layout: branded sign-in form on the left and a desktop-only finance panel on the right.
- Preserved the existing `loginAction`, hardcoded environment-backed credentials, session cookie flow, and `/dashboard` redirect.
- Verified with `npx eslint app/login/page.tsx`, `npx tsc --noEmit`, and a live `GET /login` response (200).

2026-10-10: Route, image, and dashboard UI repair.
- `npm run dev` now serves the requested `http://localhost:3030` address.
- Unauthenticated `/` redirects to `/login`; authenticated `/` keeps its `/dashboard` redirect.
- Public image extensions now bypass `proxy.ts`, fixing Next Image's internal 307 failures.
- Refined the responsive dashboard shell, KPI grid, chart, payments panel, navigation, and Finance AI preview without changing existing auth, APIs, or financial data.
- Verified production build, TypeScript, ESLint, `GET /login` (200), source image (200), and optimized image (200).

2026-10-10: Chatbot Docking Layout (VS Code Secondary Sidebar behavior).
- Fixed issue where the chatbot panel floated over and obscured the dashboard and cards on desktop/laptop displays.
- Converted `FinanceAIDrawer` (`components/chat/finance-ai-drawer.tsx`) to dock inside the layout flow beside `<main>` on desktop (`md:` and up), matching VS Code's side panel behavior.
- Updated `AppShell` (`components/layout/app-shell.tsx`) so that `<main>` automatically resizes horizontally to fit beside the docked chatbot across all menu pages (`/dashboard`, `/transactions`, `/invoices`, `/clients`, `/reports`, `/bank-connections`, `/settings`).
- Added smooth width transitions, persistent chat session state across toggles, and auto-collapsed sidebar support on narrow desktop/tablet screens (< 1024px).
- Maintained mobile slide-over with backdrop overlay on screens < 768px.
- Configured root URL (`/`) in `app/page.tsx` to redirect to `/login` first; successful login redirects to `/dashboard` from which all pages are accessible.
- Zero backend changes; verified with clean `npx tsc --noEmit` and `npm run build`.

## In Progress

2026-10-12: Human-Readable Major Units (NUMERIC 18,2) Migration & Mapping complete.
- PostgreSQL Schema: Migrated original_amount_minor and inr_amount_minor to original_amount and amount_inr NUMERIC(18,2) via forward-only migration 0001_major_unit_amounts.sql.
- Preserved existing data: converted paise/cents (divided by 100) safely with check constraint preservation.
- Exact arithmetic: added toMajorDecimal and convertUsdToInrDecimal in precision.ts preserving Banker's Rounding (Half-Even) and rejection of unsupported precision.
- Direct mapping: mapRowToConfirmationTransaction returns major unit numbers directly without double-dividing by 100.
- Verified: All 106 persistence tests, 17 schema constraint verification tests, 41 regression tests, 37 API flow tests, 45 integration tests pass cleanly (300+ total assertions).

## Open Questions

- Layout: flattened to a single Next.js app at the repo root (no `apps/`, no `src/`), matching the main websitevikreta.com repo. Decided 2026-10-15.
- Database: MongoDB (SRS base plan) or another DB? (SRS open question)
- Exchange-rate source? (SRS open question)
- Expenses in USD too, or INR only? (SRS open question)
- Can a manager edit old entries, or only Admin? (SRS open question)
- Auth provider for F1?
- Chatbot LLM provider for F5?

## Screens Completed

_None yet_

## Components Locked

<!-- Reusable components finalized and not to be changed without updating learning.md -->

- `components/ui/*` — shadcn primitives, themed via tokens. Edit only for token/size alignment with DESIGN.md; log every edit in `learning.md`.
