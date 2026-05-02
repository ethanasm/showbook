# Feature plan — Setlist intelligence + Spotify playlists

**Goal:** Turn the structured setlist data we already collect from
setlist.fm into something users *use*. Surface rare catches, tour
debuts, "songs heard most," predicted setlists pre-show, and one-tap
Spotify playlist generation for both pre-show prep and post-show
memory.

**Why now:** We already have `shows.setlists jsonb` with
section-aware structure (`packages/shared/src/types/setlist.ts`),
setlist.fm enrichment running nightly, and a partial Spotify
integration (`packages/api/src/spotify.ts` + the artist-import
flow). The data is on disk; the displays aren't built. This is the
highest leverage-per-line-of-code feature on the brainstorm list.

Status: not started.

---

## 1. The current data, audited

What we have:
- `shows.setlists` jsonb keyed by `performerId` →
  `{ sections: [{ kind: 'set'|'encore', name?, songs: [{ title, note? }] }] }`.
  This is the *user's* attended setlists.
- `setlist-retry` job re-fetches from setlist.fm for any past concert
  missing a setlist, ratcheting up coverage as setlist.fm submitters
  publish.
- `performers.musicbrainz_id` column populated by both TM
  `externalLinks.musicbrainz` and setlist.fm artist search — this is
  the *join key* into setlist.fm's tour data.

What we don't have:
- A persisted view of an artist's *broader* setlist history (other
  fans' setlists from setlist.fm). This is what powers "rare catch"
  and "predicted setlist" stats. Today we only fetch the user's
  specific show.
- A `Song` entity at all. Songs are free-text strings inside each
  setlist's JSON. That's fine for display, useless for "I've heard
  this song N times" stats.
- Any Spotify track resolution (we know the song *title* but not the
  Spotify URI).

The plan addresses each of these without rewriting the existing
storage.

---

## 2. New schema

### 2a. `tour_setlists` — corpus of setlists for the predicted-setlist + rarity features

Cache of setlist.fm setlists *beyond the user's own attended shows*,
scoped per artist + tour. Sourced lazily: when a user opens a watching
or recently-attended show, we fetch the last N setlists for that
artist's current tour and write them here. Also refreshed nightly for
artists with multiple followed users.

```sql
CREATE TABLE "tour_setlists" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performer_id      uuid NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  tour_name         text,                        -- e.g. "Eras Tour"; nullable when artist tags inconsistently
  performance_date  date NOT NULL,
  venue_name_raw    text,                        -- not always matchable to our venues table
  city              text,
  country_code      text,
  setlistfm_id      text NOT NULL,
  setlist           jsonb NOT NULL,              -- PerformerSetlist shape
  fetched_at        timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tour_setlists_setlistfm_unique
  ON tour_setlists (setlistfm_id);
CREATE INDEX tour_setlists_performer_date_idx
  ON tour_setlists (performer_id, performance_date DESC);
CREATE INDEX tour_setlists_performer_tour_idx
  ON tour_setlists (performer_id, tour_name, performance_date DESC);
```

Retention: prune entries older than 18 months whose performer has
zero followers and zero past-shows. Cheap to refetch from setlist.fm
if a user re-engages.

### 2b. `songs` — first-class song entity

Lightweight; not normalized perfectly (there's no point chasing
canonical title casing for live artist banter). The point is to
produce a stable ID for stats joins.

```sql
CREATE TABLE "songs" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performer_id    uuid NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  -- Display title; case-normalized via a lower index for joins.
  title           text NOT NULL,
  -- "Song" or "Cover (X)" etc., distilled when known.
  is_cover        boolean NOT NULL DEFAULT false,
  cover_of        text,                          -- "Talk Talk"
  -- Optional richer metadata after Spotify resolution (§4):
  spotify_track_id text,
  duration_ms     integer,
  -- For "tour debut" detection: earliest known appearance.
  first_known_performance date,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX songs_performer_title_idx
  ON songs (performer_id, LOWER(title));
CREATE INDEX songs_spotify_idx ON songs (spotify_track_id)
  WHERE spotify_track_id IS NOT NULL;
```

