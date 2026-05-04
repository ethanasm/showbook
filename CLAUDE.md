# Showbook

Personal entertainment tracker for live shows — concerts, theatre, comedy, festivals.

This file covers project-wide conventions (commit hygiene, the
monorepo, verification gates, observability). For app-specific
guidance, see the per-app CLAUDE files:

- [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md) — Next.js app, Playwright
  e2e + isolated DB, email digest plumbing, mobile token bridge.
- [`apps/mobile/CLAUDE.md`](apps/mobile/CLAUDE.md) — Expo app, auth
  bridge, Maestro flows, mobile-only test gate.

## Commit and PR hygiene

Do **not** include `https://claude.ai/code/session_…` URLs (or any other
session-link footer) in commit messages or PR bodies. Strip the line from
the default template before committing. Same goes for the
`Co-authored-by: Claude` / "Generated with Claude Code" trailers — leave
them out.

## Working environment (Claude on the web)

When you're running in the Claude Code web sandbox, this checkout is a **shallow clone** (`git rev-parse --is-shallow-repository` → `true`) of a single branch. As a result:

- `git log` and `git status` will show the local branch sitting tens or hundreds of commits "behind" `origin/main` — that's the shallow history, not real divergence. Don't raise it as a concern, don't try to "catch up" by merging or rebasing onto `origin/main`, and don't unshallow the repo.
- After merging your PR to `main`, the branch you were working on is done. Treat the merge as success even if local refs still look out of date.
- Only worry about divergence if `git log origin/<your-branch>..HEAD` or `git log HEAD..origin/<your-branch>` shows unexpected commits on the branch you actually pushed.

## Project structure

- `apps/web/` — Next.js 15 (App Router). See [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md).
- `apps/mobile/` — Expo + Expo Router. See [`apps/mobile/CLAUDE.md`](apps/mobile/CLAUDE.md).
- `packages/` — `db` (Drizzle schema + migrations), `api` (tRPC routers),
  `jobs` (pg-boss handlers + daily digest), `emails` (react-email
  templates), `scrapers` (Playwright-bound external scrapers),
  `observability` (pino logger + Langfuse wrapper), `shared` (types,
  constants, utils).
- `showbook-specs/` — All specs: schema, data sources, pipelines,
  infrastructure, decisions. Index at
  [`showbook-specs/README.md`](showbook-specs/README.md).
- `showbook-specs/TASKS.md` — Master task list with dependency DAG.
- `showbook-specs/phases/VERIFICATION.md` — Playwright testing + visual
  verification strategy.
- `showbook-specs/mobile-roadmap.md` — Mobile build plan; the app
  is feature-complete against the design handoff.
