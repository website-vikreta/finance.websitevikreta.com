# Command Recipe: audit-component

> Quick design, accessibility and data-safety audit on one component.

## Trigger

Run the **audit-component** command recipe, or invoke `/audit-component` if your tool supports slash commands.

## Load

- `.ai/agents/critic.md` (rubric + Automatic Fails)
- `.ai/standards/design-system.md` (token compliance)
- `.ai/standards/data-safety.md` only if the component shows or edits money/records

## Input Required

- Component file path or pasted code

## Audit Checks

**Design (DESIGN.md fidelity)**
- [ ] No raw hex / rgb / arbitrary colors; only token classes
- [ ] At most one yellow (`bg-primary`) action in the view
- [ ] Type uses the scale classes (`text-display-*`, `text-title-*`, `text-stat`, `text-body-*`, `text-caption`, `text-eyebrow`)
- [ ] Radius: buttons/inputs `rounded-lg` (8px), cards `rounded-xl` (12px), badges `rounded-full`
- [ ] No shadows on in-page surfaces, no gradients
- [ ] Hover = one surface step (`hover:bg-accent`), nothing more
- [ ] Uses shadcn primitives where one exists

**Money / data**
- [ ] Amounts formatted by the shared helper, `tabular-nums`, right-aligned in tables
- [ ] USD rows show original amount + rate + INR
- [ ] No client-side summing of full datasets

**Accessibility**
- [ ] Keyboard reachable, visible yellow focus ring
- [ ] Labels tied to inputs, errors via `aria-describedby`
- [ ] Icon-only buttons have `aria-label`
- [ ] Text contrast: nothing the user must act on is in `muted-soft`

**States & copy**
- [ ] Loading, empty, error, read-only handled
- [ ] Visible strings pass `.ai/commands/macro/humanize.md`

## Output Validation

- Pass / Fail per check
- Exact lines to fix
- Fixed version of the component (if failures found)
