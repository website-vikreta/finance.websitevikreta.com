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
- Rule: All colors, type, radius come from `DESIGN.md` via `src/app/globals.css`. Primary `#faff69`, canvas `#0a0a0a`, card `#1a1a1a`, hairline `#2a2a2a`. Never use the main Vikreta brand (`#FFD600`, `#FAFAF7`, Epilogue).
- Where: `src/app/globals.css`, `.ai/standards/design-system.md`
- Why: User chose the ClickHouse system (`npx getdesign@latest add clickhouse`) for this tool.
- Date: 2026-10-07

### [Tokens] — dark only, `.dark` always on
- Rule: `<html class="dark">` permanently; palette lives in `:root`; no light theme, no toggle. New code doesn't write `dark:` variants. `<Toaster theme="dark" />`.
- Where: `src/app/layout.tsx`, `src/app/globals.css`
- Why: DESIGN.md has no light surface. Keeping `.dark` on lets shadcn's built-in `dark:` styles apply.
- Date: 2026-10-07

### [Tokens] — shadcn `accent` ≠ brand accent
- Rule: `--accent` = `#242424` (hover/focus fill). Brand yellow is `--primary`. Use `hover:bg-accent` for hovers, `bg-primary` for the one primary action.
- Where: `src/app/globals.css`
- Date: 2026-10-07

### [Tokens] — radius mapping
- Rule: `rounded-sm` 4px, `rounded-md` 6px, `rounded-lg` 8px (buttons, inputs), `rounded-xl` 12px (cards, dialogs), `rounded-full` (badges, avatars, icon buttons). `--radius` = 8px.
- Where: `src/app/globals.css` `@theme inline`
- Why: matches DESIGN.md xs/sm/md/lg while keeping shadcn's class names working unchanged.
- Date: 2026-10-07

## Typography

### [Type] — scale utilities carry weight + tracking
- Rule: Use `text-display-{xl,lg,md,sm}`, `text-title-{lg,md,sm}`, `text-stat`, `text-body-{md,sm}`, `text-caption`, `text-eyebrow uppercase`, `font-mono text-code`. Don't add `font-bold` / `tracking-*` on top.
- Where: `src/app/globals.css` `--text-*`
- Date: 2026-10-07

