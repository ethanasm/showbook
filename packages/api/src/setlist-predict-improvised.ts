/**
 * Improvised-style predicted setlist. Phase 6 of setlist-intelligence
 * (feature-plan §15d improvised, §15p display variants).
 *
 * Improvised artists (King Gizzard, Phish-in-some-eras, free-jazz
 * residencies) defy song-by-song prediction by design — the band
 * picks each night's program in the dressing room, often without
 * announcing in advance. The model **refuses** to emit a song list
 * and instead surfaces:
 *
 *   - **Show-mode odds** — King Gizzard alternates between "Regular"
 *     (~11 songs) and "Marathon" (~26 songs) nights, sometimes a
 *     "Microtonal" night drawing from K.G. / L.W. material. We
 *     cluster setlist lengths into modes via a 1-D k-means with
 *     k=3 (the marathon-vs-regular gap is large enough that this
 *     converges reliably; we cap k=3 because the worked example has
 *     three documented modes).
 *
 *   - **Vibe sketch** — show-level shape: energy curve buckets, key
 *     counts, album coverage, "spacier than usual" deltas. v1 uses
 *     the corpus directly rather than a hand-curated descriptor so
 *     the model picks up new tendencies automatically. The 7-axis
 *     VibeRadar shape from the design handoff is populated with the
 *     sketch values; the UI renders the same component shape as
 *     elsewhere on the show page.
 *
 *   - **No song list.** The likely-setlist section is replaced with a
 *     copy block explaining why ("no song-by-song prediction tonight
 *     — here's the shape").
 *
 * Spec: docs/specs/setlist-intelligence/phases/phase-06-theatrical-improvised.md,
 *       docs/specs/setlist-intelligence/feature-plan.md §15d (improvised),
 *       docs/specs/setlist-intelligence/worked-examples.md §4 (King Gizzard).
 */

import type { PerformerSetlist } from '@showbook/shared';
import type { CorpusRow } from './setlist-predict';
import {
  setCountFromShowModes,
  type SetCountPrediction,
} from './setlist-predict-shared';

const RECENT_WINDOW = 10;
/** Weight applied to the i-th most-recent setlist: w_i = RECENCY_BASE^i.
 *  At 0.92 the 10th-oldest setlist still carries ~43% the weight of the
 *  newest — recent shows lean in, older shows aren't ignored. */
const RECENCY_BASE = 0.92;
/** Number of vibe-radar axes — the design handoff uses 7, populated
 *  here as a stable order so the UI can map them positionally. */
export const VIBE_AXES = [
  'energy',
  'danceability',
  'jamLength',
  'novelty',
  'heaviness',
  'psychedelia',
  'tempo',
] as const;

export type VibeAxis = (typeof VIBE_AXES)[number];

export interface ShowMode {
  /** Mode label — "Regular", "Marathon", "Microtonal", "Mixed", etc. */
  label: string;
  /** Probability the next show lands in this mode. Sums to 1.0 across
   *  the array. */
  probability: number;
  /** Median song count for the cluster — what the UI shows as "~26
   *  songs" / "~11 songs". */
  expectedSongCount: number;
  /** Number of historical shows that landed in this mode. */
  occurrences: number;
}

export interface VibeSketch {
  /** Short headline descriptor — "high-energy psych-rock with
   *  extended jams" for King Gizzard. */
  headlineDescriptor: string;
  /** 7-axis radar values, 0–1. Order = VIBE_AXES. */
  axes: Record<VibeAxis, number>;
  /** "Spacier than usual" / "shorter than usual" deltas vs. the
   *  performer's historical baseline. Empty when there's not enough
   *  corpus to derive a baseline. */
  deltas: VibeDelta[];
  /** Most-played-recently songs surfaced as "you'll probably hear
   *  something from these" rather than per-song probabilities. */
  popularPicks: Array<{
    title: string;
    playedShare: number;
    lastPlayedDate: string | null;
  }>;
  /** Albums represented in the recent corpus — feeds the
   *  "recent albums you'll likely hear from" list in the UI. */
  albumsRepresentedRecently: string[];
  /** Curated tendencies for seed-listed artists; auto-generated v1
   *  leaves this empty. */
  knownTendencies: string[];
}

