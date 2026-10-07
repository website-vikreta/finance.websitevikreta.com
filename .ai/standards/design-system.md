# Design System — Finance Tool

> **Source of truth: `DESIGN.md`** (ClickHouse system). This file maps those tokens to the code: CSS variables in `src/app/globals.css` and the Tailwind classes you actually write.
> Never inline hex. Never invent a size, radius or color that is not listed here. If you need one, add it to `globals.css` + this file + `learning.md` together.

## Theme Setup (already done)
- Dark only. `<html class="dark">` is permanent in `src/app/layout.tsx`. There is no theme toggle and no light palette. Don't add `dark:` variants in new code; there is only one theme.
- `:root` holds DESIGN.md values. `@theme inline` exposes them as Tailwind utilities.
- Fonts: `--font-inter` (sans + heading), `--font-jetbrains-mono` (mono) via `next/font/google`.

## Color Tokens → Classes
| DESIGN.md | CSS var | Use in Tailwind |
|-----------|---------|-----------------|
| `canvas` #0a0a0a | `--background` | `bg-background` |
| `surface-soft` #121212 | `--surface-soft` / `--muted` | `bg-surface-soft`, `bg-muted` |
| `surface-card` #1a1a1a | `--card` | `bg-card`, `bg-surface-card`, `bg-secondary` |
| `surface-elevated` #242424 | `--surface-elevated` / `--popover` / `--accent` | `bg-surface-elevated`, `bg-popover`, `hover:bg-accent` |
| `primary` #faff69 | `--primary` | `bg-primary`, `text-primary`, `ring-ring` |
| `primary-active` #e6eb52 | `--primary-active` | `bg-primary-active` |
| `primary-disabled` #3a3a1f | `--primary-disabled` | `bg-primary-disabled` |
| `on-primary` #0a0a0a | `--primary-foreground` | `text-primary-foreground` |
| `ink` #ffffff | `--foreground` | `text-foreground` (headings default to this) |
| `body` #cccccc | `--body` | `text-body` (body default) |
| `body-strong` #e6e6e6 | `--body-strong` | `text-body-strong` |
| `muted` #888888 | `--muted-foreground` | `text-muted-foreground` |
| `muted-soft` #5a5a5a | `--muted-soft` | `text-muted-soft` |
| `hairline` #2a2a2a | `--border` | `border-border` (default for `border`), `border-hairline` |
| `hairline-strong` #3a3a3a | `--input` / `--hairline-strong` | `border-input`, `border-hairline-strong` |
| `accent-emerald` #22c55e | `--income` / `--success` | `text-income`, `text-success` |
| `accent-rose` #ef4444 | `--expense` / `--destructive` | `text-expense`, `text-destructive` |
| `warning` #f59e0b | `--warning` | `text-warning` |
| `accent-blue` #3b82f6 | `--info` | `text-info` |

⚠️ shadcn's `accent` is the **hover/focus fill** (#242424), not the brand accent. The brand accent is `primary`.

### Chart colors
`--chart-1` yellow `#faff69` (the series that matters) · `--chart-2` `#e6e6e6` · `--chart-3` `#888888` · `--chart-4` `#5a5a5a` · `--chart-5` `#3a3a3a`.
Exception: income-vs-expense charts use `--income` / `--expense`. Load the `dataviz` skill before building any chart.

## Typography → Classes
Each class sets size, line-height, tracking and weight together. Don't add `font-bold` / `tracking-*` on top.

| DESIGN.md | Class | Spec | Use |
|-----------|-------|------|-----|
| `display-xl` | `text-display-xl` | 72/1.05, -2.5px, 700 | Login hero only |
| `display-lg` | `text-display-lg` | 56/1.1, -2px, 700 | Rare. Empty-state hero |
| `display-md` | `text-display-md` | 40/1.15, -1.5px, 700 | Page title on dashboard |
| `display-sm` | `text-display-sm` | 32/1.2, -1px, 700 | Page titles (`<h1>`) |
| `title-lg` | `text-title-lg` | 24/1.3, -0.3px, 700 | Section headings (`<h2>`) |
| `title-md` | `text-title-md` | 18/1.4, 600 | Card titles |
| `title-sm` | `text-title-sm` | 16/1.4, 600 | Small card titles, list labels |
| `stat-display` | `text-stat` | 56/1.0, -1.5px, 700 | KPI numbers. Always `text-primary tabular-nums` |
| `body-md` | `text-body-md` | 16/1.55 | Running text |
| `body-sm` | `text-body-sm` | 14/1.55 | Tables, helper text (UI default size) |
| `caption` | `text-caption` | 13/1.4, 500 | Badges, meta |
| `caption-uppercase` | `text-eyebrow uppercase` | 12/1.4, 1.5px, 600 | Section labels, column group labels |
| `code` | `font-mono text-code` | 14/1.55 | IDs, rates, audit diffs |
| `button` | (built into `<Button>`) | 14, 600 | — |
| `nav-link` | `text-sm font-medium` | 14, 500 | Sidebar / top-nav items |

