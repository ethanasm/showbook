/**
 * Gap-based rotating-style predicted setlist. §15c–15e of the feature
 * plan and the Setlist tab rotating display in Phase 5.
 *
 * For artists classified as 'rotating' the §4c stable algorithm is the
 * wrong model — raw frequency rewards songs played in *most* recent
 * setlists, but rotating-style artists almost never repeat a song.
 * The right signal is overdue-ness: a current-gap that exceeds the
 * song's historical mean gap. This module produces:
 *   - `due`               — overdue_score ≥ 1.5
 *   - `hot`               — frequency ≥ 40% in last 10 setlists
 *   - `bustoutCandidates` — overdue_score ≥ 3 AND ≥5 historical plays
 *   - `positions`         — per-slot pools (opener / encore close / etc.)
 *   - `multiNightContext` — same-venue run anti-repeat (§15e)
 *
 * Pure — accepts a loaded corpus + optional multi-night-run context.
 *
 * Spec: specs/setlist-intelligence/feature-plan.md §15c-§15e,
 *       specs/setlist-intelligence/phases/phase-05-style-classifier-rotating.md
 */

import type { PerformerSetlist } from '@showbook/shared';
import type { CorpusRow, SongRole } from './setlist-predict';
import type { RunContext } from './multi-night-run-detector';
import { computeSetCount, type SetCountPrediction } from './setlist-predict-shared';

const MS_PER_DAY = 86_400_000;
const RECENT_WINDOW = 10; // "in the last 10 setlists"
const DUE_THRESHOLD = 1.5; // overdue_score ≥ 1.5 lands in due
const BUSTOUT_THRESHOLD = 3; // overdue_score ≥ 3 + ≥5 plays
const BUSTOUT_MIN_PLAYS = 5;
const HOT_SHARE = 0.4; // played in ≥40% of recent
const TOP_DUE = 30; // cap "due" list size
const TOP_HOT = 12; // cap "hot" list
const TOP_BUSTOUT = 8; // cap "bustout" list
const POSITION_POOL_SIZE = 10; // candidates per slot

export type PositionRole = 'opener' | 'closer' | 'encore_open' | 'encore_close';

export interface OverdueSong {
  title: string;
  currentGap: number;
  meanGap: number;
  overdueScore: number;
  totalPlays: number;
  lastPlayedDate: string | null;
}

export interface HotSong {
  title: string;
  playedCount: number;
  playedShare: number;
  evidence: string;
}

export interface PositionPoolCandidate {
  title: string;
  slotShare: number;
  /** True when the song was played at this position earlier in the same
   *  multi-night run. UI renders these greyed-out + struck through. */
  playedThisRun?: boolean;
  /** True when the song has both a high overdue score AND occupies this
   *  position frequently — the "Tweezer Reprise" star. */
  dueDoubleFlag?: boolean;
}

export interface PositionPool {
  role: PositionRole;
  poolEntropy: number;
  candidates: PositionPoolCandidate[];
}

export interface MultiNightContext {
  venue: string;
  runIndex: number;
  priorNights: number;
  songsAlreadyPlayed: string[];
  runStartDate: string;
}

export interface RotatingPrediction {
  style: 'rotating';
  due: OverdueSong[];
  hot: HotSong[];
  bustoutCandidates: OverdueSong[];
  positions: PositionPool[];
  multiNightContext: MultiNightContext | null;
  copy: string;
  confidence: number;
  sampleSize: number;
  tourName: string | null;
  tourId: string | null;
  /** Phase 11 §15f — uniform set/song/duration prediction surfaced
   *  inline as "{setCount} sets · ~{p50} songs · ~{minutes} min". */
  setCountPrediction: SetCountPrediction | null;
}

export type RotatingPredictionResult = RotatingPrediction;

export interface PredictRotatingInput {
  performerId: string;
  targetDate: string;
  corpus: CorpusRow[];
  /** When supplied, the run's already-played songs feed the "played
   *  this run" badge on position pools and the songsAlreadyPlayed list
   *  on the multi-night banner. */
  multiNightRun?: RunContext | null;
}

/**
 * Compute the rotating-style prediction over a corpus. The algorithm
 * is intentionally light on signal mixing: per-song gap stats drive
 * Due / Bustout, recent appearances drive Hot, role tally drives
 * Position Pools. Each list is independently sortable and cap-limited.
 */
