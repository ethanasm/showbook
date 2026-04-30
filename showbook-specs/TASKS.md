# Showbook — Task Graph

Flat task list with explicit dependencies. The lead agent should read this, build a DAG, and assign subagents to maximize parallelism. Each task states what to read, what to build, what blocks it, and how to verify it's done.

**Spec files** (every subagent should have access to these):
- `schema.md` — entity definitions
- `data-sources.md` — external API details
- `pipelines.md` — enrichment + ingestion flows
- `infrastructure.md` — stack choices, monorepo structure
- `decisions.md` — resolved design decisions
- `VERIFICATION.md` — Playwright testing strategy

---

## Dependency Graph (visual)

```
T01 Scaffold ──┬──────────────────────────────────────────────────────────┐
               │                                                          │
T02 Schemas ───┤                                                          │
               │                                                          │
T03 Shared ────┤   T05 Playwright ────────────────────────────────────┐   │
               │                                                      │   │
T04 Design ────┤                                                      │   │
               │                                                      │   │
          ┌────┴────┐                                                 │   │
          │         │                                                 │   │
       T06 DB    T08 TM client                                       │   │
          │      T09 Setlist client                                   │   │
          │      T10 Groq client                                      │   │
          │         │                                                 │   │
       T07 Auth  T11 Venue matcher ──────┐                            │   │
          │      T12 Performer matcher ──┤                            │   │
          │      T13 pg-boss             │                            │   │
          │         │                    │                            │   │
          ├─────────┼────────────────────┤                            │   │
          │         │                    │                            │   │
       T14 Shows router              T16 Enrichment router            │   │
       T15 Discover router           T17 Prefs router                 │   │
          │         │                    │                            │   │
          ├─────────┼────────────────────┤                            │   │
          │         │                    │                            │   │
       T18 App shell + nav              T25 Nightly job               │   │
       T19 Add page                     T26 Setlist retry job         │   │
       T20 Shows page                   T27 Ingestion job             │   │
       T21 Home page                    T28 Notification job          │   │
       T22 Discover page                                              │   │
       T23 Map page                  T29 R2 photo pipeline            │   │
       T24 Preferences page                                           │   │
          │                                                           │   │
          └── Playwright tests per page (T05) ────────────────────────┘   │
                                                                          │
       T30 Caddy + Tunnel ────────────────────────────────────────────────┘
       T31 Expo scaffold
       T32 Offline caching
```

---

## Wave 1 — No dependencies (all parallel)

### T01: Scaffold Nx workspace + Docker
**Depends on:** nothing
**Read:** `infrastructure.md → Monorepo Structure`, `infrastructure.md → Docker Setup`
**Build:**
- `npx create-nx-workspace showbook --preset=ts --pm=pnpm`
- Create all directories: `apps/web`, `apps/mobile` (placeholder), `packages/db`, `packages/api`, `packages/jobs`, `packages/shared`
- Install core deps per package (see infrastructure.md)
- Configure `nx.json` with project graph
- `apps/web`: scaffold Next.js 15 with App Router, **port 3001**
- Create `apps/web/Dockerfile` — Node 20 base, install pnpm, copy workspace, `nx dev web --hostname 0.0.0.0`, expose 3001
- Create `docker-compose.yml` from `infrastructure.md → Docker Setup` (two services: postgres on 5433, web on 3001 with volume mounts for hot reload)
- Create `.env.local` template with all required env vars (see infrastructure.md)
- **Port check:** Verify 5433 and 3001 are free: `lsof -i :5433 -i :3001`. If taken, adjust ports in docker-compose.yml.
- `docker compose up -d`
**Verify:** `docker compose ps` shows both containers healthy. `http://localhost:3001` loads the Next.js default page.

### T02: Drizzle schemas
**Depends on:** nothing (can write schema files without the monorepo running)
**Read:** `schema.md` (every entity, every field, every enum, every relation)
**Build:**
- One file per entity in `packages/db/schema/`: `users.ts`, `venues.ts`, `performers.ts`, `shows.ts`, `announcements.ts`, `follows.ts`, `regions.ts`, `enrichment.ts`
- `relations.ts` with all Drizzle relation definitions
- `index.ts` re-exporting everything
- All enums: kind, state, performer_role, on_sale_status, announcement_source, digest_frequency, theme, enrichment_type
- `drizzle.config.ts` pointing at `postgresql://localhost:5432/showbook`
**Verify:** `npx drizzle-kit generate` produces migration SQL with no errors. Inspect generated SQL — every table, column, enum, FK, and index from `schema.md` should be present.

