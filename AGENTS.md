# Finance Tool — Universal AI Instruction Router

> **Entry point for every AI tool** (Claude Code, Cursor, Codex, Windsurf, ChatGPT, etc.).
> Canonical instructions live in `.ai/`. Load selectively. Never bulk-read the folder.

## What This Project Is

An **internal finance tracker** for Website Vikreta managers (`finance.websitevikreta.com`). One place to record, track and understand company money: income and expenses, in INR and USD. Not client-facing. Spec: Finance Tool SRS v0.1, summarized in `.ai/context/business.md`.

Entering a transaction takes seconds (form or chatbot). Reading the numbers takes one glance (analytics). Nothing is lost, nothing is wrong, every rupee is traceable.

## Non-Negotiables

- **Visual source of truth: `DESIGN.md`** (ClickHouse system). Near-black canvas, electric yellow `#faff69`, Inter + JetBrains Mono. Dark only.
- Do **not** borrow UI from the main Website Vikreta site (light theme, `#FFD600`, Epilogue). Different product, different system.
- **Money is exact.** Integer minor units, stored rate per transaction, INR is the base currency. See `.ai/standards/data-safety.md`.
- **Nothing saves silently.** Chatbot entries always show a confirm card first.
- **Every write is audited**, every delete is soft.
- shadcn/ui (Base UI) primitives in `src/components/ui/` first. Build custom only when no primitive fits.
- Tokens only. No raw hex in components.
- Speed: dashboard under 3 s, chat reply under 5 s.
- Uniformity. Reuse logged conventions in `.ai/learning.md`. Never reinvent spacing/type/color per screen.

## Before Any Implementation — Run This Pipeline

```
1. DESIGNER  →  .ai/agents/designer.md   (job, flow, states, data shown)
2. BUILDER   →  .ai/agents/builder.md    (architecture, components, data path)
3. CRITIC    →  .ai/agents/critic.md     (score, route back or ship)
```

Never skip to code. Job → Flow → States → Architecture → Code.
Small fixes (one component, one bug) can go straight to Builder with the matching micro recipe.

## Context Window Rule (Mandatory)

**Load `session.md` + exactly ONE relevant standard + ONE agent persona per task.**

**Always load with every task:**

- `.ai/context/session.md` — current task, locked decisions
- `.ai/context/brand.md` — palette, type, microcopy voice (summary of `DESIGN.md`)

**Load additionally when the task requires it:**

- The ONE relevant file from `.ai/standards/`
- `DESIGN.md` for exact component specs (button-primary, stat-callout, pricing-tier-card ...)
- Writing user-facing text? Also load `.ai/context/ai-slop-stop-skill.md` and run `.ai/commands/macro/humanize.md`

## Reference Index

| Need | File |
|------|------|
| What we're building + SRS summary | `.ai/context/business.md` |
| Who uses it | `.ai/context/target-users.md` |
| Brand + voice | `.ai/context/brand.md` |
| Vision + success criteria | `.ai/context/vision.md` |
| Current session | `.ai/context/session.md` |
| Full visual spec | `DESIGN.md` |
| Flow + states persona | `.ai/agents/designer.md` |
| Build + perf persona | `.ai/agents/builder.md` |
| Score + critique persona | `.ai/agents/critic.md` |
| Tokens → Tailwind classes | `.ai/standards/design-system.md` |
| Animation | `.ai/standards/motion-system.md` |
| Code rules | `.ai/standards/code-standards.md` |
| Money, currency, audit, roles | `.ai/standards/data-safety.md` |
| Anti-slop writing | `.ai/context/ai-slop-stop-skill.md` |
| Conventions log | `.ai/learning.md` |

## Task Recipes (Commands)

Recipes in `.ai/commands/` are tool-agnostic workflows. Invoke by name or slash command if your tool supports it (`/design-screen`, `/humanize`, ...).

### Macro (full workflows)

| Recipe | File | When to use |
|--------|------|-------------|
| `build-feature` | `.ai/commands/macro/build-feature.md` | New feature (F1–F10) from discovery through critique |
| `design-screen` | `.ai/commands/macro/design-screen.md` | New screen: Designer → Builder → Critic → implement |
| `humanize` | `.ai/commands/macro/humanize.md` | Strip AI-writing tells from any UI text |

### Micro (focused tasks)

| Recipe | File | When to use |
|--------|------|-------------|
| `add-animation` | `.ai/commands/micro/add-animation.md` | Add or fix motion on one component |
| `audit-component` | `.ai/commands/micro/audit-component.md` | Design-token + a11y + data-safety audit on one component |
| `fix-performance` | `.ai/commands/micro/fix-performance.md` | Dashboard / chat too slow, bundle, CLS |
| `push` | `.ai/commands/micro/push.md` | Build gate, split commits, push, PR |

## Learning Log — Consistency Memory

`.ai/learning.md` is the persistent record of every reusable design + code convention.

- **Read it** before building any screen/component. Reuse what exists.
- **Update it** whenever a reusable decision is made. One entry = one rule, exact values.
- **Honor it.** If new work conflicts with a logged rule, follow the rule or update it with a reason. No silent divergence.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
