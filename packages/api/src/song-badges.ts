/**
 * Song-badge resolver. Computes the inline 🆕 / 🎯 badge map that
 * decorates the Setlist tab's track rows on the show-detail page.
 *
 * Two badges, scope deliberately distinguished in the labels:
 *
 *   - `firstTime`  — user-scoped. This attended show is the earliest
 *                    known appearance of the song in the user's
 *                    attended setlist history. Renders as 🆕 "Your
 *                    first" with tooltip "The show where you first
 *                    heard this live".
 *   - `rareCatch`  — artist-scoped. The song appears in fewer than
 *                    `RARE_THRESHOLD` of the performer's recent corpus
 *                    setlists (12-month window). Renders as 💎 "Rare"
 *                    with the fraction in a tooltip.
 *
 * The resolver is split into two pieces:
 *   1. A pure `computeSongBadges` function that takes already-loaded
 *      appearance + corpus rows and returns the badge map — easy to
 *      unit test, no DB.
 *   2. The router procedure (`shows.songBadges`) that hits the DB and
 *      calls into it.
 */

export const RARE_THRESHOLD = 0.05; // < 5% of recent corpus = "rare"
const RARE_MIN_CORPUS_TOTAL = 10; // need ≥10 setlists to call anything "rare"

export interface FirstAppearanceRow {
  songId: string;
  /** Earliest attended date the user heard this song. ISO YYYY-MM-DD. */
  firstDate: string;
}

export interface CorpusFrequencyRow {
  songId: string;
  /** Number of corpus setlists in the last 12 months that contain this song. */
  corpusHits: number;
}

export interface SongBadge {
  firstTime: boolean;
  /** Corpus-frequency rarity. `null` when not rare or when corpus is too thin. */
  rareCatch: { fractionPct: number } | null;
}

export type SongBadgesMap = Record<string, SongBadge>;

export interface ComputeSongBadgesInput {
  /** Songs played at the target show, in display order. */
  songIds: string[];
  /** This show's date (ISO YYYY-MM-DD). */
  showDate: string | null;
  /** For each songId in the input, the earliest attended date the user heard it. */
  firstAppearances: FirstAppearanceRow[];
  /** Corpus hit counts per songId across the last 12 months of `tour_setlists`. */
  corpusFrequencies: CorpusFrequencyRow[];
  /** Total distinct corpus setlists in the same 12-month window, per performer. */
  corpusTotalForPerformer: number;
}

/**
 * Pure computation of the badge map. The router procedure loads the
 * rows and calls this; tests can call it directly with fixture data.
 */
export function computeSongBadges(input: ComputeSongBadgesInput): SongBadgesMap {
  const firstByteOf = new Map(
    input.firstAppearances.map((r) => [r.songId, r.firstDate]),
  );
  const corpusByteOf = new Map(
    input.corpusFrequencies.map((r) => [r.songId, r.corpusHits]),
  );
  const out: SongBadgesMap = {};
  for (const songId of input.songIds) {
    const firstDate = firstByteOf.get(songId);
    const firstTime = Boolean(
      input.showDate && firstDate && firstDate === input.showDate,
    );
    let rareCatch: SongBadge['rareCatch'] = null;
    if (input.corpusTotalForPerformer >= RARE_MIN_CORPUS_TOTAL) {
      const hits = corpusByteOf.get(songId) ?? 0;
      const fraction = hits / input.corpusTotalForPerformer;
      if (fraction < RARE_THRESHOLD) {
        rareCatch = { fractionPct: Math.max(1, Math.round(fraction * 100)) };
      }
    }
    // Skip songs with no badge at all so the map is sparse — easier
    // for the UI to short-circuit when nothing renders.
    if (firstTime || rareCatch) {
      out[songId] = { firstTime, rareCatch };
    }
  }
  return out;
}