### T03: Shared types and constants
**Depends on:** nothing
**Read:** `schema.md` (enums), project README (design system — palette, kind colors)
**Build:**
- `packages/shared/constants/kinds.ts` — Kind enum, KIND_COLORS, KIND_ICONS
- `packages/shared/constants/states.ts` — ShowState enum
- `packages/shared/constants/palette.ts` — MARQUEE_GOLD, neutral surfaces, theme tokens
- `packages/shared/types/` — TypeScript types for Show, Venue, Performer, Announcement, etc. (mirrors Drizzle schema but as plain interfaces for use in UI code)
- `packages/shared/utils/` — date helpers (countdown, relative dates), formatting utils
**Verify:** Types compile with no errors. Import from another package works.

### T04: Design system foundation
**Depends on:** nothing (can build components in isolation)
**Read:** project README (design system section — typography, palette, kind colors, interactions)
**Build:**
React components in `apps/web/components/design-system/`:
- `ThemeProvider` — dark/light/system toggle, CSS variables
- `KindBadge` — kind icon + color label (concert/theatre/comedy/festival)
- `StateChip` — TIX and WATCHING chips in Marquee Gold
- `ShowRow` — a show list row with kind color bar, headliner, venue, date, state chip. Three visual variants per state (past/ticketed/watching) per `schema.md → State Machine`
- `HeroCard` — next-up show card with venue, date, countdown
- `SegmentedControl` — reusable segmented control component
- `Sidebar` — app navigation shell with 6 items, active state in Marquee Gold
- Typography: Geist (headliners, body) + Geist Mono (labels, metadata, nav)
**Verify:** Each component renders correctly in isolation. Create a `/dev/components` route that renders all components in both themes.

### T05: Playwright setup
**Depends on:** nothing
**Read:** `VERIFICATION.md`
**Build:**
- Install Playwright: `pnpm add -D @playwright/test` in `apps/web`
- `playwright.config.ts` with baseURL `http://localhost:3000`
- Screenshot output directory: `apps/web/test-results/screenshots/`
- Helper utilities:
  - `takeScreenshot(page, name)` — full-page screenshot saved to output dir
  - `loginAsTestUser(page)` — auth helper that signs in via test credentials
  - `seedTestData(db)` — inserts a known set of test shows, venues, performers
  - `cleanTestData(db)` — removes test data
- Seed data script that creates a realistic test dataset: ~20 shows across all 4 kinds and 3 states, ~8 venues, ~15 performers, ~10 announcements
**Verify:** `npx playwright test --project=setup` runs the seed script and takes a screenshot of the empty app.

---

## Wave 2 — Depends on scaffold + schemas

### T06: Postgres migrations
**Depends on:** T01, T02
**Build:**
- Verify Docker Postgres is running: `docker compose exec showbook-dev-db pg_isready -U showbook`
- `packages/db/client.ts` — exports configured Drizzle client. Inside the web container, uses `postgresql://showbook:showbook_dev@postgres:5432/showbook` (Docker internal). From host, uses `localhost:5433`.
- Run migrations from host: `DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook npx drizzle-kit migrate`
**Verify:** `docker compose exec showbook-dev-db psql -U showbook -c '\dt'` lists all expected tables. All columns, types, and constraints match `schema.md`.

### T07: Google OAuth with Auth.js
**Depends on:** T01, T06
**Read:** `infrastructure.md → The Stack` (Auth.js), `schema.md → User`
**Build:**
- Install `next-auth@5`, `@auth/drizzle-adapter`
- `apps/web/auth.ts` — Google OAuth provider, Drizzle adapter
- `app/api/auth/[...nextauth]/route.ts`
- `app/(auth)/signin/page.tsx` — sign-in page
- Session provider in root layout
- `.env.local` template with all required env vars
**Verify:** Complete Google OAuth flow end to end. `users` table has a row. Session accessible in server components.

