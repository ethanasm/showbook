# Phase 7 — Library sync · priming · year-end soundtrack

> **Goal.** The features that need to act on their own using the
> persisted token from Phase 0. Library cross-reference, fan-loyalty
> ring, "songs you discovered live" rail, pre-show priming stat,
> year-end concert soundtrack playlist.

| Estimated effort | ~2 weeks |
| Critical path? | No (parallel to Phase 5/6) |
| Prerequisites | Phase 0 (token storage), Phase 1 (predicted setlist) |
| Ships | Fan-loyalty ring + discovered-live rail + priming stat on web; year-end soundtrack email + playlist generation |

References:
- [`../feature-plan.md`](../feature-plan.md) §13c, §13d, §13h
- [`../music-layer.md`](../music-layer.md) #6, #7, #8

---

## Code

### Schema additions

```sql
ALTER TABLE shows
  ADD COLUMN spotify_prep_track_count  smallint,
  ADD COLUMN spotify_post_track_count  smallint;

ALTER TABLE users
  ADD COLUMN spotify_year_playlists jsonb;   -- { "2025": "spotify:playlist:abc", ... }
```

**No `user_spotify_saved_tracks` table.** The fan-loyalty ring +
discovered-live rail use Spotify's `/me/tracks/contains` endpoint
on demand instead of caching the user's full saved library in our
database. The privacy footprint shrinks from "Showbook holds an
encrypted index of your entire Spotify library" to "Showbook asks
Spotify, per show, which of these N songs you saved" — never
persisted, only the per-show boolean answer is held in memory for
the page render. See **`spotify.tracksContains` query** below for
the wrapper.

### `packages/api/src/spotify-catalog.ts` extension

```ts
/**
 * Check whether each of `trackIds` is in the connected user's
 * saved library. Wraps `GET /v1/me/tracks/contains?ids=...` —
 * Spotify accepts up to 50 IDs per call and returns a boolean
 * array in the same order. Larger setlists batch into multiple
 * calls; results stitched back into the original order.
 *
 * Used by the fan-loyalty + discovered-live procedures (per-show
 * intersection, on demand). Replaces the v1 plan's nightly
 * `/me/tracks` page-through into a `user_spotify_saved_tracks`
 * table — that bulk cache was dropped to keep the user's full
 * library out of our database.
 */
export async function tracksContains(
  accessToken: string,
  trackIds: string[],
): Promise<boolean[]>;
```

### Removed: `packages/jobs/src/spotify-library-sync.ts`

The nightly library-sync job is **not** in Phase 7. The fan-
loyalty + discovered-live procedures call `tracksContains` per
show, on demand, so there's nothing to pre-sync.

Knock-on: the SI-12 daily Spotify API budget concern collapses —
typical show pageload is one `tracksContains` call covering 15-25
song IDs (well under the 50-per-call cap). One call per show
view, only when the user actually opens it.

### `packages/jobs/src/spotify-recently-played.ts` (new)

Per-user pull of last 50 plays from
`/me/player/recently-played`. Ranges over the past 24 hours.

For each show within ±6h of any returned play, increment that
show's `spotify_prep_track_count` (if play before show) or
`spotify_post_track_count` (if after).

After 6 hours have passed since the show date, the count is
considered final and isn't updated again.

Schedule: 09:00 ET nightly.

### `packages/jobs/src/year-end-soundtrack.ts` (new)

Annual cron firing Dec 31 03:00 ET. For each user with persisted
tokens:

1. Find every show with `state = 'past'` and `date >=
   current_year-01-01`.
2. For each show with a populated setlist, pick the *signature*
   track:
   - Score = `playedCount × spotifyPopularity × userListeningFrequency`
   - Tie-break by latest played
3. Resolve each to `spotifyTrackId` (sync resolve for any unresolved).
4. Order DJ-set-style: rough valence-energy curve (warm-up → peak
   → wind-down).
5. Create or update playlist `Showbook · YYYY` (idempotent — uses
   the year-playlists map on `users` to overwrite an existing
   playlist instead of creating duplicates).
6. Apply branded cover (`packages/api/src/playlist-cover.ts` from
   Phase 3 — new "year" variant).
7. Send the year-end soundtrack email (new template).

### `packages/emails/src/YearEndSoundtrack.tsx` (new)

React-email template, same dark editorial style as the daily
digest. Hero stat block (count, venues, miles) + a single CTA to
open the playlist.

### `packages/api/src/routers/setlist-intel.ts` (extend)

Phase 7 procedures:

```ts
setlistIntel.fanLoyalty({ showId })           // for the ring
setlistIntel.discoveredLive({ showId })       // for the rail
setlistIntel.saveDiscoveredSong({ songId })   // user-tap save-to-library
setlistIntel.primingStat({ showId })          // for the one-liner
```

