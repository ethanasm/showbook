# Phase 8 — Vibe radar + energy arc

> ## ❌ STATUS: DEFERRED to v2 (2026-05-17)
>
> The SI-11 audio-features probe ran on **2026-05-17** against the
> prod app registration and returned **HTTP 403** —
> `GET /v1/audio-features/3n3Ppam7vgaVa1iaRUc9Lp` (Mr. Brightside) is
> denied. Spotify's late-2024 deprecation applied to our app.
>
> Per SI-16, Phase 8 is **dropped from v1**. AcousticBrainz is not a
> viable fallback (frozen at 2022, ~100% miss for current tours).
> Revisit when a third-party data source emerges; the probe script
> (`packages/api/scripts/probe-audio-features.ts`) and the
> `SpotifyAudioFeaturesAvailable` feature flag stay in place so a
> future operator can re-probe without redoing the plumbing.
>
> The downstream impact:
>
> - The right-rail VibeRadar + EnergyArc slots from the 2026-05-16
>   redesign render as **empty / hidden** in v1.
> - `FanLoyaltyRing` (Phase 7) is the only post-show right-rail atom.
> - Phase 10 (mobile parity) does NOT include the mobile VibeRadar /
>   EnergyArc variants.
> - The Phase 5 release gate still applies; Phase 8 metrics are not
>   gated because nothing ships.
>
> Everything below is preserved as the v2 design reference — do not
> implement against it without re-running the probe.

> **Goal (v2 only).** Add the audio-feature-driven displays — vibe
> radar, energy arc, set length to the second. **Hard-gated** on
> whether Spotify grandfathered our app's access to the deprecated
> audio-features endpoint (probed in Phase 0). If access is denied,
> Phase 8 is **dropped from v1** (SI-16) — see "The probe" below.

| Estimated effort | ~1 week (only if probe returns access) |
| Critical path? | No |
| Prerequisites | Phase 0 (probe), Phase 3 (track resolve) |
| Ships (if access granted) | `VibeRadar` + `EnergyArc` cards on web show detail; set-length inline |
| Ships (if access denied) | Nothing in v1; revisit when a third-party data source warrants. AcousticBrainz is NOT a default fallback — it's frozen at 2022 and useless for current tours. |

References:
- [`../feature-plan.md`](../feature-plan.md) §13a (deprecation),
  §13b (audio features)
- [`../music-layer.md`](../music-layer.md) #3, #4, #5

---

## The probe (runs at end of Phase 0)

A single test call:

```ts
const test = await spotifyFetch('/audio-features/3n3Ppam7vgaVa1iaRUc9Lp', accessToken);
```

Outcomes (SI-16 hard-gate):

- **200** with audio features → access intact. Phase 8 ships
  natively. Spotify is the data source for everything.
- **403** "this endpoint is no longer available for new
  applications" → access denied. **Phase 8 is dropped from v1.**
  AcousticBrainz was considered as a fallback but rejected — it's
  frozen as of 2022 and returns ~100% miss rate for songs from
  2023+, which would ship a feature that's empty for any current
  tour. Better to skip the feature entirely until a viable data
  source exists (third-party API or on-device ML; revisit in v2).
- **Other error** → log + retry; don't gate on transient failures.

The result is written to a config flag (e.g.
`spotify.audio_features_available`) that's read at job start.

If the flag is `false` when Phase 8's scheduled work begins, the
phase exits without shipping. The AcousticBrainz fallback code
paths (`packages/jobs/src/acousticbrainz-features.ts`,
`packages/api/src/acousticbrainz.ts`) from the v1 plan are NOT
built.

---

## Code

### Schema additions

```sql
ALTER TABLE songs
  ADD COLUMN spotify_audio_features jsonb;

CREATE INDEX songs_spotify_audio_features_gin
  ON songs USING gin (spotify_audio_features);

CREATE MATERIALIZED VIEW show_vibe AS
  SELECT
    s.id AS show_id,
    s.user_id,
    AVG((sng.spotify_audio_features->>'energy')::float)        AS avg_energy,
    AVG((sng.spotify_audio_features->>'valence')::float)       AS avg_valence,
    AVG((sng.spotify_audio_features->>'danceability')::float)  AS avg_danceability,
    AVG((sng.spotify_audio_features->>'acousticness')::float)  AS avg_acousticness,
    AVG((sng.spotify_audio_features->>'instrumentalness')::float) AS avg_instrumentalness,
    AVG((sng.spotify_audio_features->>'liveness')::float)      AS avg_liveness,
    AVG((sng.spotify_audio_features->>'tempo')::float)         AS avg_tempo,
    SUM((sng.spotify_audio_features->>'duration_ms')::int)     AS total_duration_ms,
    COUNT(*)                                                    AS song_count
  FROM shows s
  JOIN setlist_song_appearances a ON a.show_id = s.id
  JOIN songs sng ON sng.id = a.song_id
  WHERE sng.spotify_audio_features IS NOT NULL
  GROUP BY s.id, s.user_id;
CREATE UNIQUE INDEX show_vibe_pk ON show_vibe (show_id);
CREATE INDEX show_vibe_user_idx ON show_vibe (user_id);
```

