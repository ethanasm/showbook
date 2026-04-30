# Showbook — Infrastructure & Stack

Self-hosted on desktop. Two Docker containers (Postgres + Next.js). Accessible at `showbook.ethanasm.me`.

---

## The Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Language** | TypeScript | Shared with frontend. One language, one toolchain |
| **Web framework** | Next.js 15 (App Router) | Server components, API routes, middleware. Serves pages + tRPC API + pg-boss jobs — all one process, one container |
| **Mobile** | Expo (React Native) | Mobile apps in React/TypeScript. Build tools, file-based routing, native API wrappers without Xcode/Android Studio |
| **Database** | PostgreSQL (Docker, port 5433) | Own container, independent from other projects |
| **ORM** | Drizzle ORM | Type-safe, SQL-like API. Schema in TypeScript → generates migrations |
| **Auth** | Auth.js (NextAuth v5) | Google OAuth built-in. Sessions in Postgres |
| **Background jobs** | pg-boss | Job queue backed by Postgres. Runs inside the Next.js process |
| **Media storage** | Cloudflare R2 | Zero egress fees, S3-compatible |
| **LLM** | Groq API | Fast inference on Llama 3. OpenAI-compatible SDK. Effectively free |
| **API layer** | tRPC | End-to-end type safety between server and client |
| **Monorepo** | Nx | Build orchestration, caching, `nx affected` |
| **External access** | Cloudflare Tunnel | `showbook.ethanasm.me` → localhost:3001. Shared tunnel with vacation tracker |

---

## Docker Setup

Two containers. That's it.

```yaml
name: showbook

services:
  postgres:
    image: postgres:16-alpine
    container_name: showbook-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: showbook
      POSTGRES_USER: showbook
      POSTGRES_PASSWORD: showbook_dev
    ports:
      - "5433:5432"
    volumes:
      - showbook_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: [ "CMD-SHELL", "pg_isready -U showbook" ]
      interval: 5s
      timeout: 3s
      retries: 5

  web:
    build:
      context: showbook-specs
      dockerfile: apps/web/Dockerfile
    container_name: showbook-web
    restart: unless-stopped
    env_file: .env.local
    environment:
      DATABASE_URL: postgresql://showbook:showbook_dev@postgres:5432/showbook
    ports:
      - "3001:3001"
    volumes:
      - ./apps:/app/apps
      - ./packages:/app/packages
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  showbook_pgdata:
```

The `web` container runs Next.js which serves everything: pages, tRPC API, and pg-boss background jobs. No separate API or worker container — it's all one process. Volume mounts give hot reload.

The `DATABASE_URL` inside the container uses `postgres` (the Docker service name) not `localhost`, since containers talk to each other via Docker's internal network. The host-exposed port 5433 is only for running migrations and psql from outside Docker.

### E2E database isolation

Local development uses the `showbook` database. Playwright uses a separate
`showbook_e2e` database in the same Postgres container so test seeding can
delete and recreate fixtures without touching manually entered dev data.

```bash
pnpm db:prepare:e2e
pnpm test:e2e
```

`pnpm db:prepare:e2e` drops/recreates disposable `showbook_e2e` and applies
Drizzle migrations with:

```bash
DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e
```

Playwright starts its own Next.js dev server on `https://localhost:3002` with
`ENABLE_TEST_ROUTES=1`. The `/api/test/*` routes reject requests unless test
routes are enabled and `DATABASE_URL` points at `showbook_e2e`.

### .env.local

```bash
PORT=3001
NEXTAUTH_URL=https://showbook.ethanasm.me
NEXTAUTH_SECRET=generate-a-random-string

GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

TICKETMASTER_API_KEY=your-tm-key
SETLISTFM_API_KEY=your-setlistfm-key
GROQ_API_KEY=your-groq-key

R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret
R2_BUCKET_NAME=showbook
R2_PUBLIC_URL=https://media.ethanasm.me
```

Note: `DATABASE_URL` is set in `docker-compose.yml` under `environment`, not in `.env.local`, because the container needs the Docker-internal hostname (`postgres`) not `localhost`.

### Port map (all projects, no conflicts)

| Port | Service | Project |
|------|---------|---------|
| 3000 | web | vacation-price-tracker |
| **3001** | web | **showbook** |
| 5432 | postgres | vacation-price-tracker |
| **5433** | postgres | **showbook** |
| 6379 | redis | vacation-price-tracker |
| 7233 | temporal | vacation-price-tracker |
| 8000 | api | vacation-price-tracker |
| 8080 | temporal-ui | vacation-price-tracker |

### Workflow

```bash
# Start everything
docker compose up -d

# Run migrations (from host, via exposed port 5433)
DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook npx drizzle-kit migrate

# Prepare the isolated e2e DB
pnpm db:prepare:e2e

# Verify
docker compose logs web       # Next.js output
docker compose exec showbook-db pg_isready -U showbook

# Rebuild after code changes (if hot reload misses something)
docker compose up -d --build web
```

### Dockerfile (apps/web/Dockerfile)

The agent will create this, but the key requirements:
- Node 20 base image
- Install pnpm, copy workspace, install deps
- Run `npx nx build web` for production build
- Or run `npx nx dev web` with `--hostname 0.0.0.0` for development with hot reload
- Expose port 3001

---

## External Access