### T08: Ticketmaster API client
**Depends on:** T01, T03
**Read:** `data-sources.md → Ticketmaster Discovery API` (endpoints, field mappings, kind inference)
**Build:**
`packages/api/lib/ticketmaster.ts`:
- `searchEvents(params: { keyword?, venueId?, latlong?, radius?, startDate?, endDate?, size? })` → typed response
- `getVenue(tmVenueId)` → Venue-shaped response
- `getAttraction(tmAttractionId)` → Performer-shaped response with image URL
- `inferKind(classifications)` → Kind enum
- Rate limiting: max 5 requests/sec (use a simple delay or p-throttle)
- Error handling: typed errors, retries on 429
**Verify:** Call `searchEvents({ keyword: "Radiohead" })` → returns events. Call `getVenue` with a known TM venue ID → returns venue data with lat/lng.

### T09: setlist.fm API client
**Depends on:** T01, T03
**Read:** `data-sources.md → setlist.fm API`
**Build:**
`packages/api/lib/setlistfm.ts`:
- `searchArtist(name)` → returns array of `{ mbid, name, sortName }`
- `searchSetlist(artistMbid, date)` → returns `{ songs: string[], tourName?: string }` or null
- Response parsing: flatten `sets.set[].song[].name`, extract `tour.name`
- Rate limiting: ~2 req/sec
**Verify:** `searchArtist("Radiohead")` → returns MBID. `searchSetlist(mbid, "2024-06-15")` → returns a setlist or null.

### T10: Groq API client
**Depends on:** T01
**Read:** `infrastructure.md → LLM: Groq`, `data-sources.md → Manual Entry + LLM Extraction`
**Build:**
`packages/api/lib/groq.ts`:
- `parseShowInput(freeText)` → `{ headliner, venue_hint, date_hint, seat_hint, kind_hint }`
- `extractCast(imageBase64)` → `[{ actor: string, role: string }]`
- System prompts for both use cases (structured JSON output)
- Error handling for malformed responses
**Verify:** `parseShowInput("I saw Wicked at the Gershwin last Tuesday, row F")` → correctly extracts headliner, venue, date, seat. Cast extraction with a test image.

### T11: Venue matcher
**Depends on:** T06, T08
**Read:** `schema.md → Venue → Deduplication strategy`
**Build:**
`packages/api/lib/venue-matcher.ts`:
- `matchOrCreateVenue(input: { name, city, tmVenueId?, lat?, lng?, neighborhood? })` → `{ venue, candidates?, created }`
- Match logic: TM venue ID → exact name+city → show candidates if multiple → create if none
- On create: geocode via TM data or Google Geocoding API if no lat/lng
**Verify:** Create a venue with TM ID. Call matcher with same TM ID → returns existing. Call with name+city → returns existing. Call with new name → creates.

### T12: Performer matcher
**Depends on:** T06, T08
**Read:** `schema.md → Performer → Deduplication`
**Build:**
`packages/api/lib/performer-matcher.ts`:
- `matchOrCreatePerformer(input: { name, tmAttractionId?, setlistfmMbid? })` → `{ performer, created }`
- Match on TM attraction ID → setlist.fm MBID → case-insensitive name
- On create with TM attraction ID: fetch image from TM
**Verify:** Create a performer with TM ID. Call matcher with same ID → returns existing.

### T13: pg-boss setup
**Depends on:** T06
**Read:** `infrastructure.md → Background Jobs`
**Build:**
- `packages/jobs/boss.ts` — create and export pg-boss instance
- Initialization in Next.js server startup (`instrumentation.ts`)
- `packages/jobs/registry.ts` — registers all job handlers + schedules on startup
- Stub handlers for all 4 scheduled jobs (actual logic in Wave 4)
**Verify:** pg-boss tables exist in Postgres. A test cron job fires on schedule.

---

## Wave 3 — Depends on matchers + auth

