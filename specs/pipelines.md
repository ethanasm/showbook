# Showbook — Pipelines

How data flows through the system: the Add flow enrichment sequence, Discover feed ingestion, and background jobs.

---

## 1. Add Flow — Enrichment Sequence

When a user adds a show via the structured form. The chat-mode Add uses an LLM to parse free-text into the same structured input, then enters this same pipeline at step 1.

```
┌─────────────────────────────────────────────────────────┐
│  USER INPUT: kind + headliner + approximate date        │
│  (minimum viable input to start enrichment)             │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 1: Search Ticketmaster                            │
│                                                         │
│  GET /events?keyword={headliner}&startDateTime={range}  │
│  &classificationName={kind_hint}                        │
│                                                         │
│  ┌─ Results found?                                      │
│  │  YES → Show top 3 matches (event name, venue, date)  │
│  │        User picks one                                │
│  │        → Auto-fill: venue, exact date                │
│  │        → Match/create Venue from TM venue data       │
│  │        → Match/create Performers from TM attractions │
│  │        → Fetch performer image from TM /attractions  │
│  │        → Store ticketmaster_event_id in source_refs  │
│  │                                                      │
│  └─ NO  → User enters venue + date manually             │
│           → Fuzzy-match venue against existing Venues    │
│           → Multiple matches? Show candidates            │
│           → One match? Auto-select                       │
│           → No match? Create new Venue                   │
│             (user provides city, optional neighborhood)  │
│             (geocode lat/lng from TM or Google Geocoding)│
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 2: Kind-specific enrichment                       │
│                                                         │
│  IF kind = concert AND date is past:                    │
│    → Check if Performer already has setlistfm_mbid       │
│      (TM provides MusicBrainz IDs — skip search if so)  │
│    → If no MBID: search setlist.fm artist by name        │
│    → Store setlistfm_mbid on Performer                   │
│    → Search setlists by MBID + date (dd-MM-yyyy format)  │
│    → Found? Auto-fill setlist, tour_name                 │
│    → Not found? "No setlist found. We'll check again."  │
│      → Schedule retry job (see §3)                      │
│                                                         │
│  IF kind = theatre:                                    │
│    → Prompt: "Got a photo of your playbill?"            │
│    → YES: Send to LLM for cast extraction               │
│           → Parse response → create Performers          │
│           → Create show_performers with role=cast        │
│           → Show extracted cast for user confirmation    │
│    → NO:  Manual cast entry (optional, skippable)       │
│                                                         │
│  IF kind = comedy:                                      │
│    → No enrichment available                            │
│    → User enters tour name, opener manually             │
│                                                         │
│  IF kind = festival:                                    │
│    → Prompt for end_date                                │
│    → Headliners/support entered by user (string[])      │
│    → TM may have lineup data in attraction list         │
│      → If TM match exists, extract attractions as       │
│        performers                                       │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 3: Personal data                                  │
│                                                         │
│  User enters: seat, price_paid, photos                  │
│  (All optional. Null for watching state.)               │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 4: Save                                           │
│                                                         │
│  Determine state:                                       │
│    date < today         → state = past                  │
│    date ≥ today + seat  → state = ticketed              │
│    date ≥ today, no seat→ state = watching              │
│                                                         │
│  Insert Show + show_performers rows                     │
│  Return to Shows list                                   │
└─────────────────────────────────────────────────────────┘
```

### Chat-mode Add

The conversational Add flow wraps this pipeline with an LLM pre-processor:

1. User types free text: *"I saw Radiohead at MSG last night, second row, they opened with Everything In Its Right Place"*
2. LLM extracts structured fields:
   ```json
   {
     "headliner": "Radiohead",
     "venue_hint": "MSG",
     "date_hint": "last night",
     "seat_hint": "second row",
     "kind_hint": "concert",
     "notes": "opened with Everything In Its Right Place"
   }
   ```
3. Resolve `date_hint` to actual date, `venue_hint` to venue search query
4. Enter the enrichment pipeline at Step 1 with pre-filled inputs
5. Show the enrichment results in the chat interface for confirmation
6. User confirms or corrects → save

---

## 2. Discover Feed — Ingestion Pipeline

Background job that populates the Announcement table. Runs on a schedule.

