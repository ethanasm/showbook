/**
 * Theatrical-style predicted setlist. Phase 6 of setlist-intelligence
 * (feature-plan §15c theatrical, §15p display variants).
 *
 * Theatrical artists (Beyoncé Cowboy Carter, Eras-era Taylor Swift,
 * Hamilton tours) ship the same scripted show every night. The
 * stable-§4c probability bar is the wrong UI — every row is ~100%,
 * which reads as overconfident noise. The right model produces a
 * **deterministic setlist** (the running show, ordered) plus a small
 * set of **rotating slots** — the 1-3 positions per show where the
 * edit distance to the canonical setlist is non-zero. The display
 * variant in `TheatricalSetlistView` reserves the eye for those slots
 * while presenting the fixed core as a program.
 *
 * Algorithm (over the Tier-A-equivalent corpus — the same recent
 * window the stable model uses for the active-leg):
 *
 *   1. Group songs by act using the section names from setlist.fm
 *      (`Act I`, `Act II`, etc.). When sections aren't named, group
 *      by section index so the first `kind:'set'` is "Act I", etc.
 *      The encore is its own act.
 *
 *   2. For each (act, position-within-act) slot across the corpus,
 *      compute the song-share distribution. Slots whose top song
 *      occupies ≥95% of the corpus are **fixed**; slots where 3+
 *      candidates each occupy 10-35% share are **rotating**. Slots
 *      whose top song is between those bands fall back to the
 *      top-song "fixed" rendering — the dampened theatrical UI looks
 *      odd when uncertainty sits in only one row.
 *
 *   3. For rotating slots, the candidate probability is **uniform**
 *      unless one candidate appeared in ≥60% of the slot's
 *      occurrences, in which case it carries its observed share and
 *      the others split the remainder proportionally.
 *
 * Outputs are pure — `predictTheatrical` accepts a `CorpusRow[]` and
 * returns the payload the router serves. Identical to
 * `predictRotating` / `predictSetlist`'s pure contract.
 *
 * Spec: docs/specs/setlist-intelligence/phases/phase-06-theatrical-improvised.md,
 *       docs/specs/setlist-intelligence/feature-plan.md §15c (theatrical),
 *       docs/specs/setlist-intelligence/worked-examples.md §3 (Beyoncé).
 */

import type { PerformerSetlist } from '@showbook/shared';
import type { CorpusRow } from './setlist-predict';
import {
  setCountFromSingleCount,
  type SetCountPrediction,
} from './setlist-predict-shared';

const RECENT_WINDOW = 20;
const FIXED_TOP_SHARE = 0.95;
const ROTATING_MIN_SHARE = 0.1;
const ROTATING_MAX_TOP_SHARE = 0.6;
const ROTATING_MIN_CANDIDATES = 3;
const DOMINANT_CANDIDATE_SHARE = 0.6;
const MAX_ROTATING_CANDIDATES = 6;

export interface TheatricalSongRow {
  /** Act label (e.g. 'Act I', 'Act II', 'Encore'). */
  act: string;
  /** Zero-based act index — used for stable sorting. */
  actIndex: number;
  title: string;
  /** Always 1.0 for fixed rows; the prediction is the scripted song. */
  probability: number;
  /** Slot share in the underlying corpus. Equal to probability for
   *  near-deterministic rows; surfaced separately so the UI can label
   *  "32 of 32 shows" honestly when the slot was 100% the same song. */
  slotShare: number;
}

export interface TheatricalRotatingSlot {
  /** Act label this slot lives inside. */
  act: string;
  actIndex: number;
  /** Position within the act (0-based). */
  positionInAct: number;
  /** Human-readable slot label — "Surprise · Act V", "Family appearance · Act VII", etc. */
  slotName: string;
  candidates: Array<{
    title: string;
    /** Probability the candidate fills this slot tonight. */
    probability: number;
    /** Observed share in the corpus for this slot. */
    slotShare: number;
  }>;
}

