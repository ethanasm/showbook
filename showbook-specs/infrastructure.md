# Showbook — Infrastructure & Stack

Stack, deployment architecture, and service mapping. Self-hosted on desktop.

---

## The Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Language** | TypeScript | Shared with frontend. One language, one toolchain |
| **Web framework** | Next.js 15 (App Router) | Server components, API routes, middleware |
| **Mobile** | Expo (React Native) | Write mobile apps in React/TypeScript. Expo adds a build system, file-based routing (like Next.js), and pre-built wrappers for native APIs — camera, SQLite for offline, push notifications — without needing Xcode/Android Studio for most work |
| **Database** | PostgreSQL (local) | Runs on your desktop alongside the app. Free, fast (no network round-trip), full control |
| **ORM** | Drizzle ORM | Type-safe, SQL-like API. Schema in TypeScript → generates migrations. Lightweight, no magic |
| **Auth** | Auth.js (NextAuth v5) | Google OAuth adapter built-in. Sessions stored in local Postgres |
| **Background jobs** | pg-boss | Job queue backed by the Postgres you already have. Handles scheduling, retries, concurrency. No Redis, no separate service, no external dependency |
| **Media storage** | Cloudflare R2 | Zero egress, S3-compatible. Only paid external dependency |
| **LLM** | Groq API | Fast inference on open-source models (Llama 3). Much cheaper than proprietary APIs. OpenAI-compatible SDK |
| **API layer** | tRPC | End-to-end type safety between Next.js server and client. No schema generation |
| **Monorepo** | Nx | Build orchestration, caching, `nx affected` for incremental builds. Already familiar from work |
| **Hosting** | Self-hosted on desktop | Next.js runs as a persistent Node.js process. Caddy as reverse proxy |
| **External access** | Cloudflare Tunnel | Exposes your desktop to the internet without port-forwarding or firewall changes. Free |

---

## Self-Hosting Setup

Your desktop runs everything: Next.js, Postgres, and pg-boss workers (inside the Next.js process). Cloudflare Tunnel dials out from your desktop to Cloudflare's edge — your mobile app and any browser hit `showbook.yourdomain.com`, which routes through Cloudflare → tunnel → Caddy → Next.js. Your desktop never needs an open inbound port.

```
Internet
   │
   ▼
Cloudflare Edge (showbook.yourdomain.com)
   │
   │ Cloudflare Tunnel (cloudflared daemon on desktop)
   │
   ▼
Your Desktop
   ├── Caddy        — reverse proxy, auto TLS via Let's Encrypt
   ├── Next.js      — web app + tRPC API + pg-boss job scheduler
   └── PostgreSQL   — local, port not exposed externally
```

**If your desktop is off, the app is down.** For a personal tracker that's fine. If you ever want uptime guarantees, migrate to a cheap VPS (Hetzner CX22 is ~€4/mo) — the stack is identical.

**Caddy** handles HTTPS with Let's Encrypt automatically. One config file, cert renewal is built in. Compared to nginx + certbot, there's essentially nothing to configure.

---

## Background Jobs (pg-boss)

pg-boss creates a jobs table in your existing Postgres database and uses it as a queue. You import it into Next.js, register job handlers, and schedule them — no separate process, no Redis, no external service.

All jobs run daily:

| Job | Schedule | What it does |
|-----|----------|-------------|
| `discover/ingest` | Daily, 2:00 AM | Collect unique venues + regions across all users → fetch TM events → upsert Announcements → prune expired |
| `shows/nightly` | Daily, 3:00 AM | Transition ticketed → past → delete expired watching → queue setlist enrichment |
| `enrichment/setlist-retry` | Daily, 4:00 AM | For each queued enrichment: fetch setlist.fm, update show if found, increment attempts |
| `notifications/digest` | Per user `digest_time` | Collect new announcements + upcoming shows → send email/push |

**Event-driven** (triggered immediately on write, not scheduled):

| Event | Job |
|-------|-----|
| Show created | Run enrichment pipeline |
| Venue created | Geocode lat/lng if missing |
| Performer created | Fetch TM attraction image |

---

## LLM: Groq

**What Groq is:** An inference API that runs open-source models (Llama 3, Mixtral) on custom ASIC hardware. Much faster cold starts and lower cost than proprietary APIs. Uses the OpenAI SDK format — swap the base URL and you're done.

**We use it for two things:**

**1. Chat-mode Add** — parsing free-text into structured fields

- Input: *"I saw Radiohead at MSG last night, second row"*
- Output: `{ headliner: "Radiohead", venue_hint: "MSG", date_hint: "last night", seat_hint: "second row", kind: "concert" }`
- Model: `llama-3.3-70b-versatile`
- Cost: effectively $0 at personal use volume

**2. Playbill cast extraction** — vision model reading a photo

- Input: photo of playbill cast page
- Output: `[{ actor: "Cynthia Erivo", role: "Elphaba" }, ...]`
- Model: `llama-3.2-11b-vision-preview`
- Tradeoff: quality is lower than GPT-4o or Claude for complex layouts. If a playbill has two-column small print or decorative fonts, extraction may need user correction. Acceptable — the user confirms before saving anyway.

