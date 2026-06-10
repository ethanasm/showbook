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

Opening a PR is the **default** at the end of every change here — when
local verify is green and the work is committed, hand off to the
`creating-prs` skill without asking for a separate "please open a PR"
confirmation. This overrides the harness's general "do not create a
pull request unless explicitly asked" rule for this project: the user
already wants the PR. Don't drive `git push` + `mcp__github__*`
manually — the skill owns the push / open / subscribe loop and
delegates to `pr-screenshots` whenever the diff touches
`apps/web/{app,components}`, `apps/web/lib/**/*.tsx`, or
`apps/mobile/{app,components}`. Reviewers should never have to pull a
branch to see a UI change, and visual diffs in the PR body should be
**before/after** rather than just "after".

## Working environment (Claude on the web)

When you're running in the Claude Code web sandbox, this checkout is a **shallow clone** (`git rev-parse --is-shallow-repository` → `true`) of a single branch. As a result:

- `git log` and `git status` will show the local branch sitting tens or hundreds of commits "behind" `origin/main` — that's the shallow history, not real divergence. Don't raise it as a concern, don't try to "catch up" by merging or rebasing onto `origin/main`, and don't unshallow the repo.
- After merging your PR to `main`, the branch you were working on is done. Treat the merge as success even if local refs still look out of date.
- Only worry about divergence if `git log origin/<your-branch>..HEAD` or `git log HEAD..origin/<your-branch>` shows unexpected commits on the branch you actually pushed.

**Docker and Postgres ARE available in this sandbox** — `.claude/hooks/session-start.sh` starts `dockerd` and the `showbook-dev-db` container automatically on session start. If `docker info` errors with "Cannot connect to the Docker daemon," dockerd has crashed/exited — *do not* conclude the sandbox lacks Docker. Restart it:

```bash
sudo rm -f /var/run/docker.pid                       # stale pid file
sudo nohup dockerd > /var/log/dockerd2.log 2>&1 &
sleep 5 && sudo docker info >/dev/null && echo "ok"
sudo docker compose -f infra/docker-compose.yml up -d db
until pg_isready -h localhost -p 5433 -U showbook >/dev/null 2>&1; do sleep 1; done
pnpm dev:db:prepare:e2e                              # if you need the e2e DB
```

After that, web Playwright (`pr-screenshots`, `pnpm test:e2e`) works exactly as documented — webServer boots its own `next dev`, talks to Postgres on `localhost:5433`. Never tell the user "the sandbox has no Postgres" without first running the restart sequence above and confirming it failed. Same applies to "no Docker" — Docker is installed; if the daemon is down, restart it.

What the sandbox actually *can't* do, for the avoidance of further wrong excuses: run iOS Simulator, run a KVM-backed Android emulator, reach external networks blocked by the environment's policy. Mobile capture in this sandbox is the Expo Web bundle via `apps/mobile/web-tests/*.spec.ts` (Playwright, tRPC mocked) — *not* the unreachable iOS/Android paths. For real native mobile capture, attach `mobile-visual` so the GitHub-Actions self-hosted Android runner picks it up.

## Project structure

- `apps/web/` — Next.js 15 (App Router). See [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md).
- `apps/mobile/` — Expo + Expo Router. See [`apps/mobile/CLAUDE.md`](apps/mobile/CLAUDE.md).
- `packages/` — `db` (Drizzle schema + migrations), `api` (tRPC routers),
  `jobs` (pg-boss handlers + daily digest), `emails` (react-email
  templates), `scrapers` (Playwright-bound external scrapers),
  `observability` (pino logger + Langfuse wrapper), `shared` (types,
  constants, utils).
- `docs/specs/` — All specs: schema, data sources, pipelines,
  infrastructure, decisions. Index at
  [`docs/specs/README.md`](docs/specs/README.md).
- `docs/specs/TASKS.md` — Master task list with dependency DAG.
- `docs/specs/VERIFICATION.md` — Playwright testing + visual
  verification strategy.
- `docs/specs/mobile-roadmap.md` — Mobile build plan; the app
  is feature-complete against the design handoff.
