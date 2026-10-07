# Business Context — Finance Tool

> Source: **Finance Tool SRS v0.1** (draft, internal). More modules will be added. When the SRS changes, update this file first.

## What It Is
An internal web app where Website Vikreta managers record, track and understand company money: income and expenses.
**Not a client-facing product.** No marketing pages, no SEO, no lead gen. Every page is `noindex`.

## Problems It Solves
- Scattered sheets and notes
- Mixed USD / INR confusion
- No single view of income vs expense

## Roles
| Role | Can do |
|------|--------|
| Manager (main user) | Add / edit income and expenses, manage clients, use chatbot entry, view analytics |
| Admin | Everything a manager can, plus users, roles, categories, audit log |
| Viewer (later) | Read-only analytics |

## Core Flow
```
Login → Dashboard (income, expense, net) → Add a transaction
  ├─ Manual form ─────────────────────────────┐
  └─ Chatbot: plain words → bot extracts      │
       fields → confirm card (edit / cancel)  │
       → confirm ─────────────────────────────┤
                                              ▼
                              Validate fields (one shared API)
                                              ▼
                     Currency? INR → save as INR
                               USD → fetch rate, convert, save USD + rate + INR
                                              ▼
                 Analytics refresh → Audit log written → Event sent to automation team
```

## Features (v0.1 scope: F1–F10, INR + USD)
| ID | Feature | What it does |
|----|---------|--------------|
| F1 | Login & roles | Secure sign-in; access by role |
| F2 | Income tracking | Record money received, linked to a client |
| F3 | Expense tracking | Record money spent, with category and note |
| F4 | Manual entry | Form with validation for every transaction |
| F5 | Chatbot entry | Add transactions by chatting; saved only after the manager confirms |
| F6 | Currency handling | INR saved as is; USD converted to INR, both stored |
| F7 | Client records | Client profile with all their payments |
| F8 | Analytics | Charts and totals, filtered by date, client, category, currency |
| F9 | Data safety | No data loss, no duplicates, full change history |
| F10 | Search & export | Find any entry; download reports |

**F4 + F5:** two ways in, one database path. Same validation, same API. Every entry stores `source: manual | chatbot`. The bot asks a question when unsure (missing amount, unclear currency).

## Analytics (F8)
- **Totals:** total income, total expense, net (income − expense)
- **Breakdowns:** by client, by expense category, by currency (INR vs USD)
- **Trends:** monthly income vs expense, top clients, source split (manual vs chatbot)
- Filters: date range, client, category, currency. Numbers update right after each save.

## Data Model (core)
`USER` creates `TRANSACTION` · `CLIENT` linked_to `TRANSACTION` · `CATEGORY` tags `TRANSACTION` · `CHAT_SESSION` produces `TRANSACTION` · `AUDIT_LOG` tracks `TRANSACTION`.

TRANSACTION: `type` (income | expense), `original_amount`, `original_currency` (INR | USD), `exchange_rate` (null for INR), `inr_amount`, `txn_date`, `source` (manual | chatbot).

## Team Split
- **Development team** (us): apps, packages, database, chatbot, currency, analytics.
- **Automation team**: all n8n / webhook work (notifications, reminders, follow-ups). We only **send events** (e.g. `transaction.created`). We never build their workflows.

## Later (out of scope for v0.1, do not build)
More currencies · budgets and approvals · invoices, tax · bank import · more submodules.

## Open Questions (from SRS, unresolved)
- Which exchange-rate source do we trust?
- Are expenses also in USD, or INR only?
- Can a manager edit old entries, or only Admin?
- Keep MongoDB, or move to another DB?
