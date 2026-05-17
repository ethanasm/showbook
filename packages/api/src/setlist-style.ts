/**
 * Setlist-style classifier — §15b of the feature plan.
 *
 * Walks a corpus of recent setlists and decides which of four prediction
 * archetypes the performer falls under. Output drives both the back-test
 * eval bucketing (Phase 4) and which display variant the show-detail
 * Setlist tab mounts (Phase 5).
 *
 * Output values:
 *   - 'stable'      — top-down setlist with a small song pool (Tate McRae, Coldplay)
 *   - 'rotating'    — gap-based; rare repeats (Phish, Pearl Jam, Springsteen)
 *   - 'theatrical'  — scripted; identical setlist every night (Cirque, Eras)
 *   - 'improvised'  — no useful per-song prediction (DJ sets, free jazz)
 *   - 'unknown'     — corpus too small (< 5 setlists)
 *
 * The classifier is pure — no DB access — so it composes the same way
 * inside the prediction-eval back-test and the nightly refresh cron.
 *
 * Spec: showbook-specs/setlist-intelligence/feature-plan.md §15b,
 *       showbook-specs/setlist-intelligence/phases/phase-05-style-classifier-rotating.md
 */

import type { PerformerSetlist } from '@showbook/shared';
import type { CorpusRow } from './setlist-predict';

export type SetlistStyle = 'stable' | 'rotating' | 'theatrical' | 'improvised';
export type SetlistStyleOrUnknown = SetlistStyle | 'unknown';

export interface InferStyleOpts {
  /**
   * Manual operator override. Always wins regardless of corpus shape.
   * Source: `performers.setlist_style_override`.
   */
  override?: SetlistStyle | null;
  /**
   * Seeded style from the curated seed table. When the auto-classifier
   * disagrees, the caller increments a counter and only flips to the
   * auto-classified value after three consecutive disagreements.
   */
  seed?: SetlistStyle | null;
  /**
   * Minimum corpus size to run the auto-classifier. Defaults to 5 per
   * the spec — below that the classifier returns 'unknown'.
   */
  minCorpusSize?: number;
}

const DEFAULT_MIN_CORPUS = 5;

/** Pure helper — flatten a setlist's titles into a deduped lower-cased set. */
export function setlistSongSet(setlist: PerformerSetlist): Set<string> {
  const out = new Set<string>();
  for (const section of setlist.sections) {
    for (const song of section.songs) {
      const lower = song.title.trim().toLowerCase();
      if (lower.length > 0) out.add(lower);
    }
  }
  return out;
}

/** Mean pairwise Jaccard similarity across every pair of setlists in the
 *  corpus. Returns 0 for a single-setlist corpus (no pair to compare).
 *  Empty intersect ∪ empty union → drop the pair from the average. */
