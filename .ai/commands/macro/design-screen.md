# Command Recipe: design-screen

> Full pipeline for designing a new screen or flow from scratch.

## Trigger

Run the **design-screen** command recipe, or invoke `/design-screen` if your tool supports slash commands.

## What This Does

Runs the complete Designer → Builder → Critic pipeline for a new screen.
Do not skip steps. Do not jump to code.

---

## Input Required

- Route (e.g. `/transactions/new`)
- SRS feature(s) covered (F1–F10)
- Roles that see it (manager / admin / viewer)
- Any locked constraints from `.ai/context/session.md`

---

## Execution Checklist

### Step 1 — Load Context
Read:
- `.ai/context/session.md` (locked decisions, open questions)
- `.ai/context/brand.md` (palette, type, voice)
- `.ai/context/business.md` (the SRS section for this feature)
- `.ai/learning.md` (scan for related entries)

If the screen depends on an unresolved open question (DB, rate source, auth, edit rights), stop and ask the user.

### Step 2 — Designer Pass
Load: `.ai/agents/designer.md`

Answer the Job, Glance, Trust, Safety and States questions.
Map the flow: `ENTRY → ACTION → FEEDBACK → RECOVERY`.
Fill and output the Designer Handoff Block.

### Step 3 — Builder Pass
Load: `.ai/agents/builder.md`
Load: `.ai/standards/design-system.md`
Load: `.ai/standards/data-safety.md` if the screen reads or writes money/records.

Using the Designer handoff:
1. Component list (shadcn primitives first, then feature components)
2. Layout with exact classes from `design-system.md`
3. Data path: UI → server action / route handler → DB → audit → event
4. Loading / empty / error / read-only states
5. Perf plan against the 3 s dashboard / 5 s chat targets

Fill and output the Builder Handoff Block.

### Step 4 — Critic Pass (on the plan)
Load: `.ai/agents/critic.md`

Score the plan. Check all Automatic Fails.
If REVISION ROUTE = Designer or Builder: go back. Do not proceed.
If REVISION ROUTE = Ship: implement.

### Step 5 — Implement
Follow `.ai/standards/code-standards.md`. Run `npx tsc --noEmit` and `npx eslint` on touched files.

### Step 6 — Humanize the copy (mandatory before done)
Run `.ai/commands/macro/humanize.md` over every visible string: labels, placeholders, empty states, errors, toasts, dialogs, chatbot lines.

### Step 7 — Critic Pass (on the code)
Re-score the built screen. Fix until Ship or the user accepts named gaps.

Update `.ai/context/session.md` when done.

## Output Validation

- [ ] Designer Handoff Block completed
- [ ] Builder Handoff Block completed
- [ ] Critic Final Verdict = Ship (plan and code)
- [ ] All states designed and built
- [ ] Humanize pass run on all visible copy
- [ ] `tsc --noEmit` + `eslint` clean
- [ ] `session.md` updated
- [ ] Reusable decisions logged to `.ai/learning.md`
