# Phase 3 — Spotify export (Hype + Save)

> **Goal.** The two playlist buttons work end-to-end on web. Branded
> covers. Track-resolution job populates `songs.spotify_track_id`.
> Connect-modal flow proves itself in production.

| Estimated effort | ~1 week |
| Critical path? | No (parallel to Phase 2, 4) |
| Prerequisites | Phase 0 (token storage), Phase 1 (predicted setlist) |
| Ships | "🎵 Hype playlist on Spotify" + "Save tonight to Spotify" buttons on web show detail |

References:
- [`../feature-plan.md`](../feature-plan.md) §5 (Spotify integration)
- [`../music-layer.md`](../music-layer.md) #1, #2 (the user-facing UX)

---

## Code

### `packages/api/src/spotify-catalog.ts` (new)

App-credentials Spotify catalog client. No user token. Used by:

- `spotify-track-resolve` job — search artist + title → Spotify
  track URI
- Cover-art rendering — fetches album art for the playlist cover
  (optional, fallback to flat color)

```ts
export async function searchTrack(artist: string, title: string): Promise<SpotifyTrack | null>;
export async function getTrack(trackId: string): Promise<SpotifyTrackFull>;  // includes ISRC + album metadata
```

Client-credentials token cached for ~50min; refreshed on miss.

### `packages/jobs/src/spotify-track-resolve.ts` (new)

Resolves song titles to Spotify track URIs in batches of 50.

```ts
registerJob('spotify/track-resolve', async ({ performerId, limit = 50 }) => {
  // Find songs for this performer with either:
  //   - spotify_track_id IS NULL (never tried), or
  //   - spotify_track_id = '__none__' AND
  //     spotify_track_id_resolved_at < now() - interval '90 days'
  //     (we tried before but Spotify's catalog may have grown — SI-11)
  // …and at least one appearance.
  //
  // Resolve via Spotify search filtered by artist:<name> track:<title>.
  // Cache negative results with sentinel (spotify_track_id = '__none__')
  // AND set spotify_track_id_resolved_at = now() so the 90-day re-check
  // fires next time.
});
```

Concurrency 1, 200ms minimum interval, 100-track cap per run.

Schema addition (SI-11):

```sql
ALTER TABLE songs
  ADD COLUMN spotify_track_id_resolved_at timestamp;
```

Set on every resolution attempt (success OR `__none__`). Lets the
job re-try previously-unresolvable songs after 90 days, in case
Spotify has uploaded the live cut / re-issue since. One column,
one filter line in the job; bounded cost.

Triggers:
- After each `setlist-corpus-fill` completion → enqueue resolve
  for that performer
- After `song-index-rebuild` → resolve for any performer with new
  songs

### `packages/api/src/playlist-cover.ts` (new)

