# Design System — Finance Tool

> **Source of truth: `DESIGN.md`** (light Website Vikreta finance theme). This file maps those tokens to the code: CSS variables in `app/globals.css` and the Tailwind classes you actually write.
> Never inline hex. Never invent a size, radius or color that is not listed here. If you need one, add it to `globals.css` + `DESIGN.md` + this file + `learning.md` together.

## Theme Setup (already done)
- Light only. `:root` in `app/globals.css` holds the palette; `<html>` has no `.dark` class and `<Toaster theme="light" />`. There is no theme toggle. Don't add `dark:` variants in new code (some shadcn primitives still ship them; leave those alone).
- `@theme inline` exposes the variables as Tailwind utilities.
- Fonts: `--font-inter` (sans + heading), `--font-jetbrains-mono` (mono) via `next/font/google` in `app/layout.tsx`.

## Color Tokens → Classes
| DESIGN.md | CSS var | Use in Tailwind |
|-----------|---------|-----------------|
| `canvas` #F8F8F4 | `--background` | `bg-background` |
| `surface-card` #FFFFFF | `--card` / `--popover` | `bg-card`, `bg-popover` |
| `surface-muted` #F1F1EC | `--muted` | `bg-muted` (table headers, icon tiles, bar tracks, skeletons) |
| `surface-secondary` #F4F4EE | `--secondary` / `--accent` | `bg-secondary`, `hover:bg-accent` |
| `ink` #0A0A0A | `--foreground` | `text-foreground` (headings default to this) |
| `body` #27272A | `--body` | `text-body` (body default) |
| `muted` #71717A | `--muted-foreground` | `text-muted-foreground` |
| `muted-soft` #A1A1AA | `--muted-soft` | `text-muted-soft` (timestamps only) |
| `hairline` #E8E8E2 | `--border` | `border-border` (default for `border`) |
| `hairline-strong` #D4D4D0 | `--hairline-strong` | `border-hairline-strong` |
| `input-border` #E4E4DE | `--input` | `border-input` |
| `primary` #FFD600 | `--primary` / `--ring` | `bg-primary`, `ring-ring`, `border-primary` |
| `primary-active` #E6C200 | `--primary-active` | `bg-primary-active` |
| `on-primary` #0A0A0A | `--primary-foreground` | `text-primary-foreground` |
| `success` #22C55E | `--success` | `text-success`, `bg-success/10` (money in) |
| `destructive` #EF4444 | `--destructive` | `text-destructive`, `border-destructive` |
| `warning` #F59E0B | `--warning` | `text-warning` |
| `info` #3B82F6 | `--info` | `text-info` |
| `income-fill` #FFD600 | `--income` | `bg-income` (charts / bars only) |
| `expense-fill` #CBD5E1 | `--expense` | `bg-expense` (charts / bars only) |

⚠️ `--income` and `--expense` are **fills**. Never use `text-income` (yellow on white is unreadable) or `text-expense` (too faint). Money in → `text-success`, money out → `text-foreground`.
⚠️ shadcn's `accent` is the **hover fill**, not the brand accent. The brand accent is `primary`.
⚠️ `--surface-elevated` is white like the card. Never use it as a chart series or anything that must show up on a card.

### Chart colors
Income-vs-expense charts use `bg-income` / `bg-expense`. Other series: `--chart-1` #FFD600 · `--chart-2` #CBD5E1 · `--chart-3` #94A3B8 · `--chart-4` #64748B · `--chart-5` #334155. Load the `dataviz` skill before building a new chart.

## Typography → Classes
Each class sets size, line-height, tracking and weight together. Don't add `font-bold` / `tracking-*` on top.

| DESIGN.md | Class | Spec | Use |
|-----------|-------|------|-----|
| `display-md` | `text-display-md` | 40/1.15, -1.5px, 700 | Dashboard hero headline |
| `display-sm` | `text-display-sm` | 32/1.2, -1px, 700 | Page titles at `md+`, KPI figures at `sm+` |
| `title-lg` | `text-title-lg` | 24/1.3, -0.3px, 700 | Page titles on mobile, stat tile figures |
| `title-md` | `text-title-md` | 18/1.4, 600 | Card titles (`<h2>`) |
| `title-sm` | `text-title-sm` | 16/1.4, 600 | List item names |
| `body-md` | `text-body-md` | 16/1.55 | Long running text |
| `body-sm` | `text-body-sm` | 14/1.55 | Tables, descriptions (UI default) |
| `caption` | `text-caption` | 13/1.4, 500 | Badges, meta, table footers |
| `eyebrow` | `text-eyebrow` | 12/1.4, 1.5px, 600 | Stat labels, table header cells (write the copy in caps) |
| `micro` | `text-micro` | 11/1.4, 500 | Chat timestamps, tiny status badges. Nothing else |

