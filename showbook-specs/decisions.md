# Showbook — Design Decisions

Resolved decisions and remaining open questions for the data layer.

---

## Resolved

### D1: Watching show expiry → Auto-delete
**Decision:** When a `watching` show's date passes without the user buying tickets, the show is silently deleted by the nightly job. No `missed` state, no archive.

**Rationale:** Keeps the Shows list clean. The announcement in Discover already aged out by this point (pruned 7 days after show_date). The user never explicitly committed to this show — it was just a "maybe."

### D2: Show imagery → TM performer images with gradient fallback
**Decision:** `cover_image` is derived from the primary headliner's `image_url` on the Performer entity, fetched from Ticketmaster's `/attractions/{id}` endpoint. If no image exists (performer not on TM, or TM has no image), fall back to a generated gradient based on `kind`.

**Rationale:** TM images are free with the API key and already fetched during event matching. Quality varies but it's zero-effort for the user. User-uploaded photos on the Show entity can override in the UI if we want, but that's a UI decision.

### D3: Chat-mode Add → LLM parsing, same pipeline
**Decision:** The chat-mode Add flow uses an LLM to parse free-text into structured fields (`headliner`, `venue_hint`, `date_hint`, `kind_hint`, etc.), then feeds those into the same enrichment pipeline as the form. Not a separate system.

**Rationale:** One enrichment pipeline, two input modes. The LLM is just a parser. This means chat-mode accuracy is bounded by the LLM's extraction quality, which is very good for this kind of structured extraction.

### D4: Venue dedup → Show candidates when multiple matches
**Decision:** Match venues on `ticketmaster_venue_id` first (definitive). Then exact match on `(lower(name), lower(city))`. If more than one candidate remains, show them to the user. If exactly one, auto-select. Never auto-merge.

**Rationale:** There's no reliable confidence score from fuzzy matching. The real-world disambiguation signal is city — "The Garden" in NYC vs. Boston. Showing candidates is cheap in the UI and prevents bad merges.

### D5: Multi-day festivals → One Show record with end_date
**Decision:** A festival is one Show record. `date` is the start date, `end_date` (nullable) is the last day. Headliners and support are stored as performers via the normal `show_performers` join table.

**Rationale:** Splitting a festival into one-show-per-day creates weird UX in the Shows list and stats. A festival is one experience. The lineup maps naturally to the headliner/support performer model — top-billed acts are headliners, everyone else is support.

