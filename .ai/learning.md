# Learning Log — Uniformity & Consistency

Persistent memory of design + code conventions for the Finance Tool. Every reusable decision lands here so screens stay uniform across sessions.

## How To Use This File

- **Before building** any screen/component: read this file. Reuse what exists. Do not reinvent.
- **After learning** anything reusable: log it here immediately. One entry = one rule.
- **On conflict**: if new work contradicts a logged rule, stop. Either follow the rule or update the rule with a reason. Never silently diverge.
- Keep entries short, specific, copy-pasteable. Exact values (px, ms, hex, token, class names) over prose.

## Entry Format

```
### [Topic] — short title
- Rule: <the convention, exact values>
- Where: <files/components using it>
- Why: <reason, if not obvious>
- Date: YYYY-MM-DD
```

Topics in use: `[Tokens]` `[Type]` `[Layout]` `[Component]` `[Money]` `[Data]` `[Motion]` `[Copy]` `[A11y]` `[Perf]` `[Rejected]` `[Exception]`

---

## Tokens & Theme

### [Tokens] — DESIGN.md is the visual source of truth
- Rule: All colors, type, radius come from `DESIGN.md` via `app/globals.css`. Primary `#FFD600`, canvas `#F8F8F4`, card `#FFFFFF`, ink `#0A0A0A`, hairline `#E8E8E2`.
- Where: `app/globals.css`, `.ai/standards/design-system.md`
- Why: The UI moved to the light Vikreta theme with the Figma login/dashboard refresh (2026-10-10). The original ClickHouse dark spec (2026-10-07) is retired; `DESIGN.md` was rewritten to match the live tokens on 2026-10-15.
- Date: 2026-10-15

### [Tokens] — light only, no `.dark`
- Rule: Palette lives in `:root`; `<html>` has no `.dark` class; `<Toaster theme="light" />`; no toggle. New code doesn't write `dark:` variants.
- Where: `app/layout.tsx`, `app/globals.css`
- Why: One theme to maintain, matching the Figma refresh.
- Date: 2026-10-15