A song row is created lazily the first time a `(performer, title)`
pair shows up — either in a user's attended setlist or in a
`tour_setlists` cache fill.

### 2c. `setlist_song_appearances` — denormalized index of every song occurrence

The shape that makes stats queries cheap. One row per song-in-a-setlist
across both `shows.setlists` (attended) and `tour_setlists` (corpus).

```sql
CREATE TABLE "setlist_song_appearances" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id         uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  performer_id    uuid NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  performance_date date NOT NULL,
  -- exactly one of these is set:
  show_id         uuid REFERENCES shows(id) ON DELETE CASCADE,
  tour_setlist_id uuid REFERENCES tour_setlists(id) ON DELETE CASCADE,
  -- For order/encore stats:
  section_index   smallint NOT NULL,
  song_index      smallint NOT NULL,
  is_encore       boolean NOT NULL DEFAULT false,
  -- For "tour debut" / rarity scoring later:
  tour_name       text
);

CREATE INDEX appearances_song_date_idx
  ON setlist_song_appearances (song_id, performance_date DESC);
CREATE INDEX appearances_performer_date_idx
  ON setlist_song_appearances (performer_id, performance_date DESC);
CREATE INDEX appearances_show_idx
  ON setlist_song_appearances (show_id) WHERE show_id IS NOT NULL;
```

This denormalization is the trick that makes every stat below cheap.
The source of truth for *display* stays `shows.setlists` jsonb;
appearances is a derived index, rebuildable from scratch via a
backfill job (and *will* need a backfill — see §6).

### 2d. View: `user_song_stats`

Materialized for fast Home/Artist-page rendering.

```sql
CREATE MATERIALIZED VIEW "user_song_stats" AS
  SELECT
    s.user_id,
    a.song_id,
    a.performer_id,
    COUNT(*) AS times_heard,
    MIN(a.performance_date) AS first_heard,
    MAX(a.performance_date) AS last_heard
  FROM setlist_song_appearances a
  JOIN shows s ON s.id = a.show_id
  GROUP BY s.user_id, a.song_id, a.performer_id;

CREATE UNIQUE INDEX user_song_stats_pk
  ON user_song_stats (user_id, song_id, performer_id);
CREATE INDEX user_song_stats_user_count_idx
  ON user_song_stats (user_id, times_heard DESC);
```

Refresh strategy: `REFRESH MATERIALIZED VIEW CONCURRENTLY` after
`shows-nightly` finishes (so it picks up newly-transitioned past
shows + freshly-enriched setlists). Cheap — the entire matview is on
the order of "songs × users" rows.

---

## 3. New jobs

### 3a. `enrichment/setlist-corpus-fill`

Lazy-fills `tour_setlists` for an artist when needed.

```ts
registerJob('enrichment/setlist-corpus-fill', async ({ performerId, sinceDate }) => {
  const performer = await db.query.performers.findFirst({ where: eq(performers.id, performerId) });
  if (!performer?.musicbrainzId) {
    log.info({ event: 'corpus.fill.no_mbid', performerId }, 'Skip: no MBID');
    return;
  }
  // setlist.fm: GET /artist/{mbid}/setlists?p=<page>
  // Already wrapped in setlistfm.ts — extend to take a since-date filter
  // on the client side (the API doesn't support date filtering directly).
  const recent = await fetchRecentSetlists(performer.musicbrainzId, sinceDate, /*maxPages=*/3);
  for (const sl of recent) {
    await upsertTourSetlist({ performerId, ...sl });
  }
  log.info({
    event: 'corpus.fill.complete',
    performerId, fetched: recent.length,
  });
});
```

Triggers:
- On user follow of an artist (chain after `discover/ingest-performer`).
- On `shows-nightly` for any artist with a `watching` show in the
  next 30 days (so we have fresh data when the user opens
  show detail).
- On opening Show detail for a watching show whose performer's
  corpus is older than 24 hours (UI-triggered, debounced).

### 3b. `enrichment/song-index-rebuild` (one-shot + nightly delta)

