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

## 7. UI surfaces (web)

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
| **L5** | Mobile parity (see §12). Predicted-setlist tab + Spotify export buttons in Show detail; Rare-catch + tour-debut rails on Home; iPad three-pane "Setlist" right pane. |

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

---

## 12. Mobile, tablet, and visuals

The mobile app is feature-complete and already has a working setlist
composer (`apps/mobile/app/show/[id]/setlist.tsx` — manual entry +
encore divider + setlist.fm "borrow" banner) and a Spotify integration
hook for artist-follow import. Setlist intelligence is additive.

### 12a. Show detail — phone

`apps/mobile/app/show/[id].tsx` already segments setlist content per
performer when multiple performers exist. Extend the segmented control
from `[Setlist]` to `[Setlist | Predicted | Songs]` based on state:

| Show state | Available segments |
|------------|--------------------|
| `watching` / `ticketed` | `Predicted` (default) · `Setlist` (only if user typed any) |
| `past` | `Setlist` (default) · `Songs` (per-song history & rarity) · `Predicted` (hidden by default; tap "see what we predicted" disclosure) |

- **Predicted** segment renders a new `PredictedSetlistList` component
  in `apps/mobile/components/`. Each row is a song title + a small
  horizontal probability bar (a single styled `View` with width %).
  Encore-likely songs (`encoreProb > 0.6`) show a subtle "ENCORE"
  uppercase tag (reuse the `KIND_LABELS` typography pattern).
- Empty state (corpus too small): an `EmptyState` component (already
  shipped) with the copy "Pulling recent setlists from setlist.fm…"
  and a Banner that updates when the lazy-fetch (§3a) completes.
  PullToRefresh on this segment force-runs the corpus-fill job.
- **Songs** segment lists the user's heard songs for this show,
  decorated with badges:
  - `🆕 First time` — pulled from `tourDebutsCaught`.
  - `🎯 Rare` — pulled from `rareCatches` with frequency in tooltip.
  Tap a song row → `app/song/[id].tsx` (new stack route) → song
  history page.

### 12b. New screen — Song detail

`apps/mobile/app/song/[id].tsx`:

```
┌────────────────────────────────────────┐
│ ←   The National                        │
│     "Light Years"                       │
├────────────────────────────────────────┤
│  Heard live · 3 times                   │
│                                          │
│  First                                   │
│   Sep 12, 2019  · Music Hall of W'burg  │
│  Most recent                             │
│   Mar 22, 2025  · MSG                   │
│                                          │
│  In recent setlists  · 78%               │
│                                          │
│  [▶ Spotify]                             │
│                                          │
│  Your shows where it played              │
│   • Sep 12, 2019 — Music Hall of W'burg │
│   • Aug 14, 2023 — Forest Hills Stadium │
│   • Mar 22, 2025 — MSG                  │
└────────────────────────────────────────┘
```

- Reuses `ShowCard` (compact mode) for the per-show rows.
- Spotify button uses the existing `Linking.openURL` pattern from
  the artist-import flow.

### 12c. Spotify export — phone

Two button affordances in the Show detail action sheet (the existing
`ShowActionSheet`):

- "Hype playlist on Spotify" — when state is watching/ticketed and
  Spotify is connected.
- "Save to Spotify" — when state is past and a setlist exists.

Both call the new tRPC mutations (`exportPlaylistPredicted` /
`exportPlaylistAttended`) through the existing optimistic-mutation
runner in `apps/mobile/lib/mutations/`. The mutation persists a
pending-write row first (cache schema gets a new `'spotify.export'`
mutation kind in `apps/mobile/lib/cache/outbox.ts`), so an offline
tap queues and replays on reconnect — exactly the M6.A pattern.

On success, the action sheet item becomes "Open in Spotify"
(reads `shows.spotify_playlist_url` from the cached show row).
On partial-resolve (some songs missing), a `Toast` shows
`Created — 11 of 14 songs found`.

### 12d. Home screen rails — phone

`apps/mobile/app/(tabs)/index.tsx` adds two new horizontal rails
between the existing "Now playing" and "Recent" sections:

1. **Tonight's predicted setlist** — visible only when the user has a
   `ticketed` show with `date = today`. Card shows the artist + 3
   sample songs + "Open hype playlist" CTA. A new
   `PredictedTonightCard` component.
2. **Rare catches** — collapsed-by-default rail; expanded if the user
   has ≥3 rare catches. Card chrome matches the existing
   `RecentShowsCard` so the rhythm is consistent.

Both rails read from `useCachedQuery` so they paint instantly from
the SQLite cache on cold start.

### 12e. Artist screen — phone

`apps/mobile/app/artists/[id].tsx`:

- New section **Songs you've heard live** below the existing tagged
  photos grid. Renders a `FlatList` of `(song, count)` rows using a
  new `SongCountRow` component.
- New section **Tour debuts you caught** — only when the user has any.
  Single line: `"Light Years" · Sep 12, 2019` with a tap to song
  detail (§12b).
- Pull-to-refresh runs the `setlist-corpus-fill` job for this artist
  (debounced 24h on the server side).

### 12f. iPad three-pane — setlist intelligence pane

The most opportunity-rich tablet display. When a `concert` show is
selected in the middle pane:

```
┌── iPad: Show detail (sports → §11g of sports plan; concert here) ──┐
│ Shows list      │ Show detail (concert)        │ Setlist Lab       │
│  ▌ MAR 23 MSG   │  ┌─ The National ────────┐  │  ┌─────────────┐  │
│  ▌ MAR 14 BOS   │  │ MSG · Mar 22, 2025    │  │  │ PREDICTED   │  │
│  ▌ FEB 28 PHL   │  │ Photos…               │  │  │ ████░ Bloodb│  │
│                 │  │ Setlist · 18 songs    │  │  │ ███░░ Mr Now│  │
│                 │  │  1. Bloodbuzz Ohio   │  │  │ ███░░ Light │  │
│                 │  │  2. Mr November       │  │  │ …           │  │
│                 │  │  3. Fake Empire 🆕    │  │  │             │  │
│                 │  │  …                    │  │  │ Confidence  │  │
│                 │  └────────────────────────┘  │  │  ▰▰▰▰▱ 80% │  │
│                 │                              │  └─────────────┘  │
│                 │                              │                   │
│                 │                              │  ┌─ DIFF ──────┐  │
│                 │                              │  │ vs MAR 14   │  │
│                 │                              │  │ + 3 new     │  │
│                 │                              │  │ – 2 dropped │  │
│                 │                              │  └─────────────┘  │
│                 │                              │                   │
│                 │                              │  [🎵 Spotify]    │
└─────────────────┴──────────────────────────────┴──────────────────┘
```

The right pane today shows the Map for any selected show. For
concerts, it conditionally swaps to a new **SetlistLab** pane that
shows three stacked cards:

1. **Predicted** — the recency-weighted prediction with confidence.
2. **Diff** — comparison against the *last show on this tour* the
   user attended. This is the iPad-only display the prompt asked
   about; on phone the setlist diff is buried behind a deep link, on
   iPad it's right next to the show. Single component reusable.
3. **Spotify export** — pre-show (`Hype`) or post-show
   (`What I heard`) depending on state.

Switcher at the top of the right pane: `[Map] [Setlist Lab]`
(SegmentedControl). Persists user choice per session via
`expo-secure-store`. Map remains default for non-concert kinds.

### 12g. iPad — Songs list view

A net-new tablet-only screen `apps/mobile/app/songs/index.tsx`
accessed from the Me tab. Three-pane layout:

| Left | Middle | Right |
|------|--------|-------|
| Filter rail (artist, year, rarity threshold) | Sortable table of all songs the user has heard live (title, artist, count, last heard, rarity %) | Selected song detail (§12b content) |

This is exactly the kind of "lots of rows wants a wide table" view
the prompt called out. On phone it'd be cramped; on iPad it's a
power-user dream. Implementation reuses `ThreePaneLayout`
parameterized via context, the same way Imports does in
`feature-plan-personal-data-import.md` §12d.

### 12h. Visual / design updates

New components, all with mobile + web parity:

