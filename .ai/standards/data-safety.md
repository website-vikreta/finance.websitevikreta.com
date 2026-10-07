# Data Safety Standard — Finance Tool

> SRS F6 (currency) + F9 (data safety) + roles + audit. Load for any task that reads or writes money, transactions, clients, users or the audit log.
> This replaces the SEO/GEO standard the main Vikreta site has. This app is internal and `noindex`.

## Money
- **Store integer minor units** (paise for INR, cents for USD). Never floats for money. In JS, use `bigint` or integers within `Number.MAX_SAFE_INTEGER`; in MongoDB use `Long`/`Decimal128`, never `double`.
- Never do arithmetic on display strings. Never `parseFloat` a stored amount.
- Display only through one helper (`src/lib/money.ts`), `Intl.NumberFormat`:
  - INR: `new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })` → `₹1,23,456.00`
  - USD: `new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })` → `$1,234.00`
- Totals are summed in the database from stored minor units, then formatted once.

## Currency (F6)
- **INR is the base currency.** All analytics use `inr_amount`.
- INR entry: `original_currency = INR`, `exchange_rate = null`, `inr_amount = original_amount`.
- USD entry: fetch USD→INR rate, store `original_amount`, `exchange_rate`, `inr_amount`, `txn_date`.
- **The stored rate never changes later.** No re-converting old rows when the rate moves.
- Rate service down → manager enters the rate by hand; store `rate_source = manual` and show a `text-warning` "manual rate" marker wherever the row appears.
- Conversion records value only. It never moves money.
- Rate precision: store the rate as a scaled integer or decimal string (e.g. 4 decimal places), define rounding once (half-even) in `src/lib/currency.ts`.

## Writes (F4 + F5)
- One write path for manual and chatbot. Same schema, same server function. Only `source` differs (`manual | chatbot`).
- **Chatbot never saves silently.** Flow: extract fields → show confirm card → user confirms → write. If amount, currency, type or client is unclear, the bot asks instead of guessing.
- **Duplicate check before save:** same type + amount + currency + client + date within the same day → warn and require explicit "Save anyway". Use an idempotency key per submit so retries never double-insert.
- Order on every write: validate → duplicate check → persist → audit log → emit event. Persist + audit happen in one transaction (or the audit write is retried until it succeeds).

## Deletes
- **Soft delete only.** Set `deleted_at` + `deleted_by`. Hidden from lists and totals, restorable by admin.
- No `deleteOne` / `deleteMany` on transactions, clients or audit entries in app code.

## Audit Log (F9)
- Every create, edit, soft delete and restore writes: `who`, `what` (entity + id), `when`, `before`, `after`, `source`.
- Audit entries are append-only. Never edited, never deleted.
- Admin audit screen shows diffs in `font-mono`.

## Roles (F1)
| Action | Manager | Admin | Viewer (later) |
|--------|:-:|:-:|:-:|
| View dashboard / analytics | ✓ | ✓ | ✓ |
| Add / edit transactions, clients, chatbot | ✓ | ✓ | |
| Edit old entries | open question | ✓ | |
| Users, roles, categories, audit log | | ✓ | |

Enforced on the server for every request. UI hides what the role can't do, but the server is the gate.

## Events (Automation team boundary)
- After a successful write, emit an event (`transaction.created`, `transaction.updated`, `transaction.deleted`) with ids and amounts, no secrets.
- Emitting is fire-and-forget with retry; a failed event never rolls back a saved transaction.
- We never build n8n workflows, reminders or notifications ourselves.

## Non-Functional (SRS §8)
- HTTPS only. Secrets in env vars. Role-based access.
- Daily DB backups. Safe retries, no duplicates.
- Dashboard under 3 s. Chat reply under 5 s.

## Required Tests
Small runnable checks for: minor-unit math + formatting, USD→INR conversion + rounding, duplicate detection, role gate on each server action, soft delete excluded from totals.
