# Session State — Live Scratchpad

> Update this file at the end of every task. Loaded by default with every task. Keep it under 100 lines.

---

## Current Task

2026-10-07: Project setup. AI instruction system created (mirrors the `websitevikreta-fork` `.ai/` layout, adapted for an internal app). `DESIGN.md` tokens wired into `src/app/globals.css`; Inter + JetBrains Mono in `layout.tsx`; `<html class="dark">`; `noindex`. shadcn/ui (base-nova, Base UI) initialized with 21 primitives. Button/Input/Select resized to DESIGN.md specs (40px). `src/app/page.tsx` is now a demo dashboard (hard-coded data) for checking the styling; replace with the real F8 dashboard.

**Next up:** F1 login + app shell (sidebar, top bar), then dashboard (F8 totals).

## Locked Decisions

- Visual system: `DESIGN.md` (ClickHouse). Dark only. `#faff69` primary. Inter + JetBrains Mono. NOT the main Vikreta brand.
- UI kit: shadcn/ui, style `base-nova`, Base UI primitives, lucide icons. Components live in `src/components/ui/`.
- Framework: Next.js 16 App Router, React 19, Tailwind v4, TypeScript strict.
- INR is the base currency. All analytics use `inr_amount`.
- Rate is stored per transaction and never recalculated.
- Chatbot never saves without an explicit confirm.
- Deletes are soft. Every create / edit / delete writes an audit entry.
- Automation team owns n8n/webhooks. We only emit events.
- Internal tool: no SEO, no marketing pages, `robots: noindex`.
- Git flow: feature → `releases/YYYY-MM` → `stage` → `main` (prod, monthly, admin-only merge). Current release `releases/2026-10`. See `AGENTS.md` → Git Flow.

## In Progress

_None_

## Open Questions

- SRS says monorepo + npm workspaces (`apps/web`, `packages/*`). This repo is a single Next.js app at the root. Convert before backend work starts, or keep single-app with `src/lib/*` folders? **Ask before restructuring.**
- Database: MongoDB (SRS base plan) or another DB? (SRS open question)
- Exchange-rate source? (SRS open question)
- Expenses in USD too, or INR only? (SRS open question)
- Can a manager edit old entries, or only Admin? (SRS open question)
- Auth provider for F1?
- Chatbot LLM provider for F5?

## Screens Completed

_None yet_

## Components Locked

<!-- Reusable components finalized and not to be changed without updating learning.md -->

- `src/components/ui/*` — shadcn primitives, themed via tokens. Edit only for token/size alignment with DESIGN.md; log every edit in `learning.md`.