1. **`PredictedSetlistList`** (mobile) /
   **`PredictedSetlistView`** (web design-system) — vertical list,
   each row = song title + horizontal `ProgressBar` (new shared
   primitive: a single styled `<div>` / `<View>` with theme
   `accent` fill, `rule` track). Encore tag uses the same uppercase
   typography as `KIND_LABELS`.
2. **`SongCountRow`** — reused by Songs section on Artist detail and
   the iPad table-view middle pane. Renders count as a right-aligned
   numeric block, monospaced via the existing type ramp.
3. **`SetlistDiff`** — diff component (`+` / `−` / `=` rows). New
   color tokens? No — existing `success` / `error` / `mutedFg`.
4. **`RarePill`** and **`FirstTimePill`** — small inline badges. Extend
   the existing `KindBadge` styling rather than introducing new
   chrome.
5. Spotify connect-state CTA — borrow the existing
   `apps/mobile/app/integrations/[id].tsx` integration card chrome
   so the Spotify card slots in with Gmail / Apple Music.

Color tokens: no additions. Confidence bars use `accent`. Rare-pill
uses `accent` at reduced contrast. First-time-pill uses `kindColor`
(per show kind).

Web visuals: the new "Predicted" tab on `/(app)/shows/[id]/` reuses
`HeroCard` chrome for the predicted-setlist hero (with a "Hype
playlist on Spotify" CTA in the hero's right slot). The Songs page
on web (`/(app)/songs/`) is a sortable table with a sticky filter
sidebar — same shape as the existing `/(app)/venues/` and
`/(app)/artists/` table pages, so the interaction grammar is
already learned.

Tablet web: songs page already wide-friendly; on viewport ≥1280
the right column shows the selected song's history (mirror of the
iPad-only mobile display). Single component shared between web
and `apps/mobile/app/song/[id].tsx`.

### 12i. Mobile-specific tests

- `apps/mobile/lib/__tests__/predicted-setlist.test.ts` — render-
  ready transformation of the tRPC `predictedSetlist` payload into
  the `PredictedSetlistList` row shape (probability formatting,
  encore-tag thresholds).
- `apps/mobile/lib/__tests__/spotify-export.test.ts` — outbox-aware
  mutation behavior (replay on reconnect, partial-success toast).
- Maestro flow: `e2e/flows/spotify-export.yaml` — open a past show
  with a setlist → tap "Save to Spotify" → assert toast → assert
  the action sheet item flips to "Open in Spotify".

---

## 13. Deeper Spotify API integration

The §5 plan covers **track resolution** and **playlist export** — the
floor of what Spotify can do for us. Spotify's Web API exposes a much
larger surface that's directly applicable to setlist data we already
own. This section enumerates what's worth pulling in, what new schema
each unlocks, what UI it powers, and the risks.

### 13a. Spotify API deprecation, late 2024 — read this first

In November 2024, Spotify deprecated several Web API endpoints for
**new** applications:

- `GET /audio-features/{id}` and `GET /audio-features?ids=...`
- `GET /audio-analysis/{id}`
- `GET /artists/{id}/related-artists`
- `GET /recommendations`
- `GET /recommendations/available-genre-seeds`
- `GET /browse/featured-playlists`
- algorithmic playlist endpoints

Existing applications that used these prior to the cutoff retain
access. Showbook's app registration (used for the existing
`user-follow-read` artist-import flow) **may or may not** have
grandfathered access — verify with a probe call early in §13's
schedule. Where access is unavailable, the alternatives below use
**MusicBrainz**, **Last.fm**, **ListenBrainz**, or **AcousticBrainz**
(open / community sources) as drop-ins.

This caveat applies primarily to §13b (audio features) and §13e
(related-artist graph). Everything else in §13 uses
non-deprecated, durable endpoints.

### 13b. Audio features → "show vibe" + energy arc

The single highest-value unused dataset. `audio-features` returns
seven numerical floats per track:

