# Code Standards — Finance Tool

## Rules That Are Not Negotiable
- TypeScript strict. No `any`. No `@ts-ignore` / `@ts-expect-error` without a comment explaining why.
- Read `node_modules/next/dist/docs/` before using a Next.js API. Next 16 differs from training data (e.g. `LayoutProps<"/">` / `PageProps<"/x">` global helpers).
- Tokens only. No hex, `rgb()` or arbitrary color values in components. Use the classes in `design-system.md`.
- shadcn primitives from `@/components/ui/*` before custom markup. Add missing ones with `npx shadcn@latest add <name>`.
- `cn()` for class merging. `next/image` for every image. `next/font` for fonts (already set up).
- Server Components by default. `"use client"` only on interactive leaves.
- Money rules in `data-safety.md` apply to every file that touches an amount.

---

## File Naming
```
src/app/(app)/transactions/page.tsx     App Router convention (route groups for shell layouts)
src/components/ui/button.tsx            shadcn primitives: kebab-case (as generated)
src/components/layout/AppSidebar.tsx    Our components: PascalCase
src/components/transactions/TxnTable.tsx
src/lib/money.ts                        camelCase / kebab for utils
src/lib/db/transactions.ts
```

## Component Structure
```tsx
// 1. Imports: external → @/components → @/lib → types
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { formatInr } from "@/lib/money"
import type { Transaction } from "@/lib/types"

// 2. Types
interface KpiCardProps {
  label: string
  amountMinor: bigint
}

// 3. Component (named export, no default except pages/layouts)
export function KpiCard({ label, amountMinor }: KpiCardProps) {
  return (
    <Card className="p-6">
      <p className="text-eyebrow uppercase text-muted-foreground">{label}</p>
      <p className="text-stat text-primary tabular-nums">{formatInr(amountMinor)}</p>
    </Card>
  )
}
```

## Data & Server Code
- All writes go through **one** server function per entity (`createTransaction`, `updateTransaction`, `softDeleteTransaction`). Manual form and chatbot both call it.
- Validate input with one shared schema on the server, even if the client validated too.
- Check role on the server for every read and write. Hiding a button is UX, not security.
- Every write: validate → duplicate check → persist → audit log → emit event. Same order, same helper.
- Secrets only in env vars. Never in client components (no `NEXT_PUBLIC_` for secrets).
- External calls (rate service, LLM) have a timeout and a user-visible fallback.

## Forms
- `<Label htmlFor>` on every field. Error text under the field, linked with `aria-describedby`, `aria-invalid` on the input.
- Disable submit while pending. Make the server action idempotent anyway (see duplicate guard).
- Preserve user input on error.

## Accessibility
- `<html lang="en">` (set). Semantic landmarks: `<nav>`, `<main>`, `<header>`.
- Tables use `<Table>` with `<TableHead>`; money columns `text-right tabular-nums`.
- Every interactive element keyboard-reachable with a visible focus ring.
- Icon-only buttons: `aria-label`. Charts: a text summary or table alternative.

## Error Handling
```tsx
// Route-level: app/<route>/error.tsx and loading.tsx for every route group.
// Server actions return a typed result, never throw raw errors to the UI:
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; field?: string }
```
User-facing error strings follow `brand.md` voice: say what happened and what to do.

## Tests
- Money math, currency conversion, duplicate detection and role checks each get a small runnable test. These are the paths that lose trust if they break.
- UI tests only when a bug proves they're needed.

## Before Handoff
```
npx tsc --noEmit
npx eslint <touched files>
```

## Git Commit Convention
```
feat(transactions): add manual entry form
fix(currency): store rate per transaction
perf(dashboard): aggregate totals in db
style(ui): align input height to DESIGN.md
chore: update shadcn components
```