### [Tokens] — income/expense tokens are fills, not text
- Rule: `bg-income` (#FFD600) and `bg-expense` (#CBD5E1) for chart series and bars only. Money in text = `text-success` with `+`; money out = `text-foreground` with `−`. Never `text-income`.
- Where: `components/dashboard/cash-flow-chart.tsx`, `components/transactions/ledger-table.tsx`, `app/reports/page.tsx`
- Why: Yellow on white is ~1.4:1 contrast. The chart previously used `bg-surface-elevated` (white) for expenses, which made the bars invisible.
- Date: 2026-10-15

### [Tokens] — shadcn `accent` ≠ brand accent
- Rule: `--accent` = `#242424` (hover/focus fill). Brand yellow is `--primary`. Use `hover:bg-accent` for hovers, `bg-primary` for the one primary action.
- Where: `app/globals.css`
- Date: 2026-10-07

### [Tokens] — radius mapping
- Rule: `rounded-sm` 4px, `rounded-md` 6px, `rounded-lg` 8px (buttons, inputs), `rounded-xl` 12px (cards, dialogs), `rounded-full` (badges, avatars, icon buttons). `--radius` = 8px.
- Where: `app/globals.css` `@theme inline`
- Why: matches DESIGN.md xs/sm/md/lg while keeping shadcn's class names working unchanged.
- Date: 2026-10-07

## Typography

### [Type] — scale utilities carry weight + tracking
- Rule: Use `text-display-{xl,lg,md,sm}`, `text-title-{lg,md,sm}`, `text-stat`, `text-body-{md,sm}`, `text-caption`, `text-eyebrow uppercase`, `font-mono text-code`. Don't add `font-bold` / `tracking-*` on top.
- Where: `app/globals.css` `--text-*`
- Date: 2026-10-07

### [Type] — fonts
- Rule: Inter (`--font-inter`) for all UI, JetBrains Mono (`--font-jetbrains-mono`) for code/IDs/rates/audit diffs. Body text defaults to `text-body` (#cccccc); headings `text-foreground` (#fff) via base layer.
- Where: `app/layout.tsx`, `app/globals.css`
- Date: 2026-10-07

## Components

### [Component] — Button sized to DESIGN.md
- Rule: default size `h-10 px-5`, `font-semibold`, yellow `bg-primary` with `hover:bg-primary-active`. `size="lg"` = `h-11 px-6`. `size="icon"` = 36px round, `icon-lg` = 40px round. `sm` / `xs` kept for dense table rows.
- Where: `components/ui/button.tsx`
- Why: DESIGN.md `button-primary` = 40px tall, 12×20 padding, 14px/600; `button-icon-circular` = 36px.
- Date: 2026-10-07

### [Component] — Input / Select height 40px on card surface
- Rule: `<Input>` `h-10 px-3.5 bg-card` (removed shadcn's `dark:bg-input/30`); `<Select>` trigger default `h-10`. Focus ring yellow via `--ring`.
- Where: `components/ui/input.tsx`, `components/ui/select.tsx`
- Why: DESIGN.md `text-input` = 40px, 10×14 padding, surface-card bg, yellow focus.
- Date: 2026-10-07

### [Component] — app-wide providers
- Rule: `TooltipProvider` wraps the app; one `<Toaster />` in root layout. Never mount a second Toaster or provider per page.
- Where: `app/layout.tsx`
- Date: 2026-10-07

## Money & Data

### [Data] - Gemini extraction has a bounded, safe fallback
- Rule: Chatbot Gemini calls set `config.httpOptions.timeout` to 4,500 ms. Provider failures return `"Chat extraction is unavailable. Please try your message again."` and never expose provider errors to the client. Gemini-backed routes preserve the retryable `503` status.
- Where: `lib/chatbot/extract.ts`
- Why: keeps chat within its 5-second response budget and prevents third-party implementation details from reaching managers.
- Date: 2026-10-08

### [Money] — Exact Major Units NUMERIC(18,2) Storage & Direct Mapping
- Rule: Amounts are stored in PostgreSQL as exact human-readable major units using NUMERIC(18,2): original_amount and amount_inr (e.g. ₹500 is stored as 500.00, ₹40 as 40.00, $500 at 88.50 as 500.00 and 44250.00). No _minor paise/cents columns. Financial calculations internally use exact arithmetic and half-even rounding (precision.ts) and format to decimal strings with up to 2 decimal places. Returned rows map directly into human-readable numbers without double-dividing by 100.
- Where: lib/db/schema.ts, lib/transactions/persist.ts, lib/currency/precision.ts, drizzle/0001_major_unit_amounts.sql
- Why: User requirement for human-readable major-unit database storage while preserving exact financial arithmetic.
- Date: 2026-10-12

### [Data] — Explicit Confirmation PostgreSQL Persistence & Atomicity
- Rule: Transactions are persisted ONLY upon explicit manager confirmation (`POST /api/chatbot/confirm` or conversational `confirm`). Pre-confirmation actions (extraction, clarifications, editing, cancellation) are strictly database-write-free. Transaction insert, client resolution/creation (for income), and immutable audit event run inside a single PostgreSQL transaction. Idempotency enforced via stable key and canonical payload SHA-256 hash. Banker's Rounding (Half-Even) and exact BigInt minor units via `precision.ts`.
- Where: `lib/transactions/persist.ts`, `app/api/chatbot/confirm/route.ts`, `app/api/chatbot/message/route.ts`
- Why: Guarantees zero phantom writes, zero silent mutations, exact integer arithmetic, and robust duplicate protection.
- Date: 2026-10-12

### [Layout] - login uses a split form and context panel
- Rule: Keep the `/login` form in a `max-w-md` left column; show the supporting finance panel only at `lg` and above so small screens stay focused on sign-in.
- Where: `app/login/page.tsx`
- Why: It preserves the Figma desktop composition without adding non-essential content to the mobile sign-in flow.
- Date: 2026-10-10

### [Layout] - dashboard adapts before the assistant docks
- Rule: Dashboard KPI cards move from one to two to four columns only when their content has room; the chart and payment panels stack until the `2xl` layout, and Finance AI overlays below `xl`.
- Where: `app/dashboard/page.tsx`, `components/layout/app-shell.tsx`, `components/chat/finance-ai-drawer.tsx`
- Why: Prevents the narrow dashboard and chart overlap shown when the assistant drawer is open.
- Date: 2026-10-10

### [Layout] - chat session is root-scoped and the message pane owns scrolling
- Rule: Keep in-session Finance Chat Bot state in `ChatSessionProvider` beneath the root layout, not in per-page `AppShell` instances. Use `h-dvh` plus `min-h-0` on shell and drawer flex ancestors, and `overflow-y-auto` only on the message list.
- Where: `app/layout.tsx`, `components/chat/chat-session-provider.tsx`, `components/layout/app-shell.tsx`, `components/chat/chat-message-list.tsx`
- Why: App Router page navigation remounts each shell; a root-scoped provider preserves the active conversation while the bounded message pane prevents dashboard scrolling and keeps the input reachable.
- Date: 2026-10-10

## Rejected

### [Rejected] — Website Vikreta marketing patterns
- Rule: Don't port from `websitevikreta-fork`: Epilogue, GSAP reveals, `Reveal.tsx`, DotGrid, arrow-dots Button, SEO/GEO schema, Storyteller marketing arc. The brand colors (`#FFD600`, light canvas) and the flat repo layout are shared; the marketing UI is not.
- Why: Internal tool, not a marketing site.
- Date: 2026-10-15

## Data & Screens

### [Data] — No made-up numbers on any screen
- Rule: Every figure comes from Supabase via `lib/transactions/queries.ts` (server only). Modules with no tables yet (Invoices, Bank connections) render `ComingSoon` with what's planned. No fake badges ("Bank synced"), no fake toasts ("exported successfully"), no Save buttons that save nothing.
- Where: `app/*/page.tsx`, `components/layout/coming-soon.tsx`, `components/layout/navbar.tsx`
- Why: `lib/mock-data.ts` was removed 2026-10-15; mock data hid that pages weren't wired up.
- Date: 2026-10-15

### [Data] — Server pages + Suspense for DB reads
- Rule: Pages are Server Components. Wrap each DB-reading component in `<Suspense>` with a `Skeleton` fallback shaped like the content (Cache Components needs it). Don't `"use cache"` ledger data; it must be fresh. Interactive bits (search, filters, paging, chart hover) are small client components that receive rows as props.
- Where: `app/dashboard`, `app/transactions`, `app/clients`, `app/reports`, `app/settings`
- Date: 2026-10-15

### [Data] — Dates and periods in IST, returned as strings
- Rule: SQL returns dates via `to_char(..., 'YYYY-MM-DD')` (raw pg turns DATE into a local-midnight JS Date). "This month" and the financial year (1 April) resolve in Asia/Kolkata (`lib/transactions/period.ts`). Display with `formatDate` / `formatMonthShort`, which parse as UTC.
- Date: 2026-10-15

### [Layout] — PageHeader + one action
- Rule: Every page starts with `PageHeader` (title, one-line description, optional single action). "New transaction"/"Record income" use `NewTransactionButton`, which opens Finance AI through `useOpenFinanceAI()` from `AppShell`.
- Where: `components/layout/page-header.tsx`, `components/layout/new-transaction-button.tsx`
- Date: 2026-10-15

### [Component] — Chat confirmation cards lock once settled
- Rule: `ChatMessage.resolution` (`confirmed` | `cancelled` | `replaced`) is set on every open card when the server moves on; settled cards render without buttons. After a confirm, `router.refresh()` updates the visible page.
- Where: `components/chat/chat-session-provider.tsx`, `components/chat/chat-message-list.tsx`, `components/chat/transaction-summary-card.tsx`
- Why: Old cards kept live Confirm buttons that acted on whatever draft was current on the server.
- Date: 2026-10-15

### [Tokens] — ClickHouse discipline on the light theme
- Rule: No dot patterns, textures, illustrations or decorative shapes. Two-tone headlines use `text-muted-foreground` for the second half, never yellow. No shadows on cards or chat bubbles. Type sizes only from tokens; `text-micro` (11px) added for chat timestamps and tiny badges instead of `text-[10px]`/`text-[11px]`.
- Where: `components/dashboard/hero-card.tsx`, `components/layout/coming-soon.tsx`, `app/login/page.tsx`, `components/chat/*`, `app/globals.css`
- Why: User wants the ClickHouse rules (one accent, flat, no decoration) applied consistently while keeping the light theme; no dark mode for now. `.bg-dot-pattern` and the two brand illustration PNGs were removed.
- Date: 2026-10-15


### [Money] — One USD→INR conversion: exact half-even
- Rule: Anything that shows or saves an INR amount converts through `convertUsdToInrDecimal` (`lib/currency/precision.ts`). `buildConfirmation` uses it, so the confirmation card shows exactly what `persist.ts` saves. Amounts max 2 decimals, rates max 4; anything finer is rejected with a 400, not rounded silently.
- Why: The card used float half-up while persistence used half-even; they disagreed on 23,266 of ~360k sampled amount/rate pairs (e.g. $1 @ 80.025 → card ₹80.03, saved ₹80.02). `lib/currency/convert.ts` and `lib/chatbot/confirmation.ts` were unused duplicates and were deleted.
- Date: 2026-10-15

### [Auth] — One credential check, no secrets in code
- Rule: Login form and JSON login both call `verifyCredentials` (`lib/credentials.ts`, constant-time compare) and set `SESSION_COOKIE_OPTIONS`. Never write real emails/passwords in code, comments, docs or tests; use placeholders like `<ADMIN_EMAIL>`.
- Why: The live admin password sat in a doc comment in `app/api/auth/login/route.ts` (committed 2026-10-13).
- Date: 2026-10-15

### [Data] — Manual entry, edit and delete share the chat's persistence rules
- Rule: Manual create goes through `confirmAndPersistTransaction` with `source: "manual"` (never touches the chat session). Edit and delete live in `lib/transactions/manage.ts`; both run in one DB transaction with an audit event (`updated` with before/after, `deleted`). Money via `computeAmounts`, clients via `resolveClientId` (both exported from `persist.ts`). Form input is untrusted: `toDraft` validates it server-side. A per-form `requestId` makes double submits idempotent.
- Where: `app/transactions/actions.ts` (Server Actions, `requireAuthAction` + UUID checks, `refresh()` on success), `components/transactions/*`
- Date: 2026-10-15

### [Data] — Error pages and startup env check
- Rule: `app/error.tsx` (inside `AppShell`, Next 16 `retry()` prop, shows `error.digest` as a reference), `app/not-found.tsx` (inside the shell), `app/global-error.tsx` (own `<html>`/`<body>`, imports `globals.css`). `instrumentation.ts` runs `envProblems()` (`lib/env.ts`) on server start and refuses to boot with a missing or malformed DATABASE_URL, JWT_SECRET (≥32 chars), ADMIN_EMAIL, ADMIN_PASSWORD_HASH (64 hex) or GEMINI_API_KEY. Only names are reported, never values.
- Date: 2026-10-15

### [Data] — Delete is undoable
- Rule: Deleting shows a toast with Undo; the Transactions page lists "Recently deleted" (last 30 days, deleted through the app) with Restore. Restore writes a `restored` audit event and re-links income to an active client by name. Maintenance deletions (audit `metadata.reason`, e.g. test-suite cleanup) are not offered for restore.
- Where: `lib/transactions/manage.ts` (`restoreTransaction`), `lib/transactions/queries.ts` (`listDeleted`), `components/transactions/recently-deleted.tsx`, `restore-toast.ts`
- Date: 2026-10-15

### [Copy] — Title plus data, nothing else
- Rule: No eyebrows, taglines, hero cards or explainer lines. `PageHeader` description is optional and unused on all pages; the dashboard puts the month on its labels instead ("Money in · October"). Chat greetings are one plain sentence, no emoji. Only one way to open the chat (floating button).
- Why: User flagged "Finance overview", "Your money. Clearly managed." and "Ask, review, and approve…" as AI slop (2026-10-15).
- Date: 2026-10-15

### [Component] — Dashboard charts (recharts)
- Rule: `TrendChart` (income vs expenses, 3/6/12M + Bars/Lines/Area, crosshair tooltip), `BreakdownDonut` (top 5 + Other, falls back to share bars under 3 parts, legend with ₹ and %), `RecentTransactions` (last 5). Data stays server-side; charts are thin client components receiving rows.
- Why: Dashboard should answer "how much in, where it went, who paid" without leaving the page. Palette validated with the dataviz checker; see design-system.md → Chart colors.
- Date: 2026-10-15

### [Data] — Proxy must never guard the dev HMR WebSocket
- Rule: `proxy.ts` matcher excludes `_next/hmr` (and `_next/webpack-hmr`); `next.config.ts` lists every host the app may be browsed with in `allowedDevOrigins` (`localhost`, `127.0.0.1`, LAN IP). Never route `/_next/hmr` through the auth guard.
- Where: `proxy.ts` (matcher), `next.config.ts`
- Why: Next 16 blocked the HMR WebSocket for unlisted origins with a bare `Unauthorized` 12-byte response (no HTTP status line). Chrome reads that as `ERR_INVALID_HTTP_RESPONSE`; the dev client retries every ~5s and force-reloads the page after repeated failures, so every screen refreshed endlessly in dev. First seen 2026-10-23; caused ~2 weeks of "page keeps refreshing" without a server-side error anywhere.
- Date: 2026-10-23

### [Data] — Bank direction comes from source amount columns
- Rule: Map debit/withdrawal and credit/deposit only from their labeled source columns. Closing balance is stored separately and used only for statement reconciliation. When empty cells collapse or column alignment is uncertain, retain the row as pending with `COLUMN_COUNT_MISMATCH` / `UNKNOWN_DIRECTION`; never move a balance into an amount field or infer a side from balance changes. Preserve a negative source sign as a blocking `NEGATIVE_AMOUNT` review issue. Ambiguous numeric dates remain pending unless the statement format resolves them.
- Where: `lib/bank-import/parse.ts`, `lib/bank-import/validate.ts`
- Why: Source-faithful staging must not use balance arithmetic or positional guesses to make importable amounts.
- Date: 2026-10-23

### [Component] — Never nest interactive controls inside a `<Link>`
- Rule: A delete/secondary action button must sit OUTSIDE the card's wrapping link. `stopPropagation()` does not stop anchor navigation (that is default behavior, not bubbling), so a button inside `<Link>` "works" its own click into a page navigation — the dialog never opens. Card pattern: `<article><Link>descriptive block only</Link><div>badge, icon buttons, metadata</div></article>`. Keep dialogs fully controlled (`open={state === id}`, mounted per card), never `open={true}` behind a conditional mount.
- Where: `components/bank-import/statement-list.tsx`
- Why: The Upload-history trash icon on /bank-connections silently navigated to the statement detail page instead of opening the delete confirm dialog, so deletion appeared broken.
- Date: 2026-10-23

### [Data] — Deleting a bank statement also undoes its imported transactions
- Rule: `deleteStatementAction` first soft-deletes every imported transaction via `deleteTransaction(userId, txId, "bank_import")` (moved to "Recently deleted", restorable, audit `source: bank_import`); an "already deleted" result is fine, a blocked one (recurring-bill payment, e.g. "A later payment ... depends on this one") aborts with that reason BEFORE any staging row is touched. Then staging lines + statement are hard-deleted in one DB transaction with an audit event whose `afterState` records `importedTransactionsDeleted`. The action ends with `refresh()` like its sibling actions. Never re-block statement deletion on `importedCount > 0`.
- Why: The old action refused deletion for statements with imports ("must remain for auditability") and never revalidated, so the delete icon looked dead and the financial rows stayed; the user explicitly wants delete to undo the transactions it imported.
- Date: 2026-10-23

### [Data] — Read unruled bank PDFs from printed column geometry
- Rule: When a PDF has no drawn table borders, use PDF.js text coordinates and the printed column headers to build seven source fields. Preserve empty columns; assign right-aligned withdrawal, deposit and closing-balance values from their source x bands. Attach only no-date, no-amount continuation text to the previous dated row. Incomplete rows remain pending, and signed negative values stay signed in their source column. The staging DB permits negative or zero source amounts only when they are pending with the matching blocking flag; ready rows require a positive amount.
- Where: `lib/bank-import/pdf.ts`, `lib/bank-import/parse.ts`, `lib/bank-import/validate.ts`, `lib/db/schema.ts`
- Why: Text-only tab splitting shifted blank leading cells and counted amount-bearing continuation fragments as extra transactions; coordinate mapping retained the statement's actual layout.
- Date: 2026-10-24

### [Copy] — Bank upload save failures use one safe message
- Rule: Unexpected upload endpoint failures return the same plain message the upload form uses when it cannot read a response: "The statement could not be saved. Try again." Keep validation, authorization and duplicate errors specific.
- Where: `app/api/bank-connections/upload/route.ts`, `components/bank-import/add-statement-form.tsx`, `lib/bank-import/upload-errors.ts`
- Why: The upload flow must show a useful message for both API 500 responses and network/invalid-response failures without exposing parser or database details.
- Date: 2026-10-24

### [Data] - HDFC footer text is statement furniture
- Rule: Match HDFC footer markers after removing non-alphanumeric characters. Strip a recognized footer suffix from a dated row's narration, then ignore the rest of that page through the next table header. Never classify footer text as transaction content.
- Where: `lib/bank-import/parse.ts`
- Why: PDF extraction may remove spaces and append the final page disclaimer to the last transaction, which can create a false `AMBIGUOUS_ENTRY`.
- Date: 2026-10-24

### [Copy] - Review-save errors name a stale amount constraint
- Rule: When a review update hits SQLSTATE `23514` on `chk_bank_statement_lines_amounts`, tell the manager an admin must update bank import before saving the flagged amount. Log only the SQLSTATE and allowlisted constraint.
- Where: `lib/bank-import/review.ts`, `lib/bank-import/safe-log.ts`
- Why: Migration 0018 is required for edits to pending rows with negative or zero source amounts; a generic retry message hid the missing database update.
- Date: 2026-10-24

### [Data] - Bank-import client creation resolves an existing name before inserting
- Rule: Match active clients in SQL using collapsed whitespace and case-insensitive comparison before inserting. Never apply `LIMIT 1` to an unfiltered client list and compare only that arbitrary row; the normalized-name unique index must not turn reuse of an existing client into a generic creation error. Return whether the client was created or reused, and tell reviewers to save the row after selection to persist its link.
- Where: `lib/bank-import/review.ts`
- Why: An existing client could be visible in `/clients` and the picker while bank-import creation failed because the lookup examined a different client first.
- Date: 2026-10-24