| Feature | Range | Loosely means |
|---------|-------|---------------|
| `energy` | 0–1 | loudness × intensity × activity |
| `danceability` | 0–1 | rhythm steadiness, tempo, beat strength |
| `valence` | 0–1 | "happiness" / positive affect |
| `acousticness` | 0–1 | confidence the track is acoustic |
| `instrumentalness` | 0–1 | confidence there are no vocals |
| `liveness` | 0–1 | presence of a live audience |
| `speechiness` | 0–1 | presence of spoken word |
| `tempo` | BPM | rounded to 1 dp |
| `key`, `mode` | 0–11, 0/1 | pitch class + major/minor |
| `loudness` | dB | average across the track |
| `duration_ms` | int | ms |

#### What it unlocks

1. **Show vibe profile** — average each feature across the songs in a
   user's setlist. Render as a radar chart on Show detail
   (`apps/web/components/charts/VibeRadar.tsx`,
   `apps/mobile/components/VibeRadar.tsx`). Auto-summary one-liner:
   `High energy · Mostly acoustic · Tour-low danceability.`

2. **Energy arc** — the song order in `setlists` jsonb is preserved.
   Plot energy/valence over time (line chart) to visualize the show's
   emotional arc. Encore peaks are visible. This is a *novel* display
   no other tracker has — the energy curve is what artists actually
   design around, and we're the only product that has the
   per-song-order data to expose it.

3. **Set length precision** — sum `duration_ms`. Show detail prints
   `1h 47m 22s on stage` instead of "12 songs."

4. **Tempo / key stats** — average BPM, dominant key (major vs minor
   ratio), tempo distribution. The Year-end soundtrack playlist
   (§13h) gets DJ-mix-style ordering by tempo curve.

5. **Genre/mood fingerprint per user** — average audio features
   weighted by listening time across all attended shows → the user's
   "concert taste profile." Powers the Brain answer to "what kind of
   shows do I usually go to?" with grounded numerics.

6. **"Why did I love that show?" Brain tool** — the
   `audio_features_for_show` Brain tool (§Brain plan §3d) returns
   the radar payload so the Brain can answer "the show was higher-
   valence and lower-energy than your average — chillest concert of
   the year."

#### Schema additions

```sql
ALTER TABLE songs
  ADD COLUMN spotify_audio_features jsonb;
  -- { energy, danceability, valence, acousticness, instrumentalness,
  --   liveness, speechiness, tempo, key, mode, loudness, duration_ms }

CREATE INDEX songs_spotify_audio_features_gin
  ON songs USING gin (spotify_audio_features);   -- for jsonb path queries

-- Optional denormalized view of per-show averages for fast display:
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

#### Job

Extend `spotify/track-resolve` (§3c) — once `songs.spotify_track_id`
is populated, batch-fetch audio features:

```ts
// packages/jobs/src/spotify-audio-features.ts
registerJob('spotify/audio-features-fill', async ({ performerId, batch = 100 }) => {
  const targets = await db.query.songs.findMany({
    where: and(
      eq(songs.performerId, performerId),
      isNotNull(songs.spotifyTrackId),
      isNull(songs.spotifyAudioFeatures),
    ),
    limit: batch,
  });
  // GET /v1/audio-features?ids=<comma-separated, max 100>
  // Cache misses with a sentinel (jsonb {"unavailable": true}) so we
  // don't retry forever for tracks whose features were stripped post-
  // deprecation.
});
```

Concurrency 1, 200ms minimum interval. Falls into the same client-
credentials token already used by `track-resolve`.

#### UI

- **Show detail — vibe section** (web + mobile + iPad). On web, a
  small radar chart sits between the setlist and the photos grid.
  On mobile, it's a card directly beneath the scoreboard/hero. On
  iPad three-pane, it's a right-pane card alongside `SetlistLab`.
- **Energy arc chart** — single horizontal sparkline, x = song
  order, y = energy (or toggleable to valence). Overlaid label
  marks the encore boundary. Renders only when ≥6 songs have
  features; otherwise the section collapses.
- **Auto-summary chip** — one-line LLM-rendered description of
  the vibe profile (cached on the row, regenerated when setlist
  changes). Uses the existing `traceLLM` wrapper.

#### Fallbacks if the audio-features endpoint isn't available

- **AcousticBrainz** (community-maintained, frozen 2022 but rich)
  matched via MusicBrainz recording IDs — we already cache MBIDs.
  Reduced coverage on newer tracks (post-2022) but acceptable.
- **Spotify track preview audio + on-device ML** — last resort:
  download the 30s preview, run a small Python (or wasm) energy/
  valence model. Heavy infra; defer indefinitely.

### 13c. Library cross-reference → fan loyalty score

User-scoped: `GET /me/tracks` (saved tracks) and
`GET /me/playlists/{id}/tracks` (playlist contents). Cross-reference
against the songs they heard live.

#### What it unlocks

- **Fan loyalty score per show**: "You had 12 of 18 songs saved
  before the show — 67% fan loyalty." Display as a ring chart on
  Show detail.
- **"Songs you discovered live"** rail: tracks the user **didn't**
  have saved but heard at the show, plus a "save to library" CTA
  per row. Spotify lets us write to the library with `PUT
  /me/tracks?ids=...`.
- **"Songs you keep hearing live but never play"** — saved-track
  appearances minus monthly play count. Brain answer fodder.

#### Schema

```sql
CREATE TABLE user_spotify_saved_tracks (
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spotify_track_id text NOT NULL,
  added_at    timestamp NOT NULL,
  fetched_at  timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, spotify_track_id)
);
CREATE INDEX user_spotify_saved_tracks_user_idx
  ON user_spotify_saved_tracks (user_id);
