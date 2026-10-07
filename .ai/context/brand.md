# Brand — Finance Tool

> Quick reference. **Full spec: `DESIGN.md`** (ClickHouse design system). If this file and `DESIGN.md` disagree, `DESIGN.md` wins.
> This tool does NOT use the main Website Vikreta brand (light `#FAFAF7`, `#FFD600`, Epilogue).

## Palette (dark only)
| Role | DESIGN.md token | Value | Tailwind class |
|------|-----------------|-------|----------------|
| Canvas (page) | `canvas` | `#0a0a0a` | `bg-background` |
| Surface soft | `surface-soft` | `#121212` | `bg-surface-soft` / `bg-muted` |
| Card | `surface-card` | `#1a1a1a` | `bg-card` |
| Elevated (nested, menus) | `surface-elevated` | `#242424` | `bg-surface-elevated` / `bg-popover` |
| Primary (electric yellow) | `primary` | `#faff69` | `bg-primary` / `text-primary` |
| Primary pressed | `primary-active` | `#e6eb52` | `bg-primary-active` |
| Primary disabled | `primary-disabled` | `#3a3a1f` | `bg-primary-disabled` |
| Text on yellow | `on-primary` | `#0a0a0a` | `text-primary-foreground` |
| Headline / ink | `ink` | `#ffffff` | `text-foreground` |
| Body | `body` | `#cccccc` | `text-body` (body default) |
| Body strong | `body-strong` | `#e6e6e6` | `text-body-strong` |
| Muted | `muted` | `#888888` | `text-muted-foreground` |
| Muted soft | `muted-soft` | `#5a5a5a` | `text-muted-soft` |
| Hairline | `hairline` | `#2a2a2a` | `border-border` |
| Hairline strong | `hairline-strong` | `#3a3a3a` | `border-input` / `border-hairline-strong` |
| Income / success | `accent-emerald` | `#22c55e` | `text-income` / `text-success` |
| Expense / error | `accent-rose` | `#ef4444` | `text-expense` / `text-destructive` |
| Warning | `warning` | `#f59e0b` | `text-warning` |
| Info | `accent-blue` | `#3b82f6` | `text-info` |

**Rule:** Yellow + black is the brand. Yellow goes on: the ONE primary action per view, headline stat numbers, the active nav item, the focused input ring, the highlighted chart series. Nothing else.
**Rule:** Income green and expense red are **data colors**, not decoration. Use them only on amounts, deltas and chart series that mean income/expense.
**Rule:** No second brand color. No gradients. No drop shadows. Depth = canvas vs card contrast + 1px hairline.

---

## Typography
- **Inter** for everything (display, body, UI, labels). **JetBrains Mono** for code, IDs, raw values, audit diffs.
- Display weight is **700** with negative tracking. Titles/buttons **600**. Body **400**.
- **Money is always `tabular-nums`** so columns line up.
- Hierarchy by size + weight, never by a second family.

---

## Voice & Microcopy
**What we sound like:**
- Short. Plain. Exact.
- Say what happened, with the real value: "Saved ₹8,500 (USD 100 at ₹85.00)".
- Errors say what to do next: "Rate service is down. Enter the rate by hand."
- Confirm before anything destructive: "Delete Rent, Oct 2026? It moves to the audit log and can be restored."

**What we never sound like:**
- Celebration on routine actions ("Awesome!", "🎉", "Success!!").
- Vague errors ("Oops", "Something went wrong").
- Developer words in UI ("null", "payload", "entity", "mutation").
- AI-generated filler. Full pattern list: `.ai/context/ai-slop-stop-skill.md`.

**Rule:** Every visible string (labels, empty states, toasts, dialogs, chatbot replies) runs through `.ai/commands/macro/humanize.md`.

---

## Motion Identity
Fast and quiet. Motion confirms an action or shows where something came from, nothing more. Full rules: `.ai/standards/motion-system.md`.

## Imagery
No photos, no illustrations. The data is the visual: numbers, tables, charts. Icons from `lucide-react` only.
