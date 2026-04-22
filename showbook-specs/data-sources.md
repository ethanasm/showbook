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

### Example responses

**Event search** — `GET /events?keyword=Radiohead&size=1`

```json
{
  "_embedded": {
    "events": [
      {
        "name": "Radiohead",
        "type": "event",
        "id": "vvG1fZ9pBkd2Kp",
        "url": "https://www.ticketmaster.com/radiohead-new-york-new-york/event/...",
        "dates": {
          "start": {
            "localDate": "2025-11-20",
            "localTime": "19:30:00",
            "dateTime": "2025-11-21T00:30:00Z"
          },
          "status": { "code": "onsale" }
        },
        "sales": {
          "public": {
            "startDateTime": "2025-09-15T14:00:00Z",
            "endDateTime": "2025-11-20T23:30:00Z"
          }
        },
        "classifications": [
          {
            "primary": true,
            "segment": { "id": "KZFzniwnSyZfZ7v7nJ", "name": "Music" },
            "genre": { "id": "KnvZfZ7vAeA", "name": "Rock" },
            "subGenre": { "id": "KZazBEonSMnZfZ7v67d", "name": "Art Rock" }
          }
        ],
        "_embedded": {
          "venues": [
            {
              "name": "Madison Square Garden",
              "type": "venue",
              "id": "KovZpZA7AAEA",
              "postalCode": "10001",
              "timezone": "America/New_York",
              "city": { "name": "New York" },
              "state": { "name": "New York", "stateCode": "NY" },
              "country": { "name": "United States Of America", "countryCode": "US" },
              "location": { "longitude": "-73.99336890", "latitude": "40.75050930" }
            }
          ],
          "attractions": [
            {
              "name": "Radiohead",
              "id": "K8vZ91713wV",
              "classifications": [
                { "primary": true, "segment": { "name": "Music" }, "genre": { "name": "Rock" } }
              ]
            }
          ]
        }
      }
    ]
  },
  "page": { "size": 1, "totalElements": 5, "totalPages": 5, "number": 0 }
}
```

**Attraction (performer) lookup** — `GET /attractions?keyword=Radiohead` *(actual live response, trimmed)*

```json
{
  "_embedded": {
    "attractions": [
      {
        "name": "Radiohead",
        "type": "attraction",
        "id": "K8vZ91713wV",
        "url": "https://www.ticketmaster.com/radiohead-tickets/artist/763468",
        "externalLinks": {
          "musicbrainz": [
            { "id": "a74b1b7f-71a5-4011-9441-d0b5e4122711" }
          ],
          "spotify": [
            { "url": "https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb" }
          ]
        },
        "images": [
          {
            "ratio": "3_2",
            "url": "https://s1.ticketm.net/dam/a/f11/079ed87a-f08c-4b72-9d92-9342a23a3f11_270071_ARTIST_PAGE_3_2.jpg",
            "width": 305,
            "height": 203,
            "fallback": false
          },
          {
            "ratio": "16_9",
            "url": "https://s1.ticketm.net/dam/a/f11/079ed87a-f08c-4b72-9d92-9342a23a3f11_270071_TABLET_LANDSCAPE_LARGE_16_9.jpg",
            "width": 2048,
            "height": 1152,
            "fallback": false
          },
          {
            "ratio": "3_2",
            "url": "https://s1.ticketm.net/dam/a/f11/079ed87a-f08c-4b72-9d92-9342a23a3f11_270071_RETINA_PORTRAIT_3_2.jpg",
            "width": 640,
            "height": 427,
            "fallback": false
          }
        ],
        "classifications": [
          {
            "primary": true,
            "segment": { "id": "KZFzniwnSyZfZ7v7nJ", "name": "Music" },
            "genre": { "id": "KnvZfZ7vAeA", "name": "Rock" },
            "subGenre": { "id": "KZazBEonSMnZfZ7v67d", "name": "Art Rock" },
            "type": { "id": "KZAyXgnZfZ7v7nI", "name": "Undefined" },
            "subType": { "id": "KZFzBErXgnZfZ7v7lJ", "name": "Undefined" }
          }
        ],
        "upcomingEvents": { "ticketmaster": 5, "_total": 5 }
      }
    ]
  }
}
```

Note: `externalLinks.musicbrainz[0].id` gives us `a74b1b7f-71a5-4011-9441-d0b5e4122711` — this is the MBID we pass to setlist.fm. No separate artist search needed.