### `packages/jobs/src/spotify-audio-features.ts` (new)

```ts
registerJob('spotify/audio-features-fill', async ({ performerId, batch = 100 }) => {
  if (!config.spotify.audio_features_available) {
    log.info({ event: 'audio_features.skip.deprecated' }, 'Skip native fetch');
    return; // AcousticBrainz fallback path runs in a separate job
  }

  const targets = await db.query.songs.findMany({
    where: and(
      eq(songs.performerId, performerId),
      isNotNull(songs.spotifyTrackId),
      isNull(songs.spotifyAudioFeatures),
      // skip the negative-cache sentinel
      ne(songs.spotifyTrackId, '__none__'),
    ),
    limit: batch,
  });

  // GET /v1/audio-features?ids=<comma-separated, max 100>
  // Cache misses with `{ unavailable: true }` sentinel.
});
```

### `packages/jobs/src/acousticbrainz-features.ts` (new — fallback)

For songs with `musicbrainz_id` set on the linked recording but no
Spotify audio features (deprecated case OR Spotify miss), fetch
from AcousticBrainz's `/api/v1/{mbid}/low-level` endpoint. Map the
returned profile to our `spotify_audio_features` shape.

Always runs (regardless of native access) for songs that don't
resolve via Spotify search.

### `packages/api/src/routers/setlist-intel.ts` (extend)

```ts
setlistIntel.showVibe({ showId })   // returns { axes, oneLineDescriptor, energyArc, totalDurationMs }
```

The one-line descriptor (`"high-energy · sad · acoustic"`) is
generated server-side by mapping the radar axes through a small
ruleset. No LLM — a 50-line decision tree handles the common
cases.

### Web UI

New components in `apps/web/components/predicted-setlist/`:

- **`VibeRadar`** — 7-axis radar chart (or simpler 4-axis if 7
  feels too busy after Claude Design's pass). Positioned between
  setlist and photos on show detail.
- **`EnergyArc`** — single-line sparkline; one dot per song in
  order; height = energy. Toggleable to valence or danceability.
- **`SetLengthInline`** — single line "1h 47m 22s on stage" in the
  show metadata strip.

Visibility:

- Renders on `state === 'past'` shows with a populated setlist AND
  ≥6 songs with audio features
- Renders an empty/coverage chip when fewer than 6 songs have
  features ("vibe coverage: 4 of 18 songs · we're still resolving")
- Hidden entirely when no songs resolve (cold-start state)

---

## Tests

### Unit

- `packages/jobs/src/__tests__/spotify-audio-features.test.ts` —
  config-flag-disabled skips; batch-size paging; sentinel cache
- `packages/jobs/src/__tests__/acousticbrainz-features.test.ts` —
  MBID lookup; mapping AcousticBrainz schema → our shape
- `packages/api/src/__tests__/show-vibe-descriptor.test.ts` —
  decision-tree mapping radar axes to one-line descriptor

### Integration

- Show vibe matview refreshes correctly when a song's features
  populate
- For a show with mixed resolved/unresolved features, vibe chip
  shows correct coverage %

### E2E (Playwright)

- `apps/web/tests/show-vibe.spec.ts` — open a past show with
  seeded features, verify radar + arc + set length all render

---

## Observability events

- `spotify.audio_features.{ok,unavailable,deprecated}`
- `acousticbrainz.fetch.{ok,no_match}`
- `show_vibe.refreshed`

---

## Exit criteria

1. Probe runs at end of Phase 0 and writes the config flag
   correctly.
2. For a test show with all songs resolved, radar renders with all
   axes; energy arc shows the song-by-song dot pattern; set length
   matches the sum of song durations to the second.
3. For a show with mixed coverage, the radar shows a coverage %.
4. AcousticBrainz fallback works for at least one verifiable song
   without Spotify access.
5. Materialized view `show_vibe` refreshes within 60s of a song's
   features being populated.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Audio-features endpoint inaccessible | Probed in Phase 0; AcousticBrainz fallback runs always |
| AcousticBrainz coverage thin for post-2022 tracks | Show "vibe coverage: 8 of 18 songs" and degrade to partial radar |
| AcousticBrainz response shape differs subtly from Spotify | Map both to a shared internal shape; document the differences in the mapping function |
| Radar chart unreadable at small phone viewports | Mobile (Phase 10) replaces with a simpler 4-axis variant or stacks bars |
| Set length wrong for jam bands (extended jams not in studio durations) | Acceptable — surface a small ⓘ near the duration: "based on studio runtime" |

---

## What this phase does NOT include

- Mobile vibe / arc displays (Phase 10)
- Genre fingerprint per user (deferred)
- Album-level audio features (use the per-track shape — sufficient)
- LLM-generated vibe one-liners (the rule-based descriptor is good
  enough for v1)