### D6: Announcements → Global table, per-user state
**Decision:** The Announcement table holds one row per real-world event, shared across all users. User-specific state (watchlisted) is tracked via the `show_announcement_link` table (linking the user's `watching` Show to the Announcement). The `reason` field (followed-venue, nearby, tracked-artist) is derived at query time, not stored.

**Rationale:** Far more efficient for ingestion. If 100 users follow Madison Square Garden, we store each MSG event once, not 100 times. User state is lightweight (one join table row per watchlist action).

### D7: Notification timing → User-configurable digest_time
**Decision:** Users set their preferred notification time in Preferences (`digest_time`, default 8:00 AM). Digest dispatch respects this per-user setting. Show-day reminders fire at the same time on the day of the show.

**Rationale:** Per the prototype's Preferences page, which shows a configurable time field.

### D8: Auth → Google OAuth only
**Decision:** Single auth method: Google OAuth. We store `google_id`, `email`, `display_name`, `avatar_url` from the Google profile.

**Rationale:** Simplest to implement. Covers the vast majority of users. No password management, no magic links, no multi-provider complexity.

### D9: Social features → Personal only (v1)
**Decision:** Showbook is a personal tracker in v1. No shared shows, friend feeds, or "+1" tagging. The Show entity represents "my relationship to an event" — not the event itself shared across users.

**Rationale:** Social features would require splitting Show into Event + Attendance, adding friend graphs, and rethinking privacy. Defer to v2 if there's demand.

### D10: Data export → CSV + JSON
**Decision:** Users can export their show history as CSV or JSON. Scope: all Shows with their performers, venues, and personal data (seat, price, photos).

**Rationale:** Good practice for user data portability. Low implementation cost.

### D11: Offline support → Yes
**Decision:** The mobile app should work offline. Users can browse their Shows list, view show details, and add shows (queued for sync). Discover feed and enrichment require connectivity.

**Rationale:** You're at a venue with bad signal and want to log the show. This is a core use case.

### D12: Performer as unified entity (not "Artist")
**Decision:** Renamed Artist → Performer. Headliners, support acts, and theatre cast are all Performers linked to Shows via `show_performers` join table with `role` (headliner | support | cast) and optional `character_name`.

**Rationale:** "Artist" implies musicians. "Performer" covers actors, comedians, and musicians. The join table with role+character_name cleanly handles theatre cast ("Cynthia Erivo as Elphaba") alongside concert headliners.

### D13: Headliner is string[] (not single string)
**Decision:** A show can have multiple headliners. Stored as multiple `show_performers` rows with `role=headliner` and `sort_order` for display priority. Festivals use this heavily. Some concerts have co-headliners.

### D14: Theatre data → TM primary, manual scraping references for non-TM venues
**Decision:** Ticketmaster is the primary data source for theatre events, not Playbill. For regional theatre companies not on TM, the Venue entity has a `scrape_config` jsonb field storing a website URL and notes for manual checking. No automated scraping in v1.

**Rationale:** Playbill has no public API. TM covers Broadway and many regional venues. For the rest, a simple reference URL on the venue is practical without building a scraping system.

### D15: Playbill cast extraction → LLM vision
**Decision:** When a user photographs their physical playbill, we send the image to a vision-capable LLM to extract the cast list (actor + role). Results are shown for user confirmation before saving.

**Rationale:** Playbills have complex layouts that defeat traditional OCR. Vision LLMs handle layout interpretation well. This is already required for the chat-mode Add flow (D3), so the LLM dependency already exists.

### D16: No on-sale polling
**Decision:** We do not poll Ticketmaster for on-sale status changes. The `on_sale_status` on an Announcement is a snapshot from ingestion time. We store `on_sale_date` so the UI can display "on sale Apr 25 · 10am" statically.

**Rationale:** Polling adds complexity (scheduling, rate limit burn, status change detection) for marginal value. The on-sale date from TM is reliable enough. If a user cares about being notified the moment tickets drop, they can set a calendar reminder from the displayed date.

---

## Remaining Open Questions

*None at this time. All questions resolved.*

---

## Recently Resolved (moved from open questions)

### D17: TM address on Venue → Don't store
**Decision:** We don't store `address.line1` from TM on the Venue entity. Lat/lng + city + neighborhood is sufficient for all current features (Map, Discover, display).

**Rationale:** Address is display-only sugar. We have enough location data without it. If we need it later (e.g. directions link), we can derive it from lat/lng via reverse geocoding or add the field then.

### D18: Performer image refresh → One-time fetch
**Decision:** Performer `image_url` is fetched once from TM `/attractions/{id}` when the Performer is created. Never automatically refreshed.

**Rationale:** Stale images are cosmetically annoying but functionally harmless. Re-fetching adds complexity (scheduling, tracking staleness) for negligible user value. If it matters later, add a manual "refresh" button on the performer.

### D19: Offline Add flow → Block until online
**Decision:** The Add flow requires connectivity. If the user is offline, the Add flow is unavailable. Browsing Shows, viewing details, and navigating the Map work offline (read-only from local cache). Only creation and enrichment are blocked.

**Rationale:** The Add flow depends on TM search, setlist.fm enrichment, and LLM cast extraction — all network-dependent. Allowing partial offline creation (save minimal data, enrich later) introduces a "pending enrichment" state that complicates the UI and state machine for an edge case. Simpler to just require connectivity for writes.

### D20: Announcement dedup across users → Venue-level batching
**Decision:** The ingestion pipeline deduplicates TM calls at the venue level. Instead of running per-user, it collects the union of all followed venues across all users, makes one TM call per unique venue, and writes global Announcement rows. Each user's Discover feed then queries the Announcement table filtered by their followed venues and regions.

**Implementation:**
1. Nightly (or every 6h): collect `SELECT DISTINCT venue_id FROM user_venue_follows WHERE venue.ticketmaster_venue_id IS NOT NULL`
2. For each unique venue: one TM call → upsert Announcements (dedup on `source_event_id`)
3. For regions: collect `SELECT DISTINCT city_name, latitude, longitude, radius_miles FROM user_regions WHERE active = true`, deduplicate overlapping regions, one TM call per distinct region
4. Discover feed query is just: `SELECT * FROM announcements WHERE venue_id IN (user's followed venues) OR venue within user's regions`

**Rationale:** Scales. 100 users following MSG = 1 TM call, not 100. The schema already supports this (Announcements are global per D6). This is purely a pipeline optimization.

### D21: TM results per venue → 100 events with pagination
**Decision:** Request `&size=100` per venue call. If TM returns a `page.totalElements` > 100, paginate to fetch all events. Cap at 200 to avoid runaway calls on mega-venues.

**Rationale:** Active venues like MSG or The O2 can have 100+ events in a 12-month window. Missing events means missing announcements in the Discover feed — a core feature gap. The rate limit budget (5,000 calls/day) easily supports pagination: even with 50 followed venues × 2 pages each = 100 calls, well within budget.

### D22: Kind rename — Broadway → Theatre
**Decision:** The `broadway` kind is renamed to `theatre` across the entire codebase and UI. The Marquee palette color "Curtain Crimson" and the proscenium arch icon remain — they work for theatre broadly, not just Broadway specifically.

**Rationale:** "Broadway" is a specific theatre district in Manhattan. The app tracks all live theatre — Broadway, Off-Broadway, West End, regional companies, touring productions. "Theatre" is the accurate umbrella term.

**Migration note:** The prototype files (hifi-v2.html, shared-data.jsx, etc.) still reference `broadway` in mock data, kind enums, and palette labels. These need to be updated when the prototypes are next touched.
