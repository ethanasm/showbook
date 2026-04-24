# Google Places Venue Autocomplete

Server-side Google Places autocomplete for venue selection across two surfaces: the Add a Show page and the Discover page's "Follow a venue" modal.

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

## Client: Discover page "Follow a venue" modal

The existing `VenueSearchModal` searches only the local DB (`venues.search` tRPC procedure). This limits users to following venues they've already been to.

**New behavior:**
- The modal searches Google Places instead of (or in addition to) the local DB
- Flow: user types → debounce → `searchPlaces` → dropdown of Google results
- User clicks "Follow" on a result → `placeDetails` fetches full data → `matchOrCreateVenue` creates the venue if it doesn't exist → `venues.follow` follows it
- This requires a new mutation `venues.followByPlace` that accepts Google Place data, runs it through `matchOrCreateVenue`, and then follows the resulting venue
- Styled with existing `discover-modal__*` CSS classes (dark theme appropriate)

**Why a new mutation:** The current `venues.follow` takes a `venueId` (UUID), but when following a Google Places result the venue may not exist in the DB yet. The new mutation accepts the full place data, creates-or-matches the venue, and follows it in one call.

## Client: Preferences page "Followed venues" section

The Preferences page at `/preferences` shows a list of followed venues with unfollow buttons and a "Follow a venue" link at the bottom. The link currently has no `onClick` handler.

**New behavior:**
- Clicking "Follow a venue" opens the same `VenueSearchModal` (shared component) with Google Places autocomplete
- On follow: calls `venues.followByPlace`, then refetches `venues.followed` to update the list
- Modal styled to match Preferences page (same light card-based design, not Discover's dark theme) — the shared modal component adapts via its existing CSS class structure

## Shared component: `VenueSearchModal`

The modal should be extracted into a shared component importable from both Discover and Preferences. It accepts:
- `onClose: () => void`
- `onFollowed: () => void`
- `variant?: "discover" | "preferences"` — controls theme/styling adaptation

## What's NOT in scope

- No changes to the venue DB schema (googlePlaceId column already exists)
- No changes to `venue-matcher.ts` (already handles googlePlaceId)
- No changes to the Chat mode Add flow
- No Google Maps visual embed or map picker