**Venue lookup** — `GET /venues/KovZpZA7AAEA` *(from TM docs)*

```json
{
  "name": "Madison Square Garden",
  "type": "venue",
  "id": "KovZpZA7AAEA",
  "postalCode": "10001",
  "timezone": "America/New_York",
  "city": { "name": "New York" },
  "state": { "name": "New York", "stateCode": "NY" },
  "country": { "name": "United States Of America", "countryCode": "US" },
  "location": { "longitude": "-73.99336890", "latitude": "40.75050930" }
}
```

**Attraction with fallback images** — generic placeholder (tribute band "Just Radiohead"):

```json
{
  "name": "Just Radiohead",
  "id": "K8vZ917q7yf",
  "images": [
    {
      "ratio": "16_9",
      "url": "https://s1.ticketm.net/dam/c/fbc/b293c0ad-c904-4215-bc59-8d7f2414dfbc_106141_RETINA_LANDSCAPE_16_9.jpg",
      "width": 1136,
      "height": 639,
      "fallback": true
    }
  ],
  "classifications": [
    {
      "primary": true,
      "segment": { "name": "Music" },
      "genre": { "name": "Rock" },
      "subType": { "name": "Tribute Band" }
    }
  ]
}
```

All images have `fallback: true` — do NOT store these. Note the URL path `/dam/c/` (category placeholder) vs `/dam/a/` (actual artist).

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
| `images[]` | `image_url` — see image selection rules below |
| `externalLinks.musicbrainz[0].id` | `setlistfm_mbid` — TM provides MusicBrainz IDs for many artists. When present, store it directly on the Performer. This **skips the setlist.fm artist search** — we already have the MBID needed to fetch setlists. |

### TM image selection

TM returns an `images[]` array with multiple sizes and ratios. Each image has a `fallback` boolean:
- `fallback: false` — a real artist/event photo. Use these.
- `fallback: true` — a generic category placeholder (e.g., a stock "Music" image). **Do not store these** as the Performer's `image_url`. Treat as no image; fall back to generated gradient in the UI.

When `fallback: false` images exist, pick the best one:
1. Prefer `ratio: "3_2"` for performer profile images
2. Pick the largest available width (typically `RETINA_PORTRAIT_3_2` at 640×427 or `TABLET_LANDSCAPE_3_2` at 1024×683)
3. URLs are public CDN links on `s1.ticketm.net` — no auth, no expiration

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

1. **Check if the Performer already has a `setlistfm_mbid`** — if the Performer was created from a TM attraction, TM often provides the MusicBrainz ID in `externalLinks.musicbrainz`. If present, skip step 2.
2. If no MBID: search setlist.fm `/search/artists?artistName={name}`. If multiple results, pick the one with the highest `tmScore` (relevance) or show candidates. Store `setlistfm_mbid` on the Performer record.
3. After show date passes → search `/search/setlists?artistMbid={mbid}&date={date}`
4. Exact date match → extract setlist. No match → retry (see `pipelines.md` for retry schedule)

**Date format:** setlist.fm uses `dd-MM-yyyy` (e.g., `15-06-2024`), NOT ISO 8601. The client must convert dates before querying.

**Auth:** `x-api-key` header (not query parameter). `Accept: application/json` header required for JSON responses (default is XML).

### Example responses

**Artist search** — `GET /search/artists?artistName=Radiohead`

Headers: `x-api-key: {key}`, `Accept: application/json`

```json
{
  "artist": [
    {
      "mbid": "a74b1b7f-71a5-4011-9441-d0b5e4122711",
      "name": "Radiohead",
      "sortName": "Radiohead",
      "disambiguation": "",
      "url": "https://www.setlist.fm/setlists/radiohead-bd6bd12.html"
    },
    {
      "mbid": "some-other-mbid",
      "name": "Radiohead Tribute",
      "sortName": "Radiohead Tribute",
      "disambiguation": "tribute band",
      "url": "..."
    }
  ],
  "total": 5,
  "page": 1,
  "itemsPerPage": 20
}
```

Pick the first result (or match by name). Store `mbid` as `setlistfm_mbid` on the Performer.

**Setlist search** — `GET /search/setlists?artistMbid=a74b1b7f-71a5-4011-9441-d0b5e4122711&date=23-08-2024`

Note: date must be `dd-MM-yyyy` format.

