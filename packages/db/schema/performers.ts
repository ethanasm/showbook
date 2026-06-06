import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const performers = pgTable(
  'performers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    musicbrainzId: text('musicbrainz_id'),
    ticketmasterAttractionId: text('ticketmaster_attraction_id'),
    imageUrl: text('image_url'),
    // One of 'stable' | 'rotating' | 'theatrical' | 'improvised' | 'unknown'.
    // The "effective" style — derived from (override > computed-after-three-
    // disagreements > seed) by the nightly setlist-style-refresh cron. Null
    // means the prediction served falls back to the cold-empty-state branch.
    setlistStyle: text('setlist_style'),
    setlistStyleInferredAt: timestamp('setlist_style_inferred_at'),
    // Phase 5 — manual override (operator + future "is this artist
    // really rotating?" UI). Always wins over the auto-classifier.
    setlistStyleOverride: text('setlist_style_override'),
    // Phase 5 — last value the auto-classifier produced from corpus
    // stats. Stored alongside `setlistStyle` so the cron can decide
    // whether to flip the effective value (three-runs-to-disagree).
    computedStyle: text('computed_style'),
    // Phase 5 — three-runs-to-disagree counter. Increments each cron run
    // where the auto-classifier disagrees with a seed-table entry. At
    // ≥3 the cron flips `setlistStyle` to `computedStyle`.
    styleDisagreementCount: integer('style_disagreement_count').notNull().default(0),
    // Phase 11 (§15m) — Spotify catalog id. Populated at create time by
    // the fire-and-forget `resolvePerformerSpotifyId` hook in
    // `matchOrCreatePerformer` (so every ingest path — Add Show, scrapers,
    // discover ingest, festival lineup picker, Spotify follow import —
    // ends up filling it). The `backfill-performer-spotify-ids` cron at
    // 06:30 ET (and operator-triggered admin button) is the catch-up
    // safety net for hook failures and the pre-existing backlog. Used
    // to fetch `/v1/artists/{id}/albums` for the album-drop forward
    // signal and to render the "Open in Spotify" button on the artist
    // detail page.
    spotifyArtistId: text('spotify_artist_id'),
    // Theatre cast — Wikidata QID (e.g. "Q40281836"). Populated at create
    // time by the fire-and-forget `resolvePerformerWikidataId` hook in
    // `matchOrCreatePerformer` for cast members entered via the theatre
    // typeahead / playbill extraction (who have no Ticketmaster page), and
    // by the `backfill-performer-wikidata-ids` cron / admin button as the
    // catch-up safety net. Wikidata is the enrichment source for theatre
    // people: it provides the headshot (P18, stored to `image_url`) and,
    // when present, the MusicBrainz id (P434, stored to `musicbrainz_id`)
    // which unifies stage-and-screen performers with their concert rows.
    wikidataQid: text('wikidata_qid'),
    // Phase 11 (§15l) — dedup for the setlist-tour-watch cron. Updated
    // each time the every-3h job enqueues a corpus refresh for this
    // performer; 21h window prevents same-day repeats and respects the
    // setlist.fm rate limit.
    lastWatchRefreshAt: timestamp('last_watch_refresh_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Partial UNIQUE on the external IDs: a single TM attraction id /
    // MusicBrainz id should map to exactly one row. The IS NOT NULL
    // predicate keeps the constraint from forcing every row to fill the
    // column. matchOrCreatePerformer's catch(isUniqueViolation) branch
    // relies on these indexes to fall back to the existing row under a
    // race.
    uniqueIndex('performers_tm_attraction_uniq')
      .on(table.ticketmasterAttractionId)
      .where(sql`${table.ticketmasterAttractionId} IS NOT NULL`),
    uniqueIndex('performers_musicbrainz_uniq')
      .on(table.musicbrainzId)
      .where(sql`${table.musicbrainzId} IS NOT NULL`),
    uniqueIndex('performers_spotify_artist_uniq')
      .on(table.spotifyArtistId)
      .where(sql`${table.spotifyArtistId} IS NOT NULL`),
    uniqueIndex('performers_wikidata_uniq')
      .on(table.wikidataQid)
      .where(sql`${table.wikidataQid} IS NOT NULL`),
    index('performers_name_idx').on(table.name),
  ]
);
