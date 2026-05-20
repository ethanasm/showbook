/**
 * Song-index-rebuild — walks `shows.setlists` (attended) plus
 * `tour_setlists` (corpus) for a scope, upserts into `songs`, and rebuilds
 * the rows in `setlist_song_appearances` so the §4c algorithm and
 * Phase 2's "songs you've heard most" can read denormalized appearances
 * without re-parsing the setlist JSON.
 *
 * Lives in `@showbook/api` (not `@showbook/jobs`) so the tRPC routers
 * can call it inline on every attended-setlist write without a
 * circular dependency. `@showbook/jobs` re-exports `runSongIndexRebuild`
 * for back-compat with callers that imported it from there.
 *
 * Idempotent by construction: for each source setlist we DELETE the
 * appearances tied to that source and re-INSERT from scratch. Running
 * the indexer twice over the same scope leaves the same rows in the
 * appearances table.
 *
 * Scope variants:
 *   - `{ performerId: '…' }`        — rebuild all sources for one performer.
 *   - `{ showIds: [...] }`          — rebuild only those attended shows.
 *   - `{ tourSetlistIds: [...] }`   — rebuild only those corpus rows.
 *   - `{}`                          — full DB rebuild (for the one-time
 *                                     backfill script and CI integration).
 *
 * After insertion the matview `user_song_stats` is refreshed
 * `CONCURRENTLY` (the unique index on `(user_id, song_id, performer_id)`
 * unlocks the concurrent refresh path — it does not block readers).
 */

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { child } from '@showbook/observability';
import {
  db,
  setlistSongAppearances,
  shows,
  songs,
  tourSetlists,
} from '@showbook/db';
import {
  normalizePerformerSetlistsMap,
  type PerformerSetlist,
  type PerformerSetlistsMap,
} from '@showbook/shared';

const log = child({ component: 'jobs.song-index-rebuild' });

export interface SongIndexRebuildScope {
  performerId?: string;
  showIds?: string[];
  tourSetlistIds?: string[];
  /**
   * When true, the matview refresh is skipped — useful when the caller is
   * about to chain multiple rebuilds and prefers to refresh once at the
   * end. Default false.
   */
  skipMatviewRefresh?: boolean;
}

export interface SongIndexRebuildResult {
  showsProcessed: number;
  tourSetlistsProcessed: number;
  songsUpserted: number;
  appearancesInserted: number;
  matviewRefreshed: boolean;
}

interface AttendedSource {
  kind: 'attended';
  showId: string;
  performerId: string;
  performanceDate: string;
  tourId: string | null;
  tourName: string | null;
  setlist: PerformerSetlist;
}

interface CorpusSource {
  kind: 'corpus';
  tourSetlistId: string;
  performerId: string;
  performanceDate: string;
  tourId: string | null;
  tourName: string | null;
  setlist: PerformerSetlist;
}

type Source = AttendedSource | CorpusSource;

/**
 * Pure helper — derive a row's role from its `(sectionIndex, songIndex,
 * isEncore)` inside the whole setlist. Exported so the unit tests can
 * exercise role assignment in isolation.
 */
export function deriveRole(opts: {
  sectionIndex: number;
  songIndex: number;
  sectionCount: number;
  songsInSection: number;
  isEncore: boolean;
  hasEncore: boolean;
}): 'opener' | 'closer' | 'encore_open' | 'encore_close' | 'core' {
  const { sectionIndex, songIndex, sectionCount, songsInSection, isEncore, hasEncore } = opts;
  if (isEncore) {
    if (songIndex === 0) return 'encore_open';
    if (songIndex === songsInSection - 1) return 'encore_close';
    return 'core';
  }
  // Opener = first song of the first non-encore section. This is always
  // (sectionIndex === 0, songIndex === 0) since the encore is by spec
  // the last section (a setlist with no main set + encore-only is
  // pathological and treats the encore as core).
  if (sectionIndex === 0 && songIndex === 0) return 'opener';
  // Closer = last song of the last non-encore section. When there is an
  // encore, that's the section before it; otherwise the last section
  // overall.
  const lastMainSectionIndex = hasEncore ? sectionCount - 2 : sectionCount - 1;
  if (
    sectionIndex === lastMainSectionIndex &&
    songIndex === songsInSection - 1 &&
    lastMainSectionIndex >= 0
  ) {
    return 'closer';
  }
  return 'core';
}