```

#### Job

`spotify/library-sync` runs nightly per opted-in user. Pages
through `GET /me/tracks` (50 per page, may run 20+ pages for power
users). Stores `(track_id, added_at)`. Pruned + fully-rewritten on
each run — Spotify's library is small enough that a full resync is
cheaper than diff logic.

Token: needs `user-library-read` scope. Granted on a separate
"Connect library" CTA in Preferences/Integrations — we keep the
import-only `user-follow-read` scope as the baseline so granting
extra scope is opt-in.

### 13d. Recently played + currently playing → live mode + listening peaks

`GET /me/player/recently-played` (last 50 plays, max ~24h history)
and `GET /me/player/currently-playing` (real-time).

#### What it unlocks

- **Personal-data-import "Spotify peaks" enhancement** — already in
  `feature-plan-personal-data-import.md` §7. Rolling recently-played
  is the API path; the Takeout extended-history is the historical
  path. Same logic, two windows.
- **Live mode setlist capture** (mobile only): when the user opens
  the show detail of a `ticketed` show that's currently happening
  (date == today AND now > scheduled start), surface a "track what
  I'm hearing" toggle. While on, poll `currently-playing` every 30s
  and append matched titles to a draft setlist. Caveats:
  - Only works if the user is *playing the live audio through
    Spotify*, which they generally aren't. Practical use case is
    actually the **post-show listen** — many users listen to the
    headliner on the way home; recently-played gives a clean
    signal of "what stuck."
- **Pre-show priming detection** — if the recently-played includes
  the headliner in the 4 hours before the show, infer the user
  primed and write a `prep_played: true` flag. Powers a small "you
  played 4 [artist] tracks before the show" stat on the recap card.

#### Schema

Lightweight — just timestamps on existing rows, no new table:

```sql
ALTER TABLE shows
  ADD COLUMN spotify_prep_track_count smallint,        -- count in 4h pre-show
  ADD COLUMN spotify_post_track_count smallint;        -- count in 6h post-show
```

Backfilled by a `spotify/listening-peaks-fill` job that runs once
per show as `state` transitions to `past`.

Scope: `user-read-recently-played`, `user-read-currently-playing`.

### 13e. Top tracks + related artists → predictive enhancement

`GET /artists/{id}/top-tracks?market=US` is **not** deprecated —
this is the safe Spotify-graph signal. `related-artists` IS
deprecated for new apps; alternatives below.

#### What it unlocks

- **Better predicted setlist** (§4c): blend the corpus-based
  recency-weighted prediction with each artist's Spotify top-10.
  Top tracks correlate strongly with what they actually play. New
  formula: `score = 0.7 * corpus_recent + 0.3 * top_track_rank`.
  Improves cold-start (artists whose `tour_setlists` corpus is
  empty fall back to top tracks).
- **Pre-show "Hype" playlist seeded from top tracks** when the
  predicted setlist is too short or too uncertain. Still names
  the playlist `Hype: {artist}…` — user just gets the safe-bet
  list rather than an empty one.
- **Cross-tour discovery rail** — for each followed artist, find
  artists also-followed by users who attended their shows. Approx
  via Spotify related-artists if grandfathered; via **Last.fm
  "similar" API** otherwise; via **MusicBrainz `artist-rels`** as
  the open-source backstop.

#### Schema

```sql
ALTER TABLE performers
  ADD COLUMN spotify_top_tracks jsonb,        -- [{ trackId, name, popularity }]
  ADD COLUMN spotify_top_tracks_fetched_at timestamp;
