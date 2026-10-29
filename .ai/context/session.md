# Session State â€” Live Scratchpad

> Update after each task. Keep under 100 lines.

## Current Task

2026-10-29: Bank-connections UX — bulk duplicate, review auto-resume, dynamic reconciliation, production visibility (`feat/bank-import-review-ux`, cut from `feature/export-csv`).
- Bulk duplicate: one checkbox selection now drives `Import selected (n)` (importable subset) and a new `Duplicate (n)` button (pending/ready subset, editable review only) with an inline confirm; `markLinesDuplicate` in `review.ts` marks up to 100 rows in one locked transaction (per-row `duplicate_marked` audits, shared note `BULK_DUPLICATE_NOTE` = "Selected as duplicate in review", already-duplicate rows counted, blockers returned as per-row failures); result panel mirrors the import one. `bulkDuplicateDecision` is the pure policy under test.
- Section resume (reworked after user feedback): the bank-connections section remembers the LAST VISITED screen per browser — a list visit (`?list=1`) or one specific statement id, completed/history reviews included — in localStorage (`finance.bank-connections.section`, `lib/bank-import/section-memory.ts`). Returning via the sidebar soft-reopens exactly that screen: `components/bank-import/section-entry.tsx` (`BankConnectionsEntry` wraps the list data, `TrackStatementVisit` marks each statement page) validates the remembered id against live ids and `router.replace`s; stale/deleted ids self-heal to the list; `?list=1` forces + re-remembers the list. Replaced the DB-driven `getLatestOpenStatement()` resume (removed from `queries.ts`): it picked the wrong PDF and bounced users off an intentional `?list=1` visit. Streamed `redirect()` = MPA full reload (verified `doMpaNavigation`) — always resume client-side; the memory is read via `useSyncExternalStore` (no setState-in-effect). Banner stays removed by user request.
- Dynamic reconciliation: `deriveBalancesFromRows` fills missing opening (FIRST row only, countable movement required) / declared closing (last printed balance) when statement metadata is empty; shown as info notes, never written back, so existing staged statements (incl. the two real ones) now show Opening/Declared closing/Difference without a re-upload; uncountable rows no longer block the balance check (status `unbalanced` with the excluded-rows warning).
- Production visibility root cause: the whole bank-import feature (pages, actions, `lib/bank-import`, upload API) exists only on `feature/bank-statement` and `feature/export-csv`; `releases/2026-10` and `origin/stage` still contain only the old `app/bank-connections/page.tsx` "Coming soon" placeholder, and `origin/main` has NO bank-connections route (404 in prod). Fix = git flow only (user performs it): PR `feat/bank-import-review-ux` (contains the `feature/bank-statement` + CSV/settings lineage) → `releases/2026-10` → stage → main. Nothing was merged/deployed by the agent.
- Verified: `npm run test:bank-import` offline suites all pass (safe-log 7, parser 28, duplicates 11, pdf 13, regression 19, business-description 10, review 41 (+8: 4 new derivation checks + 4 bulk-duplicate policy), upload 9, import 15). DB-backed suites skipped per standing TEST_DATABASE_URL decision. `tsc`, ESLint on touched paths (lib/bank-import, app/bank-connections, components/bank-import), and `next build` (all routes, /bank-connections partial-prerender) pass. No commits/pushes, no shared-DB writes, no statement content printed.

2026-10-28: Bank-import statement fidelity + cross-statement duplicate detection (`lib/bank-import/*`).
- Parser fixed for both supplied statement formats: explicit `0.00` placeholder columns (no `ZERO_AMOUNT` beside a valid amount, missing-amount rows stay pending), narration printed above the amount row (lead attaches to the nearest anchor), footer state only from whole furniture wording (URL lines inside narration no longer end the page), metadata rows filtered, `TO : DD/MM/YY` period metadata accepted, row-level balance chain (`BALANCE_MISMATCH` advisory). `PARSER_VERSION` 1.4.0.
- Verified on the two real PDFs (in memory only, never committed): A = 57/57 rows (56 ready, 1 pending negative), B = 130/130 (128 ready, 2 pending negative); per-page geometry counts matched.
- Duplicates: staging pass 2 — canonical reference fold (`canonicalReferenceKey`: lowercase, separators, leading zeros; all-zero refs are placeholders) + date + signed amount + direction, same bank account. On the real pair 57/57 overlapping rows now pair 1:1 (11 exact fingerprints + 46 through the fold; 0 uncovered, 0 ambiguity). Reversals/different amounts/zero rows never key. Offline suite `__tests__/duplicates.ts` (11 checks) added to `test:bank-import`; B-format PDF fixture (0.00 columns, lead-above, URL narration, compact `TO :` metadata) added to `__tests__/pdf.ts`.
- Verified: `npm run test:bank-import` 145 offline checks across 9 suites (safe-log 7, parser 28, duplicates 11, pdf 13, regression 19, business-description 10, review 33, upload 9, import 15); tsc clean; ESLint clean on `lib/bank-import`; `next build` passes. DB-backed suites (review-db/upload-db/import-db/financial-integration-db) skipped: no disposable PostgreSQL access per user decision; a local postgresql-x64-18 service exists but credentials were not provided. No DB writes, no `.env.local` changes, nothing committed.
- Diagnostics cleaned: `node_modules/.cache/*.ts|mjs` deleted; `D:\temp\opencode\bank-import-*.json`, `recon-tables.json`, `debug-anchors.txt`, `debug-flags.ts` (statement-derived dumps) deleted.