`fanLoyalty` + `discoveredLive` both walk the same on-demand path:
load the show's `songs.spotify_track_id` set → call
`tracksContains` once → return the intersection / its inverse plus
the count. No persisted intermediate state; the answer recomputes
on next call. Per-show latency dominated by one Spotify round-trip
(~150ms cold, much faster behind the in-process Spotify token
cache).

For predicted-setlist rows that want the `💛 saved` chip across
many songs in one render, the same `tracksContains` call covers
the predicted set (typically 15-25 IDs, well under the 50-per-call
cap). The procedure returning the prediction can attach the saved-
status array alongside `PredictedSong[]` so the chip renders
without a second round-trip.

`saveDiscoveredSong` calls Spotify's `PUT /me/tracks?ids=...` —
requires `user-library-modify` (in the upfront scope set, so no
re-prompt). Doesn't write to any Showbook DB column — Spotify
itself is the source of truth, and the next `tracksContains` call
picks up the new saved status.

### Web UI additions

`apps/web/app/(app)/shows/[id]/page.tsx` (edit) — adds three
sections to the show detail (only when state='past'):

- **Fan loyalty ring** — small ring chart positioned next to the
  setlist or photos
- **Songs you discovered live** rail — appears below the setlist
  when there are ≥1 unsaved-but-played songs
- **Priming stat** one-liner — italics, mutedFg, beneath the show
  date

`apps/web/components/predicted-setlist/PredictionSongRow.tsx`
(edit) — `PersonalWeightChip` overlays now actually have data
backing them. The `💛 saved` chip pulls from the per-prediction
`tracksContains` call described above (no library cache). The
`🎯 first-time` chip from `user_song_stats`. The `⭐ top-track`
chip from a new top-tracks sync.

### `packages/jobs/src/spotify-top-tracks-sync.ts` (new)

Per-user `/me/top/tracks?time_range=long_term&limit=50` pull,
weekly. Stores in a small `user_spotify_top_tracks` table (or
just a jsonb column on `users` — pick one, not both).

---

## Tests

### Unit

- `packages/jobs/src/__tests__/year-end-soundtrack.test.ts` —
  signature-track scoring; DJ-set ordering; idempotency on rerun
- `packages/api/src/__tests__/tracks-contains.test.ts` — batches
  >50 IDs across multiple calls; stitches results back in order;
  empty input short-circuits without an HTTP call
- `packages/jobs/src/__tests__/spotify-recently-played.test.ts` —
  prep vs post bucketing edge cases (show right at midnight)

### Integration

- For a connected user with seeded shows, fan-loyalty ring renders
  with correct percentage
- Discovered-live rail surfaces only the songs not in the user's
  saved tracks
- Priming stat populates 24h after a show transitions to past
- Year-end soundtrack idempotent: run twice, no duplicate playlist

### E2E (Playwright)

- `apps/web/tests/discovered-live.spec.ts` — open a past show with
  seeded setlist + saved-tracks; tap "save" on a discovered song;
  assert it joins the saved set on next page load

---

## Observability events

- `spotify.library_sync.{ok,partial,rate_limited}`
- `spotify.recently_played.{ok,no_data}`
- `spotify.top_tracks.{ok,partial}`
- `year_end_soundtrack.{built,delivered,failed}`
- `setlistIntel.fan_loyalty.computed`
- `setlistIntel.save_discovered.{ok,failed}`

---

## Exit criteria

1. For a connected user with a recent show, the fan-loyalty ring
   + discovered-live rail render on Show detail.
2. Priming stat populated on a show 24h after it transitions to
   past.
3. Year-end soundtrack works end-to-end against a seeded
   Dec-1-to-now corpus, generating a playlist with branded cover.
4. Personal-weight chips on predicted-setlist rows display real
   data for connected users (no longer placeholders).
5. Save-discovered button calls `PUT /me/tracks` and the song
   subsequently appears in the user's saved set.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Library sync runs against thousands of users nightly | Concurrency 1 per token; cap at 250 users/run; spread across 4 time slots |
| Recently-played 24h window misses early-morning shows | Run at 09:00 ET; the next run catches anything missed; mark counts as "settled" only after 6h post-show |
| Year-end playlist generation fails for one user mid-batch | Per-user transaction wrapper; one failure doesn't block others; failed users are retried in a follow-up run on Jan 1 |
| Priming stat feels invasive | Each scope is documented in the connect-once dialog; user can disconnect to wipe |
| Disconnect mid-year leaves a half-built year playlist | The Dec 31 cron skips users without active tokens; existing year playlists remain on the user's Spotify (we don't delete) but won't update |

---

## What this phase does NOT include

- Vibe radar / energy arc (Phase 8)
- Spotify-follow rail (Phase 9)
- 30s previews (Phase 9)
- Mobile equivalents of these surfaces (Phase 10)
- Live-mode setlist capture using `currently-playing` (deferred —
  the scope is granted, but the use case is rare enough we delay)
