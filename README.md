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
- **Imports:** Spotify + Apple Music (followed artists), Gmail bulk scan, Eventbrite + setlist.fm attended (past shows)
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
pnpm dev:db:migrate
pnpm dev:db:prepare:e2e
open http://localhost:3001
```

The dev compose hardcodes the dev postgres credentials, so `.env.dev`
doesn't need `DATABASE_URL` or `POSTGRES_PASSWORD`. Both env files are
gitignored.

## Production deployment

The prod path uses a separate compose that builds a sealed image (no source
bind-mounts), runs Next.js with `NODE_ENV=production`, and binds web +
Postgres to `127.0.0.1` so only loopback (e.g. cloudflared) can reach
them.

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

pnpm prod:up              # build + start
pnpm prod:db:migrate      # apply migrations against the prod DB (run once after up)
pnpm prod:logs            # tail web logs
pnpm prod:down            # stop
```

Operator runbook — self-hosted runner / continuous deployment, querying
the prod DB from another machine via `/api/admin/sql`, and the dev/prod
port + volume layout — lives in
[`showbook-specs/operations.md`](showbook-specs/operations.md).

## Environment Variables

See [`apps/web/.env.example`](apps/web/.env.example) for the full template with
defaults and inline notes. The required groups are:

- **Auth** — `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Self-hosters should also set `AUTH_ALLOWED_EMAILS` and/or `AUTH_ALLOWED_DOMAINS` (comma-separated) to gate sign-in. Both unset = open sign-up. Optionally set `ADMIN_EMAILS` (comma-separated) to grant access to the in-app Admin tab; closed by default.
- **Data sources** — `TICKETMASTER_API_KEY`, `SETLISTFM_API_KEY`, `GROQ_API_KEY`, `GOOGLE_PLACES_API_KEY`
- **Media (Cloudflare R2)** — `R2_*` plus `MEDIA_*` quotas/limits
- **Email (Resend)** — `RESEND_API_KEY`, `EMAIL_FROM` (unset → digest job logs and skips delivery)
- **Health-check cron (optional)** — `AXIOM_QUERY_TOKEN` (Axiom Personal Access Token with Query capability on `showbook-prod`; unset → axiom-backed checks report "unknown" instead of "ok"). The morning summary email is sent to every address in `ADMIN_EMAILS` (the same allowlist that gates the in-app Admin tab); empty/unset → cron still runs and logs to Axiom but no email is sent. Both are optional in dev — the cron no-ops the relevant pieces gracefully.
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
│   ├── observability/        # pino logger + Langfuse LLM-trace wrapper
│   └── shared/               # Types, constants, utils
├── scripts/                  # verify.sh and other workspace scripts
├── showbook-specs/           # Project specifications (see operations.md for runbook)
├── design/                   # Hi-fi prototypes
├── docker-compose.yml
└── nx.json
```

All logging and LLM tracing routes through `@showbook/observability` —
`console.*` is disallowed, see [`CLAUDE.md`](./CLAUDE.md) for the conventions.

## Commands

```bash
# Development
pnpm dev                # Start Next.js dev server (no Docker — reads apps/web/.env.local)
pnpm dev:up             # docker compose up -d (reads .env.dev, dev mode)
pnpm dev:down           # docker compose down
pnpm dev:build          # Rebuild dev images and start
pnpm dev:logs           # Tail web container logs

# Build / lint
pnpm build              # Production build of the web app (also runs inside the prod image)
pnpm lint               # Lint the web app

# Production (Docker only)
pnpm prod:up            # docker compose -f docker-compose.prod.yml up -d --build
pnpm prod:down          # Stop prod services
pnpm prod:logs          # Tail prod web container logs
pnpm prod:db:migrate    # Run drizzle migrations against the prod DB
pnpm prod:query         # Run a read-only query against prod via /api/admin/sql (see operations.md)

# Verify / test
pnpm verify             # build + lint + unit tests, with status summary
pnpm verify:e2e         # verify + Playwright e2e (also: RUN_E2E=1 pnpm verify)
pnpm verify:coverage    # build + lint + unit + integration + merged coverage (CI gate; 80% line/branch/function)
pnpm test:unit          # Unit tests across all packages
pnpm test:integration   # Integration tests against the isolated showbook_e2e DB
pnpm test:e2e           # Prepare showbook_e2e and run Playwright on port 3003

# Email + DB
pnpm email:smoke        # Render the daily digest with sample data to /tmp/showbook-digest.html
pnpm email:preview      # react-email dev server (localhost:3030, hot reload)
pnpm dev:db:generate    # Generate Drizzle migrations
pnpm dev:db:migrate     # Run dev DB migrations against showbook
pnpm dev:db:prepare:e2e # Reset/migrate the isolated showbook_e2e DB
pnpm dev:db:studio      # Open Drizzle Studio
```

## CI workflows

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — runs `pnpm verify:coverage` on every push and PR to `main`; merges are blocked below the 80% line/branch/function threshold (web scope + `apps/mobile/lib/**` scoped independently).
- [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — redeploys the prod box on a green `main` via a self-hosted runner. Setup in [`operations.md`](showbook-specs/operations.md).
- [`.github/workflows/mobile-e2e.yml`](.github/workflows/mobile-e2e.yml) — Android Maestro smoke layer on `apps/mobile/**` changes (label-gated on PRs, scheduled on `main`).

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
against the design handoff. It authenticates against the web backend
via the `POST /api/auth/mobile-token` bridge, then talks to the same
`@showbook/api` tRPC routers as the web client.

```bash
pnpm mobile:start       # Metro bundler for the development client
pnpm mobile:ios         # build + install iOS development client
pnpm mobile:android     # build + install Android development client
pnpm mobile:ios:go      # Expo Go only; Google sign-in will not work
pnpm mobile:android:go  # Expo Go only; Google sign-in will not work
pnpm mobile:typecheck
pnpm mobile:lint
pnpm mobile:test
pnpm mobile:e2e:ios     # Maestro flows on a local iOS simulator
pnpm mobile:e2e:dry     # Dry-run Maestro flows (no device)
pnpm mobile:trust-localhost-cert  # one-time iOS sim cert trust for https://localhost:3001
```

Set `EXPO_PUBLIC_API_URL` to `https://localhost:3001` for an iOS
simulator pointed at the local web stack with the dev cert, or to a
LAN/tunnel URL for a physical device. Google sign-in requires the development client or a
signed native build; Expo Go uses an `exp://...` redirect URI that
Google rejects. Build / submit / push-notification follow-ups live in
[`showbook-specs/mobile-deployment.md`](showbook-specs/mobile-deployment.md)
and [`showbook-specs/planned-improvements.md`](./showbook-specs/planned-improvements.md).

## Security

Found a vulnerability? Please report it privately — see [`SECURITY.md`](./SECURITY.md).

For the operational guardrails (rate limits, per-user LLM caps, auth allowlist, test-route gating), see [`GUARDRAILS.md`](./GUARDRAILS.md).

## License

[MIT](./LICENSE) © 2026 Ethan Smith.