export function predictRotating(input: PredictRotatingInput): RotatingPrediction {
  const targetTs = new Date(input.targetDate).getTime();
  // Drop the target-date row itself (the answer key, not a feature).
  const corpus = input.corpus.filter((r) => r.performanceDate !== input.targetDate);
  // Sort newest-first so "recent window" math is straightforward.
  corpus.sort((a, b) => b.performanceDate.localeCompare(a.performanceDate));
  const recent = corpus.slice(0, RECENT_WINDOW);

  const stats = computeSongStats(corpus, targetTs);
  const positions = computePositionPools(corpus, stats, input.multiNightRun ?? null);

  // ─── due / bustout ────────────────────────────────────────────────
  const due: OverdueSong[] = [];
  const bustout: OverdueSong[] = [];
  for (const s of stats.values()) {
    if (!s.lastPlayedDate || s.totalPlays === 0) continue;
    if (s.meanGap === null || s.currentGap === null) continue;
    if (s.meanGap <= 0) continue;
    const overdueScore = s.currentGap / s.meanGap;
    const overdueRow: OverdueSong = {
      title: s.title,
      currentGap: s.currentGap,
      meanGap: Number(s.meanGap.toFixed(2)),
      overdueScore: Number(overdueScore.toFixed(2)),
      totalPlays: s.totalPlays,
      lastPlayedDate: s.lastPlayedDate,
    };
    if (overdueScore >= BUSTOUT_THRESHOLD && s.totalPlays >= BUSTOUT_MIN_PLAYS) {
      bustout.push(overdueRow);
    }
    if (overdueScore >= DUE_THRESHOLD) {
      due.push(overdueRow);
    }
  }
  due.sort((a, b) => b.overdueScore - a.overdueScore);
  bustout.sort((a, b) => b.overdueScore - a.overdueScore);
  const dueTop = due.slice(0, TOP_DUE);
  const bustoutTop = bustout.slice(0, TOP_BUSTOUT);

  // Double-flag songs that are BOTH due AND occupy a position pool
  // candidate slot — they get a `★ DUE` chip inside the pool card.
  const dueSet = new Set(dueTop.map((d) => d.title.trim().toLowerCase()));
  for (const pool of positions) {
    for (const candidate of pool.candidates) {
      if (dueSet.has(candidate.title.trim().toLowerCase())) {
        candidate.dueDoubleFlag = true;
      }
    }
  }

  // ─── hot ───────────────────────────────────────────────────────────
  const hotCounter = new Map<string, number>();
  const titlesByLower = new Map<string, string>();
  for (const row of recent) {
    for (const title of titlesIn(row.setlist)) {
      const lower = title.trim().toLowerCase();
      if (lower.length === 0) continue;
      hotCounter.set(lower, (hotCounter.get(lower) ?? 0) + 1);
      if (!titlesByLower.has(lower)) titlesByLower.set(lower, title);
    }
  }
  const hot: HotSong[] = [];
  for (const [lower, count] of hotCounter) {
    const share = count / Math.max(recent.length, 1);
    if (share >= HOT_SHARE) {
      hot.push({
        title: titlesByLower.get(lower) ?? lower,
        playedCount: count,
        playedShare: Number(share.toFixed(2)),
        evidence: `${count} of last ${recent.length}`,
      });
    }
  }
  hot.sort((a, b) => b.playedShare - a.playedShare);
  const hotTop = hot.slice(0, TOP_HOT);

  // ─── confidence ────────────────────────────────────────────────────
  // The rotating model isn't trying to predict the exact setlist — it's
  // trying to surface "this is what's overdue" with calibrated
  // uncertainty. We bracket confidence on three signals:
  //   - tier-A density of the corpus (more setlists → more reliable)
  //   - presence of a multi-night run (we know what's been burned)
  //   - lower entropy in the position pools
  // Cap at 0.55 — rotating predictions never feel sure of themselves.
  const density = Math.min(1, recent.length / RECENT_WINDOW);
  const meanEntropy = positions.length > 0
    ? positions.reduce((a, p) => a + p.poolEntropy, 0) / positions.length
    : 0.8;
  const entropyFactor = 1 - Math.min(1, meanEntropy);
  const runBoost = input.multiNightRun ? 0.1 : 0;
  const confidence = Math.min(
    0.55,
    0.3 * density + 0.2 * entropyFactor + runBoost,
  );

  const copy = composeCopy({
    corpus,
    stats,
    multiNight: input.multiNightRun ?? null,
  });

  const multiNightContext: MultiNightContext | null = input.multiNightRun
    ? {
        venue: input.multiNightRun.venue,
        runIndex: input.multiNightRun.runIndex,
        priorNights: input.multiNightRun.priorNights,
        songsAlreadyPlayed: input.multiNightRun.songsAlreadyPlayed,
        runStartDate: input.multiNightRun.runStartDate,
      }
    : null;

  // Pick a tour label — most-recent corpus row with a tour name wins.
  let tourId: string | null = null;
  let tourName: string | null = null;
  for (const r of corpus) {
    if (r.tourId || r.tourName) {
      tourId = r.tourId;
      tourName = r.tourName;
      break;
    }
  }

  return {
    style: 'rotating',
    due: dueTop,
    hot: hotTop,
    bustoutCandidates: bustoutTop,
    positions,
    multiNightContext,
    copy,
    confidence: Number(confidence.toFixed(2)),
    sampleSize: corpus.length,
    tourId,
    tourName,
    setCountPrediction: computeSetCount(corpus),
  };
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

interface SongStat {
  title: string;
  totalPlays: number;
  /** Show-position appearances per role. */
  roleTally: Record<SongRole, number>;
  /** Sorted (desc) list of dates the song was played. */
  dates: string[];
  meanGap: number | null;
  currentGap: number | null;
  lastPlayedDate: string | null;
}

function computeSongStats(corpus: CorpusRow[], targetTs: number): Map<string, SongStat> {
  const byTitle = new Map<string, SongStat>();
  // Walk newest-first.
  for (let i = 0; i < corpus.length; i++) {
    const row = corpus[i]!;
    const seen = new Set<string>();
    for (let sIdx = 0; sIdx < row.setlist.sections.length; sIdx++) {
      const section = row.setlist.sections[sIdx]!;
      const isEncore = section.kind === 'encore';
      const hasEncore = row.setlist.sections.some((s) => s.kind === 'encore');
      const lastMainSection = hasEncore
        ? row.setlist.sections.length - 2
        : row.setlist.sections.length - 1;
      for (let songIdx = 0; songIdx < section.songs.length; songIdx++) {
        const title = section.songs[songIdx]!.title;
        const lower = title.trim().toLowerCase();
        if (lower.length === 0) continue;
        if (seen.has(lower)) continue;
        seen.add(lower);
        const role = deriveRole({
          sectionIndex: sIdx,
          songIndex: songIdx,
          songsInSection: section.songs.length,
          isEncore,
          hasEncore,
          lastMainSection,
        });
        let entry = byTitle.get(lower);
        if (!entry) {
          entry = {
            title,
            totalPlays: 0,
            roleTally: { opener: 0, closer: 0, encore_open: 0, encore_close: 0, core: 0 },
            dates: [],
            meanGap: null,
            currentGap: null,
            lastPlayedDate: null,
          };
          byTitle.set(lower, entry);
        }
        entry.totalPlays += 1;
        entry.roleTally[role] += 1;
        entry.dates.push(row.performanceDate);
      }
    }
  }
  // Compute gap stats. `dates` are descending; `currentGap` = number of
  // setlists since last play (count of corpus rows whose date is later
  // than the song's most-recent play). `meanGap` = mean of pairwise gaps.
  const datesAll = corpus.map((r) => r.performanceDate);
  for (const stat of byTitle.values()) {
    stat.dates.sort((a, b) => b.localeCompare(a));
    stat.lastPlayedDate = stat.dates[0] ?? null;
    if (!stat.lastPlayedDate) continue;
    const lastTs = new Date(stat.lastPlayedDate).getTime();
    if (Number.isNaN(lastTs) || lastTs > targetTs) continue;
    // currentGap = setlists since (count of corpus rows with date >
    // lastPlayedDate and ≤ targetDate). Equivalent to "how many shows
    // have passed since this song was last played."
    let currentGap = 0;
    for (const d of datesAll) {
      const ts = new Date(d).getTime();
      if (ts > lastTs && ts <= targetTs) currentGap += 1;
    }
    stat.currentGap = currentGap;
    // Pairwise gap: for adjacent (newer, older) plays, count corpus
    // rows strictly between them.
    if (stat.dates.length < 2) {
      stat.meanGap = null;
      continue;
    }
    const gaps: number[] = [];
    for (let i = 0; i < stat.dates.length - 1; i++) {
      const newer = new Date(stat.dates[i]!).getTime();
      const older = new Date(stat.dates[i + 1]!).getTime();
      let between = 0;
      for (const d of datesAll) {
        const ts = new Date(d).getTime();
        if (ts > older && ts < newer) between += 1;
      }
      // +1 makes "back-to-back" plays count as gap 1 (no intervening
      // shows means gap = 1 show, not 0).
      gaps.push(between + 1);
    }
    if (gaps.length > 0) {
      stat.meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    }
  }
  return byTitle;
}

function computePositionPools(
  corpus: CorpusRow[],
  stats: Map<string, SongStat>,
  multiNightRun: RunContext | null,
): PositionPool[] {
  const ROLES: PositionRole[] = ['opener', 'closer', 'encore_open', 'encore_close'];
  const playedThisRunLower = new Set(
    (multiNightRun?.songsAlreadyPlayed ?? []).map((s) => s.trim().toLowerCase()),
  );
  const out: PositionPool[] = [];
  for (const role of ROLES) {
    // Count appearances at this role across the corpus. We use `stats`
    // since it already tracks per-song roleTally.
    const candidates: PositionPoolCandidate[] = [];
    let total = 0;
    for (const stat of stats.values()) {
      const count = stat.roleTally[role];
      if (count === 0) continue;
      candidates.push({
        title: stat.title,
        slotShare: count, // temporary — convert to share below
      });
      total += count;
    }
    if (total === 0) {
      out.push({ role, poolEntropy: 0, candidates: [] });
      continue;
    }
    for (const c of candidates) {
      c.slotShare = Number((c.slotShare / total).toFixed(3));
      if (playedThisRunLower.has(c.title.trim().toLowerCase())) {
        c.playedThisRun = true;
      }
    }
    candidates.sort((a, b) => b.slotShare - a.slotShare);
    const trimmed = candidates.slice(0, POSITION_POOL_SIZE);
    const entropy = shannonEntropy(trimmed.map((c) => c.slotShare));
    out.push({
      role,
      poolEntropy: Number(entropy.toFixed(2)),
      candidates: trimmed,
    });
  }
  return out;
}

function shannonEntropy(probs: number[]): number {
  // Normalised so max entropy = 1 (log_n n).
  if (probs.length === 0) return 0;
  let h = 0;
  let sum = 0;
  for (const p of probs) sum += p;
  if (sum <= 0) return 0;
  for (const p of probs) {
    const normalized = p / sum;
    if (normalized > 0) h -= normalized * Math.log2(normalized);
  }
  const maxH = Math.log2(probs.length);
  return maxH > 0 ? h / maxH : 0;
}

function deriveRole(opts: {
  sectionIndex: number;
  songIndex: number;
  songsInSection: number;
  isEncore: boolean;
  hasEncore: boolean;
  lastMainSection: number;
}): SongRole {
  if (opts.isEncore) {
    if (opts.songIndex === 0) return 'encore_open';
    if (opts.songIndex === opts.songsInSection - 1) return 'encore_close';
    return 'core';
  }
  if (opts.sectionIndex === 0 && opts.songIndex === 0) return 'opener';
  if (
    opts.sectionIndex === opts.lastMainSection &&
    opts.songIndex === opts.songsInSection - 1 &&
    opts.lastMainSection >= 0
  ) {
    return 'closer';
  }
  return 'core';
}

function titlesIn(setlist: PerformerSetlist): string[] {
  const out: string[] = [];
  for (const section of setlist.sections) {
    for (const song of section.songs) out.push(song.title);
  }
  return out;
}

function composeCopy(opts: {
  corpus: CorpusRow[];
  stats: Map<string, SongStat>;
  multiNight: RunContext | null;
}): string {
  if (opts.corpus.length === 0) {
    return 'We need at least a few setlists to predict this artist.';
  }
  if (opts.multiNight) {
    return (
      `Night ${opts.multiNight.runIndex} at ${opts.multiNight.venue}. ` +
      `${opts.multiNight.songsAlreadyPlayed.length} songs already burned this run — ` +
      `here's what's overdue and what slot it tends to fill.`
    );
  }
  const uniqueTitles = opts.stats.size;
  return (
    `${uniqueTitles}+ unique songs across the last ${opts.corpus.length} setlists. ` +
    `Probability of any specific song is low — here's what's overdue and what slot ` +
    `it tends to fill.`
  );
}