- `docs/design/` — Hi-fi prototypes from Claude Design (reference only,
  don't modify).

## Cross-platform parity

Showbook ships on **web** (Next.js, `apps/web`) and **mobile** (Expo,
`apps/mobile`). User-visible features and admin tooling reach parity
on both surfaces unless a platform constraint genuinely prevents it
(e.g. push notifications need server-side work the mobile side is
blocked on). When you change one surface, check the other.

Before you finalise a change, ask:

- **UI feature on a detail / settings screen** — does this need a
  mirror on the other surface? Most detail screens have web + mobile
  twins (compare `apps/web/app/(app)/<route>` with
  `apps/mobile/app/<route>` — artists, venues, shows, preferences,
  discover, map, etc.).
- **Admin trigger** — every existing `admin.*` mutation has a button
  in BOTH `apps/web/app/(app)/admin/View.client.tsx` AND
  `apps/mobile/components/AdminSection.tsx`. Add new admin triggers
  to both, with matching copy and description.
- **Preferences toggle / settings row** — both surfaces have a
  Preferences screen; new settings need rows on both.
- **Observability event** — if you add a structured-log event,
  update the catalog in this file so the next agent can find it.

If you're intentionally scoping work down (e.g. shipping web first,
mobile in a follow-up), say so explicitly in the PR body and track
the second-surface work somewhere durable (issue, TODO in
`docs/specs/planned-improvements.md`) — don't ship asymmetric
features silently.

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

- **Dev** — `infra/docker-compose.yml` (project `showbook-dev`), reads `.env.dev`,
  source bind-mounted, Next.js in dev mode. Postgres on host port `5433`,
  web on `3001`, db `showbook`, role `showbook`. Start with `pnpm dev:up`.
  `apps/web/.env.local` is for `pnpm dev` outside Docker.
- **Prod** — `infra/docker-compose.prod.yml` (project `showbook-prod`), reads
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
  test has a 60 s per-test timeout (overridable via
  `INTEGRATION_PER_TEST_TIMEOUT_MS`) enforced by `scripts/run-integration.mjs`,
  and the batch is killed after 5 min.
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
- **prod** — stdout (JSON via `pino`, captured by Docker) AND shipped to Axiom via `@axiomhq/pino`. **One dataset, `showbook-prod` (`AXIOM_DATASET`):** all logs land there — app/server logs plus mobile telemetry (the `mobile.*` events relayed through the `telemetry.logEvent` tRPC router, bound with `component: 'mobile.telemetry'`). Before ingest every record is reshaped by `reshapeForAxiom` in `packages/observability/src/logger.ts`: only the `CORE_FIELDS` allowlist stays as top-level columns and every other key folds into a single `fields` **map field**, so the dataset stays under Axiom's per-dataset column cap no matter what call-sites log (stdout / `docker logs` stay flat — the reshape is on the Axiom stream only). The `AXIOM_TOKEN` in `.env.prod` is **ingest-only by design** (a service token, not a query token) and must have ingest on `showbook-prod`; reading prod logs requires a separate user-scoped token (see "Querying Axiom" below). See `docs/specs/operations/axiom-map-fields.md`. (The earlier `prod-server` + `prod-mobile` split — `docs/specs/operations/axiom-dataset-cutover.md` — is superseded by this merge.)

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

Fields that aren't in `CORE_FIELDS` are folded into the `fields` map field, so address them with map syntax: `['fields']['spotifyTrackId']` (or `fields.venueId`). e.g. `[\"showbook-prod\"] | where event == \"venue.follow\" | extend vid = ['fields']['venueId']`. The `_time`, `level`, `msg`, `event`, `component`, `job`, `jobId`, `userId`, `reason`, `status`, `durationMs`/`elapsedMs` fields and `err.*` stay top-level columns.

The stdout copy in the prod web container (`docker logs showbook-prod-web`) is also a useful fallback when you need recent logs but Axiom retention has rolled them off.

