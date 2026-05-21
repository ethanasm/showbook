/**
 * Pure helpers + shared constants for the §4c stable predictor. Split
 * out of `setlist-predict.ts` so the algorithmic shape stays readable
 * while the helpers stay individually unit-testable. The cache wrapper
 * and the high-level `predictSetlist` orchestrator live in
 * `setlist-predict.ts`; the REPEATABLE-READ corpus loader lives in
 * `corpus-loader.ts`.
 */

import type { CorpusRow } from './corpus-loader';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type TierLabel = 'a' | 'b' | 'c' | 'd' | 'e';
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

export interface BucketedPredictions {
  core: PredictedSong[];
  likely: PredictedSong[];
  wildcards: PredictedSong[];
  rotation: PredictedSong[];
}

// ─────────────────────────────────────────────────────────────────────
// Constants — tuned from feature-plan §4c
// ─────────────────────────────────────────────────────────────────────

export const TIER_WEIGHTS: Record<TierLabel, number> = {
  a: 1.0,
  b: 0.55,
  c: 0.2,
  d: 0.1,
  e: 0.04,
};

// Bucket cutoffs for the `core / likely / wildcards / rotation` lists.
export const BUCKET_CORE = 0.65;
export const BUCKET_LIKELY = 0.35;
export const BUCKET_WILDCARD = 0.1;

export const TIER_A_DAYS = 30;
export const TIER_B_DAYS = 180;
export const TIER_E_DAYS = 365;

export const MS_PER_DAY = 86_400_000;

// ─────────────────────────────────────────────────────────────────────
// Bucketing-date helper
// ─────────────────────────────────────────────────────────────────────

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
// Tour / tier / aggregate helpers
// ─────────────────────────────────────────────────────────────────────

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