Mobile: `text-display-xl` → `text-display-sm` under 768px (`text-display-sm md:text-display-xl`). Stats step down to `text-display-sm md:text-stat`.

### Money
- Always `tabular-nums`. Right-align money columns in tables.
- Income amounts `text-income`, expenses `text-expense` only when the sign carries meaning (lists, deltas). Totals in KPI cards stay `text-primary`.
- Format with the shared helper (see `data-safety.md`), never by hand.

## Radius
| DESIGN.md | Tailwind | Value | Use |
|-----------|----------|-------|-----|
| `xs` | `rounded-sm` | 4px | Badge accents |
| `sm` | `rounded-md` | 6px | Small inline buttons, menu items |
| `md` | `rounded-lg` | 8px | Buttons, inputs, selects (shadcn default) |
| `lg` | `rounded-xl` | 12px | Cards, dialogs, code windows (shadcn default) |
| `pill` / `full` | `rounded-full` | 9999px | Badges, avatars, icon buttons |

No pill buttons except icon buttons.

## Spacing & Layout
4px base, Tailwind's default scale already matches DESIGN.md (`1`=4, `2`=8, `3`=12, `4`=16, `6`=24, `8`=32, `12`=48, `24`=96).

- **App shell:** top bar `h-16` (64px), `bg-background`, `border-b`. Sidebar `w-60`, `bg-background`, `border-r`.
- **Page container:** `mx-auto w-full max-w-[1280px] px-4 md:px-8 py-8`.
- **Page header → content:** `mb-8`.
- **Between page sections:** `gap-8` (32px). `section` (96px) is for marketing bands only; this app has none except the login screen.
- **Card padding:** KPI / summary / form cards `p-6` (24). Feature or empty-state cards `p-8` (32).
- **Grids:** KPI row `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`. Card grids 1 → 2 (`md`) → 3 (`lg`).
- **Breakpoints:** Tailwind defaults. `md` 768 = DESIGN mobile/tablet line, `lg` 1024 = desktop.

## Elevation
| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | none | Page canvas, shell |
| Hairline | `border` (1px `#2a2a2a`) | Tables, dividers, shell edges |
| Card | `bg-card` (+ shadcn's 1px ring) | Summaries, forms, charts |
| Elevated | `bg-surface-elevated` / `bg-popover` | Nested cards, menus, popovers |
| Yellow | `bg-primary text-primary-foreground` | One emphasis surface per view at most |

No drop shadows. If a shadcn component ships `shadow-*`, it is acceptable on floating layers (menus, dialogs) only.

## Component Mapping (DESIGN.md → shadcn)
| DESIGN.md component | Use |
|---------------------|-----|
| `button-primary` | `<Button>` (default: yellow, h-10, px-5, 600). One per view |
| `button-primary-active` | built in (`hover/active:bg-primary-active`) |
| `button-secondary` | `<Button variant="secondary">` |
| `button-text-link` | `<Button variant="ghost">` or `variant="link"` |
| `button-icon-circular` | `<Button size="icon">` (36px, round) |
| `text-input` / `-focused` | `<Input>` (h-10, `bg-card`, yellow focus ring) |
| `category-tab` / `-active` | `<Tabs>` |
| `badge-pill` | `<Badge variant="secondary">` |
| `badge-yellow` | `<Badge>` + `uppercase text-eyebrow`. Only for "NEW" / one status per view |
| `feature-card-dark` / `events-card` | `<Card className="p-6">` |
| `stat-callout` | `<p className="text-stat text-primary tabular-nums">` on canvas or inside a card |
| `code-window-card` | `<Card>` + `<pre className="font-mono text-code">` (audit diffs, raw payloads) |
| `cta-band-yellow` | Not used in-app (marketing only) |
| `top-nav` | App top bar, 64px |

Status badges: income `text-income`, expense `text-expense`, `source=chatbot` → `<Badge variant="outline">chatbot</Badge>`, `manual rate` → `text-warning`.

## Focus & Accessibility
- Focus ring: `ring-ring` = yellow. Never remove `focus-visible` styles.
- Contrast: body `#cccccc` on `#0a0a0a` passes AA. `#5a5a5a` (`muted-soft`) is fine print only, never for anything the user must read to act.
- Icon-only buttons need `aria-label`.
- Touch targets at least 40px (button/input default already 40px).

## Hard Rules (from DESIGN.md Do's & Don'ts)
- No second brand color. Monochrome + yellow (+ income/expense data colors).
- No yellow body text, no large yellow fills except one emphasis card.
- Display type is 700 with negative tracking. Never 500 for headlines.
- No shadows, no gradients, no decorative illustrations.
- Hover is subtle: background shifts one surface step (`hover:bg-accent`). No scale, no glow.
