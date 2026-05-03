# Showbook

Personal entertainment tracker for live shows — concerts, theatre, comedy, festivals.

## Tech Stack

- **Web:** Next.js 15 (App Router) — see [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md)
- **Mobile:** Expo SDK 55 + Expo Router (React Native) — feature-complete; see [`apps/mobile/CLAUDE.md`](apps/mobile/CLAUDE.md) and [`showbook-specs/mobile-roadmap.md`](showbook-specs/mobile-roadmap.md)
- **Language:** TypeScript
- **Database:** PostgreSQL + Drizzle ORM
- **API:** tRPC
- **Background Jobs:** pg-boss
- **LLM:** Groq (chat-mode Add, playbill cast extraction)
- **Data Sources:** Ticketmaster Discovery API, setlist.fm, Google Places
- **Auth:** Google OAuth (Auth.js)
- **Media:** Cloudflare R2
- **Monorepo:** Nx + pnpm

## Prerequisites

- Docker
- Node 20+
- pnpm

## Quick Start (development)

```bash
git clone <repo-url> && cd showbook
cp apps/web/.env.example apps/web/.env.local   # for `pnpm dev` outside Docker
cp apps/web/.env.example .env.dev              # for the dev compose
pnpm install
pnpm dev:up                                    # docker compose up -d (loopback only)
pnpm db:migrate
pnpm db:prepare:e2e
open http://localhost:3001
```

The dev compose hardcodes the dev postgres credentials, so `.env.dev`
doesn't need `DATABASE_URL` or `POSTGRES_PASSWORD`. Both env files are
gitignored.

## Production deployment