### T14: tRPC shows + venues + performers routers
**Depends on:** T07, T11, T12, T03
**Read:** `schema.md → Show, Venue, Performer, show_performers`
**Build:**
`packages/api/routers/shows.ts`:
- `list(filters: { state?, kind?, year? })` — all user's shows with venue + performers joined
- `detail(showId)` — single show with full data
- `create(input)` — create show + match/create venue + match/create performers + show_performers rows
- `updateState(showId, newState, data?)` — state transitions per state machine
- `delete(showId)`

`packages/api/routers/venues.ts`:
- `search(query)`, `follow(venueId)`, `unfollow(venueId)`, `followed()`

`packages/api/routers/performers.ts`:
- `search(query)`, `follow(performerId)`, `unfollow(performerId)`

`packages/api/root.ts` — merge all routers
`apps/web/app/api/trpc/[trpc]/route.ts` — Next.js handler
**Verify:** `shows.create` via tRPC with a test payload → show + performers + venue in DB. `shows.list` returns them.

### T15: tRPC discover router
**Depends on:** T07, T11, T12
**Read:** `schema.md → Announcement, show_announcement_link`
**Build:**
`packages/api/routers/discover.ts`:
- `followedFeed(pagination)` — announcements at followed venues
- `nearbyFeed(pagination)` — announcements in user's regions, excluding followed venues
- `watchlist(announcementId)` — creates watching show + show_announcement_link
- `unwatchlist(announcementId)` — deletes watching show + link
**Verify:** Insert test announcements. `followedFeed` returns them. `watchlist` creates a watching show visible in `shows.list`.

### T16: tRPC enrichment router
**Depends on:** T08, T09, T10, T11, T12
**Read:** `pipelines.md → §1 Add Flow enrichment sequence`
**Build:**
`packages/api/routers/enrichment.ts`:
- `searchTM(headliner, dateRange?, kind?)` — search TM, return top candidates
- `fetchSetlist(performerId, date)` — fetch from setlist.fm
- `parseChat(freeText)` — call Groq, return structured fields
- `extractCast(imageBase64)` — call Groq vision, return cast list
**Verify:** `searchTM("Radiohead")` → returns event candidates. `parseChat("saw Radiohead at MSG last night")` → returns structured JSON.

### T17: tRPC preferences router
**Depends on:** T07, T06
**Read:** `schema.md → User Preferences, User Regions`
**Build:**
`packages/api/routers/preferences.ts`:
- `get()` — returns user's preferences + regions
- `update(partial)` — partial update of preferences
- `addRegion(input)`, `removeRegion(regionId)`, `toggleRegion(regionId)`
**Verify:** `update({ theme: 'dark' })` persists. `addRegion` creates a row. `get` returns everything.

---

## Wave 4 — Pages + Jobs (high parallelism — most tasks are independent)

### T18: App shell + navigation
**Depends on:** T07, T04
**Read:** project README (design system), `hifi-v2.html` (v2-shell)
**Build:**
- `app/(app)/layout.tsx` — authenticated layout with sidebar
- Sidebar with 6 nav items: Home, Discover, Shows, Map, Add, Preferences
- Active state in Marquee Gold, labels in Geist Mono
- Mobile: bottom tab bar
- Dark mode as default
**Verify:** Playwright — navigate all 6 routes, screenshot each. Active nav highlights correctly.

### T19: Add flow page
**Depends on:** T14, T16, T04
**Read:** `pipelines.md → §1`, `hifi-v2.html` section 05
**Build:**
- `app/(app)/add/page.tsx` — form mode
- `app/(app)/add/chat/page.tsx` — chat mode (or toggle within page)
- Form flow: kind → headliner → TM search → venue → date → kind-specific enrichment → personal data → save
- Chat flow: free text → Groq parse → confirm extracted fields → same save
- Theatre-specific: playbill photo upload → Groq vision → cast confirmation
- Festival-specific: multi-headliner input + end_date
**Verify:** Playwright — add a concert via form with TM enrichment. Add a show via chat. Screenshot each step of the flow. Verify show appears in DB.

### T20: Shows list page
**Depends on:** T14, T04
**Read:** `schema.md → Show State Machine`, `hifi-v2.html` section 03
**Build:**
- `app/(app)/shows/page.tsx`
- Segmented control: List / Calendar / Stats
- List mode: year rail + show rows with state-based styling (past/ticketed/watching)
- Click row → expand inline detail
- Calendar mode: month grid with show dots
- Stats mode: basic counts (shows/year, shows/kind, top venues)
**Verify:** Playwright — seed test data, screenshot list with all 3 states visible. Expand a row, screenshot. Switch to calendar, screenshot. Switch to stats, screenshot.

