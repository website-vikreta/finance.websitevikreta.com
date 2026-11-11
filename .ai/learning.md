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

### [Data] - Overlapping statements match on a canonical reference, not exact text
- Rule: Cross-statement duplicate candidates also match on the canonical reference key (`canonicalReferenceKey`: lowercase, separators stripped, only leading zeros stripped, all-zero references are placeholders) + transaction date + signed amount + direction, restricted to the same bank account. Exact content fingerprints stay the first pass; a pair matched by fingerprint is never re-flagged by the canonical pass. Different signed amounts, reversals (opposite direction or negative source sign) and zero/placeholder rows never canonical-match. Match keys are pure (`stagingCanonicalMatchKey`) so SQL only narrows rows by identity columns; the fold lives in TS.
- Where: `lib/bank-import/duplicates.ts`, `lib/bank-import/normalize.ts`
- Why: The two supplied statements print the same reference with and without zero padding (and letters with/without prefix), so overlapping periods were invisible to fingerprint matching; on the real pair, 46/57 overlapping rows matched only through the fold.
- Date: 2026-10-28

### [Data] — Displayed statement period follows row coverage, not the PDF header
- Rule: Every manager-facing statement range (upload-history card, delete dialog, statement summary, overlap warning, duplicate origin detail) renders `periodFrom`/`periodTo`: the min/max of `coalesce(txn_date, value_date)` across the statement's lines, falling back to the stored `statement_from`/`statement_to` header only when no row has a usable date. Compute it at read time so existing statements are fixed without re-upload or a DB backfill; keep the stored header as provenance. All surfaces use `lib/bank-import/period.ts` (`effectivePeriod`, `effectiveStatementPeriod`, `formatStatementPeriod`) so list SQL, detail rows, duplicate SQL and overlap SQL cannot drift.
- Where: `lib/bank-import/queries.ts` (`STATEMENT_BASE_COLUMNS`, `mapSummary`), `lib/bank-import/reconciliation.ts` (`resolveStatementPeriod`, `listOverlappingStatements`), `lib/bank-import/duplicates.ts`, `components/bank-import/statement-list.tsx`, `components/bank-import/statement-detail.tsx`, `components/bank-import/reconciliation-card.tsx`
- Why: A one-page extract can carry the six-month header period while containing only two months of rows; both uploads then appeared to cover 1 Apr → 20 Oct even though one was 7 Apr → 25 May. Row coverage is the honest range of the uploaded statement and also stops false overlap warnings.
- Date: 2026-11-06

### [Data] - CSV date cells are text-forced ISO, never spreadsheet dates
- Rule: Every date cell in every CSV export (ledger, clients, reports) is written through `dateCell` (`lib/transactions/csv.ts`): strict `YYYY-MM-DD` (trimmed slice, non-dates and nulls pass through / fallback) prefixed with a single leading space, then quoted like any other cell. Never feed raw ISO (`c.firstSeen`) or `formatDate` output into a CSV date column.
- Where: `lib/transactions/csv.ts` (`toCsv`, `dateCell`), `lib/clients/csv.ts`, `lib/reports/csv.ts`
- Why: Excel auto-converts plain date-looking strings into date cells and shows `######` at its default column width (plus regional re-formatting), so managers saw broken-looking dates on clients/ledger/reports CSVs. The leading space keeps the cell text in every spreadsheet (Excel, Sheets), preserves exact values for old and new rows, and ISO still sorts chronologically.
- Date: 2026-10-26

