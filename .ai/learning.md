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
- Where: `lib/transactions/persist.ts`, `lib/chatbot/persist.ts`, `app/api/chatbot/confirm/route.ts`, `app/api/chatbot/message/route.ts`
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

