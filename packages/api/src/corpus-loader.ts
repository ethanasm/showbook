/**
 * Race-free corpus loader for the §4c stable predictor and its style
 * cousins (rotating / theatrical / improvised). Both the SELECT and the
 * signature query run inside one REPEATABLE READ transaction so MVCC
 * pins them to the same snapshot — without this, a corpus-fill INSERT
 * between the two reads could cache a stale signature with a fresher
 * payload. Both queries are SELECT-only; REPEATABLE READ adds no
 * contention because postgres only serializes on write conflicts.
 *
 * Signature shape: `<tour_setlists.fetchedAt sig>|<albums.fetchedAt
 * sig>|<PREDICTION_LOGIC_VERSION>`. Bump `PREDICTION_LOGIC_VERSION`
 * whenever the prediction math, bucketing, or confidence formula
 * changes so every cached row invalidates on the next read.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { albums, db, tourSetlists } from '@showbook/db';
import { isFeatureOn, type PerformerSetlist } from '@showbook/shared';
import { synthesizeAlbumDropRows } from './album-drop-synthetic';
import { MS_PER_DAY, TIER_E_DAYS } from './predict-helpers';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface CorpusRow {
  id: string;
  performerId: string;
  performanceDate: string;
  tourId: string | null;
  tourName: string | null;
  setlist: PerformerSetlist;
  songCount: number;
  fetchedAt: Date;
  /** Raw venue name from setlist.fm. Optional — `loadCorpusForPrediction`
   *  hydrates it so the Phase 5 multi-night-run detector can find
   *  consecutive same-venue runs. Older serialized corpus rows (cache
   *  snapshots, tests) may omit this field; consumers must tolerate
   *  null/undefined. */
  venueNameRaw?: string | null;
  /** Phase 11 §15m — true when this row was synthesized by
   *  `synthesizeAlbumDropRows` rather than loaded from `tour_setlists`.
   *  Synthetic rows are excluded from `tourCoverage` /
   *  `recentLegStart` calculations so they only contribute to per-song
   *  probability, not the headline confidence. */
  isSynthetic?: boolean;
  /** Album name for synthetic rows — used to render the
   *  "expected from new album {name}" evidence string. */
  syntheticAlbumName?: string;
}

export interface CorpusLoadResult {
  setlists: CorpusRow[];
  /**
   * `max(fetched_at)` over the corpus rows the cached prediction was
   * computed against. Stored alongside the cached value so the next
   * read can detect a fresher corpus and invalidate without an extra
   * DELETE pass. ISO string so it serializes cleanly into the cache.
   */
  signature: string;
}

// Bump whenever the prediction math, bucketing, or confidence formula
// changes. Folded into `loadCorpusForPrediction`'s signature so the
// in-DB prediction cache invalidates on the next read instead of
// serving stale payloads through the 4-hour TTL fallback.
export const PREDICTION_LOGIC_VERSION = 'v2';

// ─────────────────────────────────────────────────────────────────────
// Synthetic-album-drop branch (Phase 11 §15m)
// ─────────────────────────────────────────────────────────────────────

/**
 * Feature-flag-gated synthesis hop. When `SetlistIntelAlbumDrop` is ON
 * we append synthetic `CorpusRow` entries representing tracks from
 * albums released within ±60 days of the target; tier bucketing treats
 * them as Tier-A in position but caps their weight via the
 * `isSynthetic` flag (see `bucketTiers`). When the flag is OFF we
 * return the real corpus untouched.
 */
async function maybeAppendSyntheticAlbumDropRows(opts: {
  performerId: string;
  targetDate: string;
  real: CorpusRow[];
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0];
}): Promise<CorpusRow[]> {
  if (!isFeatureOn('SetlistIntelAlbumDrop')) return opts.real;
  const synthetic = await synthesizeAlbumDropRows({
    performerId: opts.performerId,
    targetDate: opts.targetDate,
    existingCorpus: opts.real,
    tx: opts.tx,
  });
  return opts.real.concat(synthetic);
}

// ─────────────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────────────

/**
 * Race-free corpus load. Both the SELECT and the signature query run
 * inside one REPEATABLE READ transaction so MVCC pins them to the same
 * snapshot — without this, a corpus-fill INSERT between the two reads
 * could cache a stale signature with a fresher payload. Both queries
 * are SELECT-only; REPEATABLE READ adds no contention because postgres
 * only serializes on write conflicts.
 */
