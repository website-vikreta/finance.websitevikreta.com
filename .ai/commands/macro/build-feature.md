# Command Recipe: build-feature

> End-to-end workflow for an SRS feature (F1–F10) or a slice of one: discovery through critique. Covers data, API and UI together.

## Trigger

Run the **build-feature** command recipe, or invoke `/build-feature` if your tool supports slash commands.

## What This Does

Runs **Discovery → Spec → Build → Critique** with the Designer / Builder / Critic personas at each gate.
Do not skip to code. Do not ship without the Critic pass.

---

## Input Required

- Feature ID + name (e.g. "F6 Currency handling") and scope (route, files)
- Outcome for the manager
- Known constraints from `.ai/context/session.md` and `.ai/learning.md`

---

## Phase 1 — Discovery

**Load:** `.ai/context/session.md`, `.ai/context/business.md`, `.ai/context/target-users.md`, `.ai/learning.md` (related entries)

**The Agent must answer:**
1. What job does this feature do for the manager / admin?
2. Which SRS rules apply (currency, soft delete, audit, confirm-before-save)?
3. What already exists that can be reused (components, lib helpers, schemas)?
4. What is out of scope (SRS "Later" list) or blocked by an open question?
5. Which roles can use it?

**Output — Discovery Brief:**
```
Feature: _______________
Job: _______________
SRS rules in play: _______________
Reuse candidates: _______________
Out of scope / blocked: _______________
Roles: _______________
```

If an open question blocks the feature → stop and ask the user before Phase 2.

---

## Phase 2 — Spec

**Load:** `.ai/agents/designer.md`
**Load one standard** matched to the feature:
- Screens / layout → `.ai/standards/design-system.md`
- Money, records, roles, audit → `.ai/standards/data-safety.md`
- Motion → `.ai/standards/motion-system.md`
- Code structure → `.ai/standards/code-standards.md`

**The Agent must produce:**
1. Data shape changes (fields, indexes, minor units)
2. Server functions + validation schema (one write path)
3. Screens / components (ordered list) with states
4. Copy drafts, humanized now
5. Events emitted for the automation team
6. Tests: the smallest runnable checks for the money/role/duplicate logic
7. Perf risks (queries, bundle, CLS)

**Output — Spec Handoff:**
```
Feature: _______________
Data changes: _______________
Server functions: _______________
Screens / components: _______________
Copy drafts (humanized): _______________
Events: _______________
Tests: _______________
Perf risks: _______________
```

If any Automatic Fail from `.ai/agents/critic.md` is visible in the spec → revise before Build.

---

## Phase 3 — Build

**Load:** `.ai/agents/builder.md`, `.ai/standards/code-standards.md`

**Execution rules:**
- Match existing naming, imports and patterns
- Tokens only, no raw hex
- shadcn primitives first
- Money per `data-safety.md`: minor units, stored rate, one formatter
- Server-side role check + audit + event on every write
- Run `npx tsc --noEmit`, `npx eslint` on touched files, and the feature's tests

**Output — Build Handoff** (the Builder block in `.ai/agents/builder.md`).

---

## Phase 4 — Critique

**Load:** `.ai/agents/critic.md`

Score against the full rubric. Run Automatic Fails. Score copy against `.ai/commands/macro/humanize.md`.

| Verdict | Action |
|---------|--------|
| REVISION ROUTE = Designer | Rethink flow, states, copy |
| REVISION ROUTE = Builder | Fix data path, money, perf, tokens |
| REVISION ROUTE = Ship | Close out |

Repeat Build → Critique until Ship or the user accepts named gaps.

---

## Close-out (mandatory)

1. Humanize every visible string
2. Update `.ai/context/session.md`: current task, locked decisions, open questions, screens completed
3. Append reusable conventions to `.ai/learning.md` (one entry = one rule, exact values)

## Output Validation

- [ ] Discovery Brief completed
- [ ] Spec Handoff completed
- [ ] Build Handoff completed
- [ ] Critic Final Verdict = Ship
- [ ] Money / role / duplicate tests pass
- [ ] Humanize pass clean
- [ ] `tsc --noEmit` and `eslint` clean on touched files
- [ ] `session.md` updated, `learning.md` updated if anything reusable