Walks `shows.setlists` + `tour_setlists`, upserts `songs` rows,
inserts `setlist_song_appearances` rows that don't exist yet,
refreshes `user_song_stats`.

Idempotent. Can be re-run end-to-end against the full DB without
duplicating rows (uses `(performer_id, lower(title))` for songs and
`(song_id, COALESCE(show_id, tour_setlist_id), section_index, song_index)`
as a dedup key — promote that combo to a partial unique index if
back-fills get racy).

Schedule: chained after `shows-nightly` and after each
`enrichment/setlist-corpus-fill` completion.

### 3c. `spotify/track-resolve`

Resolves song titles to Spotify track URIs in batches.

```ts
registerJob('spotify/track-resolve', async ({ performerId, limit = 50 }) => {
  // Find songs for this performer with no spotify_track_id and at
  // least one appearance.
  const targets = await db.query.songs.findMany({
    where: and(eq(songs.performerId, performerId), isNull(songs.spotifyTrackId)),
    limit,
  });
  // Resolve via the Spotify search API filtered by artist:<name> track:<title>.
  // Tolerate misses; cache negative results with a dedicated null marker
  // (e.g. spotify_track_id = '__none__') to avoid re-trying every job run.
});
```

Auth: app credentials (client-credentials flow), not the user's. We
only need *catalog* lookups, not user-scoped reads here. The user-
scoped flow remains for "save playlist to your library" (§5).

Schedule: chained after `enrichment/song-index-rebuild`. Concurrency
1 per Spotify token to respect their unspecified rate limit (~180
req/min in practice).

---

## 4. tRPC procedures

```ts
// packages/api/src/routers/setlist-intel.ts
setlistIntel.songsHeardMost({ scope: 'all'|'performerId', limit }) → SongCount[]
setlistIntel.rareCatches({ scope, limit })                         → RareSong[]
setlistIntel.tourDebuts({ performerId? })                          → DebutEvent[]
setlistIntel.setlistDiff({ showIdA, showIdB })                     → SetlistDiff
setlistIntel.predictedSetlist({ performerId, showId? })            → PredictedSetlist
setlistIntel.songStats({ songId })                                 → SongHistory
setlistIntel.firstTimes({ }) → "songs you heard live for the first time" feed
```

### 4a. Songs heard most

Single matview hit:

```sql
SELECT s.title, p.name AS performer_name, st.times_heard
FROM user_song_stats st
JOIN songs s ON s.id = st.song_id
JOIN performers p ON p.id = st.performer_id
WHERE st.user_id = $1
ORDER BY st.times_heard DESC
LIMIT $2;
```

### 4b. Rare catches

For each song the user heard, compute its frequency in the broader
`tour_setlists` corpus. "Rare" = song appears in <X% of recent
setlists for that performer/tour. Surface the rarest hits per show.

```sql
WITH recent_corpus AS (
  SELECT performer_id, COUNT(DISTINCT tour_setlist_id) AS total
  FROM setlist_song_appearances
  WHERE tour_setlist_id IS NOT NULL
    AND performance_date > now() - interval '12 months'
  GROUP BY performer_id
)
SELECT
  s.title,
  perf.name,
  shows.id AS show_id,
  shows.date,
  COUNT(corpus.id)::float / NULLIF(rc.total, 0) AS frequency
FROM setlist_song_appearances mine
JOIN shows ON shows.id = mine.show_id
JOIN songs s ON s.id = mine.song_id
JOIN performers perf ON perf.id = s.performer_id
LEFT JOIN recent_corpus rc ON rc.performer_id = perf.id
LEFT JOIN setlist_song_appearances corpus
  ON corpus.song_id = s.id
 AND corpus.tour_setlist_id IS NOT NULL
 AND corpus.performance_date > now() - interval '12 months'
WHERE shows.user_id = $1
GROUP BY s.id, s.title, perf.name, shows.id, shows.date, rc.total
HAVING COUNT(corpus.id)::float / NULLIF(rc.total, 0) < 0.05
ORDER BY frequency ASC NULLS LAST, shows.date DESC
LIMIT $2;
```