### [Data] — One selection drives two batch actions in the review table
- Rule: The checkboxes in the statement review table select for two batch actions: `Import selected (n)` counts only the importable subset (ready, or imported with a deleted transaction) and `Duplicate (n)` counts only the review-editable subset (pending/ready, same gate as the row editor's "Mark duplicate"). Disabled count = 0 for each. The two confirm flows are mutually exclusive (`importStage` / `duplicateStage` in {idle,confirm,running}); checkboxes and row/restore buttons disable on `batchBusy` = either stage running. Batch results appear in their own dismissible panel; successful rows leave the selection, blocked rows stay for retry.
- Where: `components/bank-import/review-table.tsx`, `app/bank-connections/actions.ts` (`markLinesDuplicateAction`), `lib/bank-import/review.ts` (`markLinesDuplicate`, `bulkDuplicateDecision`, `BULK_DUPLICATE_NOTE`, `MAX_DUPLICATE_BATCH` = 100 mirroring `MAX_IMPORT_BATCH`)
- Why: Marking 57 duplicate-candidate rows one by one was impractical; the selection already existed and needed to answer both "what imports?" and "what can be marked duplicate?" from one set.
- Date: 2026-10-29

### [Data] — Missing statement balances derive from the row balance chain, display-only
- Rule: When `bank_statements.opening_balance`/`closing_balance` are null, `reconcileStatementDetail` fills them from the per-row printed balances: closing = the last row (page/row order) with a printed balance; opening = the statement's FIRST row only, and only when that first row carries a printed balance and one countable amount (`opening = balance − (deposit − withdrawal)`). A later row would only know its own before-row balance, which is not the statement opening. Derived values show as info notes ("Opening balance derived from the first row's printed balance."), never as warnings, and nothing is written back — staging rows keep their source of truth, so existing statements are fixed without a re-upload. Rows without exactly one countable amount no longer block the whole balance check; the status turns `unbalanced` with the usual "N rows cannot be counted" explanation.
- Extension (2026-11-03, same evidence class): an uncountable row's movement is derived exactly from two consecutive printed balances (`balance = previous printed + this row's movement`, same balance-after chain as the opening derivation) instead of being excluded — only when the chain is dense since the last printed balance (a countable row WITHOUT a printed balance already had its movement counted from the amount; deriving a span over it would count it twice, so that span stays excluded). Derived totals join the check as `derivedMovement` (+ `derivedMovementCount`), note: "Movement of N row(s) taken from the printed balance chain (X net); their amount cells are not countable." (absolute value shown). `invalidLineCount` = rows still excluded (no anchor / dirty span). Closed the real case where the single pending NEGATIVE_AMOUNT row's +209.74 printed movement made 8,20,923.08 counted vs 8,21,132.82 declared look "Unbalanced ₹209.74" — the row is now chain-counted and the statement balances, while the "1 line still needs review" warning stays.
- Where: `lib/bank-import/reconciliation.ts` (`deriveBalancesFromRows`, `classifyMovements`, `StatementReconciliation.derivedMovement`/`derivedMovementCount`/notes), `components/bank-import/reconciliation-card.tsx` (notes rendering), tests `lib/bank-import/__tests__/reconciliation.ts` (10 checks, real-shape case first)
- Why: The printed balance chain is source data, not a guess — excluding a row whose movement two printed balances pin exactly produced a false "Unbalanced" warning on the reviewer's real statement.
- Date: 2026-10-29 (extended 2026-11-03)

### [Data] — /bank-connections reopens the section's last visited screen (per browser)
- Rule: The section remembers the exact screen a reviewer last visited — the list or one specific statement id — in browser localStorage (`finance.bank-connections.section`, helpers in `lib/bank-import/section-memory.ts`). Visiting `/bank-connections/<id>` (any status: review, importing, completed history) writes `{kind:"statement",statementId}`; a list visit — including the review page's back link, `/bank-connections?list=1` — writes `{kind:"list"}`. Opening `/bank-connections` without `?list=1` resumes that remembered screen through `components/bank-import/section-entry.tsx`: the client component validates the remembered id against the live statement id set and `router.replace`s to it; a stale/deleted id is forgotten and the list shows. `?list=1` always forces the list and re-remembers it. No DB query drives the resume (`getLatestOpenStatement` was removed) and no banner is rendered.
- Where: `lib/bank-import/section-memory.ts`, `components/bank-import/section-entry.tsx` (`BankConnectionsEntry` + `TrackStatementVisit`), `app/bank-connections/page.tsx`, `app/bank-connections/[id]/page.tsx`
- Why: Reviewers alternate between the ledger screens and several statement reviews; deciding server-side ("most recently updated open statement") landed them on the wrong PDF or bounced them off a list visit they had chosen. Last-visited memory matches intent exactly, is per-device, and needs no extra server round-trip.
- Pitfalls (keep): (1) Never `redirect()` inside this section's streamed (partial-prerendered) segment — a streamed NEXT_REDIRECT makes Next emit an MPA navigation: a full sidebar-click page reload; all resume/navigation here is client-side (`router.replace` / `<Link>`). (2) The memory is an external store — read it via `useSyncExternalStore` (snapshot cached in `section-memory.ts`; `hydrating` sentinel during SSR/hydration, skeleton until then); calling `setState` directly inside an effect breaks `react-hooks/set-state-in-effect`.


### [Data] — /analytics periods are window pairs (current + same-length previous), IST-driven

- Rule: The analytics page computes every metric from window pairs: `lib/analytics/range.ts` (pure, no clocks) turns `todayInIndia()` into month/quarter/FY windows — FY via `financialYearStart`/`fyBounds` (Apr–Mar, "2026-27"), quarters are CALENDAR quarters (same as `PERIODS.quarter`); custom ranges get a same-length window ending the day before. All 8 buckets (selected+prev, month/q/FY+prev) totals come from ONE query (`analyticsRangeTotals` in `queries.ts`, FILTER + `sql.raw` aliases); months between a range use `monthlyTotalsBetween` (zero-filled, oldest first); breakdowns reuse `expenseBreakdown`/`incomeBreakdown` (now accept an optional inclusive `to`). Growth rules live in `growth()`: 0/0 → flat, 0→positive → "new" (no %), +→0 is a true −100%, and pct is withheld when a value is negative or crosses zero; `profitMargin` returns null on income ≤ 0. Expense rises tone `bad` (rising spending, not good news). Money text is never `text-income` (design-system rule); profit negative → `text-destructive`.
- Where: `lib/analytics/range.ts`, `lib/analytics/overview.ts`, `lib/transactions/queries.ts` (`analyticsRangeTotals`, `monthlyTotalsBetween`, `transactionExtremes`, optional `to` on breakdowns), `app/analytics/page.tsx`, `components/analytics/analytics-view.tsx`, `components/layout/sidebar.tsx` (Analytics nav item), test `lib/analytics/__tests__/range.ts` (`npm run test:analytics`)
- Why: Previous windows must mirror the current window exactly; percent claims around zero otherwise mislead ("−300%" crossing into loss). A single grouped query keeps the page at ~5 read-only round trips total.
- Date: 2026-10-30

### [Data] — Year dropdowns are financial years (Apr–Mar), keyed on the FY start year
- Rule: Every month-scoped year dropdown (dashboard "Income vs expenses" `/api/reports/monthly?year=`, reports "Monthly summary") keys on and passes the FY START year (Apr`Y`–Mar`Y+1`), and renders it through `financialYearLabel` as "2026-27". `transactionYears()` returns those start years via `extract(year FROM txn_date - interval '3 months')`; `monthlyTotalsForYear(fyStart)` generates Apr `Y` → Mar `Y+1` (oldest first). Date→FY mapping lives in `lib/transactions/period.ts` (`financialYearStart`, `financialYearLabel`), mirroring `financialYear()` in `lib/invoices/math.ts` (invoice numbering keeps its own helper); an entry dated 10-Dec-2024 → "2024-25", 12-Apr-2025 → "2025-26", 31-Mar closes the old FY before 1-Apr opens the new one. Never present a calendar year (Jan–Dec) in these dropdowns, and never label with the terminal year (`2027`) — the label comes from the start year only.
- Where: `lib/transactions/period.ts` (finYear helpers), `lib/transactions/queries.ts` (`transactionYears`, `monthlyTotalsForYear`), `app/dashboard/page.tsx`, `app/reports/page.tsx`, `app/api/reports/monthly/route.ts`, `components/dashboard/trend-chart.tsx`, `components/reports/monthly-table.tsx`, `lib/reports/csv.ts` (CSV header prints "(2026-27)"), tests `lib/transactions/__tests__/fiscal-year.ts` (`npm run test:fiscal-year`)
- Why: The site follows the Indian financial year (1 April – 31 March); a calendar-year dropdown split every FY across two options and mis-sorted months. Keeping the API contract a 4-digit year (the FY start) avoided breaking `/api/reports/monthly` while the label change is presentation-only.
- Date: 2026-10-30

### [Component] — Analytics fixed-period trio card (This month / quarter / FY)
- Rule: Card header = `text-title-sm text-foreground` title + right-aligned period chip (`rounded-full bg-muted px-2.5 py-1 text-caption text-muted-foreground`, shrink-0). Window figures = `font-mono text-title-sm tabular-nums` (label below, `text-caption text-muted-foreground`), previous-window figures = `text-body-sm` muted on the same grid. Money colors are ledger semantics: Income `text-success`, Expenses/Profit `text-foreground`, Profit `text-destructive` when negative. Delta note = inline-flex badge with the DESIGN.md KPI underline (`border-b-2 border-primary` good / `border-destructive` bad / `border-border` neutral) + lucide direction icon (`ArrowUpRight`/`ArrowDownRight`/`ArrowRight`, size-3.5, aria-hidden). No sign prefixes on figures.
- Where: `components/analytics/analytics-view.tsx` (`ComparisonCard`)
- Why: The trio was visually flat but correct; this upgrades reading order + hierarchy with zero data/flow changes.
- Date: 2026-11-02

### [Component] — Net profit trend: dedicated tooltip + zero baseline, ink stroke
- Rule: The analytics net-profit line chart uses its own `NetProfitTooltip` — a LineChart payload only carries `net`, so the tooltip reads income/expense from `payload[0].payload` (the plotted datum) instead of rendering payload-derived 0s; net value tone: `text-success` >0, `text-destructive` <0. `ReferenceLine y={0}` in `var(--hairline-strong)` anchors profit/loss regions. Stroke is `var(--foreground)` (ink) with matching dots — yellow stays reserved for the income series; net is neither income nor expense. Chart tooltips print buckets via `tooltipLabel` ("Oct 2026", never raw "2026-10").
- Where: `components/analytics/analytics-view.tsx` (`NetProfitTooltip`, `tooltipLabel`, net section)
- Why: Hover on the old "Net movement trend" showed Income ₹0 / Expenses ₹0 because the shared income/expense tooltip found no matching payload keys; the line also needed an honest net-profit framing.
- Date: 2026-11-02

### [Data] — /analytics "Yearly growth": per-FY totals, FULL previous-FY comparison
- Rule: The section compares EVERY financial year on record (FY = `extract(year FROM txn_date - interval '3 months')`, same rule as `transactionYears`). ONE grouped read query (`yearlyAnalyticsTotals()` in `lib/transactions/queries.ts`) returns per FY: income/expense/counts. Pure assembly lives in `lib/analytics/yearly.ts` (`buildYearlyRows`: profit via `netProfit`, margin via `profitMargin`, growth via `growth`) and is offline-tested (`npm run test:yearly`, wired into `npm run test` after `test:analytics`). Growth compares the previous CONSECUTIVE FY's FULL April–March totals — the running year included (owner decision 2026-11-02: full-FY comparison beats same-span fairness for this page; the running year's percent simply improves as the year records money). Gap years and the oldest FY never claim a percent (`fyStart − 1` must be on record → "—"); zero baselines read "New"; equal profits read "0.0%"; negative baselines print the compact absolute move — via `yearlyGrowthCellText`/`yearlyGrowthCellSub`/`yearlyGrowthCellTone`. The growth cell shows the percent (or "New") with a micro sub-line carrying the EXACT money move (e.g. "+810.4%" over "+₹2.03L"); `yearlyGrowthCellSub` returns null when the cell text already is an amount or nothing moved. UI: `components/analytics/yearly-growth.tsx` — bar chart (Money in/Out, `var(--income)`/`var(--expense)`, datum-read net-profit tooltip) + newest-first table (FY, money right-aligned mono tabular, margin 1dp or "—", tone-colored growth cell with `title` = `vs FY <label>, full April–March totals`, Entries). No "Till <month>" chip — removed with the same-span slice. Reads are one extra server round trip fetched in `Promise.all` with the overview in `app/analytics/page.tsx`.
- Where: `lib/transactions/queries.ts` (`yearlyAnalyticsTotals`), `lib/analytics/yearly.ts`, `lib/analytics/overview.ts` (`getYearlyGrowth`), `app/analytics/page.tsx`, `components/analytics/yearly-growth.tsx`, `components/analytics/analytics-view.tsx` (renders between the fixed-period trio and the trend charts)
- Why: Managers need the multi-year story (Apr–Mar FYs) with immediately comparable exact values; keeping assembly pure keeps every growth edge case testable without a DB.
- Verified against the real DB (read-only, temp script deleted after): the only two FY 2025-26 entries are dated 1 Feb 2026 (₹15k out) and 15 Feb 2026 (₹40k in). Under the original same-span design "New" on FY 2026-27 was mathematically correct (both entries fall after the 2 Nov 2025 boundary). The owner then chose FULL-FY comparison instead — the same-span slice machinery was removed the same day; with full-FY the running FY 2026-27 reads +810.4% (+₹2.03L) vs FY 2025-26's ₹25,000 profit, exactly the number a manual check produces. Keep this decision if asked to "fix" a surprisingly large running-year percent: it is deliberate, and the cell sub-line shows the money move that backs it.
- Date: 2026-11-02

### [Component] — /analytics "This year" hero band: the FY's shape — pace, milestone, rhythm, money strip
- Rule: Sits directly under the period tabs, before the KPI grid — the one block that faces the current FY's BEHAVIOUR, not period-scoped totals and not a repeat of the dashboard (owner approved hero placement). Header: "This year" + yellow `--primary` mono badge (`APR26-MAR27`, from the FY start year), right micro line `Day N of 365 · M days to go` ("the year closes today" on the last day). Everything re-anchors itself every 1 April: bounds via `fyBounds(financialYearStart(today))`, `daysIn` from day math across them (366 across a leap February), `daysUsed` clamped 1..daysIn. Server component — native `title` tooltips, zero client JS, recharts-free.
- Story copy: ≤2 sentences, plain voice. Sentence 1 always reports money since 1 April (in/out/kept). The insight follows the priority: milestone passed → "already earned more than FY <prev> did all year" (income above) / "matched <prev>'s full-year income" (exact equality); else all-months-profitable (≥2 months) → "All N months so far have stayed profitable."; else best month → "<Mon> was the strongest month, netting …". Fall-through matters: a milestone still below the bar must hand the spotlight to the rhythm insight — an else-if chain swallowed it once and the offline suite caught it.
- Stats: (1) "At this pace" — year-to-date day-rates (÷ daysUsed) × daysIn, labelled as a projection ("projected money in by 31 Mar <year>", micro `₹x in · ₹y out a day`); null when nothing is recorded. (2) "Milestone" — income YTD vs the previous FY's FULL Apr–Mar income; % uncapped, passed at ≥100%; the bar caps at 100 visually; pct null when the previous FY earned nothing; whole block "—" when the previous year isn't on record. (3) "Profit rhythm" — profitable count of elapsed months, running month included; best month, ties → earliest. (4) "Last money in" — most recent income date across the WHOLE ledger (`lastIncomeDate()` = max(txn_date), one tiny read), daysAgo clamped ≥0 so future-dated entries never go negative.
- Money strip: 12 Apr→Mar cells; colour = net sign via tokens ONLY — `var(--success)` kept / `var(--destructive)` lost / `var(--muted)` flat, inline style, opacity 0.35..0.95 scaled by |net| ÷ max|net| of the year; future months hollow (`border-dashed border-border`), current month `ring-foreground/40`, labels (page spelling, "Sept") appear ≥ @2xl; `role="img"` aria-label describes the encoding; flat months admit "no movement recorded", future promise "no money recorded yet".
- Where: `lib/analytics/this-year.ts` (pure `buildThisYear` + `thisYearBadgeLabel`; cell titles composed there, testable), `lib/analytics/overview.ts` (`getThisYear` — 3 parallel reads, never null, empty year stays an honest zero state), `lib/transactions/queries.ts` (`lastIncomeDate`), `components/analytics/this-year.tsx`, `components/analytics/analytics-view.tsx` (prop `thisYear`, renders between tabs and the KPI grid), `app/analytics/page.tsx` (Promise.all member + skeleton band), test `lib/analytics/__tests__/this-year.ts` (`npm run test:this-year`, master chain after `test:yearly`; 14 checks, hand-summed fixture: 8,64,000 in / 4,32,000 out over day 216/365 → ₹4,000/₹2,000 a day → 14,60,000/7,30,000)
- Pitfalls (keep): (1) `formatINR` compact prints non-integer lakhs at FIXED 2dp — "₹1.40L", never "₹1.4L"; thousands go 1dp only when needed ("₹40k"). (2) Apostrophes in JSX text need `&apos;` (react/no-unescaped-entities). (3) Story insights need if + `if (insight === null)` re-check, not one else-if chain. (4) MonthTotals.month is "YYYY-MM-01" — compare/state via `.slice(0, 7)`.
- Why: Every other block answers "how much in this scope"; this one answers how the year is MOVING — pace, progress behind the previous full year, streaks and cadence — and it must survive 1 April with no code change.
- Date: 2026-11-02

### [Data] — Server-side PDF libraries load lazily, never inside a page graph
- Rule: `lib/bank-import/pdf.ts` must NEVER import `pdf-parse` or `pdfjs-dist` at module scope. One cached loader (`loadPdfLibrary`) first installs guarded, inert `DOMMatrix`/`Path2D`/`ImageData` globals, then dynamically imports both libraries in a single cached promise that resets on rejection. Limit constants (`DEFAULT_MAX_BYTES`, `DEFAULT_MAX_PAGES`) live in `limits.ts`; `limits.ts` must never import a parser module — it feeds server page renders. `next.config.ts` keeps `serverExternalPackages: ["pdf-parse", "pdfjs-dist"]` (real runtime requires, never bundled). Library errors are mapped by `error.name` (every pdfjs exception sets it), never by module classes; the pdf suite synthesizes them locally instead of importing the vendor.
- Where: `lib/bank-import/pdf.ts` (`loadPdfLibrary`, `installPdfRuntimeGlobals`, `mapPdfError`), `lib/bank-import/limits.ts`, `next.config.ts`, `lib/bank-import/__tests__/pdf.ts`
- Why: pdfjs legacy `pdf.mjs` evaluates `new DOMMatrix()` at module top scope (`SCALE_MATRIX`) and normally polyfills the DOM globals from `@napi-rs/canvas` (pdf-parse's transitive dep). A normal local install has the canvas binary so local always worked, but the Netlify function bundle resolved `node_modules` without it and evaluation crashed — `ReferenceError: DOMMatrix is not defined` → `Failed to load external module pdf-parse-…` → `failed to pipe response` — for every request sharing the chunk; this was the long-running /bank-connections deployment failure (seen 2026-10 → resolved 2026-11-02). Text extraction never renders a page, so inert globals are safe; when canvas IS installed, pdfjs still requires it (harmless) but the existing globals are not overwritten, and parsing behaviour is unchanged.
- Verified: deployment simulation (block `@napi-rs/canvas` resolution, no other change) reproduces the exact crash pre-fix and passes the full pdf suite (13/13) post-fix; zero pdfjs strings bundled in `.next/server` post-build (only `[externals]_*` load-on-demand chunks, referenced solely by the upload route).
- Date: 2026-11-02

### [Data] — Bank-import duplicates: strict identity + deterministic evidence, never amount+date alone
- Rule: Ledger duplicate candidates match ONLY on strict identity — exact `t.txn_date = l.txn_date`, exact direction (`type_id` from line direction), exact `t.amount_inr`, and `original_currency = 'INR'` — exactly like the staging canonical key. The old ±3-day `transaction_near` window is GONE: a different day is a different transaction. Identity alone is never a duplicate — `duplicate-evidence.ts` (`pure, no DB`) weighs wording: `compareBusinessTexts` (lowercase/punct/boilerplate-suffix/IFSC-UTR(≥5-digit run)/rail(NEFT/IMPS…)/legal-suffix/self-name("website","vikreta") folding, then token sets → strong = containment with a ≥5-char token in the absorbed side; moderate = ≥2 shared tokens UNLESS both sides keep a ≥4-letter named divergence, or a single named token that is each side's only distinctive; none/unknown otherwise) + client/category corroboration (`agree` never decides alone, `conflict` → review) → severity `strong | review | possible`; ≥2 strong candidates for one line fold ALL to review (`resolveAmbiguousCandidates`). Labels are engine-built badge text: `Duplicate · Manual Entry · date` (manual→Manual Entry, chatbot→Finance AI, bank_import→Previous Statement when it has an origin file / Bank Statement Import otherwise, unknown→Other Source), `Duplicate Candidate · Same Statement/Earlier Statement · date` (staging pairs), `Duplicate? · Needs review · <source · date>` (review severity), `Possible dup · <source · date>` (advisory), `Already Imported · This Statement` (UI-derived from `line.status==="imported" && line.importLive`). Narration/reference text never enters a label or detail.
- Where: `lib/bank-import/duplicate-evidence.ts` (pure: `normalizeBusinessText`, `meaningfulTokens`, `compareBusinessTexts`, `evaluateTransactionCandidate`, `resolveAmbiguousCandidates`, `importDuplicateBlockError`, `NOT_A_DUPLICATE_FLAG`, `stagingBadgeLabel`, `transactionBadgeLabel`), `lib/bank-import/duplicates.ts` (`findLedgerCandidatesForLine(executor, line)` shared by review/ack/import), `lib/bank-import/__tests__/duplicates-evidence.ts` (28 offline checks, `npm run test:bank-import` after `duplicates.ts`)
- Why: The old engine flagged any same-day same-amount pair as a strong duplicate (the "two legitimate ₹500 payments" false positive) and hid WHERE the match lives. The reviewer must see the ledger source of every candidate; weak similarities must stay importable; reviewer-edited descriptions must re-rank matches (the save→`refresh()`→`findDuplicateCandidates` flow already re-reads saved review values).
- Gotchas (keep): (1) HMR-safe determinism: the same inputs always decide the same — no thresholds beyond exact token equality. (2) Ledger candidates EXCLUDE transactions linked to lines of the same statement (`NOT EXISTS`), so same-statement double-entry needs its own import-time check (`findSameStatementImportedContent` in `import.ts`: fingerprint OR `stagingCanonicalMatchKey` equality vs other `status='imported'` rows of THIS statement). (3) `evaluateTransactionCandidate` reads the ledger text as `description ?? clientNameSnapshot ?? clientName` (income may have no description). (4) A line-specific wording pair like "Rent to Landmark Estates monthly" vs "Rent to Landmark Estates" is CONTAINMENT-strong, not moderate — moderate lives with short-token sets with no ≥5-char absorbed token.

### [Data] — Import-time duplicate gate + the reviewer's audited "Not a duplicate" decision
- Rule: `importOneLine` reruns duplicate validation INSIDE its DB transaction after the invoice guard, before idempotency: (a) same-statement imported-content check (see above), (b) `findLedgerCandidatesForLine(tx, line)` → `importDuplicateBlockError(evidence, line.flags)` — `strong`/`review` block THAT row with a per-row reason naming the source+date ("Duplicate · Manual Entry · 2026-04-11 — this money is already recorded…"), `possible` never blocks ("two recurring ₹500s" import). The reviewer can lift the block per line with the "Not a duplicate" editor button (shown only while a strong/review candidate exists), which persists the NON-blocking flag `NOT_A_DUPLICATE` in `bank_statement_lines.flags` via `acknowledgeLineNotDuplicate` (review.ts) — it recomputes candidates in-transaction and refuses when none needs a decision, audits `duplicate_acknowledged`, leaves status untouched and never writes financial data. Batch results stay per-row: one blocked duplicate never prevents independent rows from importing.
- Where: `lib/bank-import/import.ts` (`findSameStatementImportedContent`, gate inside `importOneLine`, `FLAG_PATTERN` + `NOT_A_DUPLICATE`), `lib/bank-import/review.ts` (`acknowledgeLineNotDuplicate`, `isLineFlag` regex), `lib/bank-import/types.ts` (`LINE_FLAGS` only — NOT `BLOCKING_LINE_FLAGS`), `app/bank-connections/actions.ts` (`acknowledgeLineNotDuplicateAction` + `refresh()`), `components/bank-import/review-table.tsx` (three-severity badge styles, already-imported badge, decision button)
- Why: Bulk/individual/retry paths must share one server-side check so two admins or two uploads cannot double-enter money, while false positives need an explicit, audited escape hatch instead of a silent import or silent rejection.
- Limitation (report honestly): DB-backed suites (review-db/upload-db/import-db/financial-integration-db) are `TEST_DATABASE_URL`-gated and were SKIPPED — in-transaction visibility, locking and idempotency are designed per existing patterns but not DB-verified in this session.
- Date: 2026-11-05

### [Component] — Completed statements show Business Description immediately after Narration
- Rule: `getStatementDetail` selects the imported transaction's saved description (`t.description AS "transactionDescription"` via the line's own `transaction_id` join) and `statement-detail.tsx` renders the new `Business Description` column with `businessDescriptionText(line)`: staging `businessDescription` first (trimmed), then the imported transaction's saved description, then "—". Never regenerated, never rewrites the Narration column; applies equally to historical completed statements, failed/cancelled ones and new uploads.
- Where: `lib/bank-import/queries.ts` (`StatementLineRow.transactionDescription`), `components/bank-import/statement-detail.tsx`
- Why: Managers read business meaning, not raw bank narration, when auditing completed statements; the fallback keeps pre-Business-Description historical rows readable without inventing text.
- Date: 2026-11-05

### [Data] — Completed statement exports: same detail, full nine columns, landscape PDF
- Rule: Export actions render only when `statement.status === "completed"`, in the page `PageHeader` inside the page's `print:hidden` wrapper: an outline `Export CSV` button plus the shared `ExportPdfButton`. PDF is a print-only `PrintStatement` (`print-document print-bank-statement hidden print:block`) using `PrintSection`/`PrintTable` (same title, yellow status badge, yellow-ruled headings, black-header table) — Summary first, then `Statement rows (n)`. Both export surfaces carry exactly nine columns in this order: Date, Narration, Business Description, Withdrawal, Deposit, Balance, Classification, Flags, Status — never truncated, never abbreviated. Labels come from `LINE_STATUS_LABELS` / `CLASSIFICATION_LABELS` (never raw codes), descriptions from `businessDescriptionText`, flags from `flagsText` (joined `; `, `—` when empty). A4 LANDSCAPE via named `@page bank-statement { size: A4 landscape; margin: 0 }` + `.print-bank-statement { page: bank-statement }`; do not switch to portrait with fewer columns. Shared `PrintTable` cells use `break-words` so long unbroken narration wraps instead of overflowing the printable width. CSV (`toStatementCsv`) writes exact stored decimal strings for the three money columns (no formula-prefix guard, so negatives stay numeric), `dateCell` (leading-space ISO, `—` fallback), BOM, and the same full labels so it cannot drift from the PDF.
- Where: `components/bank-import/print-statement.tsx`, `components/bank-import/statement-export-actions.tsx`, `lib/bank-import/display.ts`, `lib/bank-import/csv.ts`, `components/bank-import/statement-detail.tsx` (renders the print document; hides the screen with `print:hidden`), `app/bank-connections/[id]/page.tsx` (header action), `app/globals.css`, test `lib/bank-import/__tests__/export.ts`
- Why: Managers need the completed statement as a shareable record. Nine columns with a full narration and a full business description do not fit A4 portrait, and dropping columns silently would make the PDF disagree with the screen and the CSV. One shared detail object + shared label/display helpers keeps all three in sync.
- Date: 2026-11-11

### [Component] — Review-table duplicate badge tones, contained badges, and Convert − to + UI
- Rule (tone, `duplicateBadgeTone` in `review-table.tsx`): confirmed ledger duplicates (severity strong on kind `transaction_exact` or `imported_before` — "Duplicate · Manual Entry / Finance AI / Previous Statement · date") render GREEN (`border-success/40 bg-success/10 text-success`); staging pairs (`same_statement_row`, `other_statement_row`) keep the warning tone; `Duplicate? · Needs review` stays destructive; `Possible dup · <source> · <date>` stays muted. Badge `title` = "`<label> — <detail>`" so folded labels stay recoverable.
- Rule (no overlap): staging badges live in the Narration cell; a long label must never paint over the Business Description column. Badge classes `h-auto min-h-5 max-w-full whitespace-normal text-left` (tailwind-merge strips the primitive's `h-5`/`whitespace-nowrap`), container `min-w-0 flex-wrap`, and both cells carry `overflow-hidden align-top`.
- Rule (Convert − to +, now shipped in `releases/2026-11` from `fix/bank-import-pdf-upload` @ 84a8f8c): pending rows flagged `NEGATIVE_AMOUNT` with exactly one amount side flip sign via `convertPositiveDecision` + `convertLinesPositive` (review.ts; exact `decimalNegate`, flag dropped, fingerprint recomputed, revalidated like a review save — valid rows go `ready`, rest stay pending; per-row failures; audited `positive_converted`). UI: bulk "Convert − to + (n)" with inline confirm + result panel (mutually exclusive with Import/Duplicate), per-row "Convert to +" in the editor, negated staging amounts printed `text-destructive`. Client-side `isConvertiblePositive` mirrors the policy.
- Why: The reviewer could see negative `-₹` amounts with no way to fix them. The convert feature and the PDF-worker/`PARSER_UNAVAILABLE` packaging now arrive together from `releases/2026-11`.
- Verified: `test:bank-import` offline all green (review suite 41 → 53 checks), tsc + scoped eslint clean, `npm run build` clean.
- Date: 2026-11-05

### [Architecture] — Dead imports block completion; reopen rescue for existing statements
- Rule (completion): a statement may claim `completed` only when NO line is `pending`, `ready` or `error` — AND no imported line has lost its ledger transaction (`deadImports = 0`). `loadUnresolvedCounts` left-joins `transactions` and counts `status='imported' AND deleted_at IS NOT NULL`; a dead import is unresolved, never a settled row. Live `imported` + `skipped` + `duplicate` may sum to the total. The single completeness write is `finalizeStatementStatuses(tx, statementId, from)` in `lib/bank-import/statement-sync.ts` (NEW): counts the unresolved lines, sets `status = completed|review`, `completed_at = coalesce(completed_at, now())` on complete, scopes the transition via `WHERE status IN (from)`, and refreshes `updated_at` in the same write. Review decisions (`skipLine`, `markLineDuplicate`, `markLinesDuplicate`) call it with `from=["review"]`, so `9 imported / 0 skipped / 5 duplicate` of 14 rows completes the statement at the LAST decision — no import batch needed; the import batch path delegates through `finalizeStatement` (crash-recovery semantics kept, `from=["importing"]`).
- Rule (ledger sync, same module): `deleteTransaction(..., syncStatement = true)` runs `syncStatementForDeletedTransaction` inside its own transaction — a bank-import transaction deleted from /transactions demotes ONLY a `completed` statement to `review` (audited `review_reopened`); `restoreTransaction` runs `syncStatementForRestoredTransaction` — an open statement with nothing unresolved re-completes (audited `statement_completed`). `deleteStatementAction` passes `syncStatement=false` (it deletes the staging rows right after, so the demote is noise). Wire failures bubble → the ledger delete/restore rolls back with its statement.
- Rule (legacy rescue for existing statements): `reopenStatementWithDeadImports` + `reopenStatementAction` + `ReopenStatementButton` (`components/bank-import/reopen-statement.tsx`) — a `completed` statement whose imports were deleted before this sync existed returns to review from the detail screen's warning banner ("N imported rows deleted in the ledger"); audited `review_reopened` via `manual_reopen` with the dead count. The page's one-time reconcile (`app/bank-connections/[id]/page.tsx`) must also skip statements with a dead import, otherwise the reopened statement is instantly re-completed and the review screen never appears. Per-row truth marks: "Import deleted" (dead import) and "Edited in ledger" (live import whose `t.payload_hash` drifted from the line's `imported_payload_hash` — `postImportEdited` in `queries.ts`; rows without a stored hash never claim it) in both the review table and the statement detail screen.
- Why: review-side-only decisions (skip/duplicate) used to leave a fully-accounted statement stuck in `review` forever, hiding the completed summary; and a ledger deletion could leave a `completed` claim over vanished data.
- Merged coverage: 0395d2f's reconciliation balance-chain derivation and its suite arrive via `releases/2026-11`; `test:bank-import` wires both `reconciliation.ts` and `statement-sync.ts`.
- Verified: offline suites green (statement-sync 7 checks; review 53; import 15; others unchanged), tsc + scoped eslint clean, `npm run build` clean. DB-backed suites remain SKIPPED without `TEST_DATABASE_URL`.
- Date: 2026-11-05

### [Data] — Deployed Node functions must trace pdfjs's dynamically-imported runtime assets
- Rule: `next.config.ts` `outputFileTracingIncludes: { "/api/bank-connections/upload": [...] }` must carry exactly `node_modules/pdfjs-dist/legacy/build/{pdf.mjs,pdf.worker.mjs}`, `pdfjs-dist/package.json`, `pdfjs-dist/{standard_fonts,cmaps,wasm,iccs}/**`, `pdf-parse/dist/pdf-parse/esm/**` and `pdf-parse/package.json`. It must NOT carry `@napi-rs/canvas` (text extraction never renders; the inert globals cover module eval). Verify after every `next build` by grepping `pdfjs-dist|pdf-parse` paths in `.next/server/app/api/bank-connections/upload/route.js.nft.json`.
- Where: `next.config.ts`, `lib/bank-import/pdf.ts`, build check on `.next/server/app/api/bank-connections/upload/route.js.nft.json`
- Why: In Node, pdfjs sets `GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs"` (pdf.mjs L21179) and imports it RELATIVE to pdf.mjs's own file (L21368); Node's file trace follows imports only, so the deployed function got `pdf.mjs` but `./pdf.worker.mjs` was absent → fake-worker setup rejected (`Setting up fake worker failed: "…"`, pdf.mjs L21328) → every upload answered "This file is not a readable PDF". After tracing, the worker lands adjacent to pdf.mjs and the relative import resolves — no `GlobalWorkerOptions.workerSrc` pinning needed.
- Date: 2026-11-03

### [Data] — Parser infrastructure failures answer PARSER_UNAVAILABLE, never INVALID_PDF
- Rule: Content errors keep their codes (pdfjs `InvalidPDFException`/`FormatError` → INVALID_PDF; `PasswordException` → password codes). Host errors are a different class: a failed library load → `PARSER_UNAVAILABLE` thrown at the load site (`extractPdfText`), and pdfjs's fake-worker wrap `Setting up fake worker failed: "<reason>".` (plain `Error` name) → matched by message in `mapPdfError` → `PARSER_UNAVAILABLE`. `SAFE_ERROR_CODES` carries the code; the upload route maps it to HTTP 503 ("server side, retryable") so the reviewer is never told their file is unreadable. Unknown non-worker shapes stay INVALID_PDF. A degraded (non-fatal) runtime fallback logs `[bank-import] pdf parser runtime failure {stage, errorName}` — stage ∈ {library-load, pdfjs-spatial} — never the message (it embeds paths/document fragments).
- Where: `lib/bank-import/types.ts` (`SAFE_ERROR_CODES`), `lib/bank-import/pdf.ts` (`mapPdfError`, `logPdfRuntimeFailure`, loader seam `PdfLibraryLoader` on `extractPdfText(data, options, loadLibrary)`), `app/api/bank-connections/upload/route.ts` (`normalizeError` → 503), tests `lib/bank-import/__tests__/pdf.ts`
- Why: The deployed fake-worker failure surfaced as 422 INVALID_PDF for months because one catch-all rebranded every error; operators had no signal at all since nothing was logged. Classification by the wrap signature is safe: its reason text names import paths, never document content.
- Date: 2026-11-03

### [Data] — /bank-import "Convert − to +" flips flagged negative staging amounts to positive
- Rule: `convertPositiveDecision` (pure) converts only when the line is `pending`, the statement is in `review`, flags contain `NEGATIVE_AMOUNT` and EXACTLY one amount side is filled holding a negative value; zero (`skip` instead), positive, both-sides and no-side rows are per-row rejections. `convertLinesPositive` (bulk, cap `CONVERT_MAX_BATCH` = 100, one locked transaction with `.for("update", { of: [lines, statements] })`) negates via `decimalNegate`, drops the flag, RECOMPUTES the fingerprint (amount changed), then gates like a reviewer save (`validateLineForImport` + `validateImportDirection` with `effectiveLineFlags`): fully valid → status `ready` with `reviewedBy`/`reviewedAt`, otherwise stays `pending` with its remaining blockers. Per-row failures come back as counted failures; audit action `positive_converted` stores staging state only (no amounts/narration). UI: a third selection subset `selectedConvertIds`, a "Convert − to + (n)" outline button and confirm strip mutually exclusive with Import/Duplicate (`convertStage`), a result panel identical in shape, and a per-row "Convert to +" button in the editor (one-id batch through the same action); staged negative amounts print with `text-destructive` in amount cells.
- Where: `lib/bank-import/review.ts` (`convertPositiveDecision`, `convertLinesPositive`, `ConvertPositiveResult`), `app/bank-connections/actions.ts` (`convertLinesPositiveAction`), `components/bank-import/review-table.tsx` (`isConvertiblePositive`, `runConvert`, `convertPositiveRow`), tests `lib/bank-import/__tests__/review.ts` (policy + converted-eligibility cases), `lib/bank-import/__tests__/pdf.ts` (loader seam)
- Why: Real statements print negative amounts in their source column; rows were stuck pending-with-flag forever with no reviewer action except skipping them. Flipping the sign is a review decision (audited per row), never a parser guess — new uploads and existing staged rows behave the same.
- Date: 2026-11-03

### [Data] — Statement status truth: ledger deletes demote, restores re-complete (statement-sync)
- Rule: `lib/bank-import/statement-sync.ts` owns the ledger↔staging status sync. `ledgerStatementSyncDecision` (pure, offline-tested) is the whole policy: a ledger DELETE demotes only `completed`→`review`; a ledger RESTORE promotes only `review`/`importing`→`completed` and only when `canClaimComplete` (no pending/ready/error line — the exact predicate `finalizeStatement` uses). `syncStatementForDeletedTransaction`/`syncStatementForRestoredTransaction` run inside the caller's DB transaction (called from `lib/transactions/manage.ts` `deleteTransaction`/`restoreTransaction`), lock the statement row (`FOR UPDATE OF s`) via `uq_bank_statement_lines_transaction` (a transaction sits in ≤1 line, but the loop stays safe). Failures bubble → the ledger write rolls back with its statement. Audits are pointer-state only: `review_reopened` (source `manual`, metadata `{transactionId, via:"ledger_delete"}`) and `statement_completed` (metadata `{transactionId, via:"ledger_restore"}`) — never amounts or narration. `deleteTransaction` gained a 4th param `syncStatement = true`; `deleteStatementAction` passes `false` (it hard-deletes the statement right after, so demoting is noise). For statements completed BEFORE this existed, `reopenStatementWithDeadImports` + `reopenStatementAction` are the explicit rescue (button shows on a completed screen whose imports died; audited `via:"manual_reopen"` with the dead count, safe errors otherwise).
- Where: `lib/bank-import/statement-sync.ts`, `lib/transactions/manage.ts`, `app/bank-connections/actions.ts`, `components/bank-import/statement-detail.tsx` (dead-import banner), `components/bank-import/reopen-statement.tsx`, tests `lib/bank-import/__tests__/statement-sync.ts` (6 checks)
- Why: A statement said "Completed" while its imported ledger rows were vanishing from /transactions; the status now always matches what the ledger can prove, and the manager lands on the review page (proper information) where dead rows offer Restore or direct re-import.
- Date: 2026-11-03

### [Data] — Statement status always mirrors its line states (review-side finalize)
- Rule: Completion is not an import-only event. `finalizeStatementStatuses(tx, statementId, from=["importing"])` in `statement-sync.ts` is the single completeness write (target `completed` when counts pending/ready/error = 0, else `review`, `completed_at` coalesced — supersedes the old two-statement pool finalize, which `import.ts` `finalizeStatement` now wraps as a one-transaction delegate). Review decisions that RESOLVE a line call it with `from=["review"]` inside their own transaction: `skipLine`, `markLineDuplicate`, and `markLinesDuplicate` (which lost its standalone `bankStatements.updatedAt` update — the finalizer always refreshes `updated_at` in both targets). Lines that stay unresolved (ready, pending, reopened, converted) must NOT finalize — `ready` is unresolved by definition. No cycles: `statement-sync.ts` imports only db/schema/types/safe-log; `review.ts` and `import.ts` may both import it.
- Where: `lib/bank-import/statement-sync.ts` (`finalizeStatementStatuses`, `canClaimComplete`), `lib/bank-import/import.ts` (`finalizeStatement` wrapper), `lib/bank-import/review.ts` (3 call sites)
- Why: A demoted statement whose dead rows were all marked duplicate could never re-complete (no importable rows → no batch to finalize it); the mirror-the-line-states rule closes the stuck-in-review edge on new and old data.
- Date: 2026-11-03

### [Data] — Statement pages disclose what the ledger did after import
- Rule: `getStatementDetail` selects `l.imported_payload_hash` + `t.payload_hash`; a line gains optional `postImportEdited` — true only when status `imported`, `importLive`, both hashes exist and they differ (legacy rows without a stored hash never claim "edited"). Review table shows a `text-warning` caption "Edited in ledger" under the status badge; the read-only StatementDetailScreen shows the same plus `text-destructive` "Import deleted" for dead imports. Reads stay pure — no sync-on-render; the completed screen's dead-import rows instead get an explicit "Reopen statement" rescue banner.
- Where: `lib/bank-import/queries.ts` (payload-hash seam), `components/bank-import/review-table.tsx`, `components/bank-import/statement-detail.tsx`, `components/bank-import/reopen-statement.tsx`
- Why: The statement page must keep telling the ledger's story after the import: an edited transaction is no longer exactly what the PDF said, and the manager should see it without opening /transactions.
- Date: 2026-11-03