export async function loadCorpusForPrediction(opts: {
  performerId: string;
  targetDate: string;
  /** Phase 11 §15r — when set, the corpus is filtered to rows whose
   *  song-count heuristic matches the preferred show kind. `festival`
   *  prefers rows with songCount ≤ 16 (typical festival set length);
   *  `headline` prefers rows with songCount ≥ 14. Falls through to
   *  the full corpus when fewer than 3 rows match the preferred kind,
   *  so a niche-festival prediction with no festival corpus still
   *  uses the headline corpus rather than empty. */
  prefer?: 'festival' | 'headline';
}): Promise<CorpusLoadResult> {
  // "Last 365 days" anchors to today when the target is in the future,
  // otherwise to the target. Without the `min`, a show 90 days out drops
  // any setlist older than `target - 365d` even when the band toured
  // 3 months before that cutoff — those rows belong in the corpus.
  const today = Date.now();
  const targetTs = new Date(opts.targetDate).getTime();
  const anchorTs = Math.min(today, targetTs);
  const earliest = new Date(anchorTs - TIER_E_DAYS * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);

    const rows = await tx
      .select({
        id: tourSetlists.id,
        performerId: tourSetlists.performerId,
        performanceDate: tourSetlists.performanceDate,
        tourId: tourSetlists.tourId,
        tourName: tourSetlists.tourName,
        setlist: tourSetlists.setlist,
        songCount: tourSetlists.songCount,
        fetchedAt: tourSetlists.fetchedAt,
        venueNameRaw: tourSetlists.venueNameRaw,
      })
      .from(tourSetlists)
      .where(
        and(
          eq(tourSetlists.performerId, opts.performerId),
          gte(tourSetlists.performanceDate, earliest),
        ),
      )
      .orderBy(desc(tourSetlists.performanceDate));

    const [sigRow] = await tx
      .select({
        signature: sql<Date | null>`MAX(${tourSetlists.fetchedAt})`,
      })
      .from(tourSetlists)
      .where(eq(tourSetlists.performerId, opts.performerId));

    // Phase 11 §15r — extend the cache signature to include the latest
    // `albums.fetched_at` so a fresh album-metadata-fill invalidates
    // cached predictions on the next read (album-drop synthetic rows
    // would otherwise stay invisible until tour_setlists changed).
    const [albumSigRow] = await tx
      .select({
        signature: sql<Date | null>`MAX(${albums.fetchedAt})`,
      })
      .from(albums)
      .where(eq(albums.performerId, opts.performerId));

    const allRows: CorpusRow[] = rows.map((r) => ({
      id: r.id,
      performerId: r.performerId,
      performanceDate: r.performanceDate,
      tourId: r.tourId,
      tourName: r.tourName,
      setlist: r.setlist as PerformerSetlist,
      songCount: r.songCount,
      fetchedAt: r.fetchedAt,
      venueNameRaw: r.venueNameRaw,
    }));

    // Phase 11 §15r — festival vs headline filter. Heuristic on
    // songCount; tour_setlists doesn't carry kind so we infer.
    // Falls through to the full corpus when fewer than 3 rows match
    // the preferred kind.
    let realRows = allRows;
    if (opts.prefer === 'festival') {
      const festivalRows = allRows.filter((r) => r.songCount <= 16);
      if (festivalRows.length >= 3) realRows = festivalRows;
    } else if (opts.prefer === 'headline') {
      const headlineRows = allRows.filter((r) => r.songCount >= 14);
      if (headlineRows.length >= 3) realRows = headlineRows;
    }

    const setlists = await maybeAppendSyntheticAlbumDropRows({
      performerId: opts.performerId,
      targetDate: opts.targetDate,
      real: realRows,
      tx,
    });

    const realSig = sigRow?.signature
      ? new Date(sigRow.signature).toISOString()
      : 'empty';
    const albumSig = albumSigRow?.signature
      ? new Date(albumSigRow.signature).toISOString()
      : 'empty';

    return {
      setlists,
      // PREDICTION_LOGIC_VERSION is stitched into the signature so a
      // confidence-math change invalidates every cached prediction —
      // otherwise rows whose corpus hasn't changed since the previous
      // logic version keep serving the old payload until either the
      // 4-hour TTL elapses or the artist's setlist.fm coverage shifts.
      // Bump when prediction confidence / bucketing changes.
      signature: `${realSig}|${albumSig}|${PREDICTION_LOGIC_VERSION}`,
    };
  });
}
