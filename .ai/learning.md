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

### [Money] — integer minor units + one formatter
- Rule: Amounts stored and summed as integer paise/cents. Display only through `src/lib/money.ts` (`Intl.NumberFormat("en-IN", { currency: "INR" })`). Always `tabular-nums`, right-aligned in tables.
- Where: `src/lib/money.ts` (`formatMoney(minor, "INR" | "USD")`)
- Why: SRS F9 "money stored as exact values".
- Date: 2026-10-07

## Rejected

### [Rejected] — Website Vikreta marketing patterns
- Rule: Don't port from `websitevikreta-fork`: Epilogue, `#FFD600`, light theme, GSAP reveals, `Reveal.tsx`, DotGrid, arrow-dots Button, SEO/GEO schema, Storyteller marketing arc. Only its `.ai/` folder layout was reused.
- Why: Different product (internal tool) and different design system (DESIGN.md).
- Date: 2026-10-07
