# Showbook — Entity Schemas

All entity definitions for Showbook. Field types, constraints, relationships, and derivation rules.

---

## Show

The core entity. A live event as it relates to the user — both objective event data and the user's personal record of attending (or wanting to attend).

| Field | Type | Nullable | Source | Notes |
|-------|------|----------|--------|-------|
| `id` | uuid | no | generated | PK |
| `user_id` | FK → User | no | system | Owner |
| `kind` | enum | no | user input | `concert` · `theatre` · `comedy` · `festival` |
| `state` | enum | no | derived + user action | `past` · `ticketed` · `watching` — see State Machine below |
| `venue_id` | FK → Venue | no | user input → matched | |
| `date` | date | no | user input or enrichment | Start date. For festivals, this is day 1 |
| `end_date` | date | yes | user input | Only used for multi-day festivals. Null for single-day shows |
| `seat` | string | yes | user input | e.g. "ORCH L · 14", "GA FLOOR". Null for `watching` |
| `price_paid` | decimal | yes | user input | What the user actually paid. Null for `watching` |
| `tour_name` | string | yes | enrichment (setlist.fm) | |
| `setlist` | string[] | yes | enrichment (setlist.fm) | Song titles in order. Concert only. Null pre-show |
| `photos` | string[] | yes | user upload | URLs to stored media in Cloudflare R2. See Photo Storage below |
| `source_refs` | jsonb | yes | system | `{ setlistfm_id, ticketmaster_event_id }` — for re-fetching and dedup |
| `created_at` | timestamp | no | system | |
| `updated_at` | timestamp | no | system | |

### Derived fields (not stored)

| Field | Derivation |
|-------|-----------|
| `countdown` | `date - now()`, rendered as "12 days", "3 weeks", etc. |
| `setlist_count` | `length(setlist)` |
| `headliners` | Query `show_performers WHERE role = headliner ORDER BY sort_order` |
| `support` | Query `show_performers WHERE role = support ORDER BY sort_order` |
| `cast` | Query `show_performers WHERE role = cast ORDER BY sort_order` |
| `cover_image_url` | Primary headliner's `image_url` from Performer, if available. Otherwise generated gradient from `kind` |

### Indexes

- `(user_id, state)` — fast filtering by state on the Shows page
- `(user_id, date)` — calendar view, chronological ordering
- `(user_id, kind)` — kind-based filtering and stats
- `(venue_id)` — venue show count, Map page inspector

### Photo Storage

Photos are stored in **Cloudflare R2** (S3-compatible, zero egress fees).

**Why R2:** Egress is free. Every other object store (S3, GCS, Azure Blob) charges per-byte when images are viewed. For an app that renders show cards with photos on every page load, egress costs dominate. R2 eliminates that entirely. Storage cost is $0.015/GB/month — a user with 500 photos at 2MB each = 1GB = $0.015/month.

**Upload flow:**
1. User selects photo(s) in the Add flow
2. Client uploads to backend (or directly to R2 via presigned URL)
3. Backend generates resized variants:
   - `thumb` — 200px wide, used in Shows list rows and cards
   - `card` — 600px wide, used in show detail hero
   - `full` — original resolution, used in photo gallery / zoom
4. All 3 variants written to R2 under a predictable key structure
5. URLs stored in Show's `photos` array

**R2 key structure:**
```
showbook/{user_id}/shows/{show_id}/photos/{photo_id}/thumb.webp
showbook/{user_id}/shows/{show_id}/photos/{photo_id}/card.webp
showbook/{user_id}/shows/{show_id}/photos/{photo_id}/full.webp
```

**What gets stored on Show:**
The `photos` field is a string[] of photo IDs (not full URLs). URLs are constructed at render time from the ID + known R2 bucket domain + variant suffix. This avoids storing 3 URLs per photo and makes it easy to change the CDN domain later.

```json
{
  "photos": ["ph_abc123", "ph_def456"]
}
```

Resolved URL: `https://media.showbook.app/showbook/{user_id}/shows/{show_id}/photos/ph_abc123/card.webp`

**Format:** WebP for all variants. Good compression, universal browser support. Convert from JPEG/PNG/HEIC on upload.

**CDN:** R2 supports custom domains (e.g. `media.showbook.app`) with Cloudflare's CDN automatically in front. No additional caching layer needed.

**Deletion:** When a user removes a photo or a `watching` show is auto-deleted, delete the R2 objects. Cascade from show deletion → list photo IDs → delete R2 keys. Can be async (queue a cleanup job).

---

## Show State Machine

Three states. Watching shows auto-delete on expiry.

```
  User adds past show ──────────────────────────────► [PAST]
                                                        ▲
  User watchlists from Discover ──► [WATCHING] ─────────┤
                                        │               │
                                        │ User buys     │ date passes
                                        │ tickets       │ (auto)
                                        │               │
                                        ▼               │
  User adds future show ──────────► [TICKETED] ─────────┘
  with seat/price

  [WATCHING] + date passes ──► AUTO-DELETE (silently removed)
```

