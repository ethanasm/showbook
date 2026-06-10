# Showbook — Operations

Operator runbook for the self-hosted prod stack: deploy, query the
database from another machine, and test isolation details. The
[root README](../README.md) covers what gets you to a running prod web
container; everything beyond that lives here.

## Stack layout (dev vs prod)

Both compose files bind to `127.0.0.1` only — Cloudflare Tunnel
(cloudflared) runs on the same host and reaches web via loopback. Dev
and prod coexist on different host ports so both stacks can run
simultaneously.

| Stack | Compose file | Project | Web port | DB port | DB name / role |
|-------|--------------|---------|----------|---------|----------------|
| dev   | `infra/docker-compose.yml`      | `showbook-dev`  | `127.0.0.1:3001` | `127.0.0.1:5433` | `showbook` / `showbook` |
| prod  | `infra/docker-compose.prod.yml` | `showbook-prod` | `127.0.0.1:3002` | `127.0.0.1:5434` | `showbook_prod` / `showbook_prod` |
| e2e   | `infra/docker-compose.e2e.yml`  | `showbook-e2e`  | `127.0.0.1:3004` | `127.0.0.1:5435` | `showbook_e2e` / `showbook_e2e` |

Playwright's E2E dev server defaults to `3003` (override with
`PLAYWRIGHT_PORT`) so it doesn't fight with either stack. The
Cloudflare Tunnel ingress for the prod hostname must point at
`http://localhost:3002` — see
[`cloudflare-tunnel-setup.md`](cloudflare-tunnel-setup.md).

Postgres volumes are namespaced (`showbook_pgdata` vs
`showbook-prod_pgdata`), so dev and prod don't share data,
credentials, or a host port. The
[`scripts/guard-not-prod-db.mjs`](../scripts/guard-not-prod-db.mjs)
script refuses any dev/test workspace command whose `DATABASE_URL`
points at a `showbook_prod*` database.

## Mobile e2e backend (showbook-e2e)

The Maestro Android suite
([`.github/workflows/mobile-e2e.yml`](../.github/workflows/mobile-e2e.yml))
needs a backend the emulator can call with the baked-in
`MAESTRO_E2E_TOKEN`. That backend is the `showbook-e2e` stack
([`infra/docker-compose.e2e.yml`](../infra/docker-compose.e2e.yml)):
the same sealed web image prod runs, against its own postgres, its own
`AUTH_SECRET`, and an allowlist pinned to the synthetic
`maestro-e2e@showbook.test` user. It is **not** the Playwright
`showbook_e2e` database inside the dev postgres container — that one
is wiped on every `pnpm test:e2e` run; this one is long-lived so the
fixture shows the flows create persist between runs.

**Lockdown posture.** Both ports bind to `127.0.0.1` only and there is
no Cloudflare Tunnel ingress for this stack — do not add one. The only
intended client is the Android emulator on the same host, which
reaches web via `http://10.0.2.2:3004` (the emulator NAT's alias for
the host loopback). The e2e `AUTH_SECRET` is distinct from prod's, so
the token baked into e2e APKs and stored in repo secrets is worthless
against prod data; conversely a prod token can't authenticate here.
No external API keys are configured (enrichment boundaries are
non-blocking by design), `/api/test/*` stays disabled, and logs stay
in `docker logs showbook-e2e-web` (no Axiom).

**First-time setup** (on the prod box, in `/opt/showbook`):

```bash
# 1. Secrets file (gitignored). Two values, both e2e-specific:
cat > .env.e2e <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
AUTH_SECRET=$(openssl rand -base64 48)
EOF
chmod 600 .env.e2e

# 2. Start the stack and migrate. e2e:up rides the local
#    ghcr.io/ethanasm/showbook-web:latest image the last prod deploy
#    pulled (no GHCR login needed); deploy.yml refreshes the stack on
#    every prod deploy from here on.
pnpm e2e:up
pnpm e2e:db:migrate

# 3. Mint the Maestro credential against THIS stack's secret + DB.
#    Creates the test user row if missing; prints the two values to
#    paste into the GitHub repo secrets (Settings → Secrets and
#    variables → Actions): MAESTRO_E2E_TOKEN, MAESTRO_E2E_USER_JSON.
set -a; source .env.e2e; set +a
DATABASE_URL="postgresql://showbook_e2e:${POSTGRES_PASSWORD}@localhost:5435/showbook_e2e" \
  pnpm mint:e2e-token --email maestro-e2e@showbook.test
```

Then set the third repo secret `EXPO_PUBLIC_API_URL` to
`http://10.0.2.2:3004`. (E2E APK builds carry a build-time cleartext
exception for this — see the `IS_E2E_BUILD` plugin in
`apps/mobile/app.config.ts`; store builds keep the strict HTTPS-only
policy.)

**Staying current.** `deploy.yml` re-runs `pnpm e2e:up` +
`pnpm e2e:db:migrate` after every prod deploy (guarded on `.env.e2e`
existing, non-fatal), so the e2e backend's API and schema track
`main` without operator action. Manual refresh: same two commands.