export function meanPairwiseJaccard(songSets: Set<string>[]): number {
  if (songSets.length < 2) return 0;
  let acc = 0;
  let pairs = 0;
  for (let i = 0; i < songSets.length; i++) {
    for (let j = i + 1; j < songSets.length; j++) {
      const a = songSets[i]!;
      const b = songSets[j]!;
      let intersect = 0;
      for (const t of a) if (b.has(t)) intersect += 1;
      const union = a.size + b.size - intersect;
      if (union === 0) continue;
      acc += intersect / union;
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : acc / pairs;
}

/** Unique songs across the corpus divided by total song slots (sum of
 *  setlist lengths). 0 when corpus is empty. */
export function uniqueSongRatio(songSets: Set<string>[]): number {
  const all = new Set<string>();
  let totalSlots = 0;
  for (const s of songSets) {
    totalSlots += s.size;
    for (const t of s) all.add(t);
  }
  return totalSlots === 0 ? 0 : all.size / totalSlots;
}

/** Mean per-setlist song count. Useful for the improvised/DJ-set
 *  detection — sub-6 setlist lengths are the hint. */
export function meanSetlistLength(songSets: Set<string>[]): number {
  if (songSets.length === 0) return 0;
  let total = 0;
  for (const s of songSets) total += s.size;
  return total / songSets.length;
}

export interface StyleSignals {
  jaccard: number;
  uniqueRatio: number;
  meanLength: number;
  corpusSize: number;
}

/** Snapshot of the signals the classifier consumed. Returned alongside
 *  the inferred style for logging + the `setlist.style.classified`
 *  event payload. */
export function styleSignals(corpus: CorpusRow[]): StyleSignals {
  const sets = corpus.map((r) => setlistSongSet(r.setlist));
  return {
    jaccard: meanPairwiseJaccard(sets),
    uniqueRatio: uniqueSongRatio(sets),
    meanLength: meanSetlistLength(sets),
    corpusSize: corpus.length,
  };
}

/**
 * Classify a corpus into one of the four setlist styles. Below the
 * configured corpus minimum the auto-classifier returns 'unknown';
 * the caller is expected to fall through to the seed table.
 *
 * Thresholds match feature-plan §15b verbatim.
 */
export function classifyFromSignals(signals: StyleSignals): SetlistStyleOrUnknown {
  if (signals.corpusSize < DEFAULT_MIN_CORPUS) return 'unknown';
  const { jaccard, uniqueRatio, meanLength } = signals;
  // Theatrical first — its threshold is the tightest case of stable
  // (jaccard ≥ 0.95) so it must shadow the stable rule.
  if (jaccard >= 0.95 && uniqueRatio < 0.1) return 'theatrical';
  if (jaccard >= 0.75 && uniqueRatio < 0.3) return 'stable';
  if (jaccard <= 0.45 && uniqueRatio > 0.5) return 'rotating';
  if (meanLength < 6) return 'improvised';
  return 'stable';
}

/**
 * Full classifier — override > seed-fallback > auto. The seed-table
 * fallback fires when the corpus is too small for the auto-classifier
 * (`unknown`); seed entries are otherwise overridden by the auto
 * result once the caller has counted three consecutive disagreements
 * (callers track that with `styleDisagreementCount` in the DB).
 */
export function inferStyle(
  corpus: CorpusRow[],
  opts: InferStyleOpts = {},
): { style: SetlistStyleOrUnknown; signals: StyleSignals } {
  const signals = styleSignals(corpus);
  if (opts.override) return { style: opts.override, signals };
  const auto = classifyFromSignals(signals);
  if (auto === 'unknown' && opts.seed) {
    return { style: opts.seed, signals };
  }
  return { style: auto, signals };
}

/**
 * Three-runs-to-disagree state transition. Given the previous state
 * (`stored` + `disagreementCount`) and the latest auto-classified
 * value, decide whether to flip the stored style and reset the
 * counter.
 *
 * Behavior:
 *  - When `auto` matches `stored`: counter resets to 0.
 *  - When `auto` is 'unknown' (small corpus): no change.
 *  - When `auto` disagrees: counter increments. If it reaches 3, the
 *    stored value flips to `auto` and the counter resets.
 *  - When `override` is set: override wins; counter resets so the
 *    history doesn't bleed into a future override-cleared state.
 *
 * Returns the next stored style + counter. Pure — caller persists.
 */
export function reconcileStyleTransition(input: {
  stored: SetlistStyleOrUnknown | null;
  disagreementCount: number;
  auto: SetlistStyleOrUnknown;
  seed: SetlistStyle | null;
  override: SetlistStyle | null;
}): {
  nextStored: SetlistStyleOrUnknown;
  nextDisagreementCount: number;
  flipped: boolean;
  reason: 'override' | 'seed_initial' | 'auto_apply' | 'auto_flip' | 'agree' | 'unknown_keep';
} {
  if (input.override) {
    return {
      nextStored: input.override,
      nextDisagreementCount: 0,
      flipped: input.stored !== input.override,
      reason: 'override',
    };
  }
  // No stored value yet — apply seed if we have one, otherwise apply the
  // auto-classifier (which may itself be 'unknown' for sparse corpora).
  if (input.stored === null) {
    if (input.auto !== 'unknown') {
      return {
        nextStored: input.auto,
        nextDisagreementCount: 0,
        flipped: true,
        reason: 'auto_apply',
      };
    }
    if (input.seed) {
      return {
        nextStored: input.seed,
        nextDisagreementCount: 0,
        flipped: true,
        reason: 'seed_initial',
      };
    }
    return {
      nextStored: 'unknown',
      nextDisagreementCount: 0,
      flipped: false,
      reason: 'unknown_keep',
    };
  }
  // Stored value exists. If the auto-classifier returned 'unknown'
  // (corpus too thin this run), don't disturb the stored state.
  if (input.auto === 'unknown') {
    return {
      nextStored: input.stored,
      nextDisagreementCount: input.disagreementCount,
      flipped: false,
      reason: 'unknown_keep',
    };
  }
  if (input.auto === input.stored) {
    return {
      nextStored: input.stored,
      nextDisagreementCount: 0,
      flipped: false,
      reason: 'agree',
    };
  }
  const nextCount = input.disagreementCount + 1;
  if (nextCount >= 3) {
    return {
      nextStored: input.auto,
      nextDisagreementCount: 0,
      flipped: true,
      reason: 'auto_flip',
    };
  }
  return {
    nextStored: input.stored,
    nextDisagreementCount: nextCount,
    flipped: false,
    reason: 'agree',
  };
}