```

Refreshed monthly by `spotify/top-tracks-refresh` (per followed
artist). Cheap (1 call per artist per month, max ~5K calls/month
for a power user with 200 followed artists × 1 = manageable).

### 13f. Branded playlist cover art

`PUT /playlists/{id}/images` accepts a base64-encoded JPEG ≤256kb
and sets it as the playlist cover.

#### What it unlocks

Every Showbook-generated playlist gets a **custom cover** instead
of Spotify's default 4-quad collage:

- Hype playlist: dark editorial card with `HYPE` label, headliner,
  date, venue.
- "What I heard" playlist: same chrome with `LIVE` label.
- Year-end concert soundtrack (§13h): `2025 · LIVE` with
  attendance count.

Reuses the share-card service we'll need anyway for the future
Wrapped feature (out of scope for now, but the renderer pays for
itself across multiple use cases). For v1 we can lean on a small
Edge Function that renders an SVG → JPEG with Satori (already
common in Next.js) or a Sharp-based static generator.

#### Implementation

```ts
async function attachCover(playlistId: string, accessToken: string, jpegBytes: Buffer) {
  await spotifyFetch(`/playlists/${playlistId}/images`, accessToken, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: jpegBytes.toString('base64'),
  });
}
```

Cover image is also written to R2 alongside the show's media
(`media_assets` row with `kind='playlist_cover'`) so it survives
playlist deletion and powers the in-app playlist card.

### 13g. ISRC + album → first-class song identity

Today `songs` is keyed by `(performerId, lower(title))` — fine for
display but mushy for cross-referencing. Spotify exposes ISRC on
every track via `external_ids.isrc`, plus album metadata via
`/tracks/{id}` (which returns `album.id`, `album.release_date`,
`album.album_type`).

#### What it unlocks

- **De-duped song identity** across "Heroes (Live 2003)" /
  "Heroes - 2002 Remaster" / "Heroes" — same ISRC, same
  `songs` row.
- **Cross-platform readiness** — Apple Music and Tidal also key on
  ISRC. When/if we add those providers, `songs` already has the
  bridge.
- **Album-release context** — "you saw [artist] two weeks before
  [album] dropped" auto-rendered on Show detail. Album-release
  date is a dimension the Brain can pivot on
  (`shows_around_album_release` Brain tool).
- **Cover detection** — when a track's `album.artists[0]` doesn't
  match the headliner, mark `songs.is_cover = true` and populate
  `songs.cover_of` from the album artist. Cleaner than our manual
  text-pattern guess.

#### Schema

```sql
ALTER TABLE songs
  ADD COLUMN isrc                    text,
  ADD COLUMN spotify_album_id        text,
  ADD COLUMN spotify_album_name      text,
  ADD COLUMN spotify_album_release   date,
  ADD COLUMN spotify_album_type      text;   -- 'album' | 'single' | 'compilation'

CREATE UNIQUE INDEX songs_isrc_unique
  ON songs (isrc) WHERE isrc IS NOT NULL;
CREATE INDEX songs_album_release_idx
  ON songs (spotify_album_release DESC) WHERE spotify_album_release IS NOT NULL;