2026-10-28: Added "Contractor Payment" category + SWIFT code field (`feature/export-csv`).
- Category: appended "Contractor Payment" after "Salaries" in `lib/transactions/categories.ts` (forms + chatbot enum/prompt use the const; ledger filter and bank-import review read the DB). Migration `drizzle/0020_contractor_payment_swift.sql` inserts it `ON CONFLICT DO NOTHING` — APPLIED to the live Supabase DB on 2026-10-31 via `npm run db:migrate` (verified: category id 11 present, `swift_code` column present).
- SWIFT: `company_profile.swift_code` varchar(11) (schema.ts + migration 0020 + snapshot 0020 + journal idx 20). Settings form field "SWIFT code" right after IFSC with identical behavior (upper-normalize, confirmation diff, admin-only, audited). Validation regex `^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$` (8 or 11 chars, looks like HDFCINBB). Invoice doc prints SWIFT only when filled, same as IFSC.
- Verified: tsc, ESLint on changed files, `test:manage-input`, `test:ask`, `test:clarify`. No DB writes, no commits.

2026-10-26: Fixed `######` dates in all CSV exports; added Export PDF to the Clients page (`feature/export-csv`).
- Root cause: Excel auto-converts date-looking CSV strings into date cells and collapses them to `######` at the default column width (text cells never do, which is why only some columns broke). Clients CSV also wrote raw ISO (`lastPaymentDate`, `firstSeen`).
- Fix: shared `dateCell` in `lib/transactions/csv.ts` writes strict `YYYY-MM-DD` with one leading space (stays text in every spreadsheet), used by ledger CSV (transactions page + Settings → Export all), clients CSV, and the report CSV transactions section; old and new rows render identically. Unit tests (`test:clients`) + the bank-import financial-integration assertion now pin the format.
- Clients page: Export PDF added via the shared `ExportPdfButton` (now accepts `disabled`) wired to the previously committed but never-wired `components/clients/print-clients.tsx` (restored to its committed design: "Clients report" title, Metric summary, Location/GSTIN column, sorted-by badge; screen-consistent labels, shared `owedText` moved to `lib/format.ts`, row-level `negative` flag dropped because PrintTable colors only the last cell). Search/filter/sort rows sit inside `print:hidden`, mirroring the transactions page.
- Also unblocked `next build`: the pre-existing `Uint8Array` → `BlobPart` type error in `lib/bank-import/__tests__/business-description-e2e-db.ts` (documented 2026-10-25) is fixed with a scoped `as BlobPart` on the test's synthetic-PDF bytes.
- Verified: `npm run test:clients`, `test:precision`, `test:invoices`, `test:cn`, `test:credentials`, `test:manage-input`, ESLint on changed files, `tsc --noEmit`, `next build` (all routes), real-DB read-only smoke (48 real `txn_date` values → every ledger/report Date cell `" YYYY-MM-DD"`). DB-backed suites skipped (no disposable DB; live app DB untouched); unauth redirects (`/login` 200, protected 307) confirmed on `next dev`.

2026-10-25: Permanent client deletion moved to `feature/bank-statement` for combined testing with bank-import.
- `permanentlyDeleteClient` in `lib/clients/clients.ts`: atomic hard-delete of client + transactions/invoices/recurring bills in one PG transaction; bank-import staging rows retained (client link removed, links to deleted txns/invoices severed & marked skipped); minimal audit event recorded.
- Strong confirmation requires exact client name; counts recomputed server-side; no guard blocking deletion due to linked records.
- `app/clients/actions.ts`: `deleteClientAction(id, confirmationName)` + `clientDeletionPreviewAction(id)`.
- UI: `ClientDeleteDialog` (name confirmation, counts, retain/disclose policy), delete icon per client card (clients-grid + client-actions), `router.refresh()` after commit.
- DB test: `lib/clients/__tests__/permanent-deletion-db.test.ts` (12 scenarios, gated on TEST_DATABASE_URL).
- Verified: ESLint 0 errors on changed files; tsc clean for my files (pre-existing Uint8Array/BlobPart error in lib/bank-import/__tests__/business-description-e2e_db.ts unrelated). `next build` type-check blocked by that pre-existing error only.
- No disposable PostgreSQL available locally; DB tests skip without TEST_DATABASE_URL.

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