Display: "🎯 Rare catch — at your show on Jul 12, [artist] played
[song] (5% of the tour)."

### 4c. Predicted setlist

Look at the last N tour setlists for the performer (default N=10),
weight by recency, build a song → probability map.

```ts
// packages/api/src/setlist-predict.ts
export async function predictSetlist(performerId: string): Promise<PredictedSetlist> {
  const recent = await db.query.tourSetlists.findMany({
    where: eq(tourSetlists.performerId, performerId),
    orderBy: desc(tourSetlists.performanceDate),
    limit: 10,
  });
  if (recent.length === 0) return { confidence: 0, songs: [] };

  // Weight: most recent show = 1.0, oldest = 0.5.
  const weights = recent.map((_, i) => 1.0 - (0.5 * i / recent.length));

  const totals = new Map<string, { sum: number; orders: number[]; encore: number }>();
  recent.forEach((sl, i) => {
    const flat = flattenWithMeta(sl.setlist);
    for (const [pos, song] of flat.entries()) {
      const existing = totals.get(song.title) ?? { sum: 0, orders: [], encore: 0 };
      existing.sum += weights[i];
      existing.orders.push(pos);
      if (song.isEncore) existing.encore += weights[i];
      totals.set(song.title, existing);
    }
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const songs = [...totals.entries()]
    .map(([title, t]) => ({
      title,
      probability: t.sum / totalWeight,
      avgOrder: t.orders.reduce((a, b) => a + b, 0) / t.orders.length,
      encoreProb: t.encore / t.sum,
    }))
    .filter(s => s.probability >= 0.4)        // 40%+ inclusion bar
    .sort((a, b) => a.avgOrder - b.avgOrder); // average ordering

  return {
    confidence: Math.min(1, recent.length / 6),
    sampleSize: recent.length,
    songs,
  };
}
```

Display rules:
- `confidence < 0.3` (fewer than ~2 setlists in the corpus) → "not
  enough data yet" empty state.
- Otherwise: ordered list with confidence bars per song; an "encore"
  pill on songs whose `encoreProb > 0.6`.

### 4d. Setlist diff

Two-show diff for the same artist:

```
Both shows played:
  · Reckoner
  · Lucky
  · Idioteque

Only at MSG (Jul 12):
  · True Love Waits
  · Daydreaming

Only at Boston (Jul 14):
  · Pyramid Song
  · Talk Show Host
```

Pure JSON diff, no DB work needed beyond loading the two `shows.setlists`.

### 4e. Tour debuts

Songs whose `setlist_song_appearances.performance_date` minimum *is*
the user's attended show.

```sql
SELECT s.title, p.name, sh.id AS show_id, sh.date
FROM songs s
JOIN performers p ON p.id = s.performer_id
JOIN setlist_song_appearances first
  ON first.song_id = s.id
 AND first.performance_date = (
       SELECT MIN(a2.performance_date)
       FROM setlist_song_appearances a2
       WHERE a2.song_id = s.id
   )
JOIN shows sh ON sh.id = first.show_id
WHERE sh.user_id = $1
ORDER BY sh.date DESC
LIMIT 50;
```

Display: "🆕 You saw the tour debut of [song] on [date]."

---

## 5. Spotify integration

Two distinct flows. Both build on the existing
`packages/api/src/spotify.ts` client and OAuth scaffolding
(`apps/web/app/api/spotify/`).

### 5a. App-level catalog resolution (no user scope)
- `clientCredentials` token cached for ~1h; refreshed on miss.
- Used only by `spotify/track-resolve` job (§3c) to populate
  `songs.spotify_track_id`.
- `GET /search?q=artist:"<name>" track:"<title>"&type=track&limit=5`,
  pick the top result whose artist name fuzzy-matches.

### 5b. User-scoped playlist creation

Two button affordances:

#### Pre-show — "Hype playlist"
- Lives on Show detail for any show with `state in ('watching','ticketed')`
  and `kind='concert'`.
- Builds: predicted setlist (§4c) → resolve to Spotify URIs from
  `songs` table (skip songs without a URI; show "X songs unmatched")
  → create user playlist named `Hype: {artist} — {date} @ {venue}`
  → return playlist URL.

