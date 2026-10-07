# Command Recipe: push

> Turn the working-tree changes into logically-split commits, push, and open or update a PR.

## Trigger

Run the **push** command recipe, or invoke `/push` if your tool supports slash commands.

## Load

- Nothing from the design pipeline. This is a git workflow.

## Input Required

- Nothing. Optional: a short hint for the branch slug / PR title.
- Optional flag `--confirm`: stop before opening the PR and show the draft.

## Execution Checklist

### 1. Sanity checks
- `git status --porcelain` empty → stop, nothing to push.
- Flag stray files before staging: `.env*`, build output, `tsconfig.tsbuildinfo`, logs.
- `AGENTS.md` changes from `next dev` (the `nextjs-agent-rules` block) are expected; commit them with the work.

### 2. Build gate (mandatory, no skip)
- `npx tsc --noEmit` and `npm run build`.
- Fail → STOP. No commit, no push. Report and fix.

### 3. Branch
- On `main` → `git checkout -b <type>/<kebab-slug>` (`feat`, `fix`, `refactor`, `perf`, `chore`, `docs`, `style`). Never commit feature work straight to `main`.
- On a feature branch → stay on it.

### 4. Split into logical commits
- Group by concern, not file count. One commit per logical change.
- Conventional messages from `.ai/standards/code-standards.md`, e.g. `feat(transactions): add manual entry form`.
- End every message with the attribution lines the tool requires.

### 5. Push + PR
- No `origin` remote (`git remote -v` empty) → stop after committing and tell the user the commits are local only.
- Remote exists → `git push -u origin <branch>`.
- `gh pr list --head <branch> --state open` → PR exists: done, report URL. None: `gh pr create --base main` with:
  - Title: conventional, under 70 chars
  - Body: what changed, why, SRS feature IDs, test steps, screenshots for UI changes

### 6. `--confirm`
If passed: push, then show branch, `git log main..HEAD --oneline`, and the PR draft. Wait for go-ahead before `gh pr create`.

## Output Validation

- [ ] Build gate passed
- [ ] Not committed on `main`
- [ ] Commits split by concern
- [ ] No secrets or build artifacts staged
- [ ] PR URL reported (or "local only, no remote")
