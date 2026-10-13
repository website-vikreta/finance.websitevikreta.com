<!-- Base branch must be the current releases/YYYY-MM. Never main or stage. Title: conventional, under 70 chars (feat(scope): ...). -->

## Summary
- 1–3 bullets: what changed and why

## SRS features
- e.g. F2 (manual entry), F8 (dashboard). `n/a` for tooling/docs.

## Changes
- One bullet per commit or area: `file/area` → what changed

## Why
- Context or motivation not obvious from the diff

## Screenshots
<!-- Required for UI changes: before / after, desktop + mobile. Delete for non-UI PRs. -->

## Testing
### Build gate
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm run build` passes

### Manual checks
- [ ] Step-by-step verification specific to this change
- [ ] Mobile (375px) + desktop checked, if UI touched
- [ ] No new console errors or warnings

### Design & data
- [ ] Tokens only, no raw hex; matches `DESIGN.md` (if UI touched)
- [ ] Money as integer minor units, shown via `formatMoney`, `tabular-nums` (if money touched)
- [ ] Writes audited, deletes soft (if data touched)
- [ ] Keyboard focus + `aria-label` on icon buttons (if UI touched)
- [ ] No secrets, `.env.local`, or build output committed
- [ ] `.ai/learning.md` updated if a reusable convention was added

## Risk & Rollback
- Blast radius, and how to revert if it breaks
