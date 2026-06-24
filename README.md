# Showbook

Personal tracker for live shows — concerts, theatre, comedy, and festivals. Predicts setlists for upcoming concerts, scans Gmail for tickets, turns setlists you've heard into Spotify playlists, and surfaces announcements at venues you follow. Self-hosted, with a feature-complete native mobile app.

## Tech Stack

- **Web:** Next.js 15 (App Router) — see [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md)
- **Mobile:** Expo SDK 55 + Expo Router (React Native) — feature-complete; see [`apps/mobile/CLAUDE.md`](apps/mobile/CLAUDE.md) and [`docs/specs/mobile-roadmap.md`](docs/specs/mobile-roadmap.md)
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
[`docs/specs/operations.md`](docs/specs/operations.md).

## Environment Variables

See [`apps/web/.env.example`](apps/web/.env.example) for the full template with
defaults and inline notes. The required groups are:

- **Auth** — `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Self-hosters should also set `AUTH_ALLOWED_EMAILS` and/or `AUTH_ALLOWED_DOMAINS` (comma-separated) to gate sign-in. Both unset = open sign-up. Optionally set `ADMIN_EMAILS` (comma-separated) to grant access to the in-app Admin tab; closed by default.
- **Data sources** — `TICKETMASTER_API_KEY`, `SETLISTFM_API_KEY`, `GROQ_API_KEY`, `GOOGLE_PLACES_API_KEY`
- **Media (Cloudflare R2)** — `R2_*` plus `MEDIA_*` quotas/limits
- **Email (Resend)** — `RESEND_API_KEY`, `EMAIL_FROM` (unset → digest job logs and skips delivery)
- **Legal (optional)** — `LEGAL_CONTACT_EMAIL`, `LEGAL_GOVERNING_LAW` set the contact address + governing law shown on the public `/privacy`, `/terms`, and `/account-deletion` pages; unset → a `@showbook.app` placeholder
- **Health-check cron (optional)** — `AXIOM_QUERY_TOKEN` (Axiom Personal Access Token with Query capability on `showbook-prod`; unset → axiom-backed checks report "unknown" instead of "ok"). The cron reads from the same dataset prod ships to (`AXIOM_DATASET`, default `showbook-prod` — see [`docs/specs/operations/axiom-map-fields.md`](./docs/specs/operations/axiom-map-fields.md)). The morning summary email is sent to every address in `ADMIN_EMAILS` (the same allowlist that gates the in-app Admin tab); empty/unset → cron still runs and logs to Axiom but no email is sent. Both are optional in dev — the cron no-ops the relevant pieces gracefully.
- **Observability (optional)** — Langfuse and Axiom keys
- **Per-user guardrails (optional overrides)** — `SHOWBOOK_LLM_CALLS_PER_DAY` (default 50), `SHOWBOOK_BULK_SCAN_PER_HOUR` (default 5), `SHOWBOOK_BULK_SCAN_MESSAGE_CAP` (default 200). See [`docs/GUARDRAILS.md`](./docs/GUARDRAILS.md) for the full list.

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
├── docs/                     # Project docs
│   ├── specs/                #   Project specifications (see operations.md for runbook)
│   ├── design/               #   Hi-fi prototypes
│   ├── GUARDRAILS.md         #   Operational guardrails
│   └── SECURITY.md           #   Security policy
├── infra/                    # Docker compose files + local TLS certs
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   └── certs/                #   gitignored mkcert TLS for HTTPS dev
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
pnpm prod:up            # docker compose -f infra/docker-compose.prod.yml up -d --build
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
- [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — redeploys the prod box on a green `main` via a self-hosted runner. Setup in [`operations.md`](docs/specs/operations.md).
- [`.github/workflows/mobile-e2e.yml`](.github/workflows/mobile-e2e.yml) — Android Maestro smoke layer on `apps/mobile/**` changes (label-gated on PRs, scheduled on `main`).

## Scheduled jobs (cron)

All background work runs as pg-boss cron jobs inside the Next.js process,
registered in [`packages/jobs/src/registry.ts`](packages/jobs/src/registry.ts).
**All times are America/New_York (ET)** — the `SCHEDULE_TZ` the scheduler uses.
The morning health check at 07:00 ET reports any cron that didn't fire (see
`SCHEDULED_EXPECTATIONS` in `packages/jobs/src/health-check/checks.ts`).

| Job (queue) | Time (ET) | Cadence | What it does |
|-------------|-----------|---------|--------------|
| `prune/nightly` | 02:00 | Daily | Combined prune sweep, in order: past-dated announcements → orphaned catalog rows (venues/performers/announcements) → orphaned `media_assets` + their R2 blobs. |
| `enrichment/album-metadata-fill` | 02:30 | Daily | Fills Spotify album/track metadata per performer (stalest-first), budget-bounded. |
| `shows/nightly` | 03:00 | Daily | Show state transitions (watching → ticketed → past) and follow-on queueing. |
| `eval/run-daily-backtest` | 03:15 | Daily | Prediction-eval back-test against stored `tour_setlists` (shadow mode). |
| `enrichment/setlist-style-refresh` | 03:30 | Daily | Reclassifies each performer's setlist style from their corpus. |
| `enrichment/setlist-retry` | 04:00 | Daily | Retries failed/incomplete setlist enrichments. |
| `backfill/performer-mbids` | 04:30 | Daily | Resolves missing MusicBrainz IDs (before corpus-fill, which consumes them). |
| `enrichment/setlist-corpus-fill-refresh` | 04:45 | Daily | Refreshes setlist corpus for top-followed + upcoming-show performers; rebuilds song index. |
| `discover/ingest` | 05:00 | Daily | Ticketmaster ingest (phases 1–4) + scrapers. Feeds the Discover tab and the digest's "new announcements". (Was weekly; now daily.) |
| `backfill/performer-images` | 05:30 | Daily | Backfills performer photos. |
| `backfill/venue-photos` | 05:45 | Daily | Backfills venue photos (Google Places). |
| `backfill/performer-ids` | 06:00 | Daily | Combined performer external-ID sweep, in order: Ticketmaster → Spotify → Wikidata catalog IDs. |
| `backfill/show-cover-images` | 06:15 | Daily | Backfills show cover images. |
| `backfill/show-ticket-urls` | 06:45 | Daily | Fills `ticket_url` for future shows imported without a TM link. |
| `health/morning-check` | 07:00 | Daily | Runs all health checks and emails the operator (one hour before the digest). |
| `notifications/daily-digest` | 08:00 | Daily | Builds and sends each user's daily email digest. |
| `spotify/recently-played` | 09:00 | Daily | Recently-played priming-stat sweep (~6h post-show). |
| `enrichment/setlist-tour-watch` | every 3h | Sub-daily | Refreshes setlists for performers on active multi-night runs (per-performer dedup → once/day each). |
| `spotify/purge-revoked-tokens` | Sun 02:00 | Weekly | Purges revoked Spotify tokens older than 30 days. |
| `spotify/year-end-soundtrack` | Dec 31 03:00 | Yearly | Builds each user's year-end Spotify soundtrack playlist. |

The individual `prune/orphan-catalog`, `prune/past-announcements`,
`prune/orphan-media`, and `backfill/performer-{ticketmaster,spotify,wikidata}-ids`
queues stay registered but **unscheduled** — they're fanned out by the combined
`prune/nightly` / `backfill/performer-ids` sweeps above, and remain individually
triggerable from the `/admin` page. User-triggered ingests
(`discover/ingest-{venue,performer,region}`, `enrichment/setlist-corpus-fill`,
`enrichment/song-index-rebuild`) have no schedule.

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
[`docs/specs/mobile-deployment.md`](docs/specs/mobile-deployment.md)
and [`docs/specs/planned-improvements.md`](./docs/specs/planned-improvements.md).

## Security

Found a vulnerability? Please report it privately — see [`docs/SECURITY.md`](./docs/SECURITY.md).

For the operational guardrails (rate limits, per-user LLM caps, auth allowlist, test-route gating), see [`docs/GUARDRAILS.md`](./docs/GUARDRAILS.md).

## Legal

Public legal pages ship with the web app under `apps/web/app/(public)/` — these are the URLs the app stores ask for at submission:

- `/privacy` — privacy policy (what's collected, retention, deletion)
- `/terms` — terms of service
- `/account-deletion` — data-deletion instructions (**required** by Google Play)

Contact address and governing law are env-driven (`LEGAL_CONTACT_EMAIL`, `LEGAL_GOVERNING_LAW`); set them in `.env.prod` or the pages fall back to a `@showbook.app` placeholder.

## License

[MIT](./LICENSE) © 2026 Ethan Smith.
