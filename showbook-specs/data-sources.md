# Showbook — Data Sources

External APIs and data collection methods. For each source: what it provides, auth requirements, rate limits, and how we use it.

---

## Ticketmaster Discovery API

**Role:** Primary data source. Provides event listings (Discover feed), venue data, performer images, and event matching for the Add flow.

**Auth:** API key (free tier).
**Rate limits:** 5,000 calls/day, 5 requests/second.
**Base URL:** `https://app.ticketmaster.com/discovery/v2/`
**Docs:** https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/

### What we use

| Use case | Endpoint | Fields we extract | When called |
|----------|----------|-------------------|-------------|
| Discover feed — followed venues | `GET /events?venueId={id}&startDateTime=now&endDateTime=+12mo` | event name, date, on-sale date, genre, attractions | Ingestion job (every 6h) |
| Discover feed — near you | `GET /events?latlong={lat},{lng}&radius={mi}&unit=miles` | same | Ingestion job (every 6h) |
| Add flow — event search | `GET /events?keyword={headliner}&startDateTime={range}` | event ID, venue, date, attractions | On user action |
| Venue data | `GET /venues/{id}` | name, address, city, state, country, lat/lng | When creating/matching a Venue |
| Performer images | `GET /attractions/{id}` | images array (multiple resolutions) | When creating/matching a Performer |

### Kind inference from TM classification

TM returns `classifications[].segment.name` and `classifications[].genre.name`:

| TM segment | TM genre | Showbook kind | Confidence |
|------------|----------|---------------|------------|
| Music | *(any)* | `concert` | High — default for music events |
| Arts & Theatre | Musical, Theatre | `theatre` | Medium — catches Broadway + regional theatre |
| Arts & Theatre | Comedy | `comedy` | Medium |
| Music | *(any)* + event name contains "festival" or "fest" | `festival` | Medium — also check `subGenre` |

User always confirms kind. These are suggestions, not final.

### TM venue data → Venue entity mapping

