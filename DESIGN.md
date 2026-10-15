---
version: 2
name: Website Vikreta Finance (light)
description: Internal finance tool for Website Vikreta managers. Warm off-white canvas, white cards with hairline borders, near-black ink and Vikreta brand yellow as the single accent. Inter for everything, JetBrains Mono for money and figures. Calm, dense, readable. Built from the Figma login/dashboard refresh (Oct 2026).

colors:
  canvas: "#F8F8F4"
  surface-card: "#FFFFFF"
  surface-soft: "#F8F8F4"
  surface-muted: "#F1F1EC"
  surface-secondary: "#F4F4EE"
  ink: "#0A0A0A"
  body: "#27272A"
  muted: "#71717A"
  muted-soft: "#A1A1AA"
  hairline: "#E8E8E2"
  hairline-strong: "#D4D4D0"
  input-border: "#E4E4DE"
  primary: "#FFD600"
  primary-active: "#E6C200"
  primary-disabled: "#FFF3AA"
  on-primary: "#0A0A0A"
  success: "#22C55E"
  warning: "#F59E0B"
  info: "#3B82F6"
  destructive: "#EF4444"
  income-fill: "#FFD600"
  expense-fill: "#CBD5E1"

typography:
  family-sans: Inter
  family-mono: JetBrains Mono
  display-md: { size: 36px, line-height: 1.15, tracking: -1.5px, weight: 700 }
  display-sm: { size: 28px, line-height: 1.2, tracking: -1px, weight: 700 }
  title-lg: { size: 22px, line-height: 1.3, tracking: -0.3px, weight: 700 }
  title-md: { size: 16px, line-height: 1.4, weight: 600 }
  title-sm: { size: 15px, line-height: 1.4, weight: 600 }
  body-md: { size: 15px, line-height: 1.55 }
  body-sm: { size: 13px, line-height: 1.55 }
  caption: { size: 12px, line-height: 1.4, weight: 500 }
  eyebrow: { size: 11px, line-height: 1.4, tracking: 1.5px, weight: 600 }
  micro: { size: 11px, line-height: 1.4, weight: 500 }

radius:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
---

# Website Vikreta Finance — Design Spec

> Source of truth for how the app looks. Tokens live in `app/globals.css`; the class-level mapping is in `.ai/standards/design-system.md`. If this file and `globals.css` disagree, fix one of them in the same change.

## Atmosphere

A light, quiet workspace for reading numbers. The page is a warm off-white (`canvas`), every block of content sits on a white card with a 1px hairline border, and text is near-black. Vikreta yellow is the only brand color: it marks the primary action, focus, the income series in charts and progress bars. Everything else is neutral, so the yellow always means "this one".

- Light only. There is no dark theme and no toggle; don't write `dark:` variants.
- Same brand family as websitevikreta.com (yellow `#FFD600`, near-black ink), but this is an internal tool: no marketing sections, no motion-heavy reveals, no Epilogue.
- Cards, not shadows. Depth comes from white-on-off-white plus hairlines.
- Follows the ClickHouse discipline on a light canvas: one accent color, Inter 700 with negative tracking for display, flat cards, no decoration. No dot patterns, no illustrations, no background textures. Emphasis comes from size and weight before color.

## Color

| Role | Token | Hex | Notes |
|------|-------|-----|-------|
| Page | `canvas` | `#F8F8F4` | `bg-background` |
| Card / popover | `surface-card` | `#FFFFFF` | `bg-card` |
| Quiet fill | `surface-muted` | `#F1F1EC` | Table headers, icon tiles, tracks of progress bars, skeletons (`bg-muted`) |
| Secondary fill | `surface-secondary` | `#F4F4EE` | Hover fill (`bg-accent`), secondary buttons |
| Ink | `ink` | `#0A0A0A` | Headings, figures, primary text |
| Body | `body` | `#27272A` | Default running text |
| Muted text | `muted` | `#71717A` | Labels, meta, helper text |
| Fine print | `muted-soft` | `#A1A1AA` | Timestamps only; never for something the user must read to act |
| Hairline | `hairline` | `#E8E8E2` | Card borders, dividers, table rules |
| Primary | `primary` | `#FFD600` | Primary button, focus ring, income chart fill, progress bars, small accents |
| Primary pressed | `primary-active` | `#E6C200` | Hover/active on primary |
| Text on yellow | `on-primary` | `#0A0A0A` | Always black on yellow |
| Success / money in | `success` | `#22C55E` | Income amounts and arrows in lists |
| Destructive | `destructive` | `#EF4444` | Errors, negative net, sign-out hover |
| Warning | `warning` | `#F59E0B` | Rare: manual-rate or attention notes |
| Expense fill | `expense-fill` | `#CBD5E1` | Expense series in charts and expense bars |