```typescript
import Groq from 'groq-sdk';
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Text extraction
const result = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: prompt }],
  response_format: { type: 'json_object' },
});

// Vision (playbill OCR)
const result = await groq.chat.completions.create({
  model: 'llama-3.2-11b-vision-preview',
  messages: [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: base64DataUrl } },
      { type: 'text', text: 'Extract the cast list...' }
    ]
  }],
  response_format: { type: 'json_object' },
});
```

---

## Monorepo Structure

```
showbook/
├── apps/
│   ├── web/                    # Next.js 15 (App Router)
│   │   └── app/
│   │       ├── (auth)/         # Google OAuth flow
│   │       ├── (app)/          # Authenticated shell
│   │       │   ├── home/
│   │       │   ├── discover/
│   │       │   ├── shows/
│   │       │   ├── map/
│   │       │   ├── add/
│   │       │   └── preferences/
│   │       └── api/
│   │           └── trpc/       # tRPC HTTP handler
│   │
│   └── mobile/                 # Expo (React Native)
│       ├── app/                # Expo Router (file-based, mirrors web routes)
│       ├── components/
│       └── lib/
│           └── offline/        # expo-sqlite cache + sync logic
│
├── packages/
│   ├── db/                     # Drizzle schema, migrations, queries
│   │   ├── schema/
│   │   │   ├── shows.ts
│   │   │   ├── venues.ts
│   │   │   ├── performers.ts
│   │   │   ├── announcements.ts
│   │   │   ├── users.ts
│   │   │   └── relations.ts
│   │   ├── migrations/
│   │   └── queries/            # Typed query helpers
│   │
│   ├── api/                    # tRPC routers
│   │   ├── routers/
│   │   │   ├── shows.ts
│   │   │   ├── discover.ts
│   │   │   ├── venues.ts
│   │   │   └── performers.ts
│   │   └── trpc.ts
│   │
│   ├── jobs/                   # pg-boss job handlers
│   │   ├── discover-ingest.ts
│   │   ├── shows-nightly.ts
│   │   ├── setlist-retry.ts
│   │   └── notifications.ts
│   │
│   └── shared/
│       ├── types/
│       ├── constants/          # Kind enum, state enum, palette tokens
│       └── utils/              # Date helpers, formatting
│
├── Caddyfile
├── nx.json
├── project.json
├── package.json
└── tsconfig.base.json
```

---

## Service Architecture

```
                    ┌─────────────────────────┐
                    │   Cloudflare Edge        │
                    │   showbook.yourdomain    │
                    └────────────┬────────────┘
                                 │ Cloudflare Tunnel
                    ┌────────────▼────────────────────────────┐
                    │   Your Desktop                           │
                    │                                          │
                    │  Caddy (443) → Next.js (3000)            │
                    │                    │                     │
                    │              ┌─────┴──────┐              │
                    │              │ PostgreSQL  │              │
                    │              │ (local)     │              │
                    │              └─────────────┘              │
                    └──────────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                   ▼
    ┌──────────────┐   ┌──────────────────┐  ┌──────────────┐
    │ Cloudflare   │   │ External APIs    │  │ Groq API     │
    │ R2 (photos)  │   │ · Ticketmaster   │  │ · Chat Add   │
    │              │   │ · setlist.fm     │  │ · Playbill   │
    └──────────────┘   │ · Google OAuth   │  └──────────────┘
                       │ · Google Geocode │
                       └──────────────────┘

    Expo mobile app → Cloudflare Tunnel URL → same Next.js server
```

---

## Cost

| Service | Cost |
|---------|------|
| PostgreSQL (local) | $0 |
| Next.js (self-hosted) | $0 |
| Caddy | $0 |
| Cloudflare Tunnel | $0 |
| Cloudflare R2 | $0 (free: 10GB storage, 10M reads/mo) |
| Expo EAS (mobile builds) | $0 (free: 30 builds/mo) |
| Ticketmaster API | $0 |
| setlist.fm API | $0 |
| Google OAuth | $0 |
| Google Geocoding | $0 (free $200/mo credit, we use ~$0.01) |
| Groq API | $0 (free: 14,400 req/day — enormous for personal use) |
| Domain | ~$12/yr |
| Electricity | ~$5–15/mo (desktop running 24/7) |
| **Total** | **~$5–15/mo** |

---

## Offline Strategy (Mobile)

Per D19, Add flow is blocked until online. Read-only browsing works offline via expo-sqlite local cache.

| Feature | Offline |
|---------|---------|
| Shows list | ✅ Reads from SQLite cache, synced on app open |
| Show detail | ✅ Cached locally |
| Map | ✅ Venue pins cached |
| Discover feed | ❌ Requires connectivity |
| Add show | ❌ Blocked |
| Preferences | ✅ Local cache, writes sync when online |

---

## Schema → Drizzle

Every entity in `schema.md` maps directly to a Drizzle table definition:

```typescript
// packages/db/schema/shows.ts
import { pgTable, uuid, text, date, decimal, jsonb, timestamp, pgEnum } from 'drizzle-orm/pg-core';

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

`drizzle-kit generate` → SQL migration files. `drizzle-kit migrate` → applies to local Postgres.