### T21: Home page
**Depends on:** T14, T04
**Read:** `hifi-v2.html` section 01
**Build:**
- `app/(app)/home/page.tsx`
- Hero card: next ticketed show (headliner, venue, date, seat, countdown)
- Recent 5: last 5 past shows as compact rows
- Empty states for no upcoming / no past shows
**Verify:** Playwright — seed data with 1 ticketed + 5 past shows, screenshot. Verify hero card data. Test empty state.

### T22: Discover page
**Depends on:** T15, T04
**Read:** `hifi-v2.html` section 02
**Build:**
- `app/(app)/discover/page.tsx`
- Segmented control: Followed / Near You
- Followed: announcements grouped by venue, watch/unwatch buttons
- Near You: announcements outside followed venues
- Web: venue filter left rail. Mobile: horizontal chip row
**Verify:** Playwright — seed announcements, screenshot both tabs. Tap Watch, verify show appears in Shows list. Screenshot the watched state.

### T23: Map page
**Depends on:** T14, T04
**Read:** `hifi-v2.html` section 04
**Build:**
- `app/(app)/map/page.tsx`
- Full-bleed map (Leaflet + OpenStreetMap — free, no API key needed)
- Pin per venue where user has shows
- Click pin → venue inspector panel (show count, kind breakdown, show list, follow button)
**Verify:** Playwright — seed venues with lat/lng, screenshot map with pins. Click a pin, screenshot inspector.

### T24: Preferences page
**Depends on:** T17, T04
**Read:** `schema.md → User Preferences, User Regions`, `hifi-v2.html` section 06
**Build:**
- `app/(app)/preferences/page.tsx`
- Sections: Appearance, Notifications, Regions, Followed Venues, Data Sources
- Theme toggle applies immediately
- Region add via Google Places autocomplete
- Followed venues with unfollow
**Verify:** Playwright — screenshot page. Toggle theme, screenshot. Add a region, screenshot.

### T25: Nightly state transitions job
**Depends on:** T13, T14
**Read:** `pipelines.md → §3 Background Jobs`
**Build:**
- `packages/jobs/shows-nightly.ts` — full implementation
- Register cron: `0 3 * * *`
**Verify:** Create ticketed show with yesterday's date. Run job. Show is now `past`. Create watching show with yesterday's date. Run job. Show is deleted.

### T26: Setlist retry job
**Depends on:** T13, T09
**Read:** `pipelines.md → §3 Setlist enrichment retry`
**Build:**
- `packages/jobs/setlist-retry.ts` — full implementation
- Register cron: `0 4 * * *`
**Verify:** Create past concert with known artist, no setlist. Insert enrichment_queue row. Run job. Show's setlist field is populated.

### T27: Discovery ingestion job
**Depends on:** T13, T08, T11
**Read:** `pipelines.md → §2 Discover Feed ingestion`
**Build:**
- `packages/jobs/discover-ingest.ts` — full implementation
- Phase 0 → Phase 1 → Phase 2 → Phase 3 (prune)
- Register cron: `0 2 * * *`
- Respect TM rate limits (5/sec max)
**Verify:** Follow a real venue (e.g., MSG). Run job. Announcements table has events.

### T28: Notification digest job
**Depends on:** T13, T17
**Read:** `pipelines.md → §3 Notification dispatch`
**Build:**
- `packages/jobs/notifications.ts`
- Check users whose digest_time is now, send digest email via Resend
- Show-day reminder for ticketed shows today
- Install `resend` SDK
**Verify:** Set digest_time to now. Run job. Email received with announcements + upcoming shows.

### T29: R2 photo pipeline
**Depends on:** T01
**Read:** `schema.md → Photo Storage`
**Build:**
- `packages/api/lib/r2.ts` — presigned upload URL generation, delete
- `packages/api/lib/image-processing.ts` — Sharp resize to thumb/card/full, convert to WebP
- Upload endpoint in tRPC or Next.js API route
- Wire into Add flow photo step
**Verify:** Upload a photo. 3 WebP variants exist in R2 bucket. URL resolves and displays.