| TM field | Venue field |
|----------|------------|
| `id` | `ticketmaster_venue_id` |
| `name` | `name` |
| `city.name` | `city` |
| `state.name` | `state_region` |
| `country.name` | `country` |
| `location.latitude` | `latitude` |
| `location.longitude` | `longitude` |
| `address.line1` | *(not stored — we don't have an address field. Add if needed?)* |

**Note:** TM doesn't provide `neighborhood`. This stays null unless the user fills it in.

### TM attraction data → Performer entity mapping

| TM field | Performer field |
|----------|----------------|
| `id` | `ticketmaster_attraction_id` |
| `name` | `name` |
| `images[]` | `image_url` — pick the highest-res image with `ratio: "16_9"` or `"3_2"` |

### Limitations

- Coverage skews toward Live Nation / Ticketmaster-affiliated venues. Independent venues, small comedy clubs, and regional theatres are often missing.
- Comedy and festival coverage is weaker than concerts.
- Genre classification is coarse — edge cases will misclassify.
- No setlist data.
- `on_sale_status` is a snapshot at query time. We ingest it once and display it statically (no polling).

---

## setlist.fm API

**Role:** Secondary source. The only structured source for setlists — what songs were actually played at a specific concert.

**Auth:** API key (free, requires registration at https://api.setlist.fm).
**Rate limits:** Not officially documented. ~2 requests/second appears safe.
**Base URL:** `https://api.setlist.fm/rest/1.0/`
**Docs:** https://api.setlist.fm/docs/1.0/

### What we use

| Use case | Endpoint | Fields we extract | When called |
|----------|----------|-------------------|-------------|
| Setlist enrichment | `GET /search/setlists?artistMbid={mbid}&date={dd-MM-yyyy}` | songs[], tour name | After a concert's date passes |
| Artist MBID lookup | `GET /search/artists?artistName={name}` | MBID (MusicBrainz ID) | When creating a Performer from user input |

### Setlist response → Show fields

| setlist.fm field | Show field |
|------------------|-----------|
| `sets.set[].song[].name` | `setlist` (flattened, ordered) |
| `tour.name` | `tour_name` |

### Matching strategy

1. User enters headliner name → search setlist.fm `/search/artists?artistName={name}`
2. If multiple results, pick the one with the highest `tmScore` (relevance) or show candidates
3. Store `setlistfm_mbid` on the Performer record
4. After show date passes → search `/search/setlists?artistMbid={mbid}&date={date}`
5. Exact date match → extract setlist. No match → retry (see `pipelines.md` for retry schedule)

### Limitations

- **Concert only.** No theatre, comedy, or festival data.
- **Crowd-sourced.** Coverage varies wildly. Mainstream acts (Radiohead, Taylor Swift) have near-complete data. Niche acts may have nothing.
- **Delayed.** Setlists appear hours to weeks after a show. The enrichment pipeline must retry.
- **Tour name is post-hoc.** It's on the setlist, not the event. We get it only after the show, not before.

---

## Manual Entry + LLM Extraction

**Role:** Fallback for everything the APIs can't provide. Primary source for comedy shows and theatre cast.

### Theater cast — LLM extraction from playbill photos

When a user has a physical playbill (the printed program you get at a theatre show), they can photograph it and we extract the cast.

**Flow:**
1. User uploads photo(s) of the playbill's cast page
2. Send image to LLM (vision-capable model) with prompt:
   ```
   Extract the cast list from this playbill photo.
   Return a JSON array of objects: [{"actor": "name", "role": "character name"}]
   Only include the principal cast. Skip ensemble/swing listings.
   ```
3. Parse LLM response → create Performer records (name-only, no external IDs) → create `show_performers` rows with `role=cast` and `character_name`
4. Show user the extracted cast for confirmation/editing before saving

**Why LLM and not OCR?** Playbills have complex layouts — columns, decorative fonts, headers mixed with names. Traditional OCR gets the text but can't reliably separate actor names from role names from section headers. A vision LLM handles the layout interpretation.

### Comedy shows

No good structured source exists for comedy. Everything is manual:
- **Headliner/support:** User enters or matched from TM if the show is listed
- **Tour name:** User enters (e.g. "Happiness Begins Tour")
- **Material notes:** User enters free-text (e.g. "new hour, mostly crowd work")

### Regional theatre / non-TM venues

For venues not on Ticketmaster, the `scrape_config` field on Venue stores a reference URL and notes. In v1, this is purely informational — the user checks the venue's website manually. No automated scraping.

Future option: build scrapers per-venue using the config, but this is a maintenance burden and likely not worth it unless there are high-value venues the user checks repeatedly.

---

## Google APIs

### Google OAuth

**Role:** Authentication. Only auth method.
**What we get:** `google_id`, `email`, `display_name`, `avatar_url`

### Google Maps Geocoding API

**Role:** Fallback for venue lat/lng when TM doesn't provide coordinates (rare — TM almost always has them).

**When called:** Only when creating a Venue that came from manual entry (no TM venue match) and we need coordinates for the Map page.

**Auth:** API key. Pricing: $5 per 1,000 requests (very low volume for this use case).

### Google Places Autocomplete

**Role:** User region setup. When a user adds a region in Preferences, they type a city name and we autocomplete it, then extract lat/lng for the center point.

---

## Source → Field Matrix

Which source fills which field on Show:

| Field | User input | Ticketmaster | setlist.fm | LLM extraction | Notes |
|-------|:---:|:---:|:---:|:---:|-------|
| `kind` | ✅ primary | suggests | — | — | User always confirms |
| `headliners` | ✅ primary | ✅ match Performers | ✅ match Performers | — | |
| `support` | fallback | ✅ | ✅ | — | |
| `cast` | fallback | — | — | ✅ from playbill photo | Theater only |
| `venue_id` | picks from list | ✅ creates/matches Venue | — | — | |
| `date` | ✅ primary | ✅ confirm | ✅ confirm | — | |
| `end_date` | ✅ only source | — | — | — | Festivals only |
| `seat` | ✅ only source | — | — | — | |
| `price_paid` | ✅ only source | — | — | — | |
| `tour_name` | fallback | — | ✅ only structured source | — | Post-show only |
| `setlist` | — | — | ✅ only source | — | Concert only, post-show |
| `photos` | ✅ only source | — | — | — | Stored in Cloudflare R2 |
| `cover_image` | — | ✅ via Performer `image_url` | — | — | Fallback: generated gradient |