export interface TheatricalPrediction {
  style: 'theatrical';
  /** Ordered list of the show's deterministic songs — same order
   *  every night. Rotating-slot positions are NOT included here; they
   *  appear inline in the UI via `rotatingSlots`. */
  deterministicSetlist: TheatricalSongRow[];
  rotatingSlots: TheatricalRotatingSlot[];
  /** Mean songs per show — useful for the UI's "1 set · ~39 songs". */
  expectedSongCount: number;
  /** Phase 11 §15f — uniform set/song/duration prediction across all
   *  styles. For theatrical, setCount is always 1 (one scripted act
   *  sequence) and song count comes from the deterministic-set length. */
  setCountPrediction: SetCountPrediction | null;
  /** Number of corpus setlists used. */
  sampleSize: number;
  /** Always near-1.0 for theatrical — the deterministic part is
   *  exact-match — but expressed as a number so the existing
   *  confidence-banner UI doesn't fork. */
  confidence: number;
  tourName: string | null;
  tourId: string | null;
  copy: string;
  spoilerBlurDefault: boolean;
}

export interface PredictTheatricalInput {
  performerId: string;
  targetDate: string;
  corpus: CorpusRow[];
}

interface SlotKey {
  actIndex: number;
  actLabel: string;
  positionInAct: number;
}

interface SlotObservation extends SlotKey {
  /** Map title-lower → { display, count }. */
  counts: Map<string, { display: string; count: number }>;
  total: number;
}

/**
 * Build the theatrical prediction over a loaded corpus. The corpus is
 * truncated to `targetDate` exclusive — same convention as
 * `predictRotating` and the stable model.
 */