---

## Wave 5 — Infrastructure + Mobile

### T30: Cloudflare Tunnel setup
**Depends on:** T18 (needs the app running to verify)
**Read:** `cloudflare-tunnel-setup.md`, `infrastructure.md → External Access`
**Build:**
- Cloudflared runs on the host (not Docker) — installed via `brew install cloudflared`
- Create tunnel: `cloudflared tunnel login && cloudflared tunnel create home-tunnel`
- Create `~/.cloudflared/config.yml` routing `showbook.example.com` → `http://localhost:3002` (prod web)
- Add CNAME DNS record in Cloudflare: `showbook` → `{tunnel-id}.cfargotunnel.com`
- Install as system service: `sudo cloudflared service install`
- Document setup in project `RUNNING.md`
**Verify:** `https://showbook.example.com` loads the app from a phone on cellular (not WiFi).

### T31: Expo mobile scaffold
**Depends on:** T14, T30 (needs API + tunnel URL)
**Read:** `infrastructure.md → Offline Strategy`
**Build:**
- Scaffold Expo app in `apps/mobile/`
- Expo Router with tab bar (6 tabs)
- tRPC client pointed at `https://showbook.example.com/api/trpc`
- Auth via Expo AuthSession (Google OAuth)
- Build mobile versions of: Home, Shows list, Add (form only)
**Verify:** App builds with `npx expo start`. Connects to backend. Shows list renders same data as web.

### T32: Offline caching
**Depends on:** T31
**Read:** `infrastructure.md → Offline Strategy`
**Build:**
- expo-sqlite local cache
- Sync on foreground: fetch shows updated since last sync
- Shows list + Home read from SQLite, update from network in background
- Add flow blocked when offline
**Verify:** Load data while online. Go to airplane mode. Shows list still renders. Add flow shows offline message.

---

## Parallelism Summary

| Wave | Tasks | Max parallelism |
|------|-------|-----------------|
| 1 | T01, T02, T03, T04, T05 | 5 agents |
| 2 | T06, T07, T08, T09, T10, T11, T12, T13 | 8 agents (T06 blocks T07/T11/T12/T13) |
| 3 | T14, T15, T16, T17 | 4 agents |
| 4 | T18–T29 | 12 agents (all independent) |
| 5 | T30, T31, T32 | 3 agents (sequential chain) |

**Critical path:** T01 → T06 → T07 → T14 → T19 (Add flow). Everything else can happen around this spine.

---

## Docker

Two containers: `showbook-dev-db` (Postgres on 5433) and `showbook-dev-web` (Next.js on 3001). Ports 5432 and 3000 are used by vacation-price-tracker — never use them.

```bash
docker compose up -d                    # start both
docker compose exec showbook-dev-db pg_isready -U showbook  # check Postgres
curl http://localhost:3001              # check Next.js
```

Migrations run from the host via the exposed port:
```bash
DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook npx drizzle-kit migrate
```

Inside the web container, `DATABASE_URL` uses the Docker service name: `postgresql://showbook:showbook_dev@postgres:5432/showbook`

Playwright does not use the dev database. Run e2e through:
```bash
pnpm test:e2e
```

That command resets `showbook_e2e`, migrates it, and starts the e2e server on
`https://localhost:3003` (override with `PLAYWRIGHT_PORT`) with
`ENABLE_TEST_ROUTES=1`. `/api/test/*` routes are guarded so they only run
against `showbook_e2e`.

Cloudflared is NOT in Docker — it's a host-level system service (see T30).

---

## Acceptance Criteria

See `LAUNCH.md` for the full acceptance checklist. The project is done when all boxes are checked, all Playwright tests pass, and all commits are pushed to main.

---

## Continuous Execution

The lead agent should execute all 5 waves sequentially without waiting for human review between waves. Commit after each task (`T{XX}: description`), push after each wave. If a task fails verification, fix it before moving to the next dependent task. After all 32 tasks, run the full acceptance test suite from LAUNCH.md and report status.