Satori SVG → JPEG cover renderer. Output 640×640 JPEG ≤256KB
(Spotify's `PUT /playlists/{id}/images` cap).

Two cover variants:

- **Hype** — dark editorial card with `HYPE` label, headliner,
  date, venue
- **Live** — same chrome with `LIVE` label

Covers cached in R2 keyed by `(playlistId, version, kind)`; only
re-rendered when the underlying setlist changes.

### `packages/api/src/routers/setlist-intel.ts` (extend)

```ts
setlistIntel.exportPlaylistPredicted({ showId, performerId })
setlistIntel.exportPlaylistAttended({ showId, performerId })
```

Both use `ensureFreshUserToken(ctx.session.user.id)` (from Phase 0)
to authenticate against Spotify.

Implementation skeleton:

```ts
async function exportPlaylist(input) {
  const access = await ensureFreshUserToken(input.userId);
  if (!access) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'spotify_not_connected' });

  const me = await spotifyFetch('/me', access);
  const playlist = await spotifyFetch(`/users/${me.id}/playlists`, access, {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      public: false,
      description: 'Showbook',
    }),
  });

  // Resolve titles → URIs in batches of 50 via songs.spotify_track_id
  // (run a synchronous resolve for any unresolved titles in case the
  // background job hasn't caught up yet)
  const uris = await resolveOrFetchUris(input.titles, input.performerId);

  await spotifyFetch(`/playlists/${playlist.id}/tracks`, access, {
    method: 'POST',
    body: JSON.stringify({ uris: uris.slice(0, 100) }),
  });

  // Multi-batch additions for setlists > 100 tracks (jam bands)
  for (let i = 100; i < uris.length; i += 100) {
    await spotifyFetch(`/playlists/${playlist.id}/tracks`, access, {
      method: 'POST',
      body: JSON.stringify({ uris: uris.slice(i, i + 100), position: i }),
    });
  }

  // Cover art
  const coverJpeg = await renderCover({ kind, headliner, date, venue });
  await spotifyFetch(`/playlists/${playlist.id}/images`, access, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: coverJpeg.toString('base64'),
  });

  // Persist URL on the show row
  await db.update(shows).set({
    spotifyPlaylistUrl: playlist.external_urls.spotify,
  }).where(eq(shows.id, input.showId));

  return {
    playlistUrl: playlist.external_urls.spotify,
    found: uris.length,
    requested: input.titles.length,
    missing: input.titles.length - uris.length,
  };
}
```

### Schema additions

```sql
ALTER TABLE shows
  ADD COLUMN spotify_playlist_url           text,
  ADD COLUMN spotify_attended_playlist_url  text;
```

Two columns — Hype and Save are different artifacts. Re-tapping
either button overwrites the existing playlist (same URL); the
column lets the UI flip the button to "Open in Spotify" on
subsequent visits.

### Web UI

`apps/web/app/(app)/shows/[id]/page.tsx` action bar gains:

- **🎵 Hype playlist on Spotify** — visible when `state ∈
  {watching, ticketed}` AND `kind ∈ {'concert', 'festival'}` (per
  SI-03). **Phase 3 does NOT gate on `setlistStyle === 'rotating'`**
  — the classifier doesn't land until Phase 5. Per SI-05 option C,
  the button shows for Phish too in the Phase 3 → Phase 5 window;
  Phish fans get a low-relevance playlist of "songs that have been
  rotating recently" rather than the documented "we can't predict"
  empty state. The cost is briefly misleading UX for rotating-style
  fans during the Phase 3 → Phase 5 gap; the win is Phase 3 ships
  without waiting on Phase 5's classifier. Phase 5 adds the
  `setlistStyle === 'rotating'` hide rule per
  [`../ui-spec.md`](../ui-spec.md) §3.4.
- **🎵 Save tonight to Spotify** — visible when `state === 'past'`
  AND a setlist exists (either user-typed or fetched from
  setlist.fm).

Both buttons wrapped in `requireConnection(...)`:

```tsx
const { requireConnection } = useSpotifyConnection();
const exportHype = trpc.setlistIntel.exportPlaylistPredicted.useMutation({
  onSuccess: (data) => {
    showToast({ kind: 'success', text: `Created — ${data.found} of ${data.requested} found` });
  },
});

<Button
  onClick={() => requireConnection(() => exportHype.mutate({ showId }))}
>
  Hype playlist on Spotify
</Button>
```

When `spotifyPlaylistUrl` is already populated, the button label
flips to **Open in Spotify** and short-circuits to opening the URL.

---

## Tests

### Unit

- `packages/api/src/__tests__/playlist-cover.test.ts` — cover
  rendering produces a ≤256KB JPEG; rejects oversized inputs
- `packages/api/src/__tests__/spotify-export.test.ts` — multi-batch
  paging behavior on a 150-track setlist; partial-resolve toast
  message; Spotify 401 surfaces as a re-connect cue

### Integration

- Connect → predict → export round-trip with mocked Spotify HTTP
- Re-tap on a show with `spotifyPlaylistUrl` already populated:
  asserts overwrite (not duplicate)

### E2E (Playwright)

- `apps/web/tests/spotify-export.spec.ts` — first tap on a fresh
  account surfaces the connect modal; OAuth (mocked); modal closes;
  export auto-fires; toast appears; button label flips to "Open in
  Spotify"

---

## Observability events

- `spotify.export_playlist.{success,partial,failed}`
  (payload: `kind: 'hype'|'attended'`, `found`, `requested`)
- `spotify.track_resolve.{ok,no_match}`

---

## Exit criteria

1. Tap "Hype playlist" on a fresh-account show → connect modal →
   OAuth → playlist appears in user's Spotify with branded cover.
2. Subsequent taps on any other Spotify-using feature: zero
   prompts.
3. Resolved-vs-unresolved song count is honest in the toast.
4. Re-tapping a button on a show with the URL already populated
   opens the existing playlist instead of creating a duplicate.
5. The cover art renders correctly under all theme states (dark
   default; verify light too even though the app is mostly dark).

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Cover-art generation cost | Cache covers in R2 keyed by `(playlistId, version)`; regenerate only when the show set changes |
| Spotify rate limit on track resolve | Concurrency 1; 200ms interval; 100-track cap per job run |
| Synchronous resolve for un-cached tracks blocks the export request | If unresolved tracks > 5, kick off a background resolve and return the partial playlist with a "we'll add 7 more songs in a minute" toast |
| Multi-batch for jam-band setlists | Already handled with `position` parameter |
| Token expired between connection-status check and the export call | `ensureFreshUserToken` handles refresh transparently |

---

## What this phase does NOT include

- Mobile parity (Phase 10)
- Library cross-reference / fan-loyalty ring (Phase 7)
- Year-end soundtrack playlist (Phase 7)
- 30-second previews (Phase 9)
- Personal-weight chip data (Phase 7)
- The rotating-style style-guard on the Hype button — that lands
  in Phase 5 along with the classifier (SI-05 option C: ship Phase
  3 with the button visible everywhere, accept brief
  low-relevance UX for rotating-style fans in the gap).
