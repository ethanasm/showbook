# Showbook

Personal entertainment tracker for live shows — concerts, theatre, comedy, festivals.

## Tech Stack

- **Web:** Next.js 15 (App Router)
- **Mobile:** Expo (React Native)
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
prod data doesn't share storage with dev.

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

Both composes bind host port 3001, so stop one before starting the other:
`pnpm dev:down` before `pnpm prod:up` (and vice versa).

### Continuous deployment

`.github/workflows/deploy.yml` redeploys the prod box every time CI passes
on `main`. It runs on a **self-hosted GitHub Actions runner** installed on
the prod machine, fetches the deploy SHA into a fixed prod tree, and runs
`pnpm prod:up && pnpm prod:migrate`. No inbound ports are required — the
runner connects out to GitHub, so this works behind Cloudflare Tunnel.

One-time setup on the prod host:

1. **Place the prod tree at a fixed path** (default `/opt/showbook`). Clone
   the repo there and populate `.env.prod` (see above). Override the path
   with a repo Variable named `PROD_DIR` if you keep it elsewhere.

   ```bash
   sudo mkdir -p /opt/showbook && sudo chown "$USER" /opt/showbook
   git clone <repo-url> /opt/showbook
   cp apps/web/.env.example /opt/showbook/.env.prod   # then edit
   ```

2. **Install the GitHub Actions runner** with the labels
   `self-hosted,showbook-prod`. Follow the registration steps under
   *Settings → Actions → Runners → New self-hosted runner* and pass
   `--labels showbook-prod` to `config.sh`. Install it as a service
   (`sudo ./svc.sh install && sudo ./svc.sh start`) so it survives
   reboots. Make sure docker, docker compose, git, and pnpm are on the
   service's `PATH` (the runner inherits its env from systemd; for pnpm
   under corepack you may need `corepack enable` in the runner user's
   shell profile).

3. **Lock down fork PRs.** Under *Settings → Actions → General* set
   *Fork pull request workflows from outside collaborators* to
   *Require approval for all outside collaborators*. The workflow also
   refuses to deploy unless the upstream CI run was on `main` and was not
   a `pull_request` event, but defence in depth matters when the runner
   sits on your prod box.

After that, every push to `main` that turns CI green will redeploy. To
deploy a specific SHA on demand, use *Actions → Deploy (prod) → Run
workflow* and pass the SHA.

## Environment Variables

See [`apps/web/.env.example`](apps/web/.env.example) for the full template with
defaults and inline notes. The required groups are:

- **Auth** — `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Self-hosters should also set `AUTH_ALLOWED_EMAILS` and/or `AUTH_ALLOWED_DOMAINS` (comma-separated) to gate sign-in. Both unset = open sign-up.
- **Data sources** — `TICKETMASTER_API_KEY`, `SETLISTFM_API_KEY`, `GROQ_API_KEY`, `GOOGLE_PLACES_API_KEY`
- **Media (Cloudflare R2)** — `R2_*` plus `MEDIA_*` quotas/limits
- **Email (Resend)** — `RESEND_API_KEY`, `EMAIL_FROM` (unset → digest job logs and skips delivery)
- **Observability (optional)** — Langfuse and Axiom keys
- **Per-user guardrails (optional overrides)** — `SHOWBOOK_LLM_CALLS_PER_DAY` (default 50), `SHOWBOOK_BULK_SCAN_PER_HOUR` (default 5), `SHOWBOOK_BULK_SCAN_MESSAGE_CAP` (default 200). See [`GUARDRAILS.md`](./GUARDRAILS.md) for the full list.

## Project Structure

```
showbook/
├── apps/
│   ├── web/                  # Next.js 15 (App Router)
│   └── mobile/               # Expo (React Native)
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
pnpm test:e2e           # Prepare showbook_e2e and run Playwright on port 3002

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

## E2E Database Isolation

Development data lives in the `showbook` database. Playwright tests use a separate
`showbook_e2e` database in the same Postgres container so `/api/test/seed` can
wipe and rebuild fixtures without touching local dev data.

`pnpm test:e2e` runs `pnpm db:prepare:e2e` first, then starts a Playwright-owned
Next.js dev server at `https://localhost:3002` with:

```bash
DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e
ENABLE_TEST_ROUTES=1
NEXTAUTH_URL=https://localhost:3002
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

### Dev (`docker-compose.yml`, project `showbook`)

| Service | Container | Host port |
|---------|-----------|-----------|
| PostgreSQL 16 | showbook-db | 127.0.0.1:5433 |
| Next.js (dev mode, source bind-mounted) | showbook-web | 127.0.0.1:3001 |

### Prod (`docker-compose.prod.yml`, project `showbook-prod`)

| Service | Container | Host port |
|---------|-----------|-----------|
| PostgreSQL 16 | showbook-prod-db | 127.0.0.1:5433 |
| Next.js (prod build, NODE_ENV=production) | showbook-prod-web | 127.0.0.1:3001 |

The two projects' postgres volumes are namespaced separately
(`showbook_pgdata` vs `showbook-prod_pgdata`), so dev and prod databases
do not share data.

Named volumes:

| Volume | Purpose |
|--------|---------|
| `showbook_pgdata` / `showbook-prod_pgdata` | Postgres data directory |
| `showbook_next_cache` | Webpack persistent cache (`.next/cache`) — kept off the macOS bind mount so it survives container rebuilds and avoids ENOENT rename errors that otherwise force full cold compiles |
