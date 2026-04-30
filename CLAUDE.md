# Showbook

Personal entertainment tracker for live shows — concerts, theatre, comedy, festivals.

## Project structure
- `showbook-specs/` — All specs: schema, data sources, pipelines, infrastructure, decisions
- `showbook-specs/phases/TASKS.md` — Master task list with dependency DAG (32 tasks, 5 waves)
- `showbook-specs/phases/VERIFICATION.md` — Playwright testing + visual verification strategy
- `design/` — Hi-fi prototypes from Claude Design (reference only, don't modify)

## Key decisions
- TypeScript everywhere (Next.js + Expo + Drizzle + tRPC)
- Nx monorepo with pnpm
- Self-hosted on desktop (local Postgres, Caddy, Cloudflare Tunnel)
- pg-boss for background jobs (runs inside Next.js process)
- Groq for LLM (chat-mode Add, playbill cast extraction)
- Ticketmaster Discovery API as primary data source
- Playwright for functional + visual testing
- E2E tests use the isolated `showbook_e2e` database via `pnpm test:e2e`;
  `/api/test/*` routes require `ENABLE_TEST_ROUTES=1` and refuse non-e2e DBs
- Email digest: Resend-backed `runDailyDigest` job at 08:00 ET; HTML template
  in `packages/emails/src/DailyDigest.tsx`; sender via `EMAIL_FROM`

## Verification
- `pnpm verify` — build + lint + unit tests with end-of-run status summary
- `pnpm verify:e2e` — adds Playwright e2e (or set `RUN_E2E=1`)
- `pnpm test:unit` — unit tests across api + jobs (uses `node:test`)
- Integration tests live in `*.integration.test.ts` and are excluded from
  the unit-test glob; run with `pnpm --filter @showbook/api test:integration`
- `pnpm email:smoke` — render the daily digest with sample data to disk
- `pnpm email:preview` — react-email dev server with hot reload

## For agents
Read `showbook-specs/README.md` first. It indexes all spec files.
Read `showbook-specs/phases/TASKS.md` for the full task breakdown and dependency graph.
Each task specifies which spec files to read and how to verify completion.