The prod path uses a separate compose that builds a sealed image (no source
bind-mounts), runs Next.js with `NODE_ENV=production`, and binds web +
Postgres to `127.0.0.1` so only loopback (e.g. cloudflared) can reach
them. Project name `showbook-prod` namespaces volumes/containers so
prod data doesn't share storage with dev. Prod postgres also runs on
a different host port (`5434` vs dev's `5433`) and uses a distinct
database name and role (`showbook_prod`) so dev/test workspace
scripts cannot reach it — `scripts/guard-not-prod-db.mjs` refuses any
`db:*` / `test:integration*` command whose DATABASE_URL points at
`showbook_prod`.

```bash
cp apps/web/.env.example .env.prod
# then in .env.prod:
#   - comment out DATABASE_URL
#   - set POSTGRES_PASSWORD ($(openssl rand -base64 32))
#   - set AUTH_SECRET ($(openssl rand -base64 48))
#   - set NEXTAUTH_URL to your Cloudflare Tunnel hostname
#     (and add it to your Google OAuth client's redirect URIs as
#      <NEXTAUTH_URL>/api/auth/callback/google and /api/gmail/callback)
#   - set AUTH_ALLOWED_EMAILS and/or AUTH_ALLOWED_DOMAINS
#   - set real API keys, leave ENABLE_TEST_ROUTES unset

pnpm prod:up        # build + start
pnpm prod:migrate   # apply migrations against the prod DB (run once after up)
pnpm prod:logs      # tail web logs
pnpm prod:down      # stop
```

Dev and prod stacks coexist: dev web binds host port `3001`, prod
binds `3002`, and postgres uses `5433` / `5434` respectively. The
Cloudflare Tunnel ingress for the prod hostname must point at
`http://localhost:3002` (see
[`showbook-specs/cloudflare-tunnel-setup.md`](showbook-specs/cloudflare-tunnel-setup.md)).
Playwright's E2E dev server defaults to `3003` so it doesn't fight
with either stack.

### Continuous deployment

`.github/workflows/deploy.yml` redeploys the prod box every time CI passes
on `main`. It runs on a **self-hosted GitHub Actions runner** installed on
the prod machine, fetches the deploy SHA into a fixed prod tree, and runs
`pnpm prod:up && pnpm prod:migrate`. No inbound ports are required — the
runner connects out to GitHub, so this works behind Cloudflare Tunnel.

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
secrets (see the Environment Variables section below), then lock down
fork PRs: under *Settings → Actions → General* set *Fork pull request
workflows from outside collaborators* to *Require approval for all
outside collaborators*.

After that, every push to `main` that turns CI green will redeploy. To
deploy a specific SHA on demand, use *Actions → Deploy (prod) → Run
workflow* and pass the SHA.

## Environment Variables

See [`apps/web/.env.example`](apps/web/.env.example) for the full template with
defaults and inline notes. The required groups are:

- **Auth** — `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Self-hosters should also set `AUTH_ALLOWED_EMAILS` and/or `AUTH_ALLOWED_DOMAINS` (comma-separated) to gate sign-in. Both unset = open sign-up. Optionally set `ADMIN_EMAILS` (comma-separated) to grant access to the in-app Admin tab; closed by default.
- **Data sources** — `TICKETMASTER_API_KEY`, `SETLISTFM_API_KEY`, `GROQ_API_KEY`, `GOOGLE_PLACES_API_KEY`
- **Media (Cloudflare R2)** — `R2_*` plus `MEDIA_*` quotas/limits
- **Email (Resend)** — `RESEND_API_KEY`, `EMAIL_FROM` (unset → digest job logs and skips delivery)
- **Health-check cron (optional)** — `HEALTH_CHECK_RECIPIENT` (operator email address; unset → cron still runs and logs to Axiom but no email is sent), `AXIOM_QUERY_TOKEN` (Axiom Personal Access Token with Query capability on `showbook-prod`; unset → axiom-backed checks report "unknown" instead of "ok"). Both are optional in dev — the cron no-ops the relevant pieces gracefully.
- **Observability (optional)** — Langfuse and Axiom keys
- **Per-user guardrails (optional overrides)** — `SHOWBOOK_LLM_CALLS_PER_DAY` (default 50), `SHOWBOOK_BULK_SCAN_PER_HOUR` (default 5), `SHOWBOOK_BULK_SCAN_MESSAGE_CAP` (default 200). See [`GUARDRAILS.md`](./GUARDRAILS.md) for the full list.

## Project Structure

```
showbook/
├── apps/
│   ├── web/                  # Next.js 15 (App Router) — see apps/web/CLAUDE.md
│   └── mobile/               # Expo + Expo Router — see apps/mobile/CLAUDE.md
├── packages/
│   ├── db/                   # Drizzle schema + migrations
│   ├── api/                  # tRPC routers
│   ├── jobs/                 # pg-boss job handlers (incl. daily digest)
│   ├── emails/               # react-email templates (DailyDigest)
│   ├── scrapers/             # External data source scrapers
│   └── shared/               # Types, constants, utils
├── scripts/                  # verify.sh and other workspace scripts
├── showbook-specs/           # Project specifications
├── design/                   # Hi-fi prototypes
├── docker-compose.yml
└── nx.json
```

## Commands

```bash
# Development
pnpm dev                # Start Next.js dev server (no Docker — reads apps/web/.env.local)
pnpm dev:up             # docker compose up -d (reads .env.dev, dev mode)
pnpm dev:down           # docker compose down
pnpm dev:build          # Rebuild dev images and start
pnpm dev:logs           # Tail web container logs

# Production (Docker only)
pnpm prod:up            # docker compose -f docker-compose.prod.yml up -d --build
pnpm prod:down          # Stop prod services
pnpm prod:logs          # Tail prod web container logs
pnpm prod:migrate       # Run drizzle migrations against the prod DB

# Verify / test
pnpm verify             # build + lint + unit tests, with status summary
pnpm verify:e2e         # verify + Playwright e2e (also: RUN_E2E=1 pnpm verify)
pnpm test:unit          # unit tests across api + jobs packages
pnpm test:e2e           # Prepare showbook_e2e and run Playwright on port 3003

# Email + DB
pnpm email:smoke        # Render the daily digest with sample data to /tmp/showbook-digest.html
pnpm email:preview      # react-email dev server (localhost:3030, hot reload)
pnpm db:generate        # Generate Drizzle migrations
pnpm db:migrate         # Run dev DB migrations against showbook
pnpm db:prepare:e2e     # Reset/migrate the isolated showbook_e2e DB
pnpm db:studio          # Open Drizzle Studio
```

## Email Notifications

The daily digest is a Resend-backed email sent at 08:00 ET to users with email
notifications enabled in Preferences. The HTML template lives in
`packages/emails/src/DailyDigest.tsx` and is sent from the digest job in
`packages/jobs/src/notifications.ts`.

- `pnpm email:smoke` — render with sample fixtures, write HTML to disk for
  visual inspection. Override path with `SMOKE_OUT=...`.
- `pnpm email:preview` — react-email dev server with hot reload at
  http://localhost:3030.
- `pnpm --filter @showbook/jobs run-daily-digest` — run the real digest job
  against your dev DB. Without `RESEND_API_KEY` it logs `Would send to ...`
  for each user instead of delivering.

## Mobile app

The Expo app at [`apps/mobile/`](apps/mobile/) is feature-complete
against the design handoff. It
authenticates against the web backend via the
`POST /api/auth/mobile-token` bridge, then talks to the same
`@showbook/api` tRPC routers as the web client.

```bash
pnpm mobile:start       # Metro bundler
pnpm mobile:ios         # build + open in iOS Simulator
pnpm mobile:android     # build + open in Android emulator
pnpm mobile:typecheck
pnpm mobile:lint
pnpm mobile:test
```

Defaults to the prod Cloudflare Tunnel hostname for its backend; override
`EXPO_PUBLIC_API_URL` to your LAN IP or `http://localhost:3001` for
local dev. Build / submit / push-notification follow-ups live in
[`showbook-specs/mobile-deployment.md`](showbook-specs/mobile-deployment.md)
and [`Planned Improvements.md`](./Planned%20Improvements.md).

## E2E Database Isolation

Development data lives in the `showbook` database. Playwright tests use a separate
`showbook_e2e` database in the same Postgres container so `/api/test/seed` can
wipe and rebuild fixtures without touching local dev data.

`pnpm test:e2e` runs `pnpm db:prepare:e2e` first, then starts a Playwright-owned
Next.js dev server at `https://localhost:3003` (override with `PLAYWRIGHT_PORT`)
with:

```bash
DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e
ENABLE_TEST_ROUTES=1
NEXTAUTH_URL=https://localhost:3003
```

The `/api/test/*` routes are disabled unless `ENABLE_TEST_ROUTES=1` is set and
the active database name is `showbook_e2e`.

## Security

Found a vulnerability? Please report it privately — see [`SECURITY.md`](./SECURITY.md).

For the operational guardrails (rate limits, per-user LLM caps, auth allowlist, test-route gating), see [`GUARDRAILS.md`](./GUARDRAILS.md).

## License

[MIT](./LICENSE) © 2026 Ethan Smith.

## Docker Services

Both composes bind to `127.0.0.1` only — Cloudflare Tunnel (cloudflared)
runs on the same host and reaches the web service via loopback.

### Dev (`docker-compose.yml`, project `showbook-dev`)

| Service | Container | Host port |
|---------|-----------|-----------|
| db (PostgreSQL 16) | showbook-dev-db | 127.0.0.1:5433 |
| web (Next.js dev mode, source bind-mounted) | showbook-dev-web | 127.0.0.1:3001 |

### Prod (`docker-compose.prod.yml`, project `showbook-prod`)

| Service | Container | Host port |
|---------|-----------|-----------|
| db (PostgreSQL 16) | showbook-prod-db | 127.0.0.1:5434 |
| web (Next.js prod build, NODE_ENV=production) | showbook-prod-web | 127.0.0.1:3002 |

Prod uses database `showbook_prod` and role `showbook_prod` (vs dev's
`showbook`/`showbook`), and the postgres volumes are namespaced
separately (`showbook_pgdata` vs `showbook-prod_pgdata`), so dev and
prod databases do not share data, credentials, or a host port. Web
ports also differ (dev `3001`, prod `3002`), so both stacks can run
simultaneously.

Named volumes:

| Volume | Purpose |
|--------|---------|
| `showbook_pgdata` / `showbook-prod_pgdata` | Postgres data directory |
| `showbook_next_cache` | Webpack persistent cache (`.next/cache`) — kept off the macOS bind mount so it survives container rebuilds and avoids ENOENT rename errors that otherwise force full cold compiles |
