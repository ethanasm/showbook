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

## Quick Start

```bash
git clone <repo-url> && cd showbook
cp .env.local.example .env.local  # fill in API keys
docker compose up -d
pnpm install
pnpm db:migrate
open http://localhost:3001
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXTAUTH_URL` | Auth callback URL |
| `NEXTAUTH_SECRET` | Auth session secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `TICKETMASTER_API_KEY` | Ticketmaster Discovery API key |
| `SETLISTFM_API_KEY` | setlist.fm API key |
| `GROQ_API_KEY` | Groq API key |
| `GOOGLE_PLACES_API_KEY` | Google Places API key (venue search) |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_URL` | R2 public URL |

## Project Structure

```
showbook/
├── apps/
│   ├── web/                  # Next.js 15 (App Router)
│   └── mobile/               # Expo (React Native)
├── packages/
│   ├── db/                   # Drizzle schema + migrations
│   ├── api/                  # tRPC routers
│   ├── jobs/                 # pg-boss job handlers
│   └── shared/               # Types, constants, utils
├── showbook-specs/           # Project specifications
├── design/                   # Hi-fi prototypes
├── docker-compose.yml
└── nx.json
```

## Commands

```bash
pnpm dev                # Start Next.js dev server
pnpm db:generate        # Generate Drizzle migrations
pnpm db:migrate         # Run migrations
pnpm db:studio          # Open Drizzle Studio
pnpm test:e2e           # Run Playwright tests
docker compose up -d    # Start Postgres + web containers
docker compose logs web # View web container logs
```

## Docker Services

| Service | Container | Port |
|---------|-----------|------|
| PostgreSQL 16 | showbook-db | 5433 |
| Next.js | showbook-web | 3001 |
