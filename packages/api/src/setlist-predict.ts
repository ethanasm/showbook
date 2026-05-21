/**
 * Tour-aware Bayesian predicted-setlist algorithm. Centerpiece of the
 * Phase 1 setlist-intelligence ship — every product surface that asks
 * "what will artist X play tonight?" comes through `predictSetlist`.
 *
 * Spec: docs/specs/setlist-intelligence/feature-plan.md §4c.
 * Phase brief: phases/phase-01-predicted-setlist-stable.md.
 *
 * Pure helpers (`bucketTiers`, `aggregate`, `pickRole`,
 * `bucketByProbability`, `computeConfidence`) are all individually
 * unit-testable; `predictSetlist` orchestrates them against a corpus
 * loaded by `loadCorpusForPrediction` (SI-06 race-free REPEATABLE READ).
 *
 * `loadCorpusForPrediction` and `cachePrediction` together implement
 * the prediction cache. `predictedSetlistCached` is the entry point
 * the tRPC procedure calls — it computes a corpus signature, looks up
 * the cache, and only re-runs `predictSetlist` on a miss.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@showbook/db';
import { albums, predictionCache, predictionSnapshots, tourSetlists } from '@showbook/db';
import { child } from '@showbook/observability';
import { type PerformerSetlist } from '@showbook/shared';
import { synthesizeAlbumDropRows } from './album-drop-synthetic';
import {
  computeSetCount,
  type SetCountPrediction,
} from './setlist-predict-shared';

const log = child({ component: 'api.setlist-predict' });

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type TierLabel = 'a' | 'b' | 'c' | 'd' | 'e';
export type TourCoverage = 'active_tour' | 'recent_tour' | 'last_year' | 'cold';
export type SongRole = 'opener' | 'closer' | 'encore_open' | 'encore_close' | 'core';

export interface PredictedSong {
  title: string;
  songId: string | null;
  probability: number;
  role: SongRole;
  avgPosition: number;
  encoreProbability: number;
  lastPlayedDate: string | null;
  appearancesInWindow: number;
  windowSize: number;
  evidence: string;
}

export type PredictedSetlistResult = HotPrediction | ColdPrediction;

export interface HotPrediction {
  style: 'stable';
  core: PredictedSong[];
  likely: PredictedSong[];
  wildcards: PredictedSong[];
  rotation: PredictedSong[];
  confidence: number;
  /** One-sentence rationale for the headline confidence number,
   *  surfaced under the percentage in the banner. Null when the
   *  prediction is on the strong-active-tour happy path and the
   *  number speaks for itself. */
  confidenceNote: string | null;
  sampleSize: number;
  tourId: string | null;
  tourName: string | null;
  tourCoverage: TourCoverage;
  spoilerBlurDefault: boolean;
  /** Phase 11 §15f — set count + song count + duration prediction.
   *  Null when sampleSize < 3 makes the estimate too noisy to show. */
  setCountPrediction: SetCountPrediction | null;
  /** Phase 11 §15e — multi-night anti-repeat context. Non-null when
   *  the target sits inside a same-venue run. */
  multiNightContext: {
    venue: string;
    priorNights: number;
    songsAlreadyPlayed: string[];
    runStartDate: string;
  } | null;
}

export interface ColdPrediction {
  style: 'cold';
  reason: ColdReason;
  performerName?: string | null;
  /** Convenience for the UI — always 0 in cold state. */
  sampleSize: 0;
  tourCoverage: 'cold';
  confidence: 0;
  confidenceNote: null;
  core: [];
  likely: [];
  wildcards: [];
  rotation: [];
  tourId: null;
  tourName: null;
  spoilerBlurDefault: false;
  setCountPrediction: null;
  multiNightContext: null;
}

export type ColdReason =
  | 'no_mbid'
  | 'no_corpus'
  | 'no_headliner'
  | 'date_not_set'
  | 'wrong_kind'
  | 'production_show';

// ─────────────────────────────────────────────────────────────────────
// Constants — tuned from feature-plan §4c
// ─────────────────────────────────────────────────────────────────────

const TIER_WEIGHTS: Record<TierLabel, number> = {
  a: 1.0,
  b: 0.55,
  c: 0.2,
  d: 0.1,
  e: 0.04,
};

// Bump whenever the prediction math, bucketing, or confidence formula
// changes. Folded into `loadCorpusForPrediction`'s signature so the
// in-DB prediction cache invalidates on the next read instead of
// serving stale payloads through the 4-hour TTL fallback.
const PREDICTION_LOGIC_VERSION = 'v2';

const PRIOR_ALPHA = 2;
const PRIOR_BETA = 2;

// Active-tour anchor: floor a song's probability at 0.85 when it appears
// in ≥80% of Tier-A setlists AND the recent leg started within 60 days.
const ANCHOR_TIER_A_THRESHOLD = 0.8;
const ANCHOR_LEG_START_DAYS = 60;
const ANCHOR_MIN_TIER_A = 3;
const ANCHOR_FLOOR = 0.85;