### [Type] — fonts
- Rule: Inter (`--font-inter`) for all UI, JetBrains Mono (`--font-jetbrains-mono`) for code/IDs/rates/audit diffs. Body text defaults to `text-body` (#cccccc); headings `text-foreground` (#fff) via base layer.
- Where: `src/app/layout.tsx`, `src/app/globals.css`
- Date: 2026-10-07

## Components

### [Component] — Button sized to DESIGN.md
- Rule: default size `h-10 px-5`, `font-semibold`, yellow `bg-primary` with `hover:bg-primary-active`. `size="lg"` = `h-11 px-6`. `size="icon"` = 36px round, `icon-lg` = 40px round. `sm` / `xs` kept for dense table rows.
- Where: `src/components/ui/button.tsx`
- Why: DESIGN.md `button-primary` = 40px tall, 12×20 padding, 14px/600; `button-icon-circular` = 36px.
- Date: 2026-10-07

### [Component] — Input / Select height 40px on card surface
- Rule: `<Input>` `h-10 px-3.5 bg-card` (removed shadcn's `dark:bg-input/30`); `<Select>` trigger default `h-10`. Focus ring yellow via `--ring`.
- Where: `src/components/ui/input.tsx`, `src/components/ui/select.tsx`
- Why: DESIGN.md `text-input` = 40px, 10×14 padding, surface-card bg, yellow focus.
- Date: 2026-10-07

### [Component] — app-wide providers
- Rule: `TooltipProvider` wraps the app; one `<Toaster />` in root layout. Never mount a second Toaster or provider per page.
- Where: `src/app/layout.tsx`
- Date: 2026-10-07

## Money & Data

### [Data] - Gemini extraction has a bounded, safe fallback
- Rule: Chatbot Gemini calls set `config.httpOptions.timeout` to 4,500 ms. Provider failures return `"Chat extraction is unavailable. Please try your message again."` and never expose provider errors to the client. Gemini-backed routes preserve the retryable `503` status.
- Where: `src/lib/chatbot/extract.ts`
- Why: keeps chat within its 5-second response budget and prevents third-party implementation details from reaching managers.
- Date: 2026-10-08

### [Money] — Exact Major Units NUMERIC(18,2) Storage & Direct Mapping
- Rule: Amounts are stored in PostgreSQL as exact human-readable major units using NUMERIC(18,2): original_amount and amount_inr (e.g. ₹500 is stored as 500.00, ₹40 as 40.00, $500 at 88.50 as 500.00 and 44250.00). No _minor paise/cents columns. Financial calculations internally use exact arithmetic and half-even rounding (precision.ts) and format to decimal strings with up to 2 decimal places. Returned rows map directly into human-readable numbers without double-dividing by 100.
- Where: src/lib/db/schema.ts, src/lib/transactions/persist.ts, src/lib/currency/precision.ts, drizzle/0001_major_unit_amounts.sql
- Why: User requirement for human-readable major-unit database storage while preserving exact financial arithmetic.
- Date: 2026-10-12

### [Data] — Explicit Confirmation PostgreSQL Persistence & Atomicity
- Rule: Transactions are persisted ONLY upon explicit manager confirmation (`POST /api/chatbot/confirm` or conversational `confirm`). Pre-confirmation actions (extraction, clarifications, editing, cancellation) are strictly database-write-free. Transaction insert, client resolution/creation (for income), and immutable audit event run inside a single PostgreSQL transaction. Idempotency enforced via stable key and canonical payload SHA-256 hash. Banker's Rounding (Half-Even) and exact BigInt minor units via `precision.ts`.
- Where: `src/lib/transactions/persist.ts`, `src/lib/chatbot/persist.ts`, `src/app/api/chatbot/confirm/route.ts`, `src/app/api/chatbot/message/route.ts`
- Why: Guarantees zero phantom writes, zero silent mutations, exact integer arithmetic, and robust duplicate protection.
- Date: 2026-10-12

### [Layout] - login uses a split form and context panel
- Rule: Keep the `/login` form in a `max-w-md` left column; show the supporting finance panel only at `lg` and above so small screens stay focused on sign-in.
- Where: `src/app/login/page.tsx`
- Why: It preserves the Figma desktop composition without adding non-essential content to the mobile sign-in flow.
- Date: 2026-10-10

### [Layout] - dashboard adapts before the assistant docks
- Rule: Dashboard KPI cards move from one to two to four columns only when their content has room; the chart and payment panels stack until the `2xl` layout, and Finance AI overlays below `xl`.
- Where: `src/app/dashboard/page.tsx`, `src/components/layout/app-shell.tsx`, `src/components/chat/finance-ai-drawer.tsx`
- Why: Prevents the narrow dashboard and chart overlap shown when the assistant drawer is open.
- Date: 2026-10-10

### [Layout] - chat session is root-scoped and the message pane owns scrolling
- Rule: Keep in-session Finance Chat Bot state in `ChatSessionProvider` beneath the root layout, not in per-page `AppShell` instances. Use `h-dvh` plus `min-h-0` on shell and drawer flex ancestors, and `overflow-y-auto` only on the message list.
- Where: `src/app/layout.tsx`, `src/components/chat/chat-session-provider.tsx`, `src/components/layout/app-shell.tsx`, `src/components/chat/chat-message-list.tsx`
- Why: App Router page navigation remounts each shell; a root-scoped provider preserves the active conversation while the bounded message pane prevents dashboard scrolling and keeps the input reachable.
- Date: 2026-10-10

## Rejected

### [Rejected] — Website Vikreta marketing patterns
- Rule: Don't port from `websitevikreta-fork`: Epilogue, `#FFD600`, light theme, GSAP reveals, `Reveal.tsx`, DotGrid, arrow-dots Button, SEO/GEO schema, Storyteller marketing arc. Only its `.ai/` folder layout was reused.
- Why: Different product (internal tool) and different design system (DESIGN.md).
- Date: 2026-10-07