`text-display-xl`, `text-display-lg` and `text-stat` exist in `globals.css` but aren't used in-app; prefer the sizes above.

Page titles go through `components/layout/page-header.tsx` (`text-title-lg md:text-display-sm`).

### Money
- Always `font-mono tabular-nums`. Right-align money columns.
- Lists: income `text-success` with `+`, expense `text-foreground` with `−`. KPI totals `text-foreground`.
- Format with `formatINR` from `lib/format.ts`; shares with `formatShare` (`<1%` for tiny parts); dates with `formatDate` / `formatMonthShort`. Never by hand.

## Radius
| Tailwind | Value | Use |
|----------|-------|-----|
| `rounded-sm` | 4px | Tiny accents |
| `rounded-md` | 6px | Chips, segmented-filter items |
| `rounded-lg` | 8px | Buttons, inputs, icon tiles |
| `rounded-xl` | 12px | Cards, panels, tables |
| `rounded-full` | 9999px | Badges, avatars, dots, bar fills, navbar pills |

## Spacing & Layout
4px base; Tailwind's default scale.

- **App shell:** `components/layout/app-shell.tsx`. Top bar `h-16` white with `border-b`; sidebar white with `border-r`; Finance AI panel docks on the right.
- **Page container:** shell `main` is `p-4 md:p-8` (tighter while the chat panel is open) with `mx-auto max-w-7xl space-y-6`. Pages return their sections directly; don't add another wrapper.
- **Card padding:** `p-6`; stat tiles `p-5`.
- **Grids:** KPI row `grid gap-4 sm:grid-cols-2 2xl:grid-cols-4`. Card grids 1 → 2 (`md`) → 3 (`xl`). Panels `gap-6`.
- **Breakpoints:** Tailwind defaults.

## Elevation
| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | `bg-background` | Page canvas |
| Card | `bg-card border border-border rounded-xl` | Everything that holds content |
| Inset | `bg-muted` | Table header row, segmented filter track, icon tiles |
| Floating | shadcn popover/dialog/toast shadow | Menus, dialogs, toasts only |

No drop shadows on cards. `shadow-xs` only on the active item of a segmented filter.

## Component Mapping
| Need | Use |
|------|-----|
| Page title + action | `PageHeader` (`components/layout/page-header.tsx`) |
| Primary action | `<Button>` (yellow, h-10). One per view |
| "New transaction" / "Record income" | `NewTransactionButton` (opens Finance AI via `useOpenFinanceAI`) |
| Secondary action / link button | `<Button variant="outline">` or an `<a>` with the same classes (h-10, hairline, `bg-background`, `hover:bg-muted`) |
| Search | `<Input type="search">` with a leading `Search` icon (`pl-9`) |
| Type / period filter | `segmentedTrack` + `segmentedItem(active)` from `components/ui/segmented.ts` (buttons or links) |
| Summary figure | `StatTile` (`components/layout/stat-tile.tsx`); dashboard uses `KPICard` |
| Link that looks like a button | `<a className={buttonVariants({ variant })}>`. Never copy button classes by hand |
| Icon-only button | `<Button variant="ghost" size="icon">` (`icon-lg` in the navbar) |
| Chat quick actions | `QuickActions` in `chat-message-list.tsx` (outline, `size="sm"`, `rounded-full`) |
| Data table | `components/transactions/ledger-table.tsx` pattern |
| KPI | `components/dashboard/kpi-card.tsx` |
| Loading | `Skeleton` in the `<Suspense>` fallback, same shape as the content |
| Module without a backend | `components/layout/coming-soon.tsx` |
| Chat confirmation | `components/chat/transaction-summary-card.tsx` (`resolution` locks settled cards) |

## Focus & Accessibility
- Focus ring: `focus-visible:ring-3 focus-visible:ring-ring/50`. Never remove it.
- `muted` text passes AA at 14px+; `muted-soft` is fine print only.
- Icon-only buttons need `aria-label`; decorative icons `aria-hidden`.
- Touch targets at least 40px.

## Hard Rules
- Light only; no `dark:` in new code.
- No yellow text on white. Yellow is for fills, rings and the primary button.
- No second brand color, no gradients, no raw hex in components.
- Hover is subtle: one surface step (`hover:bg-muted` / `hover:bg-accent`). No scale, no glow.
- Never show invented figures; empty and roadmap states say what's true.
- No dot patterns, textures, illustrations or decorative shapes (ClickHouse discipline). Never `text-[Npx]`; use a type token.
- No shadows on cards or chat bubbles.