#### Post-show — "What I heard"
- Lives on Show detail for any show with `state='past'` AND a
  populated `setlists`.
- Builds: flatten user's attended setlist for the headliner →
  resolve to Spotify URIs → create user playlist named `Live: {artist}
  — {date} @ {venue}`.

Both routes:

```ts
// packages/api/src/routers/setlist-intel.ts
setlistIntel.exportPlaylistPredicted({ showId, performerId })
setlistIntel.exportPlaylistAttended({ showId, performerId })
```

Implementation:

```ts
async function exportPlaylist(input: { titles: string[]; name: string; userId: string }) {
  const access = await ensureFreshUserToken(input.userId);  // existing helper
  const me = await spotifyFetch('/me', access);
  const playlist = await spotifyFetch(`/users/${me.id}/playlists`, access, {
    method: 'POST',
    body: JSON.stringify({ name: input.name, public: false, description: 'Showbook' }),
  });
  // Resolve titles → URIs in batches of 50 via songs.spotify_track_id.
  // Drop unresolved with a logged warning + UI message.
  await spotifyFetch(`/playlists/${playlist.id}/tracks`, access, {
    method: 'POST',
    body: JSON.stringify({ uris: resolvedUris.slice(0, 100) }),
  });
  return { playlistUrl: playlist.external_urls.spotify, missing: titles.length - resolvedUris.length };
}
```

Edge case: setlists are often longer than 100 tracks for jam bands;
handle multi-batch additions with the `position` parameter.

### 5c. UI affordances