| From | To | Trigger | Side effects |
|------|----|---------|-------------|
| *(new)* | `watching` | User taps "Watch" on Discover announcement | Creates Show with minimal data (headliner, venue, date, kind). Links to announcement via `show_announcement_link` |
| *(new)* | `ticketed` | User adds future show via Add flow with seat/price | Full enrichment pipeline runs |
| *(new)* | `past` | User adds show via Add flow with past date | Full enrichment pipeline runs. Setlist.fm queried immediately |
| `watching` | `ticketed` | User taps "Got tickets", enters seat/price | Enrichment pipeline runs for any missing data |
| `ticketed` | `past` | Automatic — `date < today` | Nightly job or on-access check. Triggers setlist.fm enrichment for concerts |
| `watching` | *(deleted)* | Automatic — `date < today` | Nightly job. Row removed. Announcement remains in Discover (already aged out by then) |

---

## Performer

Unified entity for anyone who appears in a show — headliner, support act, theatre cast member. The term "performer" avoids the ambiguity of "artist" (which implies musicians only).

| Field | Type | Nullable | Source | Notes |
|-------|------|----------|--------|-------|
| `id` | uuid | no | generated | PK |
| `name` | string | no | user input or enrichment | Canonical display name |
| `setlistfm_mbid` | string | yes | setlist.fm / MusicBrainz | For concert performers. Used to fetch setlists |
| `ticketmaster_attraction_id` | string | yes | Ticketmaster | For event matching + image fetching |
| `image_url` | string | yes | TM `/attractions/{id}` | Artist image. Quality varies. Null until fetched |
| `created_at` | timestamp | no | system | |

### Creation rules

Performers are created lazily — not from a master database, but when:
- User enters a headliner/support in the Add flow → search TM/setlist.fm → match or create
- TM event data includes attraction IDs → match existing or create
- User manually enters a theatre cast member → create with name only (no external IDs)
- LLM extracts names from a playbill photo → create with name only

### Deduplication

Match on `ticketmaster_attraction_id` first, then `setlistfm_mbid`, then case-insensitive name. Show candidates when more than one match exists.

---

## show_performers (join table)

Links Shows to Performers with role and ordering.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `show_id` | FK → Show | no | |
| `performer_id` | FK → Performer | no | |
| `role` | enum | no | `headliner` · `support` · `cast` |
| `character_name` | string | yes | Theater only — the role they played, e.g. "Elphaba" |
| `sort_order` | integer | no | Display ordering within the role group |

**Composite PK:** `(show_id, performer_id, role)` — a performer could theoretically be both headliner and cast (unlikely but the schema allows it).

### Examples

A concert: Radiohead at MSG with Massive Attack opening
```
show_performers:
  (show_1, radiohead_id, headliner, null, 1)
  (show_1, massive_attack_id, support, null, 1)
```

A theatre show: Wicked with specific cast
```
show_performers:
  (show_2, wicked_id, headliner, null, 1)          -- "Wicked" is the headliner (the production)
  (show_2, cynthia_erivo_id, cast, "Elphaba", 1)
  (show_2, kristin_chenoweth_id, cast, "Glinda", 2)
```

A festival: Outside Lands with multiple headliners
```
show_performers:
  (show_3, radiohead_id, headliner, null, 1)
  (show_3, lcd_soundsystem_id, headliner, null, 2)
  (show_3, metallica_id, headliner, null, 3)
  (show_3, opener_1_id, support, null, 1)
  (show_3, opener_2_id, support, null, 2)
  ...
```

---

## Venue

Canonical venue entity. All shows and announcements reference this by FK.

| Field | Type | Nullable | Source | Notes |
|-------|------|----------|--------|-------|
| `id` | uuid | no | generated | PK |
| `name` | string | no | TM or user input | Canonical display name |
| `neighborhood` | string | yes | TM or user input | e.g. "East Village". Not all venues have one |
| `city` | string | no | TM or user input | |
| `state_region` | string | yes | TM or user input | |
| `country` | string | no | TM or user input | |
| `latitude` | float | yes | TM venue data or Google Geocoding API | Geocoded once at venue creation. Nullable if geocoding fails — venue still works, just won't appear on Map |
| `longitude` | float | yes | TM venue data or Google Geocoding API | Same as above |
| `ticketmaster_venue_id` | string | yes | Ticketmaster | Primary dedup key. Null for manually-entered venues not on TM |
| `google_place_id` | string | yes | Google Places | For geocoding fallback. Null if not needed |
| `scrape_config` | jsonb | yes | manual setup | For regional theatres / non-TM venues. See below |
| `created_at` | timestamp | no | system | |

### scrape_config

For venues not on Ticketmaster (regional theatre companies, small comedy clubs, independent venues), this field stores references for manual or semi-automated data collection.

```json
{
  "type": "manual",
  "website_url": "https://roundabouttheatre.org/shows",
  "notes": "Check monthly for new season announcements"
}
```

Or for future semi-automated scraping:
```json
{
  "type": "scrape",
  "url": "https://roundabouttheatre.org/shows",
  "selector": ".show-listing",
  "check_frequency_days": 7
}
```

