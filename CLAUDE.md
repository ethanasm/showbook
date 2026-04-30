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
