# Google Places Venue Autocomplete

Server-side Google Places autocomplete for the Add a Show venue field.

## Decision

**Server-side tRPC proxy** — the API key stays on the server. The client calls a tRPC procedure, which calls the Google Places API, and returns structured venue data. No API keys are exposed to the browser.

Rejected: client-side `@googlemaps/js-api-loader` (exposes API key in browser).

## Scope

- Only active during **manual entry** — when the user has NOT selected a Ticketmaster result (`tmEnriched === false`)
- When a TM result auto-fills the venue, the autocomplete is disabled/hidden

## Server: `enrichment.searchPlaces` tRPC procedure

**Input:** `{ query: string }` (min 2 chars)

**Flow:**
1. Call Google Places Autocomplete (New) API with the query
2. Filter to establishment/point-of-interest types (bias toward venues)
3. For the top result selected by the user, call Place Details to get full data
4. Return structured results

**Two procedures:**
- `searchPlaces` — takes query string, returns list of `{ placeId, name, address }` predictions
- `placeDetails` — takes placeId, returns `{ name, city, stateRegion, country, lat, lng, googlePlaceId }`

**Env var:** `GOOGLE_PLACES_API_KEY` (server-only, no `NEXT_PUBLIC_` prefix)

## Client: Venue autocomplete on Add page

**Behavior:**
- User types in venue field → 300ms debounce → calls `searchPlaces`
- Dropdown appears below the input with predictions (name + address)
- User clicks a result → calls `placeDetails` → populates venue state with all fields
- Dropdown dismisses on selection or click-outside
- If `tmEnriched` is true, the input is read-only (no autocomplete)

**Styling:** Matches existing design — `var(--surface)` background, `var(--ink)` text, same font stack (`sans`/`mono`), same border treatment as other form fields.

## Data mapping

Google Place Details → VenueData:
- `displayName.text` → `name`
- `addressComponents` city (locality) → `city`
- `addressComponents` state (administrative_area_level_1) → `stateRegion`
- `addressComponents` country → `country`
- `location.latitude` → `lat`
- `location.longitude` → `lng`
- `id` → `googlePlaceId`

## What's NOT in scope

- No changes to the venue DB schema (googlePlaceId column already exists)
- No changes to `venue-matcher.ts` (already handles googlePlaceId)
- No changes to the Chat mode Add flow
- No Google Maps visual embed or map picker