export function predictTheatrical(input: PredictTheatricalInput): TheatricalPrediction {
  const corpus = input.corpus
    .filter((r) => r.performanceDate !== input.targetDate)
    .sort((a, b) => b.performanceDate.localeCompare(a.performanceDate))
    .slice(0, RECENT_WINDOW);

  // ── Slot-by-slot tally across the corpus ─────────────────────────
  const slots = new Map<string, SlotObservation>();
  let totalSongs = 0;
  for (const row of corpus) {
    const acts = splitIntoActs(row.setlist);
    for (const act of acts) {
      for (let pos = 0; pos < act.songs.length; pos += 1) {
        const lower = act.songs[pos]!.trim().toLowerCase();
        if (lower.length === 0) continue;
        const key = `${act.index}::${pos}`;
        let slot = slots.get(key);
        if (!slot) {
          slot = {
            actIndex: act.index,
            actLabel: act.label,
            positionInAct: pos,
            counts: new Map(),
            total: 0,
          };
          slots.set(key, slot);
        }
        const entry = slot.counts.get(lower);
        if (entry) {
          entry.count += 1;
        } else {
          slot.counts.set(lower, { display: act.songs[pos]!, count: 1 });
        }
        slot.total += 1;
      }
      totalSongs += act.songs.length;
    }
  }

  const deterministicSetlist: TheatricalSongRow[] = [];
  const rotatingSlots: TheatricalRotatingSlot[] = [];
  const orderedSlots = Array.from(slots.values()).sort((a, b) => {
    if (a.actIndex !== b.actIndex) return a.actIndex - b.actIndex;
    return a.positionInAct - b.positionInAct;
  });

  for (const slot of orderedSlots) {
    const ranked = Array.from(slot.counts.entries())
      .map(([lower, entry]) => ({
        lower,
        title: entry.display,
        share: entry.count / slot.total,
        count: entry.count,
      }))
      .sort((a, b) => b.share - a.share);
    if (ranked.length === 0) continue;

    const top = ranked[0]!;
    const eligibleRotating = ranked.filter((r) => r.share >= ROTATING_MIN_SHARE);
    const isRotating =
      top.share <= ROTATING_MAX_TOP_SHARE &&
      eligibleRotating.length >= ROTATING_MIN_CANDIDATES;

    if (top.share >= FIXED_TOP_SHARE || !isRotating) {
      deterministicSetlist.push({
        act: slot.actLabel,
        actIndex: slot.actIndex,
        title: top.title,
        probability: 1,
        slotShare: Number(top.share.toFixed(2)),
      });
    } else {
      const slotName = composeSlotName({
        actLabel: slot.actLabel,
        positionInAct: slot.positionInAct,
      });
      rotatingSlots.push({
        act: slot.actLabel,
        actIndex: slot.actIndex,
        positionInAct: slot.positionInAct,
        slotName,
        candidates: computeRotatingProbabilities(eligibleRotating).slice(0, MAX_ROTATING_CANDIDATES),
      });
    }
  }

  // Tour name — most-recent corpus row that carries one wins.
  let tourId: string | null = null;
  let tourName: string | null = null;
  for (const r of corpus) {
    if (r.tourId || r.tourName) {
      tourId = r.tourId;
      tourName = r.tourName;
      break;
    }
  }

  const expectedSongCount = corpus.length > 0 ? Math.round(totalSongs / corpus.length) : 0;
  const sampleSize = corpus.length;
  // Theatrical confidence is near-1: the deterministic part is an
  // exact-match, and rotating slots are scored separately by the eval
  // harness. Floor it at 0.85 once we have ≥3 setlists.
  const confidence = sampleSize >= 3 ? Math.min(0.99, 0.85 + 0.01 * Math.min(sampleSize, 14)) : 0.5;
  const copy = composeCopy({ rotatingSlots, deterministicSetlist });

  return {
    style: 'theatrical',
    deterministicSetlist,
    rotatingSlots,
    expectedSongCount,
    setCountPrediction:
      expectedSongCount > 0 ? setCountFromSingleCount(expectedSongCount) : null,
    sampleSize,
    confidence: Number(confidence.toFixed(2)),
    tourId,
    tourName,
    copy,
    spoilerBlurDefault: true,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

interface ParsedAct {
  index: number;
  label: string;
  songs: string[];
}

/**
 * Walk a setlist's sections and emit one act per section. The label
 * uses the section's `name` when present (setlist.fm carries "Act I",
 * "Act II", etc. for theatrical tours); falls back to `Act ${roman}`
 * for unnamed `kind:'set'` sections and `Encore` for `kind:'encore'`.
 */
function splitIntoActs(setlist: PerformerSetlist): ParsedAct[] {
  const out: ParsedAct[] = [];
  let setIndex = 0;
  for (let i = 0; i < setlist.sections.length; i += 1) {
    const section = setlist.sections[i]!;
    const songs = section.songs.map((s) => s.title);
    if (songs.length === 0) continue;
    let label: string;
    if (section.kind === 'encore') {
      label = section.name?.trim() || 'Encore';
    } else {
      const namedAct = section.name?.trim();
      if (namedAct && namedAct.length > 0) {
        label = namedAct;
      } else {
        setIndex += 1;
        label = `Act ${toRoman(setIndex)}`;
      }
    }
    out.push({ index: i, label, songs });
  }
  return out;
}

function toRoman(n: number): string {
  if (n <= 0) return String(n);
  const map: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let remainder = n;
  let out = '';
  for (const [value, letter] of map) {
    while (remainder >= value) {
      out += letter;
      remainder -= value;
    }
  }
  return out;
}

function composeSlotName(opts: { actLabel: string; positionInAct: number }): string {
  // The Beyoncé spec calls Act V's variable slot the "surprise slot"
  // and Act VII the "family appearance" — neither is detectable from
  // the corpus alone, so we surface a generic descriptor and rely on
  // the UI to pretty-print further if it wants to. Position +1 in the
  // label is human-friendly.
  return `Variable · ${opts.actLabel} · slot ${opts.positionInAct + 1}`;
}

function computeRotatingProbabilities(
  ranked: Array<{ title: string; share: number }>,
): Array<{ title: string; probability: number; slotShare: number }> {
  if (ranked.length === 0) return [];
  const top = ranked[0]!;
  if (top.share >= DOMINANT_CANDIDATE_SHARE) {
    // Dominant candidate keeps its observed share; remainder splits
    // proportional to the observed shares of the rest.
    const remainder = 1 - top.share;
    const restTotal = ranked.slice(1).reduce((a, r) => a + r.share, 0);
    return ranked.map((r, i) => {
      if (i === 0) {
        return {
          title: r.title,
          probability: Number(r.share.toFixed(2)),
          slotShare: Number(r.share.toFixed(2)),
        };
      }
      const probability = restTotal > 0 ? (r.share / restTotal) * remainder : remainder / (ranked.length - 1);
      return {
        title: r.title,
        probability: Number(probability.toFixed(2)),
        slotShare: Number(r.share.toFixed(2)),
      };
    });
  }
  // No dominant candidate — distribute uniformly over the eligible
  // candidates so the UI doesn't fake a confidence we don't have.
  const uniform = 1 / ranked.length;
  return ranked.map((r) => ({
    title: r.title,
    probability: Number(uniform.toFixed(2)),
    slotShare: Number(r.share.toFixed(2)),
  }));
}

function composeCopy(opts: {
  rotatingSlots: TheatricalRotatingSlot[];
  deterministicSetlist: TheatricalSongRow[];
}): string {
  if (opts.deterministicSetlist.length === 0) {
    return "We need at least a few setlists to map this tour's program.";
  }
  if (opts.rotatingSlots.length === 0) {
    return "Tonight's show is choreographed top to bottom — the same setlist every night.";
  }
  const count = opts.rotatingSlots.length;
  const noun = count === 1 ? 'one rotating slot' : `${count} rotating slots`;
  return `Tonight's show is choreographed top to bottom — the same setlist with ${noun}.`;
}

// ─────────────────────────────────────────────────────────────────────
// Phase 6 post-show observability — `setlist.theatrical.surprise_slot_hit`
// ─────────────────────────────────────────────────────────────────────

export interface TheatricalSlotHit {
  performerId: string;
  slotIndex: number;
  slotName: string;
  /** True when the actual song at this slot position appeared in the
   *  prediction's candidate set; false when the band surprised us. */
  hit: boolean;
  /** The title the model would have picked first (highest probability). */
  predictedTopTitle: string | null;
  /** Whatever actually played at this slot position. */
  actualTitle: string | null;
}

/**
 * Compute hit/miss events for each rotating slot in a theatrical
 * prediction, given the actual setlist that played. Pure — the caller
 * (typically the setlist-retry job, which is where actual setlists
 * land) is responsible for emitting `setlist.theatrical.surprise_slot_hit`
 * log lines from the returned events.
 *
 * The actual setlist is flattened to a positional title list per act;
 * the slot's (actIndex, positionInAct) tuple addresses into that list.
 * When the actual setlist has fewer songs in an act than the
 * prediction's slot position, `actualTitle` is null and `hit` is
 * false.
 */
export function computeTheatricalSurpriseSlotHits(opts: {
  performerId: string;
  prediction: TheatricalPrediction;
  actualSetlistByAct: Array<{ actIndex: number; songs: string[] }>;
}): TheatricalSlotHit[] {
  const byAct = new Map<number, string[]>();
  for (const entry of opts.actualSetlistByAct) {
    byAct.set(entry.actIndex, entry.songs.map((s) => s.trim().toLowerCase()));
  }
  return opts.prediction.rotatingSlots.map((slot, idx) => {
    const actSongs = byAct.get(slot.actIndex) ?? [];
    const actualLower = actSongs[slot.positionInAct] ?? null;
    const candidatesLower = new Set(
      slot.candidates.map((c) => c.title.trim().toLowerCase()),
    );
    const hit = actualLower !== null && candidatesLower.has(actualLower);
    const top = slot.candidates[0]?.title ?? null;
    return {
      performerId: opts.performerId,
      slotIndex: idx,
      slotName: slot.slotName,
      hit,
      predictedTopTitle: top,
      actualTitle:
        actualLower !== null && actSongs[slot.positionInAct]
          ? opts.actualSetlistByAct
              .find((a) => a.actIndex === slot.actIndex)
              ?.songs[slot.positionInAct] ?? actualLower
          : null,
    };
  });
}
