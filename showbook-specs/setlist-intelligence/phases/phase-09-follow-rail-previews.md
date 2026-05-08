# Phase 9 — Spotify-follow rail · 30s previews · Web Playback

> **Goal.** The smaller wins — discovery rail of "artists you follow
> on Spotify but not on Showbook," 30-second previews on every
> setlist row, full-track playback for Spotify Premium users.

| Estimated effort | ~1 week |
| Critical path? | No |
| Prerequisites | Phase 0 (token), Phase 3 (track resolve job) |
| Ships | Discover-page Spotify-follow rail + preview play buttons + Premium full playback (web only) |

References:
- [`../feature-plan.md`](../feature-plan.md) §13e (related artists),
  §13j (previews + playback)
- [`../music-layer.md`](../music-layer.md) #9, #10

---

## Code

### `packages/api/src/routers/setlist-intel.ts` (extend)

```ts
setlistIntel.spotifyFollowsDiff()
// returns artists the user follows on Spotify but not on Showbook,
// minus artists the user has already explicitly skipped
```

Implementation:

1. Pull Spotify follows via the existing `getFollowedArtists`
   helper (using the persistent token now).
2. Diff against `user_performer_follows` for the user.
3. Diff against a small `user_spotify_skipped_artists` table
   (a user dismisses a card → we don't suggest it again).

### Schema additions

```sql
CREATE TABLE user_spotify_skipped_artists (
  user_id            text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spotify_artist_id  text NOT NULL,
  skipped_at         timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, spotify_artist_id)
);
```

### Web UI: the rail

`apps/web/app/(app)/discover/View.client.tsx` (edit) — adds a new
horizontally-scrollable rail above the existing followed-artists
rail. Each card renders the Spotify artist's image, name, genres,
and a `Follow` action.

```
┌─ YOU FOLLOW THESE ON SPOTIFY ─────────────────────────────────┐
│                                                                │
│  [card] [card] [card] [card] [card] [card]   →                │
│                                                                │
│  Tap follow to track them on Showbook too.                    │
└────────────────────────────────────────────────────────────────┘
```

Tap "Follow" → calls existing `performers.follow` (or the spotify-
import `importSelected` for new performers). Card flips to ✓ and
falls off on next refresh.

Tap "Skip" (small × on the card) → writes to
`user_spotify_skipped_artists`.

A **Follow them all** button at the head of the rail does a batch
follow.

### Web UI: 30s previews

`apps/web/components/predicted-setlist/PredictionSongRow.tsx`
(edit) — adds an inline play button per row. Tap → plays
`track.preview_url` via a hidden HTML `<audio>` element. A small
waveform animates across the row.

Same in the Songs page rows (Phase 2) and the per-show setlist
display.

Implementation: a single `<PreviewPlayer>` context at the page
level; rows call `play(trackUrl)` and the context manages the
`<audio>` element + the active row's animation.

### Web Playback SDK (Premium users only)

`apps/web/lib/spotify-playback.ts` (new) — wraps the Spotify Web
Playback SDK. Initialized only when the user's Spotify token
includes the right scopes AND `userSpotifyTokens.product ===
'premium'`.

When a Premium user taps a setlist row, the row calls
`playback.playFullTrack(spotifyUri)` instead of the 30s preview.

Falls back gracefully — non-Premium users always get the preview.

### Save-discovered button

`packages/api/src/routers/setlist-intel.ts`
`setlistIntel.saveDiscoveredSong({ songId })` already shipped in
Phase 7 — no changes here.

### Preview URL hydration

`packages/jobs/src/spotify-track-resolve.ts` (extend from Phase 3)
— when resolving a track, also fetch and cache the
`preview_url`:

```sql
ALTER TABLE songs
  ADD COLUMN spotify_preview_url text;
```

(Migration ships in Phase 9 even though the column is
prediction-orthogonal — keeping concerns together.)

---

## Tests

### Unit

- `packages/api/src/__tests__/spotify-follows-diff.test.ts` —
  three-way diff among Spotify follows / Showbook follows / skipped
- `apps/web/components/predicted-setlist/__tests__/PreviewPlayer.test.tsx`
  — only one row plays at a time; tapping a second row stops the
  first

### Integration

- Connected user with seeded Spotify follows and Showbook follows
  → diff returns the expected artists
- Skipping an artist → not returned on the next call

### E2E (Playwright)

- `apps/web/tests/spotify-follow-rail.spec.ts` — open Discover,
  see the rail, tap follow on a card, assert the card flips and
  the artist appears in followed-artists list

---

## Observability events

- `spotify.follow_diff.{served,empty}`
- `spotify.preview.{played,unavailable}`
- `spotify.web_playback.{ready,error}`

---

## Exit criteria

1. For a user with ≥3 Spotify-only follows, the rail appears on
   Discover with one-tap follow.
2. 30s previews play inline on web; no UI jank when switching
   rows mid-playback.
3. Premium users get full-track playback on the same rows;
   non-Premium see a "Premium" badge instead of the full play
   icon.
4. The save-discovered button writes to user library successfully.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Many tracks have null `preview_url` (Spotify has been thinning these since 2024) | Treat null as graceful degradation: hide the play button on those rows; the row stays clickable for navigation |
| Web Playback SDK requires HTTPS (no localhost dev) | Document the dev workaround (use ngrok or `--experimental-https` next dev flag); E2E uses the existing TLS-enabled Playwright dev server (port 3003) |
| Preview audio fails to load mid-playback | Toast: "preview unavailable"; row reverts to navigation-only state |
| Skipping artist for a feature flips them off Showbook entirely | The skip table is *Spotify-rail-specific* — skipping just hides the card from the rail; the user can still follow them via search or any other surface |

---

## What this phase does NOT include

- Mobile parity (Phase 10)
- Related-artist discovery rail beyond what's in Spotify follows
  (related-artists endpoint deprecated; this phase doesn't try)
- Cross-tour discovery via genre similarity (deferred)
- Lyrics display (out of scope; Spotify's lyrics endpoint is
  undocumented and we don't need them)