export interface VibeDelta {
  axis: VibeAxis;
  /** Signed delta vs. baseline. +0.2 = "20pp spacier than usual"; -0.15
   *  = "shorter set than usual". */
  delta: number;
  /** Human-readable copy for the chip. */
  description: string;
}

export interface ImprovisedPrediction {
  style: 'improvised';
  showModes: ShowMode[];
  vibeSketch: VibeSketch;
  copy: string;
  /** Improvised confidence is intentionally low — the prediction is
   *  the shape, not the songs. */
  confidence: number;
  sampleSize: number;
  tourId: string | null;
  tourName: string | null;
  spoilerBlurDefault: boolean;
  /** Phase 11 §15f — uniform set/song/duration prediction. For
   *  improvised, aggregated across show modes weighted by mode
   *  probability so the UI strip shows the "most likely tonight"
   *  length instead of a per-mode breakdown. */
  setCountPrediction: SetCountPrediction | null;
}

export interface PredictImprovisedInput {
  performerId: string;
  targetDate: string;
  corpus: CorpusRow[];
  /** Optional curated overrides applied when the auto-generated
   *  sketch is too generic — Phase 11 stretch territory. v1 callers
   *  pass nothing. */
  curated?: {
    headlineDescriptor?: string;
    knownTendencies?: string[];
  };
}

/**
 * Compute the improvised-style payload over a loaded corpus. Pure —
 * no DB access. The cache wrapper lives at the router level.
 */