// Bucket cutoffs for the `core / likely / wildcards / rotation` lists.
const BUCKET_CORE = 0.65;
const BUCKET_LIKELY = 0.35;
const BUCKET_WILDCARD = 0.1;

const TIER_A_DAYS = 30;
const TIER_B_DAYS = 180;
const TIER_E_DAYS = 365;

const MS_PER_DAY = 86_400_000;

/**
 * For a show whose target date is more than 30 days in the future and
 * has no setlists within ±30d of the target, pivot the tier-bucketing
 * anchor to the most recent past setlist (or today if none).
 *
 * Why: `pickActiveTour` and `bucketTiers` use the target date to compute
 * "is this setlist in the active leg?" For a far-future show — say
 * Aug 16 viewed in May — none of the artist's recent shows fall within
 * ±30d of Aug 16, so every setlist would collapse to Tier-E (weight 0.04)
 * and confidence would round to 0%. Treating the future target as
 * "as-if today" lets the model capture the artist's *current* activity
 * as the Tier-A window — the right signal for a future show whose tour
 * is happening right now.
 *
 * Recency decay still applies in `computeConfidence` against the actual
 * target date, so a 3-month-out show naturally lands at lower confidence
 * than a next-week show.
 */
export function pickBucketingDate(opts: {
  targetDate: string;
  setlists: CorpusRow[];
  now?: Date;
}): string {
  const target = new Date(opts.targetDate).getTime();
  const today = (opts.now ?? new Date()).getTime();
  // Past or near-term (≤30d in future) targets — no slide.
  if (target <= today + TIER_A_DAYS * MS_PER_DAY) return opts.targetDate;
  // Some artists have future-scheduled setlists in setlist.fm; if any
  // sit within ±30d of the target, the original target is the right
  // anchor and no slide is needed.
  for (const s of opts.setlists) {
    if (s.isSynthetic) continue;
    const ts = new Date(s.performanceDate).getTime();
    if (Math.abs(ts - target) <= TIER_A_DAYS * MS_PER_DAY) return opts.targetDate;
  }
  // Slide to the most-recent past setlist; fall back to today when the
  // corpus has nothing in the past (rare — a fresh corpus might only
  // hold the synthesized future rows).
  let mostRecent: number | null = null;
  for (const s of opts.setlists) {
    if (s.isSynthetic) continue;
    const ts = new Date(s.performanceDate).getTime();
    if (ts > today) continue;
    if (mostRecent === null || ts > mostRecent) mostRecent = ts;
  }
  const anchor = mostRecent ?? today;
  return new Date(anchor).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────
// Corpus loader (SI-06 — race-free REPEATABLE READ)
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

    // Phase 11 §15m — append synthetic CorpusRow entries representing
    // tracks from albums released within ±60 days of the target. The
    // aggregator below treats synthetic rows as Tier-A in position but
    // caps their weight via the `isSynthetic` flag.
    const synthetic = await synthesizeAlbumDropRows({
      performerId: opts.performerId,
      targetDate: opts.targetDate,
      existingCorpus: realRows,
      tx,
    });
    const setlists = realRows.concat(synthetic);

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

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

export interface TieredSetlist {
  id: string;
  performanceDate: string;
  tourId: string | null;
  tourName: string | null;
  tier: TierLabel;
  weight: number;
  /** Phase 11 §15m — synthetic album-drop rows are tiered as 'a' for
   *  positioning but weighted at 0.3. Aggregate uses this to detect
   *  album-only songs and override their evidence string. */
  isSynthetic?: boolean;
  syntheticAlbumName?: string;
  songs: string[];
  songsLower: Set<string>;
  encoreSongsLower: Set<string>;
  positions: Map<string, number>; // lower-cased title -> position
}

/**
 * Pick the "active tour" for the prediction window. Defined as the tour
 * appearing most often among setlists in the ±30-day Tier-A window
 * around the target date. Returns `null` when no setlist in the window
 * carries a tour name (small artists with sparse setlist.fm coverage).
 */
export function pickActiveTour(opts: {
  setlists: CorpusRow[];
  targetDate: string;
}): { tourId: string | null; tourName: string | null; firstSeen: Date | null } | null {
  const target = new Date(opts.targetDate).getTime();
  const lower = target - TIER_A_DAYS * MS_PER_DAY;
  const upper = target + TIER_A_DAYS * MS_PER_DAY;
  const counts = new Map<string, { count: number; firstSeen: number; tourName: string }>();
  for (const s of opts.setlists) {
    if (!s.tourId || !s.tourName) continue;
    const ts = new Date(s.performanceDate).getTime();
    if (ts < lower || ts > upper) continue;
    const existing = counts.get(s.tourId);
    if (existing) {
      existing.count += 1;
      existing.firstSeen = Math.min(existing.firstSeen, ts);
    } else {
      counts.set(s.tourId, { count: 1, firstSeen: ts, tourName: s.tourName });
    }
  }
  if (counts.size === 0) return null;
  // Pick the highest-count tour; ties broken by oldest firstSeen.
  let best: { tourId: string; count: number; firstSeen: number; tourName: string } | null = null;
  for (const [tourId, info] of counts) {
    if (!best || info.count > best.count || (info.count === best.count && info.firstSeen < best.firstSeen)) {
      best = { tourId, ...info };
    }
  }
  if (!best) return null;
  return {
    tourId: best.tourId,
    tourName: best.tourName,
    firstSeen: new Date(best.firstSeen),
  };
}

/**
 * Pure helper — bucket every setlist in the corpus into a tier based on
 * its date relative to the target and its tour-id relationship to the
 * active tour. Setlists exactly on the target date are dropped (the
 * answer key, not a feature).
 */
export function bucketTiers(opts: {
  setlists: CorpusRow[];
  targetDate: string;
  activeTourId: string | null;
}): TieredSetlist[] {
  const target = new Date(opts.targetDate).getTime();
  const out: TieredSetlist[] = [];
  for (const s of opts.setlists) {
    if (s.performanceDate === opts.targetDate) continue;
    const distance = Math.abs(new Date(s.performanceDate).getTime() - target) / MS_PER_DAY;
    if (distance > TIER_E_DAYS) continue;

    let tier: TierLabel;
    // Phase 11 §15m — synthetic album-drop rows always land at Tier-A
    // for position (they represent songs the artist is about to start
    // playing), but their effective weight is capped at 0.3 below.
    if (s.isSynthetic) {
      tier = 'a';
    } else if (opts.activeTourId && s.tourId === opts.activeTourId) {
      if (distance <= TIER_A_DAYS) tier = 'a';
      else if (distance <= TIER_B_DAYS) tier = 'b';
      else tier = 'c';
    } else if (opts.activeTourId && s.tourId && s.tourId !== opts.activeTourId && distance <= TIER_E_DAYS) {
      tier = 'd';
    } else {
      tier = 'e';
    }

    const songs: string[] = [];
    const songsLower = new Set<string>();
    const encoreSongsLower = new Set<string>();
    const positions = new Map<string, number>();
    let idx = 0;
    for (const section of s.setlist.sections) {
      const isEncore = section.kind === 'encore';
      for (const song of section.songs) {
        const lower = song.title.trim().toLowerCase();
        if (!songsLower.has(lower)) positions.set(lower, idx);
        songs.push(song.title);
        songsLower.add(lower);
        if (isEncore) encoreSongsLower.add(lower);
        idx += 1;
      }
    }

    out.push({
      id: s.id,
      performanceDate: s.performanceDate,
      tourId: s.tourId,
      tourName: s.tourName,
      tier,
      // Synthetic album-drop rows are capped at 0.3 instead of
      // Tier-A's natural 1.0 so a new-album track that hasn't been
      // played yet caps out around ~0.3 probability rather than
      // overwhelming the real corpus signal.
      weight: s.isSynthetic ? 0.3 : TIER_WEIGHTS[tier],
      songs,
      songsLower,
      encoreSongsLower,
      positions,
      isSynthetic: s.isSynthetic,
      syntheticAlbumName: s.syntheticAlbumName,
    });
  }
  // Sort Tier-A first by date desc (newest first) so caller can read
  // `tier[0]?.performanceDate` to find the latest reference.
  out.sort((a, b) => b.performanceDate.localeCompare(a.performanceDate));
  return out;
}

export interface SongAggregate {
  title: string;
  W_song: number;
  N_song: number;
  N_recent: number;
  /** All distinct positions observed across the corpus (for avgPosition). */
  positions: number[];
  /** Whether the song appeared as an encore in this setlist. */
  encoreCount: number;
  /** Most-recent date the song was played. */
  lastPlayedDate: string | null;
  /** Total appearances (encore + non-encore) — used for encore probability. */
  totalAppearances: number;
  /** Phase 11 §15m — count of appearances that came from real
   *  (non-synthetic) corpus rows. When this stays 0, the song only
   *  has album-drop synthetic appearances and the evidence string
   *  is overridden to "expected from new album {name}". */
  realAppearances: number;
  /** Album name attached to a synthetic appearance; first one wins. */
  syntheticAlbumName: string | null;
}

/**
 * Aggregate per-song stats across the tiered corpus. Lower-case-keyed
 * map so "Heroes" / "heroes" collapse.
 */
export function aggregate(tier: TieredSetlist[]): Map<string, SongAggregate> {
  const out = new Map<string, SongAggregate>();
  for (const setlist of tier) {
    for (const title of setlist.songs) {
      const lower = title.trim().toLowerCase();
      let entry = out.get(lower);
      if (!entry) {
        entry = {
          title,
          W_song: 0,
          N_song: 0,
          N_recent: 0,
          positions: [],
          encoreCount: 0,
          lastPlayedDate: null,
          totalAppearances: 0,
          realAppearances: 0,
          syntheticAlbumName: null,
        };
        out.set(lower, entry);
      }
      // W_song / N_song are over distinct setlists; an in-setlist
      // repeat (a song played twice in one show) only counts once.
      // To enforce: track which (setlist.id, song.lower) pairs we've
      // counted. We use the encoreSongsLower set as the dedup since
      // the per-setlist songsLower set is already deduped.
    }
  }
  // Second pass — count per-setlist appearances exactly once.
  for (const setlist of tier) {
    for (const lower of setlist.songsLower) {
      const entry = out.get(lower);
      if (!entry) continue;
      entry.W_song += setlist.weight;
      entry.N_song += 1;
      entry.totalAppearances += 1;
      if (setlist.tier === 'a') entry.N_recent += 1;
      if (setlist.encoreSongsLower.has(lower)) entry.encoreCount += 1;
      const pos = setlist.positions.get(lower);
      if (typeof pos === 'number') entry.positions.push(pos);
      if (!entry.lastPlayedDate || setlist.performanceDate > entry.lastPlayedDate) {
        entry.lastPlayedDate = setlist.performanceDate;
      }
      if (setlist.isSynthetic) {
        if (!entry.syntheticAlbumName && setlist.syntheticAlbumName) {
          entry.syntheticAlbumName = setlist.syntheticAlbumName;
        }
      } else {
        entry.realAppearances += 1;
      }
    }
  }
  return out;
}

/**
 * Most-likely role for a song, picked by examining its position +
 * encore flag across the corpus. Threshold: a single role must own
 * ≥50% of appearances to be picked; otherwise the song defaults to
 * `core`. Ties broken by role rank (closer beats opener).
 */
export function pickRole(opts: {
  tier: TieredSetlist[];
  titleLower: string;
}): { role: SongRole; avgPosition: number } {
  const tally: Record<SongRole, number> = {
    opener: 0,
    closer: 0,
    encore_open: 0,
    encore_close: 0,
    core: 0,
  };
  const positions: number[] = [];
  let total = 0;
  for (const setlist of opts.tier) {
    if (!setlist.songsLower.has(opts.titleLower)) continue;
    total += 1;
    const idx = setlist.positions.get(opts.titleLower);
    if (typeof idx === 'number') positions.push(idx);
    const sections = setlist.songs; // titles in order; need section info
    // Re-derive role using the same logic as the indexer but on the
    // flattened ordering. We track section boundaries via the setlist's
    // raw sections — for the pure helper we don't have them, so fall
    // back to position-heuristics: first position → opener candidate;
    // last position → closer/encore_close candidate; flagged-encore →
    // encore_*. The indexer is the source of truth at index time, but
    // pickRole runs over the raw corpus so we replicate the rules.
    const isFirst = idx === 0;
    const isLast = typeof idx === 'number' && idx === sections.length - 1;
    const isEncore = setlist.encoreSongsLower.has(opts.titleLower);
    if (isEncore) {
      if (isFirst || (typeof idx === 'number' && idx === sections.length - setlist.encoreSongsLower.size)) {
        tally.encore_open += 1;
      } else if (isLast) {
        tally.encore_close += 1;
      } else {
        tally.core += 1;
      }
    } else if (isFirst) {
      tally.opener += 1;
    } else if (isLast) {
      tally.closer += 1;
    } else {
      tally.core += 1;
    }
  }
  if (total === 0) return { role: 'core', avgPosition: 0 };
  const ROLE_RANK: SongRole[] = ['opener', 'core', 'closer', 'encore_open', 'encore_close'];
  let best: { role: SongRole; count: number } = { role: 'core', count: tally.core };
  for (const role of ROLE_RANK) {
    if (tally[role] > best.count) {
      best = { role, count: tally[role] };
    }
  }
  const winnerShare = best.count / total;
  const role: SongRole = winnerShare >= 0.5 ? best.role : 'core';
  const avgPosition = positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : 0;
  return { role, avgPosition };
}

export interface BucketedPredictions {
  core: PredictedSong[];
  likely: PredictedSong[];
  wildcards: PredictedSong[];
  rotation: PredictedSong[];
}

export function bucketByProbability(opts: {
  songs: PredictedSong[];
  latestTierADate: string | null;
  aggregates: Map<string, SongAggregate>;
}): BucketedPredictions {
  const core: PredictedSong[] = [];
  const likely: PredictedSong[] = [];
  const wildcards: PredictedSong[] = [];
  const rotation: PredictedSong[] = [];

  for (const s of opts.songs) {
    const agg = opts.aggregates.get(s.title.trim().toLowerCase());
    // One-off suppressor: if N_song == 1 AND that single appearance is
    // older than the most recent Tier-A setlist, bucket as rotation
    // regardless of `p`.
    if (
      agg &&
      agg.N_song === 1 &&
      opts.latestTierADate &&
      s.lastPlayedDate &&
      s.lastPlayedDate < opts.latestTierADate
    ) {
      rotation.push(s);
      continue;
    }
    if (s.probability >= BUCKET_CORE) core.push(s);
    else if (s.probability >= BUCKET_LIKELY) likely.push(s);
    else if (s.probability >= BUCKET_WILDCARD) wildcards.push(s);
    else rotation.push(s);
  }

  // Sort each bucket: openers first, then by avgPosition, then closer,
  // then encore variants. Within-tier ordering keeps the UI's reading
  // flow ("song 01 → song 21").
  const sortByPosition = (a: PredictedSong, b: PredictedSong) => {
    const ROLE_ORDER: SongRole[] = ['opener', 'core', 'closer', 'encore_open', 'core', 'encore_close'];
    const ra = ROLE_ORDER.indexOf(a.role);
    const rb = ROLE_ORDER.indexOf(b.role);
    if (ra !== rb) return ra - rb;
    return a.avgPosition - b.avgPosition;
  };
  core.sort(sortByPosition);
  likely.sort(sortByPosition);
  wildcards.sort((a, b) => b.probability - a.probability);
  rotation.sort((a, b) => b.probability - a.probability);

  return { core, likely, wildcards, rotation };
}

/**
 * Overall confidence in the prediction. Weighted blend:
 *   0.5 * tier_a_density (1.0 if ≥6 Tier-A setlists, scaled below)
 * + 0.3 * setlist_consistency (mean pairwise Jaccard across Tier A)
 * + 0.2 * recency_density (1.0 if latest Tier-A setlist ≤ 7 days old)
 */
export function computeConfidence(opts: {
  tierA: TieredSetlist[];
  targetDate: string;
}): number {
  const density = Math.min(1, opts.tierA.length / 6);
  let consistency = 0;
  if (opts.tierA.length >= 2) {
    let sumJaccard = 0;
    let pairs = 0;
    for (let i = 0; i < opts.tierA.length; i++) {
      for (let j = i + 1; j < opts.tierA.length; j++) {
        const a = opts.tierA[i]!.songsLower;
        const b = opts.tierA[j]!.songsLower;
        let intersect = 0;
        for (const v of a) if (b.has(v)) intersect += 1;
        const union = a.size + b.size - intersect;
        if (union === 0) continue;
        sumJaccard += intersect / union;
        pairs += 1;
      }
    }
    consistency = pairs > 0 ? Math.min(1, sumJaccard / pairs / 0.75) : 0;
  } else if (opts.tierA.length === 1) {
    // Single Tier-A setlist — treat as moderately consistent (we have
    // a recent reference, but no pairwise signal to verify it).
    consistency = 0.5;
  }
  let recency = 0;
  if (opts.tierA.length > 0) {
    const latest = new Date(opts.tierA[0]!.performanceDate).getTime();
    const target = new Date(opts.targetDate).getTime();
    const days = Math.abs(target - latest) / MS_PER_DAY;
    // Per feature-plan §4c: 1.0 if the latest Tier-A setlist is ≤7d
    // old; scaled below that point. Past 30 extra days the recency
    // signal goes to 0.
    if (days <= 7) recency = 1;
    else recency = Math.max(0, 1 - (days - 7) / 30);
  }
  return 0.5 * density + 0.3 * consistency + 0.2 * recency;
}

// ─────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────

export interface PredictSetlistInput {
  performerId: string;
  targetDate: string; // YYYY-MM-DD
  /** Optional audit context — when present, a row is appended to
   * `prediction_snapshots` recording the exact payload served. Lets the
   * Phase-4 eval harness compare "what we showed" rather than only
   * "what we'd say today." */
  snapshotContext?: {
    userId?: string | null;
    showId?: string | null;
  };
  /** Phase 11 §15e — when generalized multi-night detection runs on
   *  stable-style residencies, the run context flows through here so
   *  the stable predictor can apply the 0.05 anti-repeat penalty to
   *  songs already played in the run. */
  runContext?: {
    venue: string;
    priorNights: number;
    songsAlreadyPlayed: string[];
    runStartDate: string;
  } | null;
  /** Phase 11 §15r — festival vs headline corpus filter. Passes
   *  through to `loadCorpusForPrediction`. */
  prefer?: 'festival' | 'headline';
}

const MULTI_NIGHT_ANTI_REPEAT_PENALTY = 0.05;

/**
 * Pure prediction over a loaded corpus — no DB, no cache. Re-runnable
 * against the same corpus produces the same output. The cache wrapper
 * is `predictedSetlistCached`.
 */
export function predictSetlist(opts: {
  performerId: string;
  targetDate: string;
  corpus: CorpusRow[];
  runContext?: PredictSetlistInput['runContext'];
  /** Injected for tests so future-date scenarios are deterministic;
   *  defaults to wall clock in production. */
  now?: Date;
}): HotPrediction | ColdPrediction {
  if (opts.corpus.length === 0) {
    return coldPrediction('no_corpus');
  }

  // For far-future shows, pivot the tier-bucketing anchor to the artist's
  // recent activity (or today). Without this every setlist collapses to
  // Tier-E and confidence rounds to 0% — see `pickBucketingDate`.
  const bucketingDate = pickBucketingDate({
    targetDate: opts.targetDate,
    setlists: opts.corpus,
    now: opts.now,
  });

  const active = pickActiveTour({ setlists: opts.corpus, targetDate: bucketingDate });
  const activeTourId = active?.tourId ?? null;
  const tier = bucketTiers({
    setlists: opts.corpus,
    targetDate: bucketingDate,
    activeTourId,
  });
  if (tier.length === 0) {
    return coldPrediction('no_corpus');
  }
  const tierA = tier.filter((s) => s.tier === 'a');
  const totals = aggregate(tier);

  const W_total = tier.reduce((acc, s) => acc + s.weight, 0);
  const N_corpus = tier.length;
  if (W_total === 0 || N_corpus === 0) {
    return coldPrediction('no_corpus');
  }

  const recentLegStart = active?.firstSeen ?? null;
  const targetTs = new Date(opts.targetDate).getTime();

  // Phase 11 §15e — anti-repeat lookup set for multi-night residencies.
  const alreadyPlayed = new Set<string>();
  if (opts.runContext && opts.runContext.priorNights >= 1) {
    for (const title of opts.runContext.songsAlreadyPlayed) {
      alreadyPlayed.add(title.trim().toLowerCase());
    }
  }

  const songs: PredictedSong[] = [];
  for (const [lower, agg] of totals) {
    const prior = (PRIOR_ALPHA * W_total) / N_corpus;
    let p = (agg.W_song + prior) / (W_total + ((PRIOR_ALPHA + PRIOR_BETA) * W_total) / N_corpus);
    if (
      tierA.length >= ANCHOR_MIN_TIER_A &&
      tierA.length > 0 &&
      agg.N_recent / tierA.length >= ANCHOR_TIER_A_THRESHOLD &&
      recentLegStart &&
      (targetTs - recentLegStart.getTime()) / MS_PER_DAY <= ANCHOR_LEG_START_DAYS &&
      agg.realAppearances > 0  // anchor floor only on songs with real evidence
    ) {
      p = Math.max(p, ANCHOR_FLOOR);
    }
    // Phase 11 §15e — anti-repeat penalty on songs played earlier in
    // the run. Tonight's setlist is less likely to repeat them.
    if (alreadyPlayed.has(lower)) {
      p = p * MULTI_NIGHT_ANTI_REPEAT_PENALTY;
    }
    const { role, avgPosition } = pickRole({ tier, titleLower: lower });
    const encoreProbability = agg.totalAppearances > 0 ? agg.encoreCount / agg.totalAppearances : 0;
    // Phase 11 §15m — when a song has ONLY synthetic appearances
    // (real album-drop track that hasn't been played live yet), the
    // evidence string carries the album name instead of the corpus
    // count. Real evidence supersedes once any real appearance exists.
    const evidence =
      agg.realAppearances === 0 && agg.syntheticAlbumName
        ? `expected from new album ${agg.syntheticAlbumName}`
        : `${agg.N_song} of last ${N_corpus} ${agg.N_song === 1 ? 'show' : 'shows'}`;
    songs.push({
      title: agg.title,
      songId: null,
      probability: Math.max(0, Math.min(1, p)),
      role,
      avgPosition,
      encoreProbability,
      lastPlayedDate: agg.lastPlayedDate,
      appearancesInWindow: agg.N_song,
      windowSize: N_corpus,
      evidence,
    });
  }

  const latestTierA = tierA[0]?.performanceDate ?? null;
  const buckets = bucketByProbability({ songs, latestTierADate: latestTierA, aggregates: totals });

  const realTierA = tierA.filter((s) => !s.isSynthetic);
  // When no active tour was detected, `bucketTiers` parks every real
  // setlist in Tier-E (only synthetic album-drop rows get Tier-A), so
  // `realTierA` is empty and `computeConfidence` collapses to 0% even
  // when the corpus is rich and consistent. This is common for
  // festival-circuit artists (no `tourId` on setlist.fm), one-off
  // appearances, or sparse coverage. Fall back to a date-based sample:
  // real setlists within ±30d of the bucketing date. Coverage stays
  // `last_year` (still capped at 0.5) because we still couldn't label
  // an active tour, so this only fixes the floor — it can't
  // accidentally promote a band to `active_tour` confidence.
  let confidenceSample = realTierA;
  if (confidenceSample.length === 0) {
    const bucketingTs = new Date(bucketingDate).getTime();
    confidenceSample = tier.filter((s) => {
      if (s.isSynthetic) return false;
      const distance = Math.abs(new Date(s.performanceDate).getTime() - bucketingTs) / MS_PER_DAY;
      return distance <= TIER_A_DAYS;
    });
  }
  // Second fallback: target is near-term (no slide) but the artist has
  // no setlists within ±30d of either the original target or the
  // bucketing date — common when a festival booked an artist who isn't
  // currently touring (the Tash Sultana 0% bug). Use the entire
  // non-synthetic corpus so density + pairwise consistency can still
  // reflect the evidence we have. Recency naturally decays to 0 inside
  // `computeConfidence`, and the `last_year` cap at 0.5 still bounds
  // the headline.
  if (confidenceSample.length === 0) {
    confidenceSample = tier.filter((s) => !s.isSynthetic);
  }
  const confidence = computeConfidence({ tierA: confidenceSample, targetDate: opts.targetDate });
  const coverage = resolveCoverage({
    activeTourId,
    tierACount: realTierA.length,
    tier: tier.filter((s) => !s.isSynthetic),
  });
  const finalConfidence = Math.max(
    0,
    Math.min(1, coverage === 'last_year' ? Math.min(confidence, 0.5) : confidence),
  );

  return {
    style: 'stable',
    ...buckets,
    confidence: finalConfidence,
    confidenceNote: explainConfidence({
      coverage,
      confidence: finalConfidence,
      confidenceSample,
      targetDate: opts.targetDate,
    }),
    sampleSize: opts.corpus.filter((r) => !r.isSynthetic).length,
    tourId: activeTourId,
    tourName: active?.tourName ?? null,
    tourCoverage: coverage,
    spoilerBlurDefault: coverage === 'active_tour' && confidence >= 0.55,
    setCountPrediction: computeSetCount(opts.corpus),
    multiNightContext: opts.runContext ?? null,
  };
}

/**
 * One-sentence rationale for the headline confidence number. Picks the
 * dominant factor pulling the score down (no active tour / stale
 * setlists / inconsistent songs) and phrases it as plain English for
 * the banner subcopy. Returns null when the prediction is on the
 * strong active-tour happy path and the number speaks for itself.
 */
export function explainConfidence(opts: {
  coverage: TourCoverage;
  confidence: number;
  confidenceSample: TieredSetlist[];
  targetDate: string;
}): string | null {
  if (opts.coverage === 'cold') return null;
  // Silent above ~65% on an active tour — the number is informative.
  if (opts.coverage === 'active_tour' && opts.confidence >= 0.65) {
    return null;
  }
  if (opts.confidenceSample.length === 0) {
    return 'Not enough recent setlist data to score this one with confidence.';
  }
  // `confidenceSample` was sorted descending by performanceDate when it
  // came out of `bucketTiers` (the original corpus query ordered DESC),
  // so [0] is the latest.
  const latestDate = opts.confidenceSample[0]?.performanceDate ?? null;
  const daysSinceLatest = latestDate
    ? Math.max(
        0,
        Math.floor(
          (new Date(opts.targetDate).getTime() - new Date(latestDate).getTime()) /
            MS_PER_DAY,
        ),
      )
    : null;

  const monthsAgo = (days: number): string => {
    if (days < 30) return 'less than a month ago';
    const months = Math.round(days / 30);
    return `~${months} month${months === 1 ? '' : 's'} ago`;
  };

  if (opts.coverage === 'last_year') {
    if (daysSinceLatest && daysSinceLatest > 60) {
      return `No active tour — latest setlist was ${monthsAgo(daysSinceLatest)}, so we're working off older shows.`;
    }
    return "No active tour right now — confidence reflects last year's shows rather than a live run.";
  }

  if (opts.coverage === 'recent_tour') {
    return 'Tour wrapped recently — set may have shifted since the last show we have on file.';
  }

  // active_tour but middling confidence — usually a consistency issue.
  return 'Setlist varies a fair amount show-to-show.';
}

function resolveCoverage(opts: {
  activeTourId: string | null;
  tierACount: number;
  tier: TieredSetlist[];
}): TourCoverage {
  if (opts.activeTourId && opts.tierACount >= 1) return 'active_tour';
  if (opts.activeTourId) return 'recent_tour';
  if (opts.tier.length > 0) return 'last_year';
  return 'cold';
}

export function coldPrediction(reason: ColdReason, performerName: string | null = null): ColdPrediction {
  return {
    style: 'cold',
    reason,
    performerName,
    sampleSize: 0,
    tourCoverage: 'cold',
    confidence: 0,
    confidenceNote: null,
    core: [],
    likely: [],
    wildcards: [],
    rotation: [],
    tourId: null,
    tourName: null,
    spoilerBlurDefault: false,
    setCountPrediction: null,
    multiNightContext: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Cache wrapper
// ─────────────────────────────────────────────────────────────────────

/**
 * Cache-aware variant. Reads the corpus + signature inside the same
 * REPEATABLE READ transaction (SI-06), checks the cache, and only
 * re-computes on a miss. The cache row stores the result JSON keyed by
 * `(performerId, targetDate)` with the corpus signature alongside.
 *
 * Emits `setlist.predict.{cache_hit,cache_miss}` so Axiom can track the
 * hit rate and `setlist.predict.served` for the served payload meta.
 */
export async function predictedSetlistCached(
  input: PredictSetlistInput,
): Promise<HotPrediction | ColdPrediction> {
  const { setlists, signature } = await loadCorpusForPrediction({
    performerId: input.performerId,
    targetDate: input.targetDate,
    prefer: input.prefer,
  });

  // Cache hit fast path — same signature on the existing row means the
  // corpus underneath the cached prediction is unchanged.
  const [cached] = await db
    .select()
    .from(predictionCache)
    .where(
      and(
        eq(predictionCache.performerId, input.performerId),
        eq(predictionCache.targetDate, input.targetDate),
      ),
    )
    .limit(1);

  // Phase 11 §15r — 4-hour TTL fallback even when the signature
  // doesn't match. Protects against a transient corpus-fill bump that
  // produces tiny signature drift but doesn't materially change the
  // prediction. Stale-corpus reads also short-circuit here.
  const CACHE_FRESH_MS = 4 * 60 * 60 * 1000;
  const now = Date.now();
  const cachedFresh =
    !!cached &&
    cached.computedAt instanceof Date &&
    now - cached.computedAt.getTime() < CACHE_FRESH_MS;

  if (cached && (cached.corpusSignature === signature || cachedFresh)) {
    log.info(
      {
        event: 'setlist.predict.cache_hit',
        performerId: input.performerId,
        targetDate: input.targetDate,
        signatureMatch: cached.corpusSignature === signature,
        ttlFallback: cached.corpusSignature !== signature && cachedFresh,
      },
      'predicted-setlist cache hit',
    );
    const rawPayload = cached.predictionJson as HotPrediction | ColdPrediction;
    // Phase 11 added `setCountPrediction` + `multiNightContext` to the
    // union. Cached rows written by older code don't carry the fields;
    // hydrate to null so the consumer's type assumption holds.
    const payload: HotPrediction | ColdPrediction = {
      ...rawPayload,
      setCountPrediction:
        'setCountPrediction' in rawPayload ? rawPayload.setCountPrediction : null,
      multiNightContext:
        'multiNightContext' in rawPayload ? rawPayload.multiNightContext : null,
      confidenceNote:
        'confidenceNote' in rawPayload ? rawPayload.confidenceNote : null,
    } as HotPrediction | ColdPrediction;
    log.info(
      {
        event: 'setlist.predict.served',
        performerId: input.performerId,
        targetDate: input.targetDate,
        style: payload.style,
        confidence: 'confidence' in payload ? payload.confidence : 0,
        sampleSize: 'sampleSize' in payload ? payload.sampleSize : 0,
        cache: 'hit',
      },
      'predicted-setlist served from cache',
    );
    if (input.snapshotContext) {
      await writePredictionSnapshot({
        performerId: input.performerId,
        targetDate: input.targetDate,
        corpusSignature: signature,
        prediction: payload,
        context: input.snapshotContext,
      });
    }
    return payload;
  }

  const result = predictSetlist({
    performerId: input.performerId,
    targetDate: input.targetDate,
    corpus: setlists,
    runContext: input.runContext,
  });

  await db
    .insert(predictionCache)
    .values({
      performerId: input.performerId,
      targetDate: input.targetDate,
      corpusSignature: signature,
      predictionJson: result,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [predictionCache.performerId, predictionCache.targetDate],
      set: {
        corpusSignature: signature,
        predictionJson: result,
        computedAt: new Date(),
      },
    });

  log.info(
    {
      event: 'setlist.predict.cache_miss',
      performerId: input.performerId,
      targetDate: input.targetDate,
    },
    'predicted-setlist cache miss',
  );
  log.info(
    {
      event: 'setlist.predict.served',
      performerId: input.performerId,
      targetDate: input.targetDate,
      style: result.style,
      confidence: result.confidence,
      sampleSize: result.sampleSize,
      cache: 'miss',
    },
    'predicted-setlist served fresh',
  );
  if (input.snapshotContext) {
    await writePredictionSnapshot({
      performerId: input.performerId,
      targetDate: input.targetDate,
      corpusSignature: signature,
      prediction: result,
      context: input.snapshotContext,
    });
  }
  return result;
}

/** Append-only snapshot write. Failures don't propagate — losing an audit
 * row is preferable to dropping the user-facing prediction. */
async function writePredictionSnapshot(opts: {
  performerId: string;
  targetDate: string;
  corpusSignature: string;
  prediction: HotPrediction | ColdPrediction;
  context: { userId?: string | null; showId?: string | null };
}): Promise<void> {
  try {
    await db.insert(predictionSnapshots).values({
      performerId: opts.performerId,
      targetDate: opts.targetDate,
      corpusSignature: opts.corpusSignature,
      predictionJson: opts.prediction,
      servedToUserId: opts.context.userId ?? null,
      showId: opts.context.showId ?? null,
    });
  } catch (err) {
    log.error(
      {
        event: 'setlist.predict.snapshot_failed',
        err,
        performerId: opts.performerId,
        targetDate: opts.targetDate,
      },
      'predicted-setlist snapshot write failed (non-fatal)',
    );
  }
}