```json
{
  "setlist": [
    {
      "id": "63de4613",
      "eventDate": "23-08-2024",
      "artist": {
        "mbid": "a74b1b7f-71a5-4011-9441-d0b5e4122711",
        "name": "Radiohead"
      },
      "venue": {
        "id": "6bd6ca6e",
        "name": "Madison Square Garden",
        "city": {
          "id": "5128581",
          "name": "New York",
          "state": "New York",
          "stateCode": "NY",
          "coords": { "lat": 40.7127837, "long": -74.0059413 },
          "country": { "code": "US", "name": "United States" }
        }
      },
      "tour": {
        "name": "In Rainbows World Tour"
      },
      "sets": {
        "set": [
          {
            "song": [
              { "name": "15 Step" },
              { "name": "There, There" },
              { "name": "All I Need" },
              { "name": "Nude" },
              { "name": "Airbag" },
              { "name": "Weird Fishes/Arpeggi" },
              { "name": "The National Anthem" },
              { "name": "Faust Arp" },
              { "name": "No Surprises" },
              { "name": "Jigsaw Falling Into Place" },
              { "name": "Climbing Up the Walls" },
              { "name": "Exit Music (For a Film)" },
              { "name": "Bodysnatchers" },
              { "name": "Idioteque" }
            ]
          },
          {
            "encore": 1,
            "song": [
              { "name": "House of Cards" },
              { "name": "Reckoner" },
              { "name": "Everything in Its Right Place" }
            ]
          },
          {
            "encore": 2,
            "song": [
              { "name": "Videotape" }
            ]
          }
        ]
      },
      "url": "https://www.setlist.fm/setlist/radiohead/2024/madison-square-garden-new-york-ny-63de4613.html"
    }
  ],
  "total": 1,
  "page": 1,
  "itemsPerPage": 20
}
```

**Parsing logic:**
- Flatten all `sets.set[].song[].name` in order → `["15 Step", "There, There", ..., "Videotape"]`
- Extract `tour.name` → `"In Rainbows World Tour"` → store as `tour_name`
- Sets with `encore` field are encore sets — songs are still flattened into the same array (the `encore` field exists but we don't store it separately since we removed it from the schema)

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

### LLM example requests and responses

**Chat-mode Add — text parsing** (model: `llama-3.3-70b-versatile`)

Request:
```json
{
  "model": "llama-3.3-70b-versatile",
  "messages": [
    {
      "role": "system",
      "content": "You are a structured data extractor for a show tracking app. Extract show details from the user's free-text input. Return ONLY a JSON object with these fields: headliner (string), venue_hint (string or null), date_hint (string or null), seat_hint (string or null), kind_hint (one of: concert, theatre, comedy, festival, or null). If a field cannot be determined, set it to null."
    },
    {
      "role": "user",
      "content": "I saw Wicked at the Gershwin last Tuesday, row F"
    }
  ],
  "response_format": { "type": "json_object" }
}
```

Response:
```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "{\"headliner\": \"Wicked\", \"venue_hint\": \"Gershwin\", \"date_hint\": \"last Tuesday\", \"seat_hint\": \"row F\", \"kind_hint\": \"theatre\"}"
      }
    }
  ]
}
```

Parse `choices[0].message.content` as JSON → feed into enrichment pipeline.

**Playbill cast extraction — vision** (model: `meta-llama/llama-4-scout-17b-16e-instruct`)

Request:
```json
{
  "model": "meta-llama/llama-4-scout-17b-16e-instruct",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
          }
        },
        {
          "type": "text",
          "text": "Extract the principal cast list from this playbill photo. Return ONLY a JSON array of objects with 'actor' and 'role' fields. Skip ensemble, swing, and understudy listings. Example: [{\"actor\": \"Cynthia Erivo\", \"role\": \"Elphaba\"}]"
        }
      ]
    }
  ],
  "response_format": { "type": "json_object" }
}
```

Response:
```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "[{\"actor\": \"Cynthia Erivo\", \"role\": \"Elphaba\"}, {\"actor\": \"Kristin Chenoweth\", \"role\": \"Glinda\"}, {\"actor\": \"Peter Scolari\", \"role\": \"The Wizard\"}, {\"actor\": \"Jye Frasca\", \"role\": \"Fiyero\"}]"
      }
    }
  ]
}
```

Parse `choices[0].message.content` as JSON array → show to user for confirmation → create Performer records with `role=cast` and `character_name`.

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
