# Vision — Finance Tool

## The Goal
Replace scattered sheets with one place that answers "where does our money stand?" in one glance, and makes adding a transaction faster than opening a spreadsheet.

## Principles
- **Seconds to enter.** A manager types "Acme paid $300 today" and confirms. Done.
- **One glance to read.** Income, expense, net are the first thing on screen.
- **Nothing is lost, nothing is wrong.** Exact money, no duplicates, soft deletes, full audit history.
- **Every rupee is traceable.** Each number on a chart can be opened down to the transactions behind it.

## What "Done Well" Looks Like
- A new manager records their first transaction without being shown how.
- Totals on the dashboard always match the sum of the transaction list for the same filters.
- A USD entry from three months ago still shows the rate it was saved at.
- An admin can answer "who changed this and when" from the audit log alone.

## Success Criteria (v0.1)
- F1–F10 shipped for INR + USD.
- Dashboard loads under 3 s; chat reply under 5 s.
- Zero silent saves from the chatbot.
- Zero rounding drift between stored values and displayed totals.

## Growth Path (later, not now)
More currencies → budgets and approvals → invoices and tax → bank import → more submodules. Design screens so new modules slot into the sidebar without reworking existing ones.