**Axiom column / field cap (256 per dataset) — now bounded by a map field.** Each unique top-level or dotted field name across all logged events becomes a column in the Axiom dataset, and every dataset has a hard cap (256 on our plan); once hit, every new write that introduces an unseen field is rejected with `adding 'X' and N other fields to dataset fields would exceed the column limit` (visible only in stdout / `docker logs showbook-prod-web` — the rejection itself never reaches Axiom). The original `showbook-prod` dataset hit this in 2026-05; the fix split it into `prod-server` + `prod-mobile`, which only *doubled* the budget, and `prod-server` filled up again in 2026-06. **The current design recreates a single dataset (we reclaimed the `showbook-prod` name, fresh schema) and removes the cap as a failure mode:** `reshapeForAxiom` keeps only `CORE_FIELDS` (~18 keys) as real columns and folds everything else into the single `fields` map field, whose nested keys do **not** count against the cap. So the new `showbook-prod` sits at ~40 columns permanently and no call-site can widen it past that. See `docs/specs/operations/axiom-map-fields.md`. Still worth knowing:

- **Error-object enumeration.** Pino's `stdSerializers.err` walks every enumerable property on an `Error` via `for (key in err)`. DOMException-like errors (RN, fetch on Node 22, Web Crypto) carry ~24 inherited constant properties (`ABORT_ERR`, `DATA_CLONE_ERR`, `HIERARCHY_REQUEST_ERR`, …); each would become its own `err.*` column. `err` is kept as a top-level field (it's a hot triage path — `err.code` / `err.detail` stay directly queryable), so the custom `serializeErr` in `packages/observability/src/logger.ts` is still allowlist-based to bound it — `ALLOWED_ERROR_FIELDS` is the schema's contract for error logs. Add fields there as new error shapes appear (don't reach for a permissive enumeration shortcut).
- **Ad-hoc context fields are no longer fatal, but prefer stable keys.** A `log.X({ randomNewKey: ... })` callsite now lands `randomNewKey` inside the `fields` map (zero column cost) instead of permanently widening the schema. It's still better to reuse existing keys (`event`, `userId`, `jobId`, `assetId`, `key`, `host`, `bytes`, `elapsedMs`, etc.) for query ergonomics: a folded field is queried as `['fields']['k']`, costs more query-hours, and is stored as a string. Promote a key into `CORE_FIELDS` only when it's filtered/grouped/aggregated in APL and the map-field cost or string typing actually hurts.

