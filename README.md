# Finance Tool

Internal finance tracker for Website Vikreta managers. A single Next.js app at the repository root (same flat layout as the main websitevikreta.com repo).

## Requirements

- Node.js and npm compatible with the checked-in `package-lock.json`
- A local environment file at `.env.local`; use `.env.example` as the non-secret template

## Commands

Run all commands from the repository root:

```powershell
npm install
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run test
```

`npm run dev` starts the web app on `http://localhost:3030`. The test command runs the existing offline chatbot regression, phase, API-flow, and integration suites. The live Gemini probe remains opt-in and is not part of the standard test command.

## Layout

```text
app/          Routes, layouts, route handlers (app/api/*)
components/   UI: shadcn primitives (ui/), layout shell, feature components
lib/          Auth, chatbot, currency, db (Drizzle), transactions, utils
drizzle/      SQL migrations
public/       Static assets
proxy.ts      Route guard
```

The `@/*` import alias maps to the repository root.

## Deployment

No deployment or CI configuration is present in this repository. If a platform is configured externally, leave its root directory as the repository root and provide the existing environment variables there. No production settings were changed by this migration.
