# Session State â€” Live Scratchpad

> Update after each task. Keep under 100 lines.

## Current Task

2026-10-24: Fix bank-statement income client creation when a matching client exists.
- The bank-import helper limited an unfiltered client lookup to one row, then compared only that row. When another active client came first, an existing name was missed and the normalized-name unique index produced the generic failure.
- The helper now searches by collapsed, case-insensitive active client name in SQL and reuses the matching client ID. The UI distinguishes reuse from creation and tells the reviewer to save the row to persist the link. Added disposable DB regression coverage for a later match and extra whitespace.
- No app database writes. DB-backed regression remains gated on `TEST_DATABASE_URL`.

2026-10-24: Fix HDFC page-footer contamination and review-save diagnostics.
- HDFC footers may arrive with all spaces removed or appended to the last transaction cell. The parser now strips known footer suffixes, ignores remaining page furniture, and resets the footer boundary at each repeated header.
- Regression coverage exercises a synthetic four-page PDF and the text fallback: 8 source transactions remain 8, footer text is absent, and final rows do not gain `AMBIGUOUS_ENTRY`.
- Review saves now report the stale amount-check case when SQLSTATE 23514 names `chk_bank_statement_lines_amounts`; logs include only an allowlisted constraint and SQLSTATE. The configured application DB still needs migration 0018, which was not applied.
- `npm run test:bank-import`, TypeScript, scoped ESLint and production build passed. DB-backed suites skipped because `TEST_DATABASE_URL` is unset. No shared DB write or real statement reprocessing occurred.

2026-10-24: Diagnose and fix bank statement upload HTTP 500.
- Configured app DB is remote PostgreSQL (`postgres`, port 5432); read-only migration history showed 0017 latest, so 0018 is not applied. Existing `chk_bank_statement_lines_amounts` requires positive amounts. The synthetic failure reproduced SQLSTATE 23514 on that constraint when a negative source amount is staged; the supplied PDF's negative amount is correctly flagged pending.
- Migration 0018 + Drizzle schema permit negative/zero amounts only on pending rows with their matching flags. Ready rows still require positive amounts. Upload persistence returns the generic save error and logs only allowlisted SQLSTATE + constraint, including nested Drizzle causes.
- A disposable loopback PostgreSQL 18 cluster received migrations through 0018 via the repository's Drizzle migrator. The full bank-import suite passed: 214 checks, including a synthetic multipart POST containing positive rows and one flagged negative row, audit + row persistence, and rollback on an invalid database write. TypeScript, scoped ESLint, Drizzle check and production build passed.
- No shared DB writes, `.env.local` changes, or real statement upload/reprocessing occurred. The app DB still needs migration 0018; it was not applied per instruction. Original IDE terminal stack output was not accessible; the failing SQLSTATE and constraint were reproduced on disposable local PostgreSQL.

2026-10-24: Fix bank statement PDF extraction for the supplied four-page format.
- Root cause: PDF had no drawn table grid, so PDFParse fell back to tab text. Trimming dropped empty cells; 14 amount-bearing continuation lines became extra records. A generic table continuation rule could also merge a dated row with no amount.
- PDF.js coordinate extraction now reads the printed seven-column header and right-aligned value bands; empty cells are retained. Only no-date/no-amount text continues a preceding dated record. Unaligned rows do not promote balances into amounts; negative signs stay in their source column.
- Local aggregate source-to-output check: 57 source date rows -> 57 staged rows; 0 missing, extra, or duplicate rows; 0 mismatches across transaction date, value date, narration, reference, withdrawal, deposit, closing balance, direction and classification. 84 text-only continuation fragments attached; no undated numeric candidates.
- Result: 52 Ready, 5 Pending (1 negative source amount, 4 ambiguity/classification rows); 56/56 consecutive balance movements matched. Statement-level opening/closing reconciliation unavailable because metadata was not extracted.
- Synthetic offline bank-import tests, TypeScript, scoped ESLint and production build passed. DB-backed tests skipped; no database writes, imports, commits or deploys. The supplied PDF remained local and no transaction details were printed or added to the repo.
## Locked Decisions

- Visual system: `DESIGN.md`, light theme, tokens, Inter + JetBrains Mono.
- UI: shadcn/ui Base UI primitives; Next.js 16 App Router, React 19, Tailwind v4, strict TypeScript.
- INR is the base currency. Money uses exact decimal/minor-unit rules already established in `lib/currency/precision.ts`.
- Chatbot writes require explicit confirmation. Transaction writes are audited. Deletes are soft.
- Bank import: only labeled source amount columns establish direction; closing balance is reconciliation-only. Misaligned rows stay pending. See `.ai/learning.md`.
- No made-up data. Modules without a backend use `ComingSoon`.
- Git flow: feature branches target `releases/2026-10`; never merge or deploy from a task branch.

## Current Repo State

- Branch: `feature/upgrade_finance`.
- The working tree contains substantial unrelated uncommitted work. Preserve it; do not reset, clean, stash, or overwrite it.
- The bank import implementation and migration are present as untracked work from the prior agent. No commit, push, deploy, or remote DB operation was performed for this task.
- Bank import DB suites must use a disposable local database before execution; older chatbot integration/persistence suites may write to the configured database.

## Open Questions

- Database direction in the original SRS (MongoDB or current PostgreSQL implementation).
- Exchange-rate source; whether USD expenses are supported; manager edit permissions; auth and chatbot provider decisions.
