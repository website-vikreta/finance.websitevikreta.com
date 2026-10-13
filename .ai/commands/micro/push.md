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

### 3. Branch (flow: `AGENTS.md` → Git Flow)
- Find the current release: `git branch -r --list 'origin/releases/*' | sort | tail -1`.
- On `main`, `stage` or a `releases/*` branch → `git checkout -b <type>/<kebab-slug> origin/releases/<YYYY-MM>` (`feat`, `fix`, `refactor`, `perf`, `chore`, `docs`, `style`). Never commit straight to `main`, `stage` or `releases/*`.
- On a feature branch → stay on it.

### 4. Split into logical commits
- Group by concern, not file count. One commit per logical change.
- Conventional messages from `.ai/standards/code-standards.md`, e.g. `feat(transactions): add manual entry form`.
- End every message with the attribution lines the tool requires.

### 5. Push + PR
- No `origin` remote (`git remote -v` empty) → stop after committing and tell the user the commits are local only.
- Remote exists → `git push -u origin <branch>`.
- `gh pr list --head <branch> --state open` → PR exists: done, report URL. None: `gh pr create --base releases/<YYYY-MM>` (the current release, never `main` or `stage`) with:
  - Title: conventional, under 70 chars
  - Body: fill **every section** of `.github/pull_request_template.md` (Summary, SRS features, Changes, Why, Screenshots, Testing, Risk & Rollback). Tick `[x]` only checks you actually ran; mark checks that don't apply `n/a`; leave unrun ones `[ ]` and say why.
- Already-open PR and the push changed its scope → update the body with `gh pr edit <n> --body-file <file>`.

### 6. `--confirm`
If passed: push, then show branch, `git log main..HEAD --oneline`, and the PR draft. Wait for go-ahead before `gh pr create`.

## Output Validation

- [ ] Build gate passed
- [ ] Not committed on `main` / `stage` / `releases/*`
- [ ] PR base is the current `releases/<YYYY-MM>`
- [ ] Commits split by concern
- [ ] No secrets or build artifacts staged
- [ ] PR URL reported (or "local only, no remote")
