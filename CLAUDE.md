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

When you have committed changes that need to ship, hand off to the
`creating-prs` skill rather than driving `git push` + `mcp__github__*`
manually — it owns the push/open/subscribe loop and delegates to
`pr-screenshots` whenever the diff touches `apps/web/{app,components}`,
`apps/web/lib/**/*.tsx`, or `apps/mobile/{app,components}`. Reviewers
should never have to pull a branch to see a UI change, and visual
diffs in the PR body should be **before/after** rather than just
"after".

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
- `specs/` — All specs: schema, data sources, pipelines,
  infrastructure, decisions. Index at
  [`specs/README.md`](specs/README.md).
- `specs/TASKS.md` — Master task list with dependency DAG.
- `specs/phases/VERIFICATION.md` — Playwright testing + visual
  verification strategy.
- `specs/mobile-roadmap.md` — Mobile build plan; the app
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
  then `pnpm prod:db:migrate` once after first up. `.env.prod` must set
  `POSTGRES_PASSWORD` — the compose builds `DATABASE_URL` from it
  (don't set both).
- Dev and prod stacks coexist on the same host: web ports 3001 vs 3002,
  postgres 5433 vs 5434. The Cloudflare Tunnel ingress for the prod
  hostname targets `http://localhost:3002`. Playwright's E2E dev server
  defaults to `3003` (override with `PLAYWRIGHT_PORT`) so it doesn't
  collide with either stack.
- `scripts/guard-not-prod-db.mjs` refuses any dev/test workspace
  command whose `DATABASE_URL` points at a `showbook_prod*` database —
  prod migrations must go through `pnpm prod:db:migrate`. See README.md
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
- Errors: `logger.error({ err }, 'message')` — the custom `serializeErr` in `packages/observability/src/logger.ts` flattens the stack, surfaces `code` / `detail` (postgres-js / Drizzle SQLSTATE), and walks `err.cause` recursively, so wrapped errors keep their underlying SQLSTATE in Axiom.
- Never log secrets, raw user PII, raw email bodies, or image bytes. Redaction covers `apiKey`/`authorization`/`token`/`password` but don't rely on it.
- In jobs, bind `{ job, jobId }` on the child logger so Axiom queries can filter by run.
- Logs go to stdout (pretty in dev, JSON in prod) and to Axiom when `AXIOM_TOKEN` is set; behaviour must work with the env unset (tests, offline dev).

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
- `venue.photo.proxy.{upstream_error,host_not_allowed,redirect_not_allowed}` — `/api/venue-photo/[venueId]` SSRF-guard and upstream-failure boundaries. `upstream_error` fires on a non-2xx / wrong-content-type final response; `host_not_allowed` fires when a persisted absolute `photoUrl` falls outside `ALLOWED_PROXY_HOSTS`; `redirect_not_allowed` fires when an upstream 3xx points to a host outside `ALLOWED_REDIRECT_HOSTS` (added 2026-05-17 alongside the one-hop redirect follow that restored Google-Places-backed venue photos broken by `redirect: 'manual'` in #192).
- `venue.follow`, `venue.follow.place_backfill_failed` — `venues.follow` lazy backfill.
- `discover.ingest.{performer,venue,region,targeted,*}.complete` — pg-boss discover-ingest jobs.
- `shows.nightly.summary`, `setlist.retry.summary` — nightly transition + setlist-retry jobs.
- `shows.create.{tm_enrichment_failed,venue_place_backfill_failed,mbid_resolve_failed}` — `shows.create` non-blocking enrichments. `mbid_resolve_failed` fires when the inline setlist.fm MBID lookup for a future concert errors; the nightly backfill at 04:30 ET catches the gap.
- `backfill.performer_images.summary`, `backfill.performer_mbids.summary`, `backfill.venue_photos.summary` — scheduled backfill jobs (daily 04:30 / 05:30 / 05:45 ET).
- `performer.mbid.{updated,no_match,conflict,failed,done,fatal}`, `setlist_lookup.{mbid_resolved,mbid_conflict}` — performer MBID resolution events. Per-row outcomes from the `backfill-performer-mbids` cron (`updated` on a setlist.fm match write, `no_match` when search returns empty, `conflict` when another performer row already owns the MBID, `failed` for unexpected errors). `setlist_lookup.mbid_resolved` is the same signal from the inline `resolvePerformerMbid` hop on `shows.create` and `fetchSetlistForPerformer`; `mbid_conflict` is the inline variant of the cron's `conflict` event.
- `notifications.digest.summary` — daily email digest. Per-user outcomes log as `notifications.digest.sent` on a Resend-accepted send, `notifications.digest.send_failed` when Resend returns a non-throwing error response (the SDK resolves with `{ data: null, error }` on bounces / unverified-domain / rate-limit so the rejection has to be inspected on the result), `notifications.digest.failed` for unexpected exceptions in the per-user loop, `notifications.digest.already_sent_today` for the per-user idempotency skip, `notifications.digest.dry_run` when `RESEND_API_KEY` is unset, and `notifications.digest.preamble_failed` when Groq preamble generation falls back to the static greeting.
- `pgboss.{started,stopped,registered,shutdown.start,shutdown.complete,shutdown.failed,register.invoked,register.duplicate,boot.ok,boot.failed}` — pg-boss lifecycle. The `shutdown.*` events fire from the Next.js SIGTERM/SIGINT handler in `apps/web/instrumentation.ts`; absence of a `shutdown.start` before a `started` means the previous boot was killed without graceful release of in-flight jobs. `register.invoked` carries a per-process counter so Axiom can confirm whether Next.js invokes `register()` more than once per process; `register.duplicate` fires when `registerAllJobs` is called twice against the same boss instance and the second call is suppressed (this is the guard that prevents the doubled `boss.work` registrations that surfaced as duplicate `job.start` events for every cron job in May 2026).
- `gmail.scan.{truncated,summary,dedup.skipped,attachment.used,attachment.fetch_failed,attachment.parse_failed,attachment.llm_failed}` — Gmail scan orchestrator (`apps/web/app/api/gmail/scan/route.ts`). `summary` rolls up per-scan counts (`heuristicSkipped`, `pdfFallbackUsed`, `dedupSkipped`, `extracted`); the `attachment.*` events trace the R1 PDF-fallback branch; `dedup.skipped` is the P4 cross-scan dedup short-circuit fired before any Groq call. See `specs/email-ingestion-improvements-2026-05-08.md`.
- `trpc.error` — last-resort tRPC procedure error log.
- `admin.backfill_coordinates.{start,complete}`, `admin.backfill_ticketmaster.{start,complete}` — operator-triggered global venue backfills via the `/admin` page.
- `job.{start,complete,failed}` — pg-boss job wrapper from `runJob` in `packages/jobs/src/registry.ts`.
- `health.check.{start,summary}`, `health.check.<name>.{ok,warn,fail,unknown}`, `health.check.email.{skipped,failed}`, `health.check.preamble.failed`, `health.check.axiom.{skipped,http_error,failed}` — daily morning health-check cron (`health/morning-check`, 07:00 ET). `<name>` is one of `failed_jobs`, `missed_schedules`, `error_volume`, `database`, `pgboss_queue`, `data_freshness`, `stalled_scrapes`, `external_apis`. The job itself is queryable via these events, so `debugging-prod` can confirm the cron ran. The Groq-generated preamble at the top of the email is traced as `groq.generateHealthSummaryPreamble` in Langfuse; it falls back to a deterministic count line when Groq is unavailable.
- `spotify.connect.{started,success,failed,revoked}` — `/api/spotify` authorize → callback exchange → `persistInitialToken` lifecycle (Phase 0 of setlist intelligence). `failed` carries a `reason` field (`state_mismatch` | `token_exchange_or_persist`) so triage can disambiguate CSRF rejections from genuine OAuth failures. `revoked` fires both when the user disconnects from Preferences (`reason: user_disconnect`) and when Spotify returns 401 on token refresh (`reason: 401_from_spotify`).
- `spotify.token.{refreshed,refresh_failed}` — `ensureFreshUserToken`'s near-expiry refresh hop. `refresh_failed` carries the underlying error and is paired with `spotify.connect.revoked` only when the failure was a 401.
- `spotify.playlist.{hype_created,hype_reused,heard_created,heard_reused}` — `spotify.createHypePlaylist` / `spotify.createHeardPlaylist` tRPC mutation outcomes (Phase 3). `*_created` fires when a brand-new Spotify playlist is written and carries `{playlistId, trackCount, missingCount, durationMs}`; `*_reused` fires on the idempotency short-circuit (existing `show_spotify_playlists` row) and omits `missingCount`. Paired with the existing per-stage failure events in `spotify-playlist.ts` (`spotify.hype_playlist.failed`, `spotify.heard_playlist.failed`).
- `spotify.preview.{resolved,unavailable}` — `setlistIntel.resolveTrackPreview` lazy resolver (Phase 9). `resolved` carries `{hasPreview, source: 'spotify'|'itunes'|'none', itunesRateLimited}` so Axiom can chart how often Spotify's deprecated `preview_url` field requires iTunes fallback. `unavailable` fires when Spotify search itself errors or finds no match (followed by an iTunes attempt before the row is marked resolved).
- `itunes.preview.{rate_limited,user_rate_limited,failed}`, `itunes.request.{error,parse_error,network_error}` — Apple iTunes Search API fallback used when Spotify returns a track without `preview_url`. `rate_limited` is Apple's IP-level 403 (~20/min); `user_rate_limited` is the per-user resolver bucket (also 20/min). Both leave `songs.preview_resolved_at` null so the next tap can retry instead of caching the transient miss.
- `setlistfm.artist_setlists.fetched` / `setlistfm.artist_setlists.not_found` — `fetchArtistSetlists` per-call summary. The `pages` and `count` fields let Axiom track the daily corpus-fill budget against the 1440-call setlist.fm tier.
- `eval.run.{started,complete,failed}`, `eval.run.summary`, `eval.metrics.summary`, `eval.show.{rerun,rerun.requested,cold}` — Phase-4 prediction-eval back-test (`eval/run-daily-backtest`, 03:00 ET). `eval.run.complete` carries `evaluatedShows`, `brierScore`, `precisionTop10`, `recallTop15`, `calibrationError`. `eval.metrics.summary` fires once per style with the rolled-up numbers so Axiom can chart per-style trends without parsing `byStyle` jsonb.
- `setlist.style.refresh.{started,summary,entry_failed}`, `setlist.style.classified`, `setlist.style.seed_applied`, `setlist.style.seed_overridden` — Phase-5 nightly setlist-style-refresh cron (`enrichment/setlist-style-refresh`, 03:30 ET). `classified` fires on each performer style flip with `{oldStyle, newStyle, jaccard, uniqueRatio, corpusSize}`. `seed_applied` fires when a fresh performer matches the curated MBID seed table; `seed_overridden` fires when the auto-classifier wins after three consecutive disagreements.
- `setlist.run_detection.{matched,not_found}` — multi-night-run detector hits/misses fired by the rotating-style predicted-setlist branch (`setlist-intel.predictedSetlist`).
- `setlist.release_gate.{passed,failed}` — Phase-5 calibration release-gate verdict, evaluated on every read of `setlistIntel.releaseGate`. The `failed` event carries `{metric, value, threshold}` and optional `binLower`/`binUpper` for calibration breaches; the rotating-display feature flag is forced OFF on the client until the gate passes.
- `festival.lineup.extract.{started,parsed,failed}` — `enrichment.extractFestivalLineup` boundary. `started` carries `{source: 'image'|'pdf'}`; `parsed` carries `{artistCount, hasFestivalName, hasDates}` so Axiom can chart hit rate vs. day-of-week. The Groq call itself traces as `groq.extractFestivalLineup` in Langfuse with the same name across image and PDF input paths (differentiated by `metadata.source`).
- `festival.lineup.tm_match.{hit,miss,failed}` — `enrichment.matchFestivalArtists` per-name TM attractions/search outcome (run as a fan-out batch after lineup extraction so the picker can show artist images). `failed` is a thrown error from the TM client; `miss` is "TM returned no attractions" (still a valid outcome — the lineup can be created without the TM link).

**LLM observability (Langfuse):**
- Every LLM call goes through `traceLLM({ name, model, input, run })` from `@showbook/observability`. Do not call the Groq SDK directly from new code — extend `packages/api/src/groq.ts` (or the equivalent scrapers helper) so the wrapper is applied once.
- Wrap user-initiated tRPC procedures and pg-boss handlers that invoke LLMs in `withTrace(name, fn, attrs)` so generations nest under a parent trace. Tag `userId`, `jobId`, etc. as attrs.
- Call `await flushObservability()` at the end of any short-lived entry point (job handler, script) so traces aren't dropped.
- Langfuse is for LLM traces only — do not pipe app logs there. App logs go to Axiom via pino.

If a new code path doesn't fit these patterns (e.g. a CLI script), extend the package rather than reaching for `console.log` or a fresh client.

## For agents

Read `specs/README.md` first. It indexes all spec files.
Read `specs/TASKS.md` for the full task breakdown and dependency graph.
Each task specifies which spec files to read and how to verify completion.

When the work is web- or mobile-specific, read the relevant per-app
CLAUDE — they document the conventions you'll need to follow inside
that scope.
