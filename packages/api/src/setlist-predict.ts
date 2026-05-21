/**
 * Tour-aware Bayesian predicted-setlist algorithm. Centerpiece of the
 * Phase 1 setlist-intelligence ship — every product surface that asks
 * "what will artist X play tonight?" comes through `predictSetlist`.
 *
 * Spec: docs/specs/setlist-intelligence/feature-plan.md §4c.
 * Phase brief: phases/phase-01-predicted-setlist-stable.md.
 *
 * Pure helpers (`bucketTiers`, `aggregate`, `pickRole`,
 * `bucketByProbability`, `computeConfidence`) live in `predict-helpers.ts`
 * and are individually unit-testable; `loadCorpusForPrediction` is the
 * REPEATABLE-READ corpus loader in `corpus-loader.ts`.
 *
 * `predictSetlist` orchestrates those helpers against a loaded corpus;
 * `predictedSetlistCached` is the cache-aware entry point that the
 * tRPC procedure calls — it computes the corpus signature, looks up
 * the prediction cache, and only re-runs `predictSetlist` on a miss.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@showbook/db';
import { predictionCache, predictionSnapshots } from '@showbook/db';
import { child } from '@showbook/observability';
import {
  loadCorpusForPrediction,
  type CorpusRow,
} from './corpus-loader';
import {
  aggregate,
  bucketByProbability,
  bucketTiers,
  computeConfidence,
  pickActiveTour,
  pickBucketingDate,
  pickRole,
  MS_PER_DAY,
  TIER_A_DAYS,
  type PredictedSong,
  type TieredSetlist,
} from './predict-helpers';
import {
  computeSetCount,
  type SetCountPrediction,
} from './setlist-predict-shared';

const log = child({ component: 'api.setlist-predict' });

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type TourCoverage = 'active_tour' | 'recent_tour' | 'last_year' | 'cold';

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

// Re-exports so existing consumers can keep importing CorpusRow + the
// pure helpers from `./setlist-predict`. The implementations live in
// `./corpus-loader` and `./predict-helpers`.
export {
  loadCorpusForPrediction,
  type CorpusRow,
  type CorpusLoadResult,
} from './corpus-loader';
export {
  aggregate,
  bucketByProbability,
  bucketTiers,
  computeConfidence,
  pickActiveTour,
  pickBucketingDate,
  pickRole,
  type BucketedPredictions,
  type PredictedSong,
  type SongAggregate,
  type SongRole,
  type TierLabel,
  type TieredSetlist,
} from './predict-helpers';

// ─────────────────────────────────────────────────────────────────────
// Predict-only constants — tuned from feature-plan §4c
// ─────────────────────────────────────────────────────────────────────

const PRIOR_ALPHA = 2;
const PRIOR_BETA = 2;

// Active-tour anchor: floor a song's probability at 0.85 when it appears
// in ≥80% of Tier-A setlists AND the recent leg started within 60 days.
const ANCHOR_TIER_A_THRESHOLD = 0.8;
const ANCHOR_LEG_START_DAYS = 60;
const ANCHOR_MIN_TIER_A = 3;
const ANCHOR_FLOOR = 0.85;

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