interface AppearanceRow {
  songId: string;
  performerId: string;
  performanceDate: string;
  showId: string | null;
  tourSetlistId: string | null;
  sectionIndex: number;
  songIndex: number;
  isEncore: boolean;
  role: 'opener' | 'closer' | 'encore_open' | 'encore_close' | 'core';
  tourId: string | null;
  tourName: string | null;
}

/**
 * Upsert a song row keyed by `(performer_id, LOWER(title))` and return
 * the song id. We trim trailing whitespace defensively because
 * setlist.fm payloads occasionally carry trailing newlines on titles.
 */
async function ensureSongId(performerId: string, title: string): Promise<string> {
  const cleaned = title.trim();
  if (cleaned.length === 0) {
    throw new Error('ensureSongId: title is empty after trim');
  }
  const [existing] = await db
    .select({ id: songs.id })
    .from(songs)
    .where(
      and(
        eq(songs.performerId, performerId),
        sql`LOWER(${songs.title}) = LOWER(${cleaned})`,
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [inserted] = await db
    .insert(songs)
    .values({ performerId, title: cleaned })
    .onConflictDoNothing()
    .returning({ id: songs.id });
  if (inserted) return inserted.id;

  // Race: a concurrent indexer inserted the row between our select and
  // our insert. Re-select once to recover.
  const [recovered] = await db
    .select({ id: songs.id })
    .from(songs)
    .where(
      and(
        eq(songs.performerId, performerId),
        sql`LOWER(${songs.title}) = LOWER(${cleaned})`,
      ),
    )
    .limit(1);
  if (!recovered) {
    throw new Error(
      `ensureSongId: could not resolve song id for "${cleaned}" after race recovery`,
    );
  }
  return recovered.id;
}

function rowsForSetlist(source: Source): {
  rows: AppearanceRow[];
  titlesByPerformer: Map<string, string[]>;
} {
  const titles: string[] = [];
  const sections = source.setlist.sections;
  const sectionCount = sections.length;
  const hasEncore = sections.some((s) => s.kind === 'encore');
  const rows: AppearanceRow[] = [];

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const section = sections[sIdx]!;
    const isEncore = section.kind === 'encore';
    for (let songIdx = 0; songIdx < section.songs.length; songIdx++) {
      const song = section.songs[songIdx]!;
      titles.push(song.title);
      const role = deriveRole({
        sectionIndex: sIdx,
        songIndex: songIdx,
        sectionCount,
        songsInSection: section.songs.length,
        isEncore,
        hasEncore,
      });
      rows.push({
        // songId is filled in later when we resolve titles → song ids.
        songId: '',
        performerId: source.performerId,
        performanceDate: source.performanceDate,
        showId: source.kind === 'attended' ? source.showId : null,
        tourSetlistId: source.kind === 'corpus' ? source.tourSetlistId : null,
        sectionIndex: sIdx,
        songIndex: songIdx,
        isEncore,
        role,
        tourId: source.tourId,
        tourName: source.tourName,
      });
    }
  }
  const titlesByPerformer = new Map<string, string[]>();
  titlesByPerformer.set(source.performerId, titles);
  return { rows, titlesByPerformer };
}

async function loadAttendedSources(scope: SongIndexRebuildScope): Promise<AttendedSource[]> {
  const conditions = [isNotNull(shows.setlists)];
  if (scope.performerId) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM show_performers sp
        WHERE sp.show_id = ${shows.id}
          AND sp.performer_id = ${scope.performerId}
      )`,
    );
  }
  if (scope.showIds && scope.showIds.length > 0) {
    conditions.push(inArray(shows.id, scope.showIds));
  }
  const rows = await db
    .select({
      id: shows.id,
      date: shows.date,
      setlists: shows.setlists,
      tourName: shows.tourName,
    })
    .from(shows)
    .where(and(...conditions));

  const out: AttendedSource[] = [];
  for (const row of rows) {
    if (!row.date) continue;
    const normalized: PerformerSetlistsMap = normalizePerformerSetlistsMap(row.setlists);
    for (const [performerId, setlist] of Object.entries(normalized)) {
      // performerId filter — when the scope is performer-bounded, skip
      // sibling support acts on the same show row.
      if (scope.performerId && performerId !== scope.performerId) continue;
      if (setlist.sections.length === 0) continue;
      out.push({
        kind: 'attended',
        showId: row.id,
        performerId,
        performanceDate: row.date,
        tourId: null, // attended shows don't carry a synthesized tour_id
        tourName: row.tourName ?? null,
        setlist,
      });
    }
  }
  return out;
}

async function loadCorpusSources(scope: SongIndexRebuildScope): Promise<CorpusSource[]> {
  const conditions = [] as ReturnType<typeof eq>[];
  if (scope.performerId) {
    conditions.push(eq(tourSetlists.performerId, scope.performerId));
  }
  if (scope.tourSetlistIds && scope.tourSetlistIds.length > 0) {
    conditions.push(inArray(tourSetlists.id, scope.tourSetlistIds));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select({
      id: tourSetlists.id,
      performerId: tourSetlists.performerId,
      performanceDate: tourSetlists.performanceDate,
      tourId: tourSetlists.tourId,
      tourName: tourSetlists.tourName,
      setlist: tourSetlists.setlist,
    })
    .from(tourSetlists)
    .where(where ?? sql`true`);

  const out: CorpusSource[] = [];
  for (const row of rows) {
    if (!row.setlist?.sections || row.setlist.sections.length === 0) continue;
    out.push({
      kind: 'corpus',
      tourSetlistId: row.id,
      performerId: row.performerId,
      performanceDate: row.performanceDate,
      tourId: row.tourId,
      tourName: row.tourName,
      setlist: row.setlist as PerformerSetlist,
    });
  }
  return out;
}

/**
 * Idempotent re-build of `setlist_song_appearances` (and the upserted
 * `songs` rows that anchor them) for the given scope. The `songs`
 * `historical_play_count` + `last_played_date` columns are refreshed
 * from the appearances table after re-insert.
 */
export async function runSongIndexRebuild(
  scope: SongIndexRebuildScope = {},
): Promise<SongIndexRebuildResult> {
  const startedAt = Date.now();
  try {
    const attendedSources = await loadAttendedSources(scope);
    const corpusSources = await loadCorpusSources(scope);

    // For each scope, the source rows we're about to re-insert define
    // exactly which appearances we should delete first. The DELETE step
    // is what guarantees idempotency without a unique constraint on
    // `setlist_song_appearances`.
    //
    // For `{ showIds }`-scoped rebuilds we deliberately union the
    // caller's show ids with the observed-attended ids: if a show's
    // `setlists` JSONB was wiped (the user removed the last performer
    // setlist), `loadAttendedSources` skips the row (the
    // `isNotNull(shows.setlists)` filter) and a delete-by-observed
    // strategy would leak stale appearances. The union deletes by the
    // caller's intent — "make this show's appearances reflect its
    // current setlists, even if that's nothing".
    const attendedShowIds = new Set(attendedSources.map((s) => s.showId));
    if (scope.showIds) {
      for (const id of scope.showIds) attendedShowIds.add(id);
    }
    const corpusSetlistIds = new Set(corpusSources.map((s) => s.tourSetlistId));

    // A `performerId`-scoped rebuild needs to also clear any attendees-
    // bound appearances for shows in this batch that don't have a current
    // setlists.* entry for this performer (the setlist may have been
    // wiped). For the simpler implementation we delete by
    // `(performerId, source-id)` for both sides — anything not re-inserted
    // simply disappears, which is the correct behaviour.
    if (scope.performerId || scope.showIds || scope.tourSetlistIds) {
      if (attendedShowIds.size > 0) {
        await db
          .delete(setlistSongAppearances)
          .where(
            and(
              inArray(setlistSongAppearances.showId, [...attendedShowIds]),
              scope.performerId
                ? eq(setlistSongAppearances.performerId, scope.performerId)
                : sql`true`,
            ),
          );
      }
      if (corpusSetlistIds.size > 0) {
        await db
          .delete(setlistSongAppearances)
          .where(
            and(
              inArray(setlistSongAppearances.tourSetlistId, [...corpusSetlistIds]),
              scope.performerId
                ? eq(setlistSongAppearances.performerId, scope.performerId)
                : sql`true`,
            ),
          );
      }
      // Performer-scoped path: also clean orphan rows tied to corpus
      // sources we didn't observe (e.g. if a tour_setlist row was
      // physically deleted but we never indexed the removal). Cheap
      // single statement.
      if (scope.performerId) {
        await db.delete(setlistSongAppearances).where(
          and(
            eq(setlistSongAppearances.performerId, scope.performerId),
            // Orphans = pointed at a tour_setlist that no longer exists.
            sql`(
              ${setlistSongAppearances.tourSetlistId} IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM ${tourSetlists}
                WHERE ${tourSetlists.id} = ${setlistSongAppearances.tourSetlistId}
              )
            )`,
          ),
        );
      }
    } else {
      // Full rebuild — wipe everything before re-inserting.
      await db.delete(setlistSongAppearances);
    }

    let songsUpserted = 0;
    let appearancesInserted = 0;
    const seenSongIds = new Set<string>();

    async function processOne(source: Source): Promise<void> {
      const { rows } = rowsForSetlist(source);
      if (rows.length === 0) return;
      const ids = await Promise.all(
        rows.map(async (row, idx) => {
          // Use the source's setlist to look up the title for this row
          // index. rowsForSetlist preserves order so we can index directly.
          const sections = source.setlist.sections;
          let walked = 0;
          for (const section of sections) {
            if (idx - walked < section.songs.length) {
              const title = section.songs[idx - walked]!.title;
              return ensureSongId(row.performerId, title);
            }
            walked += section.songs.length;
          }
          throw new Error('processOne: index out of range');
        }),
      );
      for (let i = 0; i < rows.length; i++) {
        const songId = ids[i]!;
        rows[i]!.songId = songId;
        if (!seenSongIds.has(songId)) {
          seenSongIds.add(songId);
          songsUpserted += 1;
        }
      }
      const inserted = await db
        .insert(setlistSongAppearances)
        .values(rows)
        .returning({ id: setlistSongAppearances.id });
      appearancesInserted += inserted.length;
    }

    for (const source of attendedSources) await processOne(source);
    for (const source of corpusSources) await processOne(source);

    // Refresh `songs` aggregate columns so the gap-based prediction in
    // Phase 5 has data to read. We update `historical_play_count` and
    // `last_played_date` for every song we touched; rest is left null
    // until that phase.
    if (seenSongIds.size > 0) {
      await db.execute(sql`
        UPDATE songs s
        SET
          historical_play_count = aggregated.play_count,
          last_played_date = aggregated.last_date,
          first_known_performance = COALESCE(
            s.first_known_performance,
            aggregated.first_date
          )
        FROM (
          SELECT
            song_id,
            COUNT(*)::int AS play_count,
            MIN(performance_date) AS first_date,
            MAX(performance_date) AS last_date
          FROM setlist_song_appearances
          WHERE song_id = ANY(${sql.raw(`ARRAY[${[...seenSongIds].map((id) => `'${id}'`).join(',')}]::uuid[]`)})
          GROUP BY song_id
        ) aggregated
        WHERE s.id = aggregated.song_id
      `);
    }

    let matviewRefreshed = false;
    if (!scope.skipMatviewRefresh) {
      try {
        await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY user_song_stats`);
        matviewRefreshed = true;
      } catch (err) {
        // Concurrent refresh fails on a brand-new matview that has never
        // been populated; fall back to a non-concurrent refresh.
        log.warn(
          { event: 'setlist.song_index.partial', err },
          'concurrent matview refresh failed, retrying non-concurrent',
        );
        await db.execute(sql`REFRESH MATERIALIZED VIEW user_song_stats`);
        matviewRefreshed = true;
      }
    }

    log.info(
      {
        event: 'setlist.song_index.built',
        showsProcessed: attendedSources.length,
        tourSetlistsProcessed: corpusSources.length,
        songsUpserted,
        appearancesInserted,
        matviewRefreshed,
        durationMs: Date.now() - startedAt,
        scope: {
          performerId: scope.performerId ?? null,
          showIds: scope.showIds?.length ?? 0,
          tourSetlistIds: scope.tourSetlistIds?.length ?? 0,
        },
      },
      'Song index rebuild complete',
    );
    return {
      showsProcessed: attendedSources.length,
      tourSetlistsProcessed: corpusSources.length,
      songsUpserted,
      appearancesInserted,
      matviewRefreshed,
    };
  } catch (err) {
    log.error(
      {
        event: 'setlist.song_index.failed',
        err,
        durationMs: Date.now() - startedAt,
      },
      'Song index rebuild failed',
    );
    throw err;
  }
}

// Re-export so the registry can chain a song-index rebuild after each
// corpus-fill completes without pulling jobs internals.
export type { Source as _SongIndexSource };
