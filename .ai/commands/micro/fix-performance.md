# Command Recipe: fix-performance

> Diagnose and fix a slow screen, slow chat reply, or layout shift.

## Trigger

Run the **fix-performance** command recipe, or invoke `/fix-performance` if your tool supports slash commands.

## Load

- `.ai/agents/builder.md` (performance section)
- `.ai/context/session.md`

## Input Required

- Route or component
- Symptom: slow dashboard (>3 s) / slow chat (>5 s) / CLS / big bundle / slow table

## Diagnosis Path

### Dashboard > 3 s
- Are totals aggregated in the database, or are all rows pulled into JS?
- Are queries indexed on `txn_date`, `client_id`, `category_id`, `deleted_at`?
- Are independent queries awaited in sequence instead of `Promise.all`?
- Is the page a Server Component, or did `"use client"` creep up to the page level?
- Are charts dynamically imported?

### Chat reply > 5 s
- Is the LLM call streaming?
- Is the rate fetch running in parallel with extraction, and cached for the day?
- Is there a timeout + "enter it manually" fallback?

### Slow tables
- Server-side pagination / cursor? Never fetch all transactions.
- Search hitting an index, debounced input?

### CLS
- Skeletons sized to final content?
- Fonts through `next/font` (already set)?
- Toasts / banners overlaying instead of pushing content?

### Bundle
- `next build` output: which route is heavy?
- Chart / date libs imported whole instead of per-module?

## Output Validation

- Root cause named
- Fix applied
- Before / after measurement stated
- Reusable perf rule logged to `.ai/learning.md`