Cloudflared runs on the host as a system service (not in Docker). One tunnel, shared across all projects. Config at `~/.cloudflared/config.yml` routes by hostname:

```yaml
ingress:
  - hostname: showbook.ethanasm.me
    service: http://localhost:3001
  - hostname: vactrack.ethanasm.me
    service: http://localhost:3000
  - service: http_status:404
```

Full setup instructions in `cloudflare-tunnel-setup.md`.

---

## Architecture

```
Internet
   │
   │  https://showbook.ethanasm.me
   ▼
Cloudflare Edge (TLS)
   │
   │  Tunnel (cloudflared, host system service)
   ▼
Your Desktop
   │
   ├── showbook docker compose
   │   ├── showbook-db   (postgres, port 5433)
   │   └── showbook-web  (next.js + trpc + pg-boss, port 3001)
   │
   └── vacation-price-tracker docker compose (independent)
       └── db:5432, redis, temporal, api:8000, web:3000
```

External services:

```
showbook-web ──→ Cloudflare R2 (photos)
             ──→ Ticketmaster API (events, venues, performers)
             ──→ setlist.fm API (setlists)
             ──→ Google OAuth (auth)
             ──→ Google Geocoding (venue lat/lng)
             ──→ Groq API (chat-mode add, playbill OCR)
```

Expo mobile → `showbook.ethanasm.me` → same tunnel → same container.

---

## Background Jobs (pg-boss)

Runs inside the Next.js process in the `showbook-web` container. Uses a jobs table in Postgres.

| Job | Schedule | What it does |
|-----|----------|-------------|
| `discover/ingest` | Daily, 2:00 AM | Fetch TM events for followed venues + regions → upsert Announcements → prune expired |
| `shows/nightly` | Daily, 3:00 AM | ticketed → past, delete expired watching, queue setlist enrichment |
| `enrichment/setlist-retry` | Daily, 4:00 AM | Fetch setlist.fm for queued concerts |
| `notifications/digest` | Per user `digest_time` | New announcements + upcoming shows → email |

Event-driven (triggered on write, not scheduled):
- Show created → run enrichment pipeline
- Venue created → geocode if no lat/lng
- Performer created → fetch TM image

---

## LLM: Groq

**Chat-mode Add:** `llama-3.3-70b-versatile` parses free text into structured fields.
**Playbill cast extraction:** `meta-llama/llama-4-scout-17b-16e-instruct` (Llama 4 Scout) reads photos, extracts cast. Native multimodal — better quality than the older preview models. User confirms before saving.

```typescript
import Groq from 'groq-sdk';
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const result = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: prompt }],
  response_format: { type: 'json_object' },
});
```

---

## Monorepo Structure

```
showbook/
├── apps/
│   ├── web/                    # Next.js 15 (App Router)
│   │   ├── Dockerfile
│   │   └── app/
│   │       ├── (auth)/
│   │       ├── (app)/
│   │       │   ├── home/
│   │       │   ├── discover/
│   │       │   ├── shows/
│   │       │   ├── map/
│   │       │   ├── add/
│   │       │   └── preferences/
│   │       └── api/trpc/
│   │
│   └── mobile/                 # Expo (React Native)
│
├── packages/
│   ├── db/                     # Drizzle schema, migrations, queries
│   ├── api/                    # tRPC routers
│   ├── jobs/                   # pg-boss job handlers
│   └── shared/                 # Types, constants, utils
│
├── docker-compose.yml
├── nx.json
├── package.json
└── tsconfig.base.json
```

---

## Cost

| Service | Cost |
|---------|------|
| PostgreSQL (Docker) | $0 |
| Next.js (Docker) | $0 |
| Cloudflare Tunnel | $0 |
| Cloudflare R2 | $0 (free: 10GB, 10M reads/mo) |
| Expo EAS | $0 (free: 30 builds/mo) |
| Ticketmaster / setlist.fm / Google / Groq | $0 (all free tier) |
| Domain (ethanasm.me) | already owned |
| Electricity | ~$5–15/mo |
| **Total** | **~$5–15/mo** |

---

## Offline Strategy (Mobile)

Add flow blocked until online. Read-only browsing works offline via expo-sqlite.

| Feature | Offline |
|---------|---------|
| Shows list | ✅ SQLite cache |
| Show detail | ✅ Cached |
| Map | ✅ Venue pins cached |
| Discover | ❌ Requires connectivity |
| Add show | ❌ Blocked |
| Preferences | ✅ Local cache |

---

## Schema → Drizzle

```typescript
export const kindEnum = pgEnum('kind', ['concert', 'theatre', 'comedy', 'festival']);
export const stateEnum = pgEnum('state', ['past', 'ticketed', 'watching']);

export const shows = pgTable('shows', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  kind: kindEnum('kind').notNull(),
  state: stateEnum('state').notNull(),
  venueId: uuid('venue_id').notNull().references(() => venues.id),
  date: date('date').notNull(),
  endDate: date('end_date'),
  seat: text('seat'),
  pricePaid: decimal('price_paid', { precision: 10, scale: 2 }),
  tourName: text('tour_name'),
  setlist: text('setlist').array(),
  photos: text('photos').array(),
  sourceRefs: jsonb('source_refs'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

`drizzle-kit generate` → SQL migrations. Migrate via host: `DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook npx drizzle-kit migrate`
