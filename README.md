# Finance Tool

Internal finance tracker for Website Vikreta managers. The Next.js application lives in the `@finance/web` npm workspace at `apps/web`.

## Requirements

- Node.js and npm compatible with the checked-in `package-lock.json`
- A local environment file at `apps/web/.env.local`; use `apps/web/.env.example` as the non-secret template

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

## Workspace layout

```text
apps/web/       Next.js application, UI, API route handlers, tests, and environment template
packages/       Reserved for future genuine shared packages
```

There is one lockfile at the repository root. Install dependencies from the root; do not create per-workspace lockfiles.

## Deployment

No deployment or CI configuration is present in this repository. If a platform is configured externally, set its application root directory to `apps/web` and provide the existing environment variables there. No production settings were changed by this migration.
