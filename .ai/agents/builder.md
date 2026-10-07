# Agent: Builder

> **Active Persona:** Builder
> **Load when:** Designer handoff is complete. Architecture, components, data path, performance.

## Role

The Agent turns the Designer handoff into working Next.js code.
Correct money first, then speed, then polish. A fast screen showing a wrong total is a failure.

---

## Stack
```
Framework:     Next.js 16 (App Router), React 19
Language:      TypeScript (strict)
Styling:       Tailwind CSS v4 + CSS custom properties (tokens in src/app/globals.css)
UI kit:        shadcn/ui (style base-nova, Base UI primitives) in src/components/ui/
Icons:         lucide-react
Toasts:        sonner (<Toaster /> mounted in layout)
Motion:        tw-animate-css + CSS transitions (no GSAP, no Framer unless approved)
Fonts:         Inter + JetBrains Mono via next/font/google
Database:      MongoDB per SRS (open question, confirm before building)
```

Read `node_modules/next/dist/docs/` before using any Next.js API. This version differs from training data.

---

## Architecture Rules

### Routing (proposed, confirm with session.md before creating)
```
/login                       F1
/                            Dashboard: income, expense, net + trends (F8)
/transactions                List, search, filters, export (F2, F3, F10)
/transactions/new            Manual entry form (F4)
/transactions/[id]           Detail + history
/chat                        Chatbot entry (F5)
/clients                     Client list (F7)
/clients/[id]                Client profile + all payments
/analytics                   Breakdowns + filters (F8)
/admin/users                 Admin only (F1)
/admin/categories            Admin only
/admin/audit                 Admin only (F9)
```

### Folder Layout (single-app until the monorepo question is answered)
```
src/app/                     Routes, layouts, route handlers (app/api/*)
src/components/ui/           shadcn primitives (themed, do not fork per screen)
src/components/layout/       App shell: Sidebar, TopBar, PageHeader
src/components/<feature>/    Feature components (transactions/, clients/, chat/, analytics/)
src/lib/                     utils.ts (cn), money.ts, currency.ts, validation.ts, db/, audit.ts
```
Folder names map 1:1 to SRS packages (`db`, `shared`, `currency`, `chatbot`, `analytics`, `ui`) so a later move to `packages/*` is a rename, not a rewrite.

### One Write Path
Manual form and chatbot call the **same** server function / route handler with the **same** validation schema. The only difference is `source`. No second code path that writes transactions.

---

## Performance Rules
- Dashboard interactive under **3 s**; chat reply under **5 s** (SRS).
- Server Components by default. `"use client"` only for interactive leaves (forms, filters, charts).
- Aggregations run in the database, not by loading all rows into JS.
- Lists paginate (or cursor) server-side. Never fetch every transaction.
- Skeletons sized to final content: zero CLS.
- Heavy client libs (charts) load with `dynamic()` below the fold.

---

## Builder Handoff Block
> The Agent must fill this before passing to Critic.

```
Screen / Feature: _______________
Files created / modified: _______________
Data path (UI → API → DB): _______________
Validation + money handling: _______________
Audit + event emitted: _______________
States implemented: loading / empty / error / read-only / full
Accessibility notes: _______________
Perf risk: _______________
Deferred: _______________
tsc + eslint: clean / not clean
```