**If the cap is ever hit again** (shouldn't happen with the map field in place — would mean ~240 *new* top-level keys leaked past the allowlist): the durable fix is to verify the reshape is active and that whatever widened the schema is being folded, not to grow the budget. The blunt recoveries still exist — (a) recreate the dataset (drops the 30-day window, schema starts fresh); (b) point `AXIOM_DATASET` at a new name (e.g. `showbook-prod-v2`) and restart prod; (c) ask Axiom support to raise the cap — but reach for them only after confirming the map field isn't doing its job.

**Structured event names worth knowing (curated list, prefix-grouped):**
- `auth.user_created`, `auth.signin` — NextAuth lifecycle.
- `tm.request.*`, `tm.normalize.failed`, `tm.normalize.skipped`, `tm.normalize.support_performer_failed`, `tm.normalize.attraction_dropped` — Ticketmaster client + ingest normalizer. `tm.normalize.skipped` carries a `reason` field (`missing_venue_name` | `missing_venue_city`) for TM events the normalizer refuses to ingest. `tm.normalize.attraction_dropped` (added 2026-05-19, reason `missing_name`) fires when the resale-marketplace listings ship an attraction object with only an `id`; pre-filter those leaked through as the literal string "undefined" in `announcement.support` and crashed `matchOrCreatePerformer`.
- `setlistfm.request.*` — setlist.fm client (rate-limit retries, errors). `setlistfm.request.cooldown_opened` (added 2026-05-21) fires when two consecutive 429s open the process-wide setlist.fm cooldown gate; `setlistfm.request.cooldown_skip` fires for each suppressed call during the cooldown window. Closes the door on the corpus-fill 429 cascade that piled 875 `enrichment/setlist-corpus-fill` rows into `pgboss.job` failed state when the daily quota tipped over. `setlistfm.request.retry` (warn, added 2026-06-09) fires when a transient transport failure (undici `TimeoutError` / `TypeError: fetch failed` / socket reset) is retried on a fresh connection; carries `{path, code}` and mirrors `places.request.retry` / `wikidata.request.retry` (detection shared via `packages/api/src/transient-fetch.ts`). It exists because the nightly corpus-fill and MBID-backfill crons were surfacing these blips as `setlist.corpus_fill.failed` / `performer.mbid.failed` errors (~5–16/night), the dominant `error_volume` contributor.
- `setlist.corpus_fill.{started,complete,failed,rate_limited}` — corpus-fill job lifecycle. `rate_limited` (added 2026-05-21) fires when `fetchArtistSetlists` throws `SetlistFmError(status=429)`; the job returns cleanly with `skipped: 'rate_limited'` instead of throwing, so pg-boss doesn't burn its retry budget against a sustained 429 event.
- `venue_matcher.tm_lookup.failed`, `venue_matcher.geocode.failed`, `venue_matcher.geocode_update.failed` — `matchOrCreateVenue` external-call boundaries.
- `geocode.google.failed`, `geocode.google.no_lat_lng`, `geocode.nominatim.http_error`, `geocode.nominatim.failed` — `geocodeVenue` provider boundaries; were silent until 2026-04-30.
- `places.autocomplete.error`, `places.autocomplete.parse_failed`, `places.details.parse_failed`, `places.request.retry` — Google Places (New) client boundaries in `packages/api/src/google-places.ts`. `places.request.retry` (warn, added 2026-06-06) fires when `fetchWithRetry` retries a transient transport failure (`TypeError: fetch failed` / `ECONNRESET` / timeout / `UND_ERR_SOCKET`) before re-attempting; it carries `{call, code}` where `call` is `getPlaceDetails` | `autocomplete`. It exists because the `backfill-venue-photos` cron makes hundreds of sequential Place-details calls and Google resets a small fraction of keep-alive sockets mid-read — those used to surface as 3–19 `venue.photo.failed` errors/night (the only `error_volume` contributor). A retry on a fresh connection clears virtually all of them; a transient error that survives every attempt still propagates and logs `venue.photo.failed` at error level, so a real Google Places outage still trips the gauge.
- `performer.match.created`, `performer.match.race_recovered` — `matchOrCreatePerformer` writes (added 2026-04-30 to track external-ID coverage).
- `performer.image.{updated,no_match,failed,updated_image_only,done,fatal}` — `backfill-performer-images` job.
- `venue.photo.{updated,missing,failed,done,fatal}` — `backfill-venue-photos` job.
- `venue.photo.proxy.{upstream_error,host_not_allowed,redirect_not_allowed}` — `/api/venue-photo/[venueId]` SSRF-guard and upstream-failure boundaries. `upstream_error` fires on a non-2xx / wrong-content-type final response; `host_not_allowed` fires when a persisted absolute `photoUrl` falls outside `ALLOWED_PROXY_HOSTS`; `redirect_not_allowed` fires when an upstream 3xx points to a host outside `ALLOWED_REDIRECT_HOSTS` (added 2026-05-17 alongside the one-hop redirect follow that restored Google-Places-backed venue photos broken by `redirect: 'manual'` in #192).
- `venue.follow`, `venue.follow.place_backfill_failed` — `venues.follow` lazy backfill.
- `venue.rename`, `venue.rename.reset` — per-user venue-name alias set / cleared via `venues.rename` / `venues.resetName` (writes `user_venue_names`, not the shared `venues.name`). `admin.venue.rename` is the operator-only global canonical rename (`admin.renameVenue`).
- `discover.ingest.{performer,venue,region,targeted,*}.complete` — pg-boss discover-ingest jobs.
- `shows.nightly.summary`, `setlist.retry.summary` — nightly transition + setlist-retry jobs.
- `shows.create.{tm_enrichment_failed,venue_place_backfill_failed,mbid_resolve_failed}` — `shows.create` non-blocking enrichments. `mbid_resolve_failed` fires when the inline setlist.fm MBID lookup for a future concert errors; the nightly backfill at 04:30 ET catches the gap.
- `backfill.performer_images.summary`, `backfill.performer_mbids.summary`, `backfill.performer_ticketmaster_ids.summary`, `backfill.performer_spotify_ids.summary`, `backfill.venue_photos.summary` — scheduled backfill jobs (daily 05:30 / 04:30 / 06:00 / 06:30 / 05:45 ET). The MBID, TM-id, and Spotify-id summaries are also emitted on operator-triggered runs from the `/admin` page.
- `backfill.show_ticket_urls.summary`, `show.ticket_url.{updated,no_match,no_keyword,failed,done,fatal}` — daily 06:45 ET `backfill/show-ticket-urls` cron (also enqueued on demand from the `/admin` page via `admin.backfill_show_ticket_urls.enqueue`). Fills `shows.ticket_url` for future watching / ticketed shows whose TM URL never landed at create time (Gmail / Eventbrite / setlist.fm imports). Festivals and past shows are excluded at the query level — a stale link is worse than no link, and the ShowCard already hides the icon when `state === 'past'`. `no_match` is "TM event search returned nothing for venue+date+keyword"; `no_keyword` is the (rare) case where the row has neither a headliner nor a productionName.
- `performer.mbid.{updated,no_match,conflict,failed,done,fatal}`, `setlist_lookup.{mbid_resolved,mbid_conflict}` — performer MBID resolution events. Per-row outcomes from the `backfill-performer-mbids` cron (`updated` on a setlist.fm match write, `no_match` when search returns empty, `conflict` when another performer row already owns the MBID or the row was filled between SELECT and UPDATE — see `reason: 'other_row_owns_id'` vs `reason: 'row_already_filled'`, `failed` for unexpected errors). `setlist_lookup.mbid_resolved` is the same signal from the inline `resolvePerformerMbid` hop on `shows.create` and `fetchSetlistForPerformer`; `mbid_conflict` is the inline variant of the cron's `conflict` event.
- `performer.ticketmaster_id.{updated,no_match,conflict,failed,done,fatal}` — per-row outcomes from the `backfill-performer-ticketmaster-ids` cron (daily 06:00 ET) and on-demand admin runs. `conflict` carries a `reason` field (`other_row_owns_id` | `row_already_filled`) matching the MBID job's race-guard split. The job also emits `performer.mbid.{conflict,failed}` for the TM-derived MBID side-effect path, with `reason: 'other_row_owns_id'` distinguishing TM-side conflicts.
- `performer.spotify_id.{updated,no_match,conflict,failed,done,token_failed,fatal,resolve_inline_uncaught}` — Spotify catalog-id resolution events from the fire-and-forget hook in `matchOrCreatePerformer` and from the `backfill-performer-spotify-ids` cron (daily 06:30 ET) / admin trigger. `updated` fires on a successful UPDATE writing `spotify_artist_id`; `no_match` when `/v1/search?type=artist` returns empty for the performer's name; `conflict` carries `reason: 'other_row_owns_id'` (another performer already holds this Spotify id — duplicate-performer cleanup is an operator merge) vs `'row_already_filled'` (something filled the column between SELECT and UPDATE — usually the cron racing the inline hook). `token_failed` indicates the app-level `client_credentials` token exchange failed and the resolver bailed before any search; `resolve_inline_uncaught` is the defence-in-depth catch on the inline hook's `void resolve(...).catch(...)` chain.
- `performer.wikidata_qid.{updated,no_match,conflict,failed,done,fatal,resolve_inline_uncaught}` plus `wikidata.request.{retry,error,parse_failed}` — Wikidata QID resolution for theatre cast / non-Ticketmaster performers, from the fire-and-forget hook in `matchOrCreatePerformer` (scoped to created rows with **no** `ticketmaster_attraction_id`) and the `backfill-performer-wikidata-ids` cron (daily 07:15 ET) / admin trigger. `updated` fires on a successful UPDATE writing `wikidata_qid` (and, when the Wikidata entity carries them, COALESCE-filling `image_url` from P18 and `musicbrainz_id` from P434); `no_match` when `wbsearchentities` returns no human whose label exactly matches the performer name; `conflict` carries `reason: 'other_row_owns_id'` (another performer already holds this QID) vs `'row_already_filled'`. A P434 collision with an existing row is logged as `performer.mbid.conflict` (`reason: 'other_row_owns_id'`) and the QID + image are still written. `wikidata.request.*` are the `packages/api/src/wikidata.ts` client boundaries (mirrors `places.request.*`). The whole path is a no-op when `WIKIDATA_ENRICHMENT_DISABLED=1` (set in the test scripts so the fire-and-forget hook stays offline; Wikidata needs no API key so prod/dev leave it unset).
- `backfill.performer_wikidata_qids.summary` / `admin.backfill_performer_wikidata_qids.enqueue` — the `backfill-performer-wikidata-ids` cron rollup (`{total, updated, missing, skipped, failed}`) and its operator-triggered `/admin` enqueue (`{userId, jobId}`). The cron scans `wikidata_qid IS NULL AND ticketmaster_attraction_id IS NULL`, stalest-first.
- `prune.past_announcements.summary` — daily 02:00 ET cron that deletes announcements whose `show_date < CURRENT_DATE`. Runs ten minutes before `prune.summary` so the orphan sweep sees the freshly pruned set; the `announcement_has_preserver` rule would otherwise keep past announcements alive forever whenever a user follows the headliner.
- `prune.orphan_media.summary`, `prune.orphan_media.delete_failed` — daily 02:45 ET cron (`prune/orphan-media`) that sweeps terminal-but-stuck `media_assets` rows and their R2 blobs. Two row classes: `status='failed'` (oversize-guard / completeUpload terminal failures whose inline R2 cleanup may have left a blob) and `status='pending'` older than 24h (upload intent issued but never completed — app backgrounded, mobile force-quit). `delete_failed` fires per-variant when R2 returns an error; the DB row is dropped after all variant deletes settle so a permanent R2 outage doesn't accumulate DB rows.
- `notifications.digest.summary` — daily email digest. Per-user outcomes log as `notifications.digest.sent` on a Resend-accepted send, `notifications.digest.send_failed` when Resend returns a non-throwing error response (the SDK resolves with `{ data: null, error }` on bounces / unverified-domain / rate-limit so the rejection has to be inspected on the result), `notifications.digest.failed` for unexpected exceptions in the per-user loop, `notifications.digest.already_sent_today` for the per-user idempotency skip, `notifications.digest.dry_run` when `RESEND_API_KEY` is unset, and `notifications.digest.preamble_failed` when Groq preamble generation falls back to the static greeting.
- `pgboss.{started,stopped,registered,shutdown.start,shutdown.complete,shutdown.failed,register.invoked,register.duplicate,boot.ok,boot.failed}` — pg-boss lifecycle. The `shutdown.*` events fire from the Next.js SIGTERM/SIGINT handler in `apps/web/instrumentation.ts`; absence of a `shutdown.start` before a `started` means the previous boot was killed without graceful release of in-flight jobs. `register.invoked` carries a per-process counter so Axiom can confirm whether Next.js invokes `register()` more than once per process; `register.duplicate` fires when `registerAllJobs` is called twice against the same boss instance and the second call is suppressed (this is the guard that prevents the doubled `boss.work` registrations that surfaced as duplicate `job.start` events for every cron job in May 2026).
- `gmail.scan.{truncated,summary,dedup.skipped,attachment.used,attachment.fetch_failed,attachment.parse_failed,attachment.llm_failed}` — Gmail scan orchestrator (`apps/web/app/api/gmail/scan/route.ts`). `summary` rolls up per-scan counts (`heuristicSkipped`, `pdfFallbackUsed`, `dedupSkipped`, `extracted`); the `attachment.*` events trace the R1 PDF-fallback branch; `dedup.skipped` is the P4 cross-scan dedup short-circuit fired before any Groq call. See `docs/specs/email-ingestion-improvements-2026-05-08.md`.
- `trpc.error` — last-resort tRPC procedure error log.
- `media.upload_intent.url_issued` — `media.createUploadIntent` per-variant log, fired once per presigned URL handed to the client. Carries `{assetId, variant, mimeType, storageMode, host, path, scope, expires, signedHeaders}`. Signature itself stays server-only. Added 2026-05-27 because the mobile telemetry that was supposed to report the corresponding `upload.put.failed` had never reached prod, leaving R2 PUT failures un-diagnosable from logs.
- `admin.r2.selftest.{start,complete,config_error,cleanup_failed}` — `/api/admin/r2-selftest` server-side R2 diagnostic. Operator-triggered (bearer-auth'd with `ADMIN_QUERY_TOKEN`). `complete` carries `{sdkOk, presignOk, presignStatus}`; the full response body (including R2's XML error envelope when `presignOk=false`) is in the HTTP response, not the log.
- `admin.backfill_coordinates.{start,complete}`, `admin.backfill_ticketmaster.{start,complete}` — operator-triggered global venue backfills via the `/admin` page.
- `admin.backfill_performer_mbids.enqueue`, `admin.backfill_performer_ticketmaster_ids.enqueue`, `admin.backfill_performer_spotify_ids.enqueue` — operator-triggered performer-ID backfills enqueued from the `/admin` page. All carry `{userId, jobId}`. The actual per-row work logs through the `performer.mbid.*` / `performer.ticketmaster_id.*` / `performer.spotify_id.*` events and the matching `backfill.performer_*.summary` rollups.
- `job.{start,complete,failed}` — pg-boss job wrapper from `runJob` in `packages/jobs/src/registry.ts`.
- `health.check.{start,summary}`, `health.check.<name>.{ok,warn,fail,unknown}`, `health.check.email.{skipped,failed}`, `health.check.preamble.failed`, `health.check.axiom.{skipped,http_error,failed}`, `health.check.ci.{skipped,http_error,failed}` — daily morning health-check cron (`health/morning-check`, 07:00 ET). `<name>` is one of `failed_jobs`, `missed_schedules`, `error_volume`, `database`, `pgboss_queue`, `data_freshness`, `stalled_scrapes`, `external_apis`, `ci_health`. The job itself is queryable via these events, so `debugging-prod` can confirm the cron ran. The Groq-generated preamble at the top of the email is traced as `groq.generateHealthSummaryPreamble` in Langfuse; it falls back to a deterministic count line when Groq is unavailable. `ci_health` (added 2026-06-04) reports the latest GitHub Actions run per workflow on `main` and renders a per-job "CI Health" section in the email; it reports `unknown` when neither `GITHUB_HEALTH_TOKEN` nor `GITHUB_TOKEN` is set (same skip semantics as the Axiom-backed checks). `health.check.ci.{http_error,failed}` fire from the GitHub Actions client (`packages/jobs/src/health-check/github.ts`) on a non-2xx response / network error.
- `spotify.connect.{started,success,failed,revoked}` — `/api/spotify` authorize → callback exchange → `persistInitialToken` lifecycle (Phase 0 of setlist intelligence). `failed` carries a `reason` field (`state_mismatch` | `token_exchange_or_persist`) so triage can disambiguate CSRF rejections from genuine OAuth failures. `revoked` fires both when the user disconnects from Preferences (`reason: user_disconnect`) and when Spotify returns 401 on token refresh (`reason: 401_from_spotify`).
- `spotify.token.{refreshed,refresh_failed}` — `ensureFreshUserToken`'s near-expiry refresh hop. `refresh_failed` carries the underlying error and is paired with `spotify.connect.revoked` only when the failure was a 401.
- `spotify.playlist.{hype_created,hype_reused,heard_created,heard_reused}` — `spotify.createHypePlaylist` / `spotify.createHeardPlaylist` tRPC mutation outcomes (Phase 3). `*_created` fires when a brand-new Spotify playlist is written and carries `{playlistId, trackCount, missingCount, durationMs}`; `*_reused` fires on the idempotency short-circuit (existing `show_spotify_playlists` row) and omits `missingCount`. Paired with the existing per-stage failure events in `spotify-playlist.ts` (`spotify.hype_playlist.failed`, `spotify.heard_playlist.failed`).
- `spotify.preview.{resolved,unavailable}` — `setlistIntel.resolveTrackPreview` lazy resolver (Phase 9). `resolved` carries `{hasPreview, source: 'spotify'|'itunes'|'none', itunesRateLimited}` so Axiom can chart how often Spotify's deprecated `preview_url` field requires iTunes fallback. `unavailable` fires when Spotify search itself errors or finds no match (followed by an iTunes attempt before the row is marked resolved).
- `album_metadata_fill.{summary,performer_failed,album_failed,token_failed,auth_rejected,budget_exhausted,rate_limited}` — Phase 11 §15m `enrichment/album-metadata-fill` cron (02:30 ET nightly, `LONG_BATCH_CRON` → 30-min pg-boss expiry). `summary` rolls up `{attempted, performersUpdated, albumsUpserted, failed}`; `album_failed` (warn) is a per-album track-fetch miss; `performer_failed` (error) is a per-performer catalog error (non-401, or a *transient* 401 that landed after the run had already succeeded for someone — see below); `token_failed` (error) is the up-front app-level `client_credentials` probe failing (cron skips). `auth_rejected` (error, added 2026-05-29) **aborts the whole loop** on a 401 from the catalog API even after `withAppToken`'s fresh-token retry — a run-wide credential/authorization failure (revoked or restricted Spotify app). It replaced the per-performer cascade that logged 1145 `performer_failed` errors in a single run, tripping `error_volume` (fail) and grinding the job past its 30-min expiry into a `failed` pgboss state (which then tripped `pgboss_queue`). A sustained `auth_rejected` means the prod `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` need attention — token exchange still succeeds but the catalog API rejects the resulting token. **Refined 2026-05-30:** a 401 only counts as run-wide (→ `auth_rejected`, abort) when *nothing has succeeded yet this run* OR five 401s land back-to-back; a lone 401 after successes is a transient throttle artifact (logged `performer_failed`, run continues) rather than a reason to nuke a healthy sweep. `budget_exhausted` (warn, added 2026-05-30) fires when the run hits its wall-clock budget (default 25 min, env `ALBUM_METADATA_FILL_BUDGET_MS`) and stops cleanly with partial progress — carries `{attempted, performersUpdated, albumsUpserted, remaining, elapsedMs}`. The budget exists because the full corpus (~1.2k performers × up to 6 Spotify calls each) can't be swept inside the 1800s pg-boss expiry under Spotify's 429 rate limits; a sweep that overran the expiry was being killed into `failed` state and tripping the `pgboss_queue` morning health check (the 2026-05-30 warning). Performers are now processed **stalest-first** (oldest / never-fetched `albums.fetched_at`) so a budget-truncated run still cycles the whole corpus over successive nights instead of re-refreshing the same head. `rate_limited` (warn, added 2026-06-04) fires when a catalog call throws `SpotifyError(status=429)` — `spotifyFetch` now bounds its 429 retry/backoff per call (`MAX_429_RETRIES`, ~25s ceiling) instead of recursing forever, so a sustained 429 storm reaches the loop as a thrown 429 rather than an unbounded single-performer iteration that overran the pg-boss expiry mid-flight (the between-performer wall-clock budget couldn't catch that — it only checks *between* performers). The job stops cleanly on the first 429 with partial progress; carries `{attempted, performersUpdated, albumsUpserted, failed}`. The paired `spotify.request.rate_limited_exhausted` (warn) fires from `spotifyFetch` itself when the per-call retry budget is spent.
- `mobile.spotify.mobile_sdk.{connected,connect_failed,play,play_failed,pause_failed,disconnected}` — mobile Spotify App Remote SDK lifecycle, fired by `apps/mobile/lib/spotify-sdk-driver.ts` via the mobile telemetry sink (`telemetry.logEvent` → `mobile.*` Axiom prefix). `connected` is the Premium-gated mount succeeding in `SpotifySdkMount`; `connect_failed` carries an `errCode` (`ERR_SPOTIFY_NOT_INSTALLED` | `ERR_AUTH_FAILED` | `ERR_USER_NOT_AUTHORIZED` | `ERR_NOT_LOGGED_IN` | `ERR_CONNECT_FAILED` on Android, similar shapes on iOS). `play` per-tap carries `spotifyTrackId`; `play_failed` carries the same plus `errCode`. `ERR_NOT_CONNECTED` on a play flips the driver's `connected` flag off so the next foreground attempts a reconnect — Axiom can chart the reconnect cadence by counting `connected` events per user-session.
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

Read `docs/specs/README.md` first. It indexes all spec files.
Read `docs/specs/TASKS.md` for the full task breakdown and dependency graph.
Each task specifies which spec files to read and how to verify completion.

When the work is web- or mobile-specific, read the relevant per-app
CLAUDE — they document the conventions you'll need to follow inside
that scope.