export function predictImprovised(input: PredictImprovisedInput): ImprovisedPrediction {
  const corpus = input.corpus
    .filter((r) => r.performanceDate !== input.targetDate)
    .sort((a, b) => b.performanceDate.localeCompare(a.performanceDate))
    .slice(0, RECENT_WINDOW);

  const sampleSize = corpus.length;
  const showModes = computeShowModes(corpus);
  const vibeSketch = computeVibeSketch({
    corpus,
    curated: input.curated,
  });

  let tourId: string | null = null;
  let tourName: string | null = null;
  for (const r of corpus) {
    if (r.tourId || r.tourName) {
      tourId = r.tourId;
      tourName = r.tourName;
      break;
    }
  }

  const copy = sampleSize > 0
    ? "We can't predict tonight's setlist song-by-song — here's the shape."
    : 'Not enough recent setlists to sketch tonight yet.';

  return {
    style: 'improvised',
    showModes,
    vibeSketch,
    copy,
    confidence: sampleSize >= 5 ? 0.25 : 0.15,
    sampleSize,
    tourId,
    tourName,
    spoilerBlurDefault: false,
    setCountPrediction: setCountFromShowModes(showModes),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Show-mode clustering
// ─────────────────────────────────────────────────────────────────────

/**
 * Cluster setlist lengths into at most 3 modes via a deterministic
 * 1-D k-means. Initial centroids are spread across the (min, max)
 * range so the algorithm is reproducible — no random init. We stop
 * after 20 iterations or when no point changes cluster.
 *
 * Returns at most 3 modes; small corpora collapse to fewer. Always
 * returns at least one mode so the UI always has something to render.
 */
export function computeShowModes(corpus: CorpusRow[]): ShowMode[] {
  if (corpus.length === 0) return [];
  const lengths = corpus.map((r) => songsInSetlist(r.setlist));
  const distinct = Array.from(new Set(lengths)).sort((a, b) => a - b);
  const k = Math.min(3, distinct.length);
  if (k === 0) return [];
  if (k === 1) {
    return [
      {
        label: 'Standard',
        probability: 1,
        expectedSongCount: distinct[0]!,
        occurrences: corpus.length,
      },
    ];
  }

  // Spread initial centroids evenly across the sorted-distinct values.
  // For k=2 → [min, max]. For k=3 → [min, median, max]. Stable input
  // means a stable cluster mapping.
  const centroids: number[] = [];
  for (let i = 0; i < k; i += 1) {
    const ratio = k === 1 ? 0 : i / (k - 1);
    const idx = Math.round(ratio * (distinct.length - 1));
    centroids.push(distinct[idx]!);
  }

  const assignments = new Array(lengths.length).fill(0);
  for (let iter = 0; iter < 20; iter += 1) {
    let changed = false;
    for (let i = 0; i < lengths.length; i += 1) {
      const x = lengths[i]!;
      let bestC = 0;
      let bestD = Math.abs(x - centroids[0]!);
      for (let c = 1; c < k; c += 1) {
        const d = Math.abs(x - centroids[c]!);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        changed = true;
      }
    }
    // Recompute centroids.
    for (let c = 0; c < k; c += 1) {
      const members = lengths.filter((_, idx) => assignments[idx] === c);
      if (members.length > 0) {
        centroids[c] = members.reduce((a, b) => a + b, 0) / members.length;
      }
    }
    if (!changed) break;
  }

  // Build per-cluster summary with recency-weighted probabilities so
  // recent shows lean the prediction. We weight the assignment counts
  // by RECENCY_BASE^i where i = newest-first index.
  const recencyWeights = new Array(lengths.length).fill(0);
  let recencyTotal = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    const w = Math.pow(RECENCY_BASE, i);
    recencyWeights[i] = w;
    recencyTotal += w;
  }

  const modeSummaries = new Map<number, { weight: number; lengths: number[]; centroid: number }>();
  for (let i = 0; i < lengths.length; i += 1) {
    const c = assignments[i] as number;
    let summary = modeSummaries.get(c);
    if (!summary) {
      summary = { weight: 0, lengths: [], centroid: centroids[c]! };
      modeSummaries.set(c, summary);
    }
    summary.weight += recencyWeights[i]!;
    summary.lengths.push(lengths[i]!);
  }

  // Discard empty clusters; assign labels by centroid ascending so the
  // smallest mode is "Regular" (or "Short"), the biggest is "Marathon".
  const ordered = Array.from(modeSummaries.entries())
    .filter(([, s]) => s.lengths.length > 0)
    .sort(([, a], [, b]) => a.centroid - b.centroid);

  const totalWeight = ordered.reduce((a, [, s]) => a + s.weight, 0) || recencyTotal;
  const out: ShowMode[] = ordered.map(([, summary], idx) => {
    const label = labelForCentroid({
      centroid: summary.centroid,
      orderIndex: idx,
      count: ordered.length,
    });
    return {
      label,
      probability: Number((summary.weight / totalWeight).toFixed(2)),
      expectedSongCount: Math.round(median(summary.lengths)),
      occurrences: summary.lengths.length,
    };
  });

  // Normalize tiny rounding drift so probabilities sum to 1.0.
  const sum = out.reduce((a, m) => a + m.probability, 0);
  if (sum > 0 && Math.abs(sum - 1) > 0.001 && out.length > 0) {
    const drift = 1 - sum;
    out[0] = { ...out[0]!, probability: Number((out[0]!.probability + drift).toFixed(2)) };
  }

  return out;
}

function labelForCentroid(opts: { centroid: number; orderIndex: number; count: number }): string {
  // Labels follow the worked-example vocabulary. Centroid bands match
  // the King Gizzard split (~11 regular, ~26 marathon).
  if (opts.count === 1) return 'Standard set';
  if (opts.count === 2) {
    return opts.orderIndex === 0 ? 'Regular set' : 'Marathon set';
  }
  if (opts.orderIndex === 0) return 'Short set';
  if (opts.orderIndex === opts.count - 1) return 'Marathon set';
  return 'Regular set';
}

// ─────────────────────────────────────────────────────────────────────
// Vibe sketch
// ─────────────────────────────────────────────────────────────────────

/**
 * The vibe sketch is the **show-level** shape — the same VibeRadar
 * shape Phase 8 will use, but populated from corpus stats rather than
 * per-track audio features (the SI-16 deprecation note in
 * `feature-plan.md` is why Phase 8 stays gated; the improvised model
 * computes axes from setlist shape instead so it ships without the
 * Spotify audio-features dependency).
 *
 * Each axis is a 0–1 number derived from the corpus:
 *
 *   - **energy**: mean songs-per-show normalised to a 30-song cap.
 *     Marathon-heavy corpora push this up; regular-set corpora sit
 *     mid-range.
 *   - **danceability**: count of repeated titles vs. unique — high
 *     when the band cycles a small pool, low when novelty dominates.
 *   - **jamLength**: mean songs per section. Long single-section
 *     setlists indicate continuous jams.
 *   - **novelty**: unique-songs / total-slots. King Gizzard's 0.83
 *     uniqueRatio reads as a high-novelty signal.
 *   - **heaviness**: encore-section presence rate. A heuristic
 *     placeholder — flagged as such in the UI.
 *   - **psychedelia**: ratio of titles longer than 12 characters
 *     (band-specific but stable across the King Gizzard corpus).
 *   - **tempo**: 1 - novelty (inverse of unique-ratio). Surfaces the
 *     "familiar tonight vs. wild tonight" axis.
 */
export function computeVibeSketch(opts: {
  corpus: CorpusRow[];
  curated?: PredictImprovisedInput['curated'];
}): VibeSketch {
  const corpus = opts.corpus;
  if (corpus.length === 0) {
    const zero: Record<VibeAxis, number> = Object.fromEntries(
      VIBE_AXES.map((axis) => [axis, 0]),
    ) as Record<VibeAxis, number>;
    return {
      headlineDescriptor:
        opts.curated?.headlineDescriptor ?? 'Not enough data to sketch tonight yet.',
      axes: zero,
      deltas: [],
      popularPicks: [],
      albumsRepresentedRecently: [],
      knownTendencies: opts.curated?.knownTendencies ?? [],
    };
  }

  const totalSongs = corpus.reduce((a, r) => a + songsInSetlist(r.setlist), 0);
  const meanLength = totalSongs / corpus.length;
  const titleCounts = new Map<string, { count: number; display: string; lastDate: string | null }>();
  let totalSlots = 0;
  let encoreShows = 0;
  let longTitleSlots = 0;
  let totalSections = 0;
  for (const row of corpus) {
    let hasEncore = false;
    for (const section of row.setlist.sections) {
      if (section.songs.length === 0) continue;
      totalSections += 1;
      if (section.kind === 'encore') hasEncore = true;
      for (const song of section.songs) {
        const lower = song.title.trim().toLowerCase();
        if (lower.length === 0) continue;
        totalSlots += 1;
        if (song.title.length > 12) longTitleSlots += 1;
        const entry = titleCounts.get(lower);
        if (entry) {
          entry.count += 1;
          if (!entry.lastDate || row.performanceDate > entry.lastDate) {
            entry.lastDate = row.performanceDate;
          }
        } else {
          titleCounts.set(lower, {
            count: 1,
            display: song.title,
            lastDate: row.performanceDate,
          });
        }
      }
    }
    if (hasEncore) encoreShows += 1;
  }
  const uniqueRatio = totalSlots === 0 ? 0 : titleCounts.size / totalSlots;
  const energy = Math.min(1, meanLength / 30);
  const danceability = Math.max(0, 1 - uniqueRatio);
  const jamLength = totalSections === 0
    ? 0
    : Math.min(1, totalSlots / totalSections / 15);
  const heaviness = corpus.length === 0 ? 0 : encoreShows / corpus.length;
  const psychedelia = totalSlots === 0 ? 0 : longTitleSlots / totalSlots;

  const axes: Record<VibeAxis, number> = {
    energy: round2(energy),
    danceability: round2(danceability),
    jamLength: round2(jamLength),
    novelty: round2(uniqueRatio),
    heaviness: round2(heaviness),
    psychedelia: round2(psychedelia),
    tempo: round2(1 - uniqueRatio),
  };

  // Popular picks — songs whose recent share crosses 0.25.
  const POPULAR_THRESHOLD = 0.25;
  const popularPicks = Array.from(titleCounts.values())
    .map((entry) => ({
      title: entry.display,
      playedShare: Number((entry.count / corpus.length).toFixed(2)),
      lastPlayedDate: entry.lastDate,
    }))
    .filter((p) => p.playedShare >= POPULAR_THRESHOLD)
    .sort((a, b) => b.playedShare - a.playedShare)
    .slice(0, 8);

  const headlineDescriptor =
    opts.curated?.headlineDescriptor ??
    composeHeadlineDescriptor({ energy, novelty: uniqueRatio, jamLength });

  // Deltas vs the corpus mean — at v1 we just flag values > 0.7 as
  // "unusually X" so the UI has something to render without a separate
  // historical baseline call.
  const deltas: VibeDelta[] = [];
  if (axes.energy >= 0.7) {
    deltas.push({ axis: 'energy', delta: axes.energy - 0.5, description: 'higher-energy run' });
  }
  if (axes.novelty >= 0.7) {
    deltas.push({ axis: 'novelty', delta: axes.novelty - 0.5, description: 'spacier than usual' });
  }
  if (axes.jamLength >= 0.7) {
    deltas.push({ axis: 'jamLength', delta: axes.jamLength - 0.5, description: 'long-form jam-heavy' });
  }

  return {
    headlineDescriptor,
    axes,
    deltas,
    popularPicks,
    albumsRepresentedRecently: [],
    knownTendencies: opts.curated?.knownTendencies ?? [],
  };
}

function composeHeadlineDescriptor(opts: {
  energy: number;
  novelty: number;
  jamLength: number;
}): string {
  if (opts.novelty >= 0.7 && opts.jamLength >= 0.6) {
    return 'high-novelty, jam-heavy nights';
  }
  if (opts.energy >= 0.7) return 'high-energy run';
  if (opts.novelty >= 0.6) return 'shape-shifting setlists';
  return 'rotating-set band — expect variety';
}

// ─────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────

function songsInSetlist(setlist: PerformerSetlist): number {
  let total = 0;
  for (const section of setlist.sections) total += section.songs.length;
  return total;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────
// Phase 6 post-show observability — `setlist.improvised.show_mode_hit`
// ─────────────────────────────────────────────────────────────────────

export interface ImprovisedShowModeHit {
  performerId: string;
  /** The mode label the prediction ranked highest. */
  predictedMode: string | null;
  /** The mode the actual setlist landed in, derived by snapping the
   *  actual song count to the closest predicted mode centroid. */
  actualMode: string | null;
  /** True when predicted == actual. */
  hit: boolean;
  /** Number of songs in the actual setlist. */
  actualSongCount: number;
}

/**
 * Compute the show-mode hit/miss event for an improvised prediction
 * paired with the actual setlist length. Pure — the caller emits
 * `setlist.improvised.show_mode_hit` lines from the returned record.
 *
 * Mapping the actual setlist to a mode uses the same nearest-centroid
 * rule the eval cron uses for `improvisedObs`. When the prediction
 * carries no modes (cold corpus), the function returns null.
 */
export function computeImprovisedShowModeHit(opts: {
  performerId: string;
  prediction: ImprovisedPrediction;
  actualSongCount: number;
}): ImprovisedShowModeHit | null {
  if (opts.prediction.showModes.length === 0) return null;
  const predictedMode = opts.prediction.showModes[0]!.label;
  let actualMode = opts.prediction.showModes[0]!.label;
  let bestDist = Math.abs(opts.actualSongCount - opts.prediction.showModes[0]!.expectedSongCount);
  for (const mode of opts.prediction.showModes.slice(1)) {
    const d = Math.abs(opts.actualSongCount - mode.expectedSongCount);
    if (d < bestDist) {
      bestDist = d;
      actualMode = mode.label;
    }
  }
  return {
    performerId: opts.performerId,
    predictedMode,
    actualMode,
    hit: predictedMode === actualMode,
    actualSongCount: opts.actualSongCount,
  };
}