```

`spotify/track-resolve` (§3c) extends to fetch `/tracks/{id}` after
search match, capturing ISRC + album fields in one round-trip.

### 13h. Year-end "Concert soundtrack" playlist

A single user-scoped artifact: one signature track per attended
show in the year, ordered DJ-set-style by tempo + energy curve.

#### What it unlocks

- A *single click* delivers the year's emotional arc as audio.
  Differentiated from Wrapped-style slideshows because it's an
  ongoing artifact the user actually listens to.
- Stretch: "Smart shuffle" — re-order weekly using the audio-
  features tempo curve for a smoother listen.

#### Implementation

`spotify/concert-soundtrack-build` job, runs on user demand
(button on Year filter of Shows list) or weekly when the user has
≥3 new shows in the current year:

```ts
// 1. For each show this year with a setlist, pick the "signature" track:
//    - song with max (timesHeardThisYear * popularity)
//    - tie-break: latest played
// 2. Resolve each to spotify_track_id.
// 3. Order by valence ascending → energy ascending → valence descending
//    (rough DJ "warm up → peak → wind down" curve).
// 4. Create / update playlist `Showbook · 2025`.
// 5. Apply branded cover (§13f).
```

Schema: `users.spotify_year_playlists jsonb` — `{ "2025":
"playlist_id_xxx", "2024": "..." }` so re-runs idempotently
update the existing playlist.

### 13i. Followed-on-Spotify-but-not-on-Showbook → discovery rail

User-scoped: `GET /me/following?type=artist` returns who the user
follows on Spotify. Diff against `user_performer_follows`. The
remainder is "artists you care about that Showbook doesn't know
about yet."

#### What it unlocks

- **Onboarding**: at first run, offer to bulk-import every Spotify
  follow as a Showbook follow. (Already the existing
  `spotify-import` flow — extend it to include this delta on
  every run, not just first run.)
- **Discover rail**: "You follow these on Spotify — see their
  upcoming shows" with one-tap Showbook follow + Discover hit.
- **Brain context**: `spotify_only_follows` tool returns the diff
  list, so the Brain can answer "who do I follow on Spotify but
  haven't tracked here yet?"

#### Schema

No new tables — the existing `user_performer_follows` is the
source of truth, and the diff is a join at query time. Cache the
last-fetched-at on the user row to throttle to once-per-day.

### 13j. 30-second previews + Web Playback SDK → embedded playback

Most tracks expose a `preview_url` (30s MP3) on the
`/tracks/{id}` response. Free, no auth required beyond the
existing client-credentials token.

#### What it unlocks

- **Web Show detail** — tap a song row in the setlist, plays the
  30s preview inline (HTML `<audio>` element controlled from
  React). No account needed. Preview audio rendered as a small
  waveform overlay on the row using the audio file's first 1s of
  amplitude data.
- **Mobile Show detail** — same, via `expo-av` (already a
  dependency for the voice-input feature in the Brain plan).
  Tap-to-play with a small inline waveform visualization.
- **Premium users** — Web Playback SDK on web (
  `apps/web/lib/spotify-playback.ts`) lets logged-in Premium
  subscribers play *full* tracks inside Showbook, controlled
  from the show's setlist row. Skip controls, etc. Out of scope
  for v1; the 30s preview ships first.

#### Schema

```sql
ALTER TABLE songs
  ADD COLUMN spotify_preview_url text;