Rules:
- **Yellow is a fill, not a text color.** `#FFD600` on white is about 1.4:1 contrast. Use it for buttons, bars, dots, rings and short underlines. For a two-tone headline, the second half goes `text-muted-foreground`, not yellow.
- **Money in** reads as `text-success` with a `+` sign; **money out** stays `text-foreground` with a `−` sign. Totals in KPI cards are plain `text-foreground`.
- **Charts:** income = `primary` (`bg-income`), expenses = `expense-fill` (`bg-expense`). Never use `surface-card`/white for a series; it disappears on the card.
- No second brand color, no gradients, no raw hex in components.

## Typography

Inter carries every role; JetBrains Mono is for money, rates and IDs (always with `tabular-nums`).

| Role | Class | Spec | Use |
|------|-------|------|-----|
| Hero / big page title | `text-display-md` | 36 / 1.15, −1.5px, 700 | Dashboard hero only |
| Page title | `text-title-lg md:text-display-sm` | 22→28, 700 | `<h1>` via `PageHeader` |
| Section / card title | `text-title-md` | 16 / 1.4, 600 | Card headings |
| Small title | `text-title-sm` | 15 / 1.4, 600 | List item names |
| KPI figure | `font-mono text-title-lg sm:text-display-sm tabular-nums` | 22→28 | KPI cards, stat tiles |
| Body | `text-body-sm` | 13 / 1.55 | Tables, descriptions (UI default) |
| Meta | `text-caption` | 12 / 1.4, 500 | Badges, sub-lines, footers |
| Micro | `text-micro` | 11 / 1.4, 500 | Chat timestamps and tiny status badges only |
| Label | `text-caption` | 12, 500, sentence case | Stat labels, table headers |

Each type class sets size, line-height, tracking and weight together; don't stack `font-bold` or `tracking-*` on top.

## Shape and spacing

- Radius: cards and panels `rounded-xl` (12px); buttons and inputs `rounded-lg` (8px); small chips `rounded-md` (6px); badges, avatars and dots `rounded-full`.
- Card padding `p-6` (stat tiles `p-5`); sections stacked with `space-y-6`; grids `gap-4` (tiles) or `gap-6` (panels).
- Shell: top bar 64px white with bottom hairline; sidebar white with right hairline; content `max-w-7xl`, padded `p-4 md:p-8`.

## Components

| Component | Spec |
|-----------|------|
| Page header | `PageHeader`: title, one-line description, optional single action on the right |
| Primary button | `<Button>`: yellow fill, black text, h-10. One per view |
| Secondary action | `<Button variant="outline">` or an outline link styled the same (h-10, hairline, white) |
| Card | `rounded-xl border border-border bg-card p-6` |
| Stat tile / KPI card | Eyebrow label, mono figure, optional badge with a 2px underline (`border-primary` good, `border-destructive` bad, `border-border` neutral) |
| Table | Card wrapper, `bg-muted/60` header row with eyebrow labels, `divide-y` rows, hover `bg-muted/50`, money right-aligned in mono |
| Segmented filter | `bg-muted p-1 rounded-lg`; active item `bg-card shadow-xs text-foreground` |
| Progress / share bar | `h-1.5`–`h-2` track `bg-muted`, fill `bg-primary` (income) or `bg-expense` (expenses) |
| Badge / chip | `rounded-md border border-border bg-muted px-2 py-0.5 text-caption text-muted-foreground` |
| Loading | `Skeleton` blocks matching the final layout, inside the Suspense fallback |
| Empty state | Plain sentence that says what to do next; dashed-border card for whole-page empties |
| Roadmap page | `ComingSoon`: eyebrow, title, what exists today, bullet list of planned work |
| Yellow card | Full `bg-primary` panel with black type; at most one per screen (the login side panel). ClickHouse's `feature-card-yellow` |

## Accessibility

- Focus ring is yellow (`ring-ring`) at 3px/50%; never remove `focus-visible` styles.
- Body text on canvas and cards passes AA; `muted` (`#71717A`) passes AA at 14px+.
- Icon-only controls need `aria-label`; decorative icons `aria-hidden`.
- Touch targets at least 40px (buttons and inputs default to h-10).

## Don't

- Don't add a dark theme, `dark:` variants or a theme toggle.
- Don't put yellow text on white, or use yellow for anything that isn't the primary signal.
- Don't add drop shadows to cards; floating layers (menus, dialogs, toasts) may keep shadcn's shadow.
- Don't invent sizes, radii or colors. Add a token to `globals.css`, this file and `.ai/standards/design-system.md` together.
- Don't show made-up numbers. If there's no data or no backend yet, say so.
- Don't add dot patterns, textures, gradients, illustrations or decorative shapes.
- Don't add eyebrow labels, taglines, hero copy or explainer sentences. Title plus data; keep words to what the reader needs to act.
