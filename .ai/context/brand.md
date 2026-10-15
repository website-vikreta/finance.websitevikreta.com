# Brand — Finance Tool

> Quick reference. **Full spec: `DESIGN.md`** (light Website Vikreta finance theme). If this file and `DESIGN.md` disagree, `DESIGN.md` wins.
> Same brand family as websitevikreta.com (yellow `#FFD600`, near-black ink), styled as a calm internal tool: no Epilogue, no marketing motion.

## Palette (light only)
| Role | DESIGN.md token | Value | Tailwind class |
|------|-----------------|-------|----------------|
| Canvas (page) | `canvas` | `#F8F8F4` | `bg-background` |
| Card | `surface-card` | `#FFFFFF` | `bg-card` |
| Quiet fill | `surface-muted` | `#F1F1EC` | `bg-muted` |
| Hover / secondary fill | `surface-secondary` | `#F4F4EE` | `bg-secondary` / `hover:bg-accent` |
| Primary (Vikreta yellow) | `primary` | `#FFD600` | `bg-primary` / `ring-ring` |
| Primary pressed | `primary-active` | `#E6C200` | `bg-primary-active` |
| Text on yellow | `on-primary` | `#0A0A0A` | `text-primary-foreground` |
| Headline / ink | `ink` | `#0A0A0A` | `text-foreground` |
| Body | `body` | `#27272A` | `text-body` (body default) |
| Muted | `muted` | `#71717A` | `text-muted-foreground` |
| Muted soft | `muted-soft` | `#A1A1AA` | `text-muted-soft` |
| Hairline | `hairline` | `#E8E8E2` | `border-border` |
| Money in | `success` | `#22C55E` | `text-success` |
| Error / negative | `destructive` | `#EF4444` | `text-destructive` |
| Warning | `warning` | `#F59E0B` | `text-warning` |
| Income chart fill | `income-fill` | `#FFD600` | `bg-income` |
| Expense chart fill | `expense-fill` | `#CBD5E1` | `bg-expense` |

**Rule:** Yellow + near-black is the brand. Yellow goes on: the ONE primary action per view, the focus ring, the income series and share bars, small accents (eyebrow rule, dots, KPI badge underline). Never as text on white.
**Rule:** Green (`text-success`) marks money in; money out stays ink. Chart fills are `bg-income` / `bg-expense`.
**Rule:** No second brand color. No gradients. No drop shadows on cards. Depth = off-white canvas vs white card + 1px hairline.

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
- Errors and prompts say what to do next: "What USD → INR rate should I use? Send just the number, e.g. 88.50."
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
No photos, no illustrations, no dot patterns. The data is the visual: numbers, tables, charts. The only brand image is the logo. Icons from `lucide-react` only.