**Triaging `UNAUTHORIZED` in Maestro runs** ("Couldn't load shows" /
"Could not save show" with the sign-in step passing — the bypass
loads the baked session without validating it). The bearer path
(`apps/web/app/api/trpc/[trpc]/resolve-session.ts`) has exactly three
rejection causes:

1. **Wrong secret / expired token** — silent `decode()` failure.
   Re-mint (step 3 above) and update the repo secrets. Tokens are
   minted with a 365-day lifetime.
2. **Allowlist** — logs `auth.mobile_session_denied` in
   `docker logs showbook-e2e-web`. The compose defaults
   `AUTH_ALLOWED_EMAILS` to `maestro-e2e@showbook.test`; if you
   overrode it in `.env.e2e`, keep that address on it.
3. **Stack down / unreachable** — surfaces as network errors rather
   than `UNAUTHORIZED`; `pnpm e2e:logs` and
   `curl -s http://localhost:3004/api/health/live` from the box.

## Continuous deployment

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
redeploys the prod box every time CI passes on `main`. It runs on a
**self-hosted GitHub Actions runner** installed on the prod machine,
fetches the deploy SHA into a fixed prod tree, and runs `pnpm prod:up
&& pnpm prod:db:migrate`. No inbound ports are required — the runner
connects out to GitHub, so this works behind Cloudflare Tunnel.

One-time setup on the prod host:

```bash
pnpm setup:runner
```

This clones the repo to `/opt/showbook` (override with `$PROD_DIR`),
downloads the GitHub Actions runner, registers it with the
`showbook-prod` label, writes a `.env` so the service can find docker /
pnpm / git, and installs it as a launchd (macOS) or systemd (Linux)
service. The script is idempotent — rerun it safely after upgrades.

After the script finishes, edit `/opt/showbook/.env.prod` with real
secrets (see the Environment Variables section of the root README), then
lock down fork PRs: under *Settings → Actions → General* set *Fork pull
request workflows from outside collaborators* to *Require approval for
all outside collaborators*.

After that, every push to `main` that turns CI green will redeploy. To
deploy a specific SHA on demand, use *Actions → Web Deploy (prod) → Run
workflow* and pass the SHA.

## Scheduled jobs (pg-boss crons)

All cron jobs run from `packages/jobs/src/registry.ts` inside the
Next.js process. Schedules are in `America/New_York`. Outcome
events land in Axiom — query by `event` to confirm a run completed.

| Time (ET) | Job | Source | Axiom completion event |
|-----------|-----|--------|------------------------|
| 02:30 | `system/prune-orphan-catalog` | `packages/jobs/src/prune-orphan-catalog.ts` | `job.complete` (job=`system/prune-orphan-catalog`) |
| 03:00 | `eval/run-daily-backtest` | `packages/jobs/src/prediction-eval.ts` (Phase 4) | `eval.run.complete` + `eval.run.summary` |
| 03:00 | `shows/nightly` | `packages/jobs/src/shows-nightly.ts` | `shows.nightly.summary` |
| 03:30 | `enrichment/setlist-style-refresh` | `packages/jobs/src/setlist-style-refresh.ts` (Phase 5) | `setlist.style.refresh.summary` |
| 04:00 | `setlist/retry` | `packages/jobs/src/setlist-retry.ts` | `setlist.retry.summary` |
| 04:45 | `enrichment/setlist-corpus-fill-refresh` | `packages/jobs/src/setlist-corpus-fill.ts` (Phase 0) | `setlistfm.artist_setlists.fetched` per performer; `job.complete` for the batch |
| 05:30 | `backfill/performer-images` | `packages/jobs/src/backfill-performer-images.ts` | `backfill.performer_images.summary` |
| 05:45 | `backfill/venue-photos` | `packages/jobs/src/backfill-venue-photos.ts` | `backfill.venue_photos.summary` |
| 06:15 | `backfill/show-cover-images` | `packages/jobs/src/backfill-show-cover-images.ts` | `job.complete` |
| 07:00 | `health/morning-check` | `packages/jobs/src/health-check.ts` | `health.check.summary` |
| 08:00 | `notifications/daily-digest` | `packages/jobs/src/notifications.ts` | `notifications.digest.summary` |
| Mon 06:00 | `discover/ingest` | `packages/jobs/src/discover-ingest.ts` | `discover.ingest.*.complete` |

User-triggered jobs (no schedule):

| Job | When it fires | Source |
|-----|---------------|--------|
| `enrichment/setlist-corpus-fill` | Phase 1 `setlistIntel.predictedSetlist` on a cold-corpus performer | `packages/jobs/src/setlist-corpus-fill.ts` |
| `enrichment/song-index-rebuild` | Chained from corpus-fill when new setlists land; not separately scheduled | `packages/jobs/src/song-index-rebuild.ts` |
| `discover/ingest-{venue,performer,region}` | tRPC `venues.follow` / `performers.follow` / `discover.ingestRegion` | `packages/jobs/src/discover-ingest.ts` |