```
┌─────────────────────────────────────────────────────────┐
│  TRIGGER: Scheduled daily (2:00 AM)                     │
│  Can also be triggered manually by user pull-to-refresh │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 0: Collect unique targets                        │
│                                                         │
│  Deduplicate across all users:                          │
│    venues = SELECT DISTINCT venue_id                    │
│             FROM user_venue_follows                     │
│             WHERE venue.ticketmaster_venue_id IS NOT NULL│
│    regions = SELECT DISTINCT city_name, lat, lng, radius│
│              FROM user_regions WHERE active = true       │
│              (merge overlapping regions)                 │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 1: Followed venue events                         │
│                                                         │
│  For each unique venue from Phase 0:                    │
│                                                         │
│    GET /events?venueId={tm_venue_id}                    │
│         &startDateTime={now}                            │
│         &endDateTime={now + 12 months}                  │
│         &size=100                                       │
│                                                         │
│    If page.totalElements > 100:                         │
│      Paginate (page=1, page=2...) up to 200 events max  │
│                                                         │
│    For each event:                                      │
│      → Check: source_event_id already in Announcements? │
│        YES → Skip (already ingested)                    │
│        NO  → Create Announcement:                       │
│              venue_id = matched venue                    │
│              kind = inferred from TM classification      │
│              headliner = event.name (cleaned)            │
│              headliner_performer_id = match TM           │
│                attraction if possible                    │
│              support = from TM event attractions[1:]     │
│              show_date = event.dates.start.localDate     │
│              on_sale_date = event.sales.public.startDT   │
│              on_sale_status = derived from sales data     │
│              source = ticketmaster                       │
│              source_event_id = event.id                  │
│              discovered_at = now()                       │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 2: Near-you events                               │
│                                                         │
│  For each unique region from Phase 0:                   │
│                                                         │
│    GET /events?latlong={lat},{lng}                      │
│         &radius={radius_miles}&unit=miles               │
│         &startDateTime={now}                            │
│         &endDateTime={now + 12 months}                  │
│         &size=100                                       │
│                                                         │
│    If page.totalElements > 100:                         │
│      Paginate up to 200 events max                      │
│                                                         │
│    For each event:                                      │
│      → Filter out events at already-followed venues     │
│        (those are covered in Phase 1)                   │
│      → Check: source_event_id already in Announcements? │
│        YES → Skip                                       │
│        NO  → Match/create Venue from TM venue data      │
│             → Create Announcement (same as Phase 1)     │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 3: Tracked performer events (future)             │
│                                                         │
│  For each performer in user_performer_follows           │
│  WHERE ticketmaster_attraction_id IS NOT NULL:          │
│                                                         │
│    GET /events?attractionId={tm_attraction_id}          │
│         &startDateTime={now}                            │
│         &endDateTime={now + 12 months}                  │
│                                                         │
│    Filter to events within user's active regions        │
│    Create Announcements for new events                  │
│                                                         │
│  (Phase 3 is a v2 feature — requires performer          │
│   following to be built in the UI)                      │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 4: Cleanup                                       │
│                                                         │
│  DELETE FROM announcements                              │
│  WHERE show_date < now() - interval '7 days'            │
│                                                         │
│  (7-day grace period so recently-passed shows don't     │
│   vanish mid-scroll)                                    │
└─────────────────────────────────────────────────────────┘
```

### Rate limit budget

TM allows 5,000 calls/day. Per daily ingestion run (deduped across all users):
- Phase 1: 1–2 calls per unique followed venue (100 events/page, paginate if >100). 50 unique venues × 1.5 avg pages = ~75 calls
- Phase 2: 1–2 calls per unique region. 10 unique regions × 1.5 avg pages = ~15 calls
- Phase 3: 1 call per unique tracked performer (future)

~90 calls/day total. Generous headroom within the 5,000/day limit.

---

## 3. Background Jobs

### Nightly state transitions

**Schedule:** Daily, 3:00 AM user local time (or a fixed UTC time if simpler for v1).

```
-- Ticketed → Past
UPDATE shows
SET state = 'past', updated_at = now()
WHERE state = 'ticketed' AND date < CURRENT_DATE;

-- Queue setlist enrichment for newly-past concerts
INSERT INTO enrichment_queue (show_id, type, attempts, next_retry)
SELECT id, 'setlist', 0, now()
FROM shows
WHERE state = 'past'
  AND kind = 'concert'
  AND setlist IS NULL
  AND date = CURRENT_DATE - 1;

-- Delete expired watching shows
DELETE FROM shows
WHERE state = 'watching' AND date < CURRENT_DATE;
```

### Setlist enrichment retry

**Schedule:** Daily.

```
For each row in enrichment_queue
WHERE type = 'setlist'
  AND next_retry <= now()
  AND attempts < 14:

  → Look up Performer's setlistfm_mbid
  → If no MBID: try setlist.fm artist search by name, store MBID on Performer
  → If still no MBID: skip (can't look up setlist without it)
  → Convert show.date to dd-MM-yyyy format (setlist.fm uses this, not ISO)
  → GET /search/setlists?artistMbid={mbid}&date={dd-MM-yyyy}
    (with headers: x-api-key, Accept: application/json)
  → Found?
    YES → Update show: setlist, tour_name
          Delete from enrichment_queue
    NO  → Increment attempts, set next_retry = now() + 1 day

  → attempts >= 14? Give up. Delete from enrichment_queue.
```

### Announcement pruning

Runs as part of the discovery ingestion pipeline (Phase 4). Also runs standalone daily as a safety net.

### Notification dispatch

**Schedule:** Per user's `digest_time` preference.

```
For each user WHERE digest_frequency != 'off':
  → If digest_frequency = 'daily' OR (digest_frequency = 'weekly' AND today = Monday):
    → Collect new announcements since last digest
      (from followed venues + near-you + tracked performers)
    → Collect upcoming shows in next 7 days (show-day reminders)
    → Format digest
    → Send via email (if email_notifications = true)
    → Send via push (if push_notifications = true)
```

**Show-day reminder:** Separate from digest. Fires on the morning of a `ticketed` show.

```
For each user WHERE show_day_reminder = true:
  → SELECT * FROM shows
    WHERE user_id = user AND state = 'ticketed' AND date = CURRENT_DATE
  → If any: send push notification with show details (venue, time)
```

---

## 4. Enrichment Queue Schema

Simple job table for retryable enrichment tasks.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `show_id` | FK → Show | |
| `type` | enum | `setlist` — extensible for future enrichment types |
| `attempts` | integer | Starts at 0 |
| `max_attempts` | integer | Default 14 (2 weeks of daily retries) |
| `next_retry` | timestamp | When to try next |
| `last_error` | text | Nullable — last failure reason |
| `created_at` | timestamp | |
