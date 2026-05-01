# Showbook

Personal entertainment tracker for live shows — concerts, theatre, comedy, festivals.

## Project structure
- `showbook-specs/` — All specs: schema, data sources, pipelines, infrastructure, decisions
- `showbook-specs/phases/TASKS.md` — Master task list with dependency DAG (30 tasks + mobile roadmap, 5 waves)
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
- `pnpm verify:coverage` — build + lint + unit + integration with merged
  Node native code coverage; **fails if any of lines / branches / functions
  is below 80%**. CI runs this on every push and PR to `main`.
- `pnpm test:unit` — unit tests across all packages (uses `node:test`)
- Integration tests live in `*.integration.test.ts` and are excluded from
  the unit-test glob; run with `pnpm test:integration`. Each integration
  test has a 45 s per-test timeout enforced by `--test-timeout=45000`,
  and the batch is killed after 5 min by `scripts/run-integration.mjs`.
- `pnpm email:smoke` — render the daily digest with sample data to disk
- `pnpm email:preview` — react-email dev server with hot reload

## Test coverage

**80% line / branch / function coverage is required on `main`.** The CI
workflow at `.github/workflows/ci.yml` blocks merges that drop below the
threshold. Coverage scope, thresholds, and exclusions are owned by
`scripts/coverage-report.mjs`; merged LCOV lands at `coverage/lcov.info`.

Excluded from coverage (justified): `packages/db/**` (schema +
generated migrations), per-package re-export `index.ts` barrels,
`packages/scrapers/{run,runtime,extract,cli}.ts` (Playwright-bound),
`packages/jobs/{boss,registry,load-env-local}.ts` (orchestration
wiring + dev-only), Next.js page/layout/loading shells under
`apps/web/app/`, the test-only `/api/test/*` routes, and NextAuth /
tRPC mount routes.

### When to write each kind of test

Default to the cheapest test that proves the behaviour. Write:

- **Unit test (`*.test.ts`)** — when the logic is pure or can be made
  pure with a small mock seam. This is the default. Examples: parsers,
  matchers, formatters, prompt builders, HTTP clients (mock
  `globalThis.fetch`), Zod schemas, LLM wrappers (mock the Groq client
  via `node:test` `mock.module`), tRPC procedures that can use the
  in-memory `_fake-db.ts`, hooks (via `@testing-library/react`'s
  `renderHook` under jsdom), small components (via `render` queries).
  Lives in `<package>/src/__tests__/` or `apps/web/{lib,components}/__tests__/`.

- **Integration test (`*.integration.test.ts`)** — only when DB
  interaction (cascades, FKs, unique constraints) or cross-router
  workflow is the thing being asserted. Mock external HTTP. Use the
  `_test-helpers.ts` fixtures (`callerFor`, `createTestUser`,
  `cleanupByPrefix`, `fakeUuid`) and wrap any DB-touching
  `before`/`after` hook in `withTimeout(45_000, ...)`. Each file must
  finish in under 45 s.

- **E2E test (Playwright `*.spec.ts`)** — only when the assertion is
  about end-user behaviour that crosses Next.js routing, auth, and
  real DOM. Uses the isolated `showbook_e2e` database. Skip with
  `test.skip(!process.env.X)` if the test needs a third-party API key
  that CI doesn't provide.

Prefer adding cases to an existing test file before creating a new
one. If a feature needs both unit and integration coverage, write the
unit test first; reach for the integration only when the unit can't
falsify the behaviour.

## Running (dev vs prod)
Two compose files, two env files. Both bind to `127.0.0.1` only — the
Cloudflare Tunnel reaches web via loopback.
- **Dev** — `docker-compose.yml` (project `showbook-dev`), reads `.env.dev`,
  source bind-mounted, Next.js in dev mode. Postgres on host port `5433`,
  web on `3001`, db `showbook`, role `showbook`. Start with `pnpm dev:up`.
  `apps/web/.env.local` is for `pnpm dev` outside Docker.
- **Prod** — `docker-compose.prod.yml` (project `showbook-prod`), reads
  `.env.prod`, sealed image with `next build` baked in,
  `NODE_ENV=production`. Postgres on host port `5434`, web on `3002`,
  db `showbook_prod`, role `showbook_prod`. Start with `pnpm prod:up`,
  then `pnpm prod:migrate` once after first up. `.env.prod` must set
  `POSTGRES_PASSWORD` — the compose builds `DATABASE_URL` from it
  (don't set both).
- Dev and prod stacks coexist on the same host: web ports 3001 vs 3002,
  postgres 5433 vs 5434. The Cloudflare Tunnel ingress for the prod
  hostname targets `http://localhost:3002`. Playwright's E2E dev server
  defaults to `3003` (override with `PLAYWRIGHT_PORT`) so it doesn't
  collide with either stack.
- `scripts/guard-not-prod-db.mjs` refuses any dev/test workspace
  command whose `DATABASE_URL` points at a `showbook_prod*` database —
  prod migrations must go through `pnpm prod:migrate`. See README.md
  "Production deployment" for the env checklist.

## Observability and logging

All new code MUST use the shared `@showbook/observability` package — no `console.log/warn/error` and no direct `langfuse` / `pino` imports.

**Structured logs (pino → Axiom):**
- Import `logger` (or `child({ component, ... })`) from `@showbook/observability` for every log line.
- Use structured fields, short messages: `logger.info({ event: 'phase.start', phase: 1, venueId }, 'Phase 1 started')`.
- Errors: `logger.error({ err }, 'message')` — pino's `err` serializer flattens the stack.
- Never log secrets, raw user PII, raw email bodies, or image bytes. Redaction covers `apiKey`/`authorization`/`token`/`password` but don't rely on it.
- In jobs, bind `{ job, jobId }` on the child logger so Axiom queries can filter by run.
- Logs go to stdout (pretty in dev, JSON in prod) and to Axiom when `AXIOM_TOKEN` is set; behaviour must work with the env unset (tests, offline dev).

**LLM observability (Langfuse):**
- Every LLM call goes through `traceLLM({ name, model, input, run })` from `@showbook/observability`. Do not call the Groq SDK directly from new code — extend `packages/api/src/groq.ts` (or the equivalent scrapers helper) so the wrapper is applied once.
- Wrap user-initiated tRPC procedures and pg-boss handlers that invoke LLMs in `withTrace(name, fn, attrs)` so generations nest under a parent trace. Tag `userId`, `jobId`, etc. as attrs.
- Call `await flushObservability()` at the end of any short-lived entry point (job handler, script) so traces aren't dropped.
- Langfuse is for LLM traces only — do not pipe app logs there. App logs go to Axiom via pino.

If a new code path doesn't fit these patterns (e.g. a CLI script), extend the package rather than reaching for `console.log` or a fresh client.

## For agents
Read `showbook-specs/README.md` first. It indexes all spec files.
Read `showbook-specs/phases/TASKS.md` for the full task breakdown and dependency graph.
Each task specifies which spec files to read and how to verify completion.