Show detail, headliner section gets two new buttons (only when the
user's Spotify is connected; otherwise a "Connect Spotify" CTA):

```
[Predicted setlist ▾]   [🎵 Hype playlist on Spotify]   [Edit setlist]

   ─ once past ─
[Setlist (12 songs) ▾]  [🎵 Save to Spotify]            [Edit setlist]
```

After click: optimistic toast → on success "Opened in Spotify", URL
also stored on the show as `spotifyPlaylistUrl` so re-clicks
short-circuit.

Add a column:

```sql
ALTER TABLE shows ADD COLUMN spotify_playlist_url text;
```

---

## 6. Backfill plan

The schema changes (§2) require a one-time data backfill of every
existing `shows.setlists` jsonb into the new `songs` +
`setlist_song_appearances` tables.

```ts
// scripts/backfill-song-index.ts
async function main() {
  const userShows = await db.query.shows.findMany({
    where: isNotNull(shows.setlists),
    columns: { id: true, userId: true, date: true, setlists: true },
  });
  for (const show of userShows) {
    const map = normalizePerformerSetlistsMap(show.setlists);
    for (const [performerId, setlist] of Object.entries(map)) {
      await indexSetlist({
        performerId,
        date: show.date,
        showId: show.id,
        setlist,
      });
    }
  }
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY user_song_stats`);
}
```

Run once via `pnpm --filter @showbook/jobs tsx scripts/backfill-song-index.ts`;
then `enrichment/song-index-rebuild` keeps it current.

The same script is used for `tour_setlists` once that's populated by
the corpus-fill job.

---

## 7. UI surfaces (web; mobile mirrors in M2/M5)

### 7a. Show detail
- New tab in the existing setlist section: **Predicted** (only on
  watching/ticketed). Shows the predicted setlist with confidence
  bars and an "Open hype playlist" button.
- Existing **Setlist** tab gets two enhancements when state='past':
  - 🆕 / 🎯 badges next to songs that are first-times / rare catches
    for this user.
  - "Save to Spotify" button.
- New tab **History** for any single song (click-through):
  - "First time you heard it: Jul 12, 2024 at MSG"
  - "Times heard: 4"
  - Mini-timeline of every show.

### 7b. Artist detail
- New section: **Songs you've heard live**, ordered by frequency.
- New section: **Tour debuts you caught**, conditional on having any.
- Existing artist stats grow a "% of recent setlist" tile when corpus
  data exists.

### 7c. Home
- New rail: **Set lists you saw first** — feed of tour-debut catches.
- New rail (only when present): **Tonight's predicted setlist** — for
  any ticketed show today; one-tap into hype playlist.

### 7d. Year-in-Review (Wrapped) hooks
- Out of scope per the user's instruction, but the schema here is the
  foundation. When/if Wrapped ships, "songs heard most," "rarest
  catch of the year," "first time hearing X" all come for free.

---

## 8. Tests

- Unit:
  - `setlist-predict.predictSetlist` — synthetic corpus arrays;
    weight monotonicity; confidence falls below 0.3 with <2 setlists.
  - `setlist-corpus-fill` normalizer — setlist.fm response fixture
    → expected `tour_setlists` row.
  - `song-index` upsert idempotency: running the indexer twice on the
    same setlist produces zero duplicates.
- Integration:
  - End-to-end `setlistIntel.songsHeardMost` against a seeded user
    with 4 shows / 3 artists / overlapping titles.
  - `setlistIntel.exportPlaylistAttended` with a mock Spotify
    fetch — verify multi-batch behavior on a 150-song setlist.
- E2E:
  - Open Show detail with a populated setlist → click "Save to
    Spotify" → toast appears → button flips to "Open in Spotify."
  - Predicted setlist tab shows the empty state when corpus is empty,
    and a list with bars when corpus has 5+ entries.

---

## 9. Phased rollout

| Phase | Scope |
|-------|-------|
| **L0** | Schema migrations (§2), `song-index-rebuild` job, one-time backfill script. No UI yet. Verify the matview hits perf targets on prod-shaped seed data. |
| **L1** | "Songs heard most" + "Tour debuts" + "First times" tRPC + Home/Artist UI. All read-side; pure leverage on §L0 data. |
| **L2** | `tour_setlists` + `enrichment/setlist-corpus-fill` job + "Predicted setlist" tab + "Rare catches" rail. |
| **L3** | Spotify track resolver job (§3c) + "Save to Spotify" / "Hype playlist" flows. Per-show `spotifyPlaylistUrl` column. |
| **L4** | Setlist diff UI + per-song `History` page. |
| **L5** | Mobile parity (carries naturally once M2 ships Show detail). |

---

## 10. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Setlist.fm titles are inconsistently capitalized / contain extra notes ("Wonderwall (acoustic)") | Match by `LOWER(stripped(title))` for the song-key; preserve original in the `songs.title` for display. Cover/abbreviation rules deliberately *not* implemented in v1 — wait until users complain. |
| Spotify rate limits during corpus resolve | One token, concurrency=1, 200ms minimum interval (mirrors Gmail client). Cache negative results with sentinel (`'__none__'`). |
| `tour_setlists` could grow unbounded | 18-month prune + opportunistic fetch (only on user demand) bounds it to active artists. Estimated 50k artists × 30 setlists × 5 KB = 7.5 GB worst case; acceptable. |
| Predicted setlist shown for a tour we don't have data on | Confidence < 0.3 → empty state with "we'll pull more setlists in the next 24 hours" copy + queue an immediate corpus-fill job. |
| User listens to predicted playlist and *that* spoils the show | Default to a "blur song titles" toggle on the predicted view; prominent "show me anyway" CTA. Defer if user research disagrees. |
| Existing `shows.setlists` jsonb is the source of truth — backfill failures could lose user data | Indexer is read-only on `shows.setlists`. Worst case is a stale matview + fix-forward by re-running the indexer. |

---

## 11. Open questions

1. Do we promote `Song` to a `MusicBrainz`-anchored entity (so "Heroes"
   counts the same whether sung by Bowie or Bruce)? Probably not in
   v1; per-performer titles are the unit users intuit.
2. Is the predicted setlist a tab on Show detail or a dedicated
   "pre-show" page (§3n in the brainstorm)? Start as a tab; promote
   to its own page only if we layer in weather/transit/community-tips.
3. Apple Music + Tidal parity? Same shape as Spotify; trivial second
   provider once the schema (`song.<provider>_track_id`) is in place.
   Defer to L4+.