### Quick health checks

The simplest "did everything run last night" query:

```bash
pnpm prod:query "SELECT name, state, MAX(completed_on) AS last_completed FROM pgboss.job WHERE created_on > now() - interval '24 hours' GROUP BY name, state ORDER BY name, state"
```

In Axiom, the equivalent log-side check (last 24h, sorted by most recent):

```
['showbook-prod'] | where _time > ago(24h) and event in ('eval.run.complete', 'setlist.style.refresh.summary', 'health.check.summary', 'notifications.digest.summary') | project _time, event, msg | order by _time desc
```

Missing rows / events in either query means a job was skipped or
the registry failed to register the schedule — start with
`docker logs showbook-prod-web 2>&1 | grep pgboss.boot` to see if
the boot completed cleanly.

## Querying the prod database from another machine

Postgres is bound to `127.0.0.1:5434` on the prod host, so direct
connections require either an SSH tunnel (DBeaver / `psql`) or the
read-only HTTPS endpoint described here.

`POST /api/admin/sql` accepts a single `SELECT` / `EXPLAIN` / `WITH` /
`SHOW` / `TABLE` / `VALUES` statement, runs it inside a `BEGIN READ
ONLY` transaction with a 5s `statement_timeout`, and returns up to 1000
rows as JSON. Bearer-auth'd via `ADMIN_QUERY_TOKEN`. Disabled (401)
when the token is unset or shorter than 32 chars.

```bash
# One-time: generate the token and add to .env.prod, then restart prod web.
openssl rand -hex 32     # → ADMIN_QUERY_TOKEN=<value>
pnpm prod:up             # restart picks up the new env

# From a dev machine (or Claude Code on the web):
export ADMIN_QUERY_URL=https://<your-tunnel-hostname>
export ADMIN_QUERY_TOKEN=<value-from-.env.prod>
pnpm prod:query "select count(*) from shows"
pnpm prod:query --file query.sql
echo "select * from users limit 5" | pnpm prod:query
```

Writes are blocked at the Postgres engine — the `READ ONLY` transaction
errors any INSERT/UPDATE/DELETE/DDL with SQLSTATE `25006`.

### Restricting the endpoint to a dedicated read-only role (recommended)

By default, `/api/admin/sql` connects via `DATABASE_URL` — i.e. as the app's
main role, which owns the schema. The `BEGIN READ ONLY` transaction blocks
writes, but a privileged role can still SELECT `pg_read_file`, `pg_authid`, and
the NextAuth `accounts` / `sessions` / `verification_tokens` tables (which
hold OAuth refresh tokens and session material). If `ADMIN_QUERY_TOKEN`
leaks, that's an account-takeover-class incident.

Migration `0027_admin_query_role.sql` adds a dedicated `showbook_query` role
with SELECT on public tables only, with explicit REVOKE on the three auth
tables above. Wire the endpoint up to it as a one-time post-migration step:

```bash
# On the prod host, after `pnpm prod:db:migrate` has run 0027 (the role exists
# as NOLOGIN until you do this). Use a long random password — it never needs
# to be typed by a human, only loaded from .env.prod.
PASSWORD=$(openssl rand -hex 32)
docker compose -f infra/docker-compose.prod.yml -p showbook-prod exec -T db \
  psql -U showbook_prod -d showbook_prod \
    -c "ALTER ROLE showbook_query WITH LOGIN PASSWORD '$PASSWORD'"

# Then add to .env.prod and restart:
echo "ADMIN_QUERY_DATABASE_URL=postgresql://showbook_query:$PASSWORD@db:5432/showbook_prod" >> .env.prod
pnpm prod:up
```

The endpoint prefers `ADMIN_QUERY_DATABASE_URL` when set and falls back to
`DATABASE_URL` otherwise, so this is a safe roll-forward — adopt it when
ready without breaking existing flows. Verify the lockdown is live:

```bash
pnpm prod:query "select 1 from accounts limit 1"
# expect: 500 server_error with details "permission denied for table accounts"
pnpm prod:query "select count(*) from users"
# expect: 200 with a row count
```

## E2E database isolation

Development data lives in the `showbook` database. Playwright tests use a
separate `showbook_e2e` database in the same Postgres container so
`/api/test/seed` can wipe and rebuild fixtures without touching local dev
data.

`pnpm test:e2e` runs `pnpm dev:db:prepare:e2e` first, then starts a
Playwright-owned Next.js dev server at `https://localhost:3003` (override
with `PLAYWRIGHT_PORT`) with:

```bash
DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e
ENABLE_TEST_ROUTES=1
NEXTAUTH_URL=https://localhost:3003
```

The `/api/test/*` routes are disabled unless `ENABLE_TEST_ROUTES=1` is set
and the active database name is `showbook_e2e`. Integration tests
(`pnpm test:integration`) share the same `showbook_e2e` database and use
the same guard.