- `design/` — Hi-fi prototypes from Claude Design (reference only,
  don't modify).

## Key decisions

- TypeScript everywhere (Next.js + Expo + Drizzle + tRPC)
- Nx monorepo with pnpm
- Self-hosted on desktop (local Postgres, Caddy, Cloudflare Tunnel)
- pg-boss for background jobs (runs inside Next.js process)
- Groq for LLM (chat-mode Add, playbill cast extraction)
- Ticketmaster Discovery API as primary data source
- Playwright for functional + visual testing on the web app; Maestro
  Cloud flows on the mobile app
- Email digest: Resend-backed `runDailyDigest` job at 08:00 ET — see
  `apps/web/CLAUDE.md` for the operator commands.

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

## Verification

- `pnpm verify` — build + lint + unit tests with end-of-run status summary
- `pnpm verify:e2e` — adds Playwright e2e (or set `RUN_E2E=1`)
- `pnpm verify:coverage` — build + lint + unit + integration with merged
  Node native code coverage; **fails if any of lines / branches / functions
  is below 80%**, scored independently for the web scope and the mobile
  scope (`apps/mobile/lib/**`). CI runs this on every push and PR to `main`.
- `pnpm test:unit` — unit tests across all packages (uses `node:test`)
- Integration tests live in `*.integration.test.ts` and are excluded from
  the unit-test glob; run with `pnpm test:integration`. Each integration
  test has a 45 s per-test timeout enforced by `--test-timeout=45000`,
  and the batch is killed after 5 min by `scripts/run-integration.mjs`.
- `pnpm email:smoke` — render the daily digest with sample data to disk
- `pnpm email:preview` — react-email dev server with hot reload

App-specific test conventions (when to reach for unit vs integration
vs e2e/Maestro, fixtures, gating env vars) live in the per-app CLAUDE
files.

## Test coverage

**80% line / branch / function coverage is required on `main`.** The CI
workflow at `.github/workflows/ci.yml` blocks merges that drop below the
threshold in either the web scope or the mobile scope. Coverage scope,
thresholds, and exclusions are owned by `scripts/coverage-report.mjs`;
merged LCOV lands at `coverage/lcov.info`.

Excluded from coverage (justified): `packages/db/**` (schema +
generated migrations), per-package re-export `index.ts` barrels,
`packages/scrapers/{run,runtime,extract,cli}.ts` (Playwright-bound),
`packages/jobs/{boss,registry,load-env-local}.ts` (orchestration
wiring + dev-only), Next.js page/layout/loading shells under
`apps/web/app/`, the test-only `/api/test/*` routes, NextAuth /
tRPC mount routes, and layout-heavy mobile code under
`apps/mobile/{app,components}/` (the mobile gate is scoped to
`apps/mobile/lib/**`).

## Observability and logging

All new code MUST use the shared `@showbook/observability` package — no `console.log/warn/error` and no direct `langfuse` / `pino` imports. This is enforced by review and applies to every package, including CLI scripts and pg-boss handlers. If you find yourself reaching for `console.*`, extend the observability package instead.

**Structured logs (pino → Axiom):**
- Import `logger` (or `child({ component, ... })`) from `@showbook/observability` for every log line.
- Use structured fields, short messages: `logger.info({ event: 'phase.start', phase: 1, venueId }, 'Phase 1 started')`.
- Errors: `logger.error({ err }, 'message')` — pino's `err` serializer flattens the stack.
- Never log secrets, raw user PII, raw email bodies, or image bytes. Redaction covers `apiKey`/`authorization`/`token`/`password` but don't rely on it.
- In jobs, bind `{ job, jobId }` on the child logger so Axiom queries can filter by run.
- Logs go to stdout (pretty in dev, JSON in prod) and to Axiom when `AXIOM_TOKEN` is set; behaviour must work with the env unset (tests, offline dev).
- **Caveat**: the pino err serializer currently does NOT include `err.cause`, so a thrown wrapped postgres error (Drizzle / postgres-js) loses the underlying SQLSTATE in Axiom. If you debug a `Failed query: …` and the cause matters, fix the serializer in `packages/observability/src/logger.ts` first rather than working around it.

**Where logs go (per env):**
- **dev / local** — stdout only, pretty-printed via `pino-pretty`. `AXIOM_TOKEN` and `AXIOM_DATASET` are intentionally unset in `.env.dev` / `apps/web/.env.local`, so dev runs never ship to Axiom. Tests rely on this — don't set `AXIOM_TOKEN` in CI.
- **prod** — stdout (JSON via `pino`, captured by Docker) AND shipped to Axiom dataset `showbook-prod` via `@axiomhq/pino`. The `AXIOM_TOKEN` in `.env.prod` is **ingest-only by design** (it's a service token, not a query token), so reading prod logs requires a separate user-scoped token (see "Querying Axiom" below).

**Querying Axiom from the CLI (read access):**
The repo-side `AXIOM_TOKEN` cannot read logs. To query, use a Personal Access Token (PAT) you create in the Axiom UI under Settings → Profile → Personal Access Tokens (or an advanced API token with the `Query` capability granted on the `showbook-prod` dataset). PATs and most advanced API tokens require the `X-AXIOM-ORG-ID` header.

```bash
# Get the org id once: it's the slug shown in Axiom URLs and is also returned
# from `GET /v1/orgs`.
ORG=showbook-egap
TOKEN=xapt-...  # PAT — never commit

# APL query against the Brandon-window:
curl -sS -X POST "https://api.axiom.co/v1/datasets/_apl?format=tabular" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-AXIOM-ORG-ID: $ORG" \
  -H "Content-Type: application/json" \
  -d '{"apl":"[\"showbook-prod\"] | where _time > ago(1h) and level in (\"warn\",\"error\") | project _time, level, event, msg | order by _time desc"}'
```

The stdout copy in the prod web container (`docker logs showbook-prod-web`) is also a useful fallback when you need recent logs but Axiom retention has rolled them off.

**Structured event names worth knowing (curated list, prefix-grouped):**
- `auth.user_created`, `auth.signin` — NextAuth lifecycle.
- `tm.request.*`, `tm.normalize.failed` — Ticketmaster client + ingest normalizer.
- `setlistfm.request.*` — setlist.fm client (rate-limit retries, errors).
- `venue_matcher.tm_lookup.failed`, `venue_matcher.geocode.failed`, `venue_matcher.geocode_update.failed` — `matchOrCreateVenue` external-call boundaries.
- `geocode.google.failed`, `geocode.google.no_lat_lng`, `geocode.nominatim.http_error`, `geocode.nominatim.failed` — `geocodeVenue` provider boundaries; were silent until 2026-04-30.
- `performer.match.created`, `performer.match.race_recovered` — `matchOrCreatePerformer` writes (added 2026-04-30 to track external-ID coverage).
- `performer.image.{updated,no_match,failed,updated_image_only,done,fatal}` — `backfill-performer-images` job.
- `venue.photo.{updated,missing,failed,done,fatal}` — `backfill-venue-photos` job.
- `venue.follow`, `venue.follow.place_backfill_failed` — `venues.follow` lazy backfill.
- `discover.ingest.{performer,venue,region,targeted,*}.complete` — pg-boss discover-ingest jobs.
- `shows.nightly.summary`, `setlist.retry.summary` — nightly transition + setlist-retry jobs.
- `shows.create.{tm_enrichment_failed,venue_place_backfill_failed}` — `shows.create` non-blocking enrichments.
- `backfill.performer_images.summary`, `backfill.venue_photos.summary` — scheduled backfill jobs (daily 05:30 / 05:45 ET).
- `notifications.digest.summary` — daily email digest.
- `pgboss.{started,registered,unschedule_stale}` — pg-boss lifecycle.
- `trpc.error` — last-resort tRPC procedure error log.
- `admin.backfill_coordinates.{start,complete}`, `admin.backfill_ticketmaster.{start,complete}` — operator-triggered global venue backfills via the `/admin` page.
- `job.{start,complete,failed}` — pg-boss job wrapper from `runJob` in `packages/jobs/src/registry.ts`.
- `health.check.{start,summary}`, `health.check.<name>.{ok,warn,fail,unknown}`, `health.check.email.{skipped,failed}`, `health.check.preamble.failed`, `health.check.axiom.{skipped,http_error,failed}` — daily morning health-check cron (`health/morning-check`, 07:00 ET). `<name>` is one of `failed_jobs`, `missed_schedules`, `error_volume`, `database`, `pgboss_queue`, `data_freshness`, `stalled_scrapes`, `external_apis`. The job itself is queryable via these events, so `debugging-prod` can confirm the cron ran. The Groq-generated preamble at the top of the email is traced as `groq.generateHealthSummaryPreamble` in Langfuse; it falls back to a deterministic count line when Groq is unavailable.

When adding a new external-call boundary, follow the `<component>.<action>.<outcome>` shape and add it to this list.

**LLM observability (Langfuse):**
- Every LLM call goes through `traceLLM({ name, model, input, run })` from `@showbook/observability`. Do not call the Groq SDK directly from new code — extend `packages/api/src/groq.ts` (or the equivalent scrapers helper) so the wrapper is applied once.
- Wrap user-initiated tRPC procedures and pg-boss handlers that invoke LLMs in `withTrace(name, fn, attrs)` so generations nest under a parent trace. Tag `userId`, `jobId`, etc. as attrs.
- Call `await flushObservability()` at the end of any short-lived entry point (job handler, script) so traces aren't dropped.
- Langfuse is for LLM traces only — do not pipe app logs there. App logs go to Axiom via pino.

If a new code path doesn't fit these patterns (e.g. a CLI script), extend the package rather than reaching for `console.log` or a fresh client.

## For agents

Read `showbook-specs/README.md` first. It indexes all spec files.
Read `showbook-specs/TASKS.md` for the full task breakdown and dependency graph.
Each task specifies which spec files to read and how to verify completion.

When the work is web- or mobile-specific, read the relevant per-app
CLAUDE — they document the conventions you'll need to follow inside
that scope.
