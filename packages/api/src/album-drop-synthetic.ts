/**
 * Phase 11 (§15m) — album-drop forward signal.
 *
 * When the target date sits within ±60 days of an album release, we
 * synthesize a CorpusRow per album containing the album's new
 * tracks. Synthetic rows flow into `loadCorpusForPrediction`'s
 * output alongside real `tour_setlists`, and `bucketTiers` /
 * `aggregate` treat them as Tier-A in position but with a capped
 * weight (0.3 vs Tier-A's natural 1.0).
 *
 * Only tracks NOT already in the existing corpus get synthesized —
 * once a song appears in a real setlist, the real evidence
 * supersedes the synthetic seed and the "expected from new album"
 * evidence string is replaced by the standard "N of last M shows".
 *
 * Worked example: Sabrina Carpenter, Short n' Sweet Tour, album
 * "Man's Best Friend" released 2025-10-23 with tracks
 * Manchild / House Tour / Tears. A prediction for 2025-10-25 with
 * a corpus that has no occurrences of those tracks gets three
 * synthetic rows boosting them to ~0.3 probability.
 */

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { albums, songs } from '@showbook/db';
import { child } from '@showbook/observability';
import type { CorpusRow } from './setlist-predict';

const log = child({ component: 'api.album-drop-synthetic' });

const MS_PER_DAY = 86_400_000;
const ALBUM_DROP_WINDOW_DAYS = 60;

interface SynthesizeOpts {
  performerId: string;
  targetDate: string; // YYYY-MM-DD
  existingCorpus: CorpusRow[];
  /** Drizzle transaction handle from `loadCorpusForPrediction`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: PgTransaction<any, any, any>;
}

/**
 * Build synthetic CorpusRow entries for new-album tracks that aren't
 * already represented in the existing corpus.
 */
export async function synthesizeAlbumDropRows(
  opts: SynthesizeOpts,
): Promise<CorpusRow[]> {
  const target = new Date(`${opts.targetDate}T00:00:00Z`);
  const windowStart = new Date(target.getTime() - ALBUM_DROP_WINDOW_DAYS * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const windowEnd = new Date(target.getTime() + ALBUM_DROP_WINDOW_DAYS * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

  const albumRows = await opts.tx
    .select({
      id: albums.id,
      name: albums.name,
      releaseDate: albums.releaseDate,
      trackIds: albums.trackIds,
    })
    .from(albums)
    .where(
      and(
        eq(albums.performerId, opts.performerId),
        gte(albums.releaseDate, windowStart),
        lte(albums.releaseDate, windowEnd),
      ),
    );

  if (albumRows.length === 0) return [];

  // Collect every album track id across the window so we can resolve
  // them in a single query.
  const trackIdSet = new Set<string>();
  for (const a of albumRows) {
    for (const id of a.trackIds) trackIdSet.add(id);
  }
  if (trackIdSet.size === 0) return [];

  const trackRows = await opts.tx
    .select({
      title: songs.title,
      spotifyTrackId: songs.spotifyTrackId,
    })
    .from(songs)
    .where(
      and(
        eq(songs.performerId, opts.performerId),
        sql`${songs.spotifyTrackId} = ANY(${Array.from(trackIdSet)})`,
      ),
    );

  const titleByTrackId = new Map<string, string>();
  for (const r of trackRows) {
    if (r.spotifyTrackId) titleByTrackId.set(r.spotifyTrackId, r.title);
  }

  // Existing corpus song titles (lower-cased) — synthetic seed only
  // includes tracks NOT already present.
  const corpusTitles = new Set<string>();
  for (const row of opts.existingCorpus) {
    for (const section of row.setlist.sections) {
      for (const song of section.songs) {
        corpusTitles.add(song.title.trim().toLowerCase());
      }
    }
  }

  const synthetic: CorpusRow[] = [];
  for (const album of albumRows) {
    const newTitles: string[] = [];
    for (const trackId of album.trackIds) {
      const title = titleByTrackId.get(trackId);
      if (!title) continue;
      const lower = title.trim().toLowerCase();
      if (corpusTitles.has(lower)) continue;
      newTitles.push(title);
    }
    if (newTitles.length === 0) continue;

    synthetic.push({
      id: `synthetic-album:${album.id}`,
      performerId: opts.performerId,
      // Performance date = album release so distance-from-target lands
      // it in Tier-A range when the prediction target is inside the
      // ±60-day window.
      performanceDate: album.releaseDate,
      tourId: null,
      tourName: null,
      setlist: {
        sections: [
          {
            kind: 'set',
            songs: newTitles.map((title) => ({ title })),
          },
        ],
      },
      songCount: newTitles.length,
      fetchedAt: new Date(),
      venueNameRaw: null,
      isSynthetic: true,
      syntheticAlbumName: album.name,
    });

    log.info(
      {
        event: 'setlist.album_drop.boosted',
        performerId: opts.performerId,
        albumName: album.name,
        daysFromRelease: Math.round(
          Math.abs(
            new Date(album.releaseDate).getTime() -
              new Date(opts.targetDate).getTime(),
          ) / MS_PER_DAY,
        ),
        tracksBoosted: newTitles.length,
      },
      'album-drop synthetic rows injected',
    );
  }

  return synthetic;
}