```

Fetched alongside ISRC/album in `spotify/track-resolve` (§3c).

### 13k. Token storage — the missing infra

Today's Spotify integration is one-shot: the OAuth callback uses
the access token in the same request and discards it. Everything
in §13c (library), §13d (recently-played + currently-playing),
§13h (year playlist), §13i (Spotify follows) requires *persistent*
user-scoped tokens with refresh handling.

#### Schema

```sql
CREATE TABLE user_spotify_tokens (
  user_id           text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token      text NOT NULL,         -- AES-encrypted at rest
  refresh_token     text NOT NULL,         -- ditto
  scope             text NOT NULL,         -- comma-joined granted scopes
  expires_at        timestamp NOT NULL,
  spotify_user_id   text NOT NULL,
  display_name      text,
  product           text,                  -- 'free' | 'premium' | 'open'
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);
```

Tokens encrypted at rest using a key from `process.env.TOKEN_KEY`
(rotate via re-encrypt job). Same pattern as Gmail tokens (which
also already need this — verify the existing implementation in
`apps/web/app/api/gmail/`).

Refresh helper:

```ts
// packages/api/src/spotify.ts
export async function ensureFreshUserToken(userId: string): Promise<string> {
  const row = await db.query.userSpotifyTokens.findFirst({
    where: eq(userSpotifyTokens.userId, userId),
  });
  if (!row) throw new Error('not_connected');
  if (row.expiresAt > new Date(Date.now() + 60_000)) return decrypt(row.accessToken);
  // POST /api/token grant_type=refresh_token
  const refreshed = await refreshSpotifyToken(decrypt(row.refreshToken));
  await db.update(userSpotifyTokens).set({
    accessToken: encrypt(refreshed.access_token),
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    updatedAt: new Date(),
  }).where(eq(userSpotifyTokens.userId, userId));
  return refreshed.access_token;
}
```

This lands in §L0 alongside the rest of §13's prerequisites.

### 13l. Scope ladder — opt-in granularity

Don't ask for everything up front. The integrations page shows
Spotify with a connected/not-connected state and a per-feature
toggle that adds the matching scope incrementally:

| Feature | Scope | Default |
|---------|-------|---------|
| Import Spotify follows (existing) | `user-follow-read` | On at first connect |
| Hype + post-show playlists | `playlist-modify-private`, `ugc-image-upload` | On at first connect |
| Library cross-reference | `user-library-read` | Off — opt in per §13c |
| Recently played peaks | `user-read-recently-played` | Off — opt in per §13d |
| Currently playing (live mode) | `user-read-currently-playing` | Off — opt in per §13d |
| Save discovered songs | `user-library-modify` | Off — gated behind a CTA |

Each toggle re-runs OAuth with the additive scope set. If a user
later denies a scope, the dependent feature gracefully degrades
with an "Enable in Spotify settings" toast. Match the existing
Gmail-scope-management pattern.

### 13m. Phased rollout (extension to §9)

| Phase | Scope |
|-------|-------|
| **L3.5** | Persistent token storage + scope ladder UI (§13k, §13l). Prerequisite for everything below. |
| **L6** | Audio features fill (§13b). Verify deprecation status with a probe call before shipping. Vibe radar + energy arc + set-length on Show detail. |
| **L7** | ISRC + album metadata (§13g). De-dup song identity. Album-release context display. |
| **L8** | Library cross-reference (§13c). Fan-loyalty ring on Show detail. |
| **L9** | Top-tracks-enhanced predicted setlist (§13e). |
| **L10** | Branded playlist covers (§13f). Year-end concert soundtrack playlist (§13h). |
| **L11** | Recently-played peaks + pre/post show counts (§13d). |
| **L12** | 30s previews inline (§13j). Premium full-playback as a stretch behind a feature flag. |

L6 onwards each runs probe-first: the deprecation status of a
given endpoint determines whether it ships natively or via the
fallback in §13b/§13e.

### 13n. Risks specific to §13

| Risk | Mitigation |
|------|-----------|
| Audio-features endpoint inaccessible (Nov 2024 deprecation) | Probe call gates the L6 schema rollout. Fall back to AcousticBrainz via cached MBIDs; reduced coverage on post-2022 tracks but acceptable. |
| Related-artists endpoint inaccessible | Use Last.fm `similar` API (free, registered) or MusicBrainz `artist-rels` as the related-artist source. |
| User scope creep — too many OAuth re-prompts | Scope ladder (§13l) — one prompt per feature, never bundled. Surface "what data this needs" copy on each toggle. |
| Token leak | Encrypt at rest; never log the access/refresh token. Pino redaction already covers `accessToken`/`refreshToken` keys; verify in serialization paths. |
| Spotify API rate limit (~180 req/min) | Concurrency 1 per token; 200ms minimum interval; per-user circuit breaker via the existing `rate-limit.ts` shared limiter. |
| ISRC drift — Spotify's ISRC for a track sometimes differs from MusicBrainz's | Don't hard-merge on ISRC alone for songs that already have a populated `songs.id`; treat ISRC as a *secondary* index. |
| 30s preview deprecation | Some tracks already have null `preview_url`; treat as graceful degradation (row hides the play button). Spotify hasn't formally deprecated, but the field has been quietly thinning since 2024. |
| Cover-art generation cost | Cache covers in R2 keyed by `(playlistId, version)`; regenerate only when the show set changes. |