v1 reality: this is just a reference URL and notes. No automated scraping.

### Derived fields (not stored)

| Field | Derivation |
|-------|-----------|
| `show_count` | `COUNT(*) FROM shows WHERE venue_id = this` |
| `kinds` | `SELECT kind, COUNT(*) FROM shows WHERE venue_id = this GROUP BY kind` |
| `first_show` | `MIN(date) FROM shows WHERE venue_id = this` |
| `last_show` | `MAX(date) FROM shows WHERE venue_id = this` |
| `is_followed` | `EXISTS (SELECT 1 FROM user_venue_follows WHERE venue_id = this AND user_id = current_user)` |

### Deduplication strategy

1. Match on `ticketmaster_venue_id` if available — definitive
2. Exact match on `(lower(name), lower(city))` — high confidence
3. If multiple candidates: show them to the user, let them pick or create new
4. Never auto-merge without user confirmation

---

## Announcement

An upcoming event surfaced in the Discover feed. These are **global** — one row per real-world event, shared across all users. User-specific state (watchlisted, dismissed) lives in separate tables.

| Field | Type | Nullable | Source | Notes |
|-------|------|----------|--------|-------|
| `id` | uuid | no | generated | PK |
| `venue_id` | FK → Venue | no | matched from source data | |
| `kind` | enum | no | inferred from TM genre | `concert` · `theatre` · `comedy` · `festival` |
| `headliner` | string | no | source (TM) | Display string. Performer FK matching is best-effort |
| `headliner_performer_id` | FK → Performer | yes | matched from TM attraction | Null if no match found |
| `support` | string[] | yes | source (TM) | Often empty at announcement time |
| `show_date` | date | no | source | |
| `on_sale_date` | datetime | yes | source (TM) | Displayed statically. Not polled |
| `on_sale_status` | enum | no | source (TM) at ingestion | `announced` · `on_sale` · `sold_out` |
| `source` | enum | no | system | `ticketmaster` · `manual` |
| `source_event_id` | string | yes | source | TM event ID. Primary dedup key |
| `discovered_at` | timestamp | no | system | When our ingestion first saw it |

### Lifecycle

- Created by the discovery ingestion pipeline (see `pipelines.md`)
- Never updated after creation (on_sale_status is a snapshot at ingestion time — no polling)
- Pruned by nightly job: `DELETE WHERE show_date < now() - interval '7 days'`
- User watchlisting creates a Show (`state=watching`) and a `show_announcement_link` row

### Derived fields (not stored)

| Field | Derivation |
|-------|-----------|
| `reason` | `followed-venue` if venue_id ∈ user's followed venues. `nearby` if venue is in user's active region. `tracked-artist` if headliner_performer_id ∈ user's followed performers. Can have multiple reasons |
| `watchlisted` | `EXISTS (SELECT 1 FROM show_announcement_link sal JOIN shows s ON sal.show_id = s.id WHERE sal.announcement_id = this AND s.user_id = current_user)` |

---

## User

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | uuid | no | PK |
| `google_id` | string | no | From Google OAuth. Unique |
| `email` | string | no | From Google OAuth |
| `display_name` | string | no | From Google profile, user can edit |
| `avatar_url` | string | yes | From Google profile |
| `created_at` | timestamp | no | |

---

## User Preferences

One row per user. All fields have defaults so the row can be sparse.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `user_id` | FK → User | — | PK |
| `theme` | enum | `system` | `system` · `light` · `dark` |
| `compact_mode` | boolean | `false` | |
| `digest_frequency` | enum | `daily` | `daily` · `weekly` · `off` |
| `digest_time` | time | `08:00` | User-configurable. Time in user's local timezone |
| `email_notifications` | boolean | `true` | |
| `push_notifications` | boolean | `true` | |
| `show_day_reminder` | boolean | `true` | |

---

## User Regions

Defines geographic areas for the "Near you" Discover feed. A user can have multiple regions (e.g. home city + frequent travel destination).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | uuid | no | PK |
| `user_id` | FK → User | no | |
| `city_name` | string | no | Display label, e.g. "San Francisco" |
| `latitude` | float | no | Center point — from Google Places autocomplete |
| `longitude` | float | no | Center point |
| `radius_miles` | integer | no | |
| `active` | boolean | no | User can toggle off without deleting |

---

## Join / Relationship Tables

### user_venue_follows

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | FK → User | |
| `venue_id` | FK → Venue | |
| `followed_at` | timestamp | |

**Composite PK:** `(user_id, venue_id)`

### user_performer_follows

For the "tracked artist" feature in Discover.

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | FK → User | |
| `performer_id` | FK → Performer | |
| `followed_at` | timestamp | |

**Composite PK:** `(user_id, performer_id)`

### show_announcement_link

Connects a user's `watching` show to the Discover announcement it came from. When the show is auto-deleted (watching + date passed), this row is cascade-deleted.

| Field | Type | Notes |
|-------|------|-------|
| `show_id` | FK → Show | ON DELETE CASCADE |
| `announcement_id` | FK → Announcement | |

**Composite PK:** `(show_id, announcement_id)`
