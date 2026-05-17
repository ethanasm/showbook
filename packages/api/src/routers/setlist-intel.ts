/**
 * Setlist intelligence — read-only tRPC procedures for Phase 1.
 *
 * - `predictedSetlist({ showId })` — Bayesian prediction (cached). Resolves
 *   the headliner server-side; gates by show kind + date + headliner
 *   presence. Returns the `cold` empty state with a typed `reason` for
 *   any failing gate (per SI-03 / SI-04).
 * - `songsHeardMost({ scope, limit })` — the user's top songs by times
 *   heard live across attended shows.
 * - `setlistDiff({ showIdA, showIdB })` — symmetric diff of two attended
 *   setlists (Both / Only A / Only B).
 * - `firstTimes({ limit })` — user-scoped only (SI-17). "First time YOU
 *   heard this song live."
 *
 * The corresponding mutations (cache invalidation, manual edits) live
 * elsewhere; this router is read-only.
 */

import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  performers,
  predictionEvalRuns,
  setlistSongAppearances,
  shows,
  songs,
} from '@showbook/db';
import {
  getHeadlinerId,
  isFeatureOn,
  isProductionShow,
  type ShowLike,
} from '@showbook/shared';
import { child } from '@showbook/observability';
import { protectedProcedure, publicProcedure, router } from '../trpc';
import {
  coldPrediction,
  loadCorpusForPrediction,
  predictedSetlistCached,
  type ColdPrediction,
  type HotPrediction,
} from '../setlist-predict';
import {
  evaluateReleaseGate,
  type ReleaseGateBreach,
  RELEASE_GATE_THRESHOLDS,
} from '../setlist-release-gate';
import {
  predictRotating,
  type RotatingPrediction,
} from '../setlist-predict-rotating';
import {
  predictTheatrical,
  type TheatricalPrediction,
} from '../setlist-predict-theatrical';
import {
  predictImprovised,
  type ImprovisedPrediction,
} from '../setlist-predict-improvised';
import { detectMultiNightRun } from '../multi-night-run-detector';

const log = child({ component: 'api.setlist-intel' });

const SUPPORTED_KINDS = new Set(['concert', 'festival']);

const predictedSetlistInput = z.object({
  showId: z.string().uuid(),
});

const songsHeardMostInput = z.object({
  scope: z.union([z.literal('all'), z.string().uuid()]).default('all'),
  limit: z.number().int().min(1).max(200).default(50),
});

const setlistDiffInput = z.object({
  showIdA: z.string().uuid(),
  showIdB: z.string().uuid(),
});

const firstTimesInput = z
  .object({ limit: z.number().int().min(1).max(200).default(50) })
  .default({ limit: 50 });

export const setlistIntelRouter = router({
  /**
   * Predicted setlist for an attended/upcoming show. Eligibility gate
   * runs server-side per SI-03 — the client always calls this and the
   * procedure decides cold vs hot.
   */
  predictedSetlist: protectedProcedure
    .input(predictedSetlistInput)
    .query(async ({ ctx, input }): Promise<
      | HotPrediction
      | ColdPrediction
      | RotatingPrediction
      | TheatricalPrediction
      | ImprovisedPrediction
    > => {
      const userId = ctx.session.user.id;
      const show = await ctx.db.query.shows.findFirst({
        where: and(eq(shows.id, input.showId), eq(shows.userId, userId)),
        with: {
          showPerformers: { with: { performer: true } },
        },
      });
      if (!show) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }

      if (!SUPPORTED_KINDS.has(show.kind)) {
        return coldPrediction('wrong_kind');
      }
      if (isProductionShow(show as ShowLike)) {
        return coldPrediction('production_show');
      }
      if (!show.date) {
        return coldPrediction('date_not_set');
      }
      const headlinerId = getHeadlinerId(show as ShowLike);
      if (!headlinerId) {
        return coldPrediction('no_headliner');
      }

      // No-MBID short-circuit (SI-04). The corpus-fill job is the
      // primary writer; we additionally check here so a fresh
      // performer with no corpus row yet doesn't burn a wasted query.
      // Phase 5 — also pull the persisted style + override in this
      // same select so the rotating branch below doesn't need a
      // second round-trip.
      const [perf] = await ctx.db
        .select({
          id: performers.id,
          name: performers.name,
          musicbrainzId: performers.musicbrainzId,
          setlistStyle: performers.setlistStyle,
          setlistStyleOverride: performers.setlistStyleOverride,
        })
        .from(performers)
        .where(eq(performers.id, headlinerId))
        .limit(1);
      if (!perf) {
        return coldPrediction('no_headliner');
      }
      if (!perf.musicbrainzId) {
        return coldPrediction('no_mbid', perf.name);
      }

      // Phase 5 — style classifier branch. When the §15b classifier
      // is on AND the performer is rotating-style, we run the gap-
      // based rotating model instead of §4c stable. The
      // SetlistIntelStyleClassifier flag exists so we can fall every
      // performer back to 'stable' if the classifier misbehaves.
      const styleClassifierOn = isFeatureOn('SetlistIntelStyleClassifier');
      const effectiveStyle = styleClassifierOn
        ? (perf.setlistStyleOverride ?? perf.setlistStyle ?? 'stable')
        : 'stable';

      if (effectiveStyle === 'rotating') {
        try {
          const { setlists } = await loadCorpusForPrediction({
            performerId: headlinerId,
            targetDate: show.date,
          });
          if (setlists.length === 0) {
            return coldPrediction('no_corpus', perf.name);
          }
          // Venue match for multi-night-run detection — the corpus
          // rows carry `venueNameRaw` from setlist.fm; we compare the
          // show's saved venue name against that. Fuzzy matching is
          // future work; v1 uses exact string match.
          const targetVenueName = (show as { venue?: { name?: string } | null }).venue?.name ?? null;
          const runContext = detectMultiNightRun({
            targetDate: show.date,
            targetVenue: targetVenueName,
            corpus: setlists,
          });
          const prediction = predictRotating({
            performerId: headlinerId,
            targetDate: show.date,
            corpus: setlists,
            multiNightRun: runContext,
          });
          if (runContext) {
            log.info(
              {
                event: 'setlist.run_detection.matched',
                performerId: headlinerId,
                showId: input.showId,
                venue: runContext.venue,
                runIndex: runContext.runIndex,
                priorNights: runContext.priorNights,
              },
              'multi-night run detected',
            );
          } else {
            log.info(
              {
                event: 'setlist.run_detection.not_found',
                performerId: headlinerId,
                showId: input.showId,
                targetVenue: targetVenueName,
              },
              'no multi-night run detected',
            );
          }
          log.info(
            {
              event: 'setlist.predict.served',
              performerId: headlinerId,
              targetDate: show.date,
              style: prediction.style,
              confidence: prediction.confidence,
              sampleSize: prediction.sampleSize,
              cache: 'bypass',
            },
            'predicted-setlist served (rotating)',
          );
          return prediction;
        } catch (err) {
          log.error(
            {
              event: 'setlist.predict.failed',
              err,
              showId: input.showId,
              performerId: headlinerId,
              style: 'rotating',
            },
            'rotating predicted-setlist failed',
          );
          return coldPrediction('no_corpus', perf.name);
        }
      }

      if (effectiveStyle === 'theatrical') {
        try {
          const { setlists } = await loadCorpusForPrediction({
            performerId: headlinerId,
            targetDate: show.date,
          });
          if (setlists.length === 0) {
            return coldPrediction('no_corpus', perf.name);
          }
          const prediction = predictTheatrical({
            performerId: headlinerId,
            targetDate: show.date,
            corpus: setlists,
          });
          log.info(
            {
              event: 'setlist.predict.served',
              performerId: headlinerId,
              targetDate: show.date,
              style: prediction.style,
              confidence: prediction.confidence,
              sampleSize: prediction.sampleSize,
              rotatingSlotCount: prediction.rotatingSlots.length,
              deterministicCount: prediction.deterministicSetlist.length,
              cache: 'bypass',
            },
            'predicted-setlist served (theatrical)',
          );
          return prediction;
        } catch (err) {
          log.error(
            {
              event: 'setlist.predict.failed',
              err,
              showId: input.showId,
              performerId: headlinerId,
              style: 'theatrical',
            },
            'theatrical predicted-setlist failed',
          );
          return coldPrediction('no_corpus', perf.name);
        }
      }

      if (effectiveStyle === 'improvised') {
        try {
          const { setlists } = await loadCorpusForPrediction({
            performerId: headlinerId,
            targetDate: show.date,
          });
          if (setlists.length === 0) {
            return coldPrediction('no_corpus', perf.name);
          }
          const prediction = predictImprovised({
            performerId: headlinerId,
            targetDate: show.date,
            corpus: setlists,
          });
          log.info(
            {
              event: 'setlist.predict.served',
              performerId: headlinerId,
              targetDate: show.date,
              style: prediction.style,
              confidence: prediction.confidence,
              sampleSize: prediction.sampleSize,
              showModeCount: prediction.showModes.length,
              topShowMode: prediction.showModes[0]?.label ?? null,
              cache: 'bypass',
            },
            'predicted-setlist served (improvised)',
          );
          return prediction;
        } catch (err) {
          log.error(
            {
              event: 'setlist.predict.failed',
              err,
              showId: input.showId,
              performerId: headlinerId,
              style: 'improvised',
            },
            'improvised predicted-setlist failed',
          );
          return coldPrediction('no_corpus', perf.name);
        }
      }

      try {
        return await predictedSetlistCached({
          performerId: headlinerId,
          targetDate: show.date,
          snapshotContext: { userId, showId: input.showId },
        });
      } catch (err) {
        log.error(
          { event: 'setlist.predict.failed', err, showId: input.showId, performerId: headlinerId },
          'predicted-setlist failed',
        );
        return coldPrediction('no_corpus', perf.name);
      }
    }),

  /**
   * The user's top songs by times-heard. `scope` is either `'all'` for
   * across every attended performer, or a specific `performerId`. Reads
   * the denormalized `setlist_song_appearances` index built by Phase 1's
   * indexer.
   */
  songsHeardMost: protectedProcedure
    .input(songsHeardMostInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const filters = [eq(shows.userId, userId)];
      if (input.scope !== 'all') {
        filters.push(eq(setlistSongAppearances.performerId, input.scope));
      }
      const rows = await ctx.db
        .select({
          songId: setlistSongAppearances.songId,
          performerId: setlistSongAppearances.performerId,
          timesHeard: sql<number>`COUNT(*)::int`,
          firstHeard: sql<string>`MIN(${setlistSongAppearances.performanceDate})`,
          lastHeard: sql<string>`MAX(${setlistSongAppearances.performanceDate})`,
          title: songs.title,
          performerName: performers.name,
        })
        .from(setlistSongAppearances)
        .innerJoin(shows, eq(shows.id, setlistSongAppearances.showId))
        .innerJoin(songs, eq(songs.id, setlistSongAppearances.songId))
        .innerJoin(performers, eq(performers.id, setlistSongAppearances.performerId))
        .where(and(...filters))
        .groupBy(
          setlistSongAppearances.songId,
          setlistSongAppearances.performerId,
          songs.title,
          performers.name,
        )
        .orderBy(desc(sql`COUNT(*)`), asc(songs.title))
        .limit(input.limit);
      return rows;
    }),

  /**
   * Symmetric diff of two attended shows. Each section returns titles
   * in the order they first appeared in the source setlist.
   */
  setlistDiff: protectedProcedure
    .input(setlistDiffInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const showRows = await ctx.db
        .select({
          showId: setlistSongAppearances.showId,
          songId: setlistSongAppearances.songId,
          songIndex: setlistSongAppearances.songIndex,
          sectionIndex: setlistSongAppearances.sectionIndex,
          title: songs.title,
          performerName: performers.name,
        })
        .from(setlistSongAppearances)
        .innerJoin(shows, eq(shows.id, setlistSongAppearances.showId))
        .innerJoin(songs, eq(songs.id, setlistSongAppearances.songId))
        .innerJoin(performers, eq(performers.id, setlistSongAppearances.performerId))
        .where(
          and(
            eq(shows.userId, userId),
            inArray(setlistSongAppearances.showId, [input.showIdA, input.showIdB]),
          ),
        )
        .orderBy(
          asc(setlistSongAppearances.sectionIndex),
          asc(setlistSongAppearances.songIndex),
        );

      const titlesByShow = new Map<string, { title: string; songId: string }[]>();
      for (const row of showRows) {
        if (!row.showId) continue;
        const list = titlesByShow.get(row.showId) ?? [];
        list.push({ title: row.title, songId: row.songId });
        titlesByShow.set(row.showId, list);
      }
      const aList = titlesByShow.get(input.showIdA) ?? [];
      const bList = titlesByShow.get(input.showIdB) ?? [];
      const aTitles = new Set(aList.map((s) => s.title.toLowerCase()));
      const bTitles = new Set(bList.map((s) => s.title.toLowerCase()));

      const both: { title: string; songId: string }[] = [];
      const onlyA: { title: string; songId: string }[] = [];
      const onlyB: { title: string; songId: string }[] = [];
      const seen = new Set<string>();
      for (const item of aList) {
        const lower = item.title.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        if (bTitles.has(lower)) both.push(item);
        else onlyA.push(item);
      }
      const seenB = new Set<string>();
      for (const item of bList) {
        const lower = item.title.toLowerCase();
        if (seenB.has(lower)) continue;
        seenB.add(lower);
        if (!aTitles.has(lower) && !seen.has(lower)) onlyB.push(item);
      }
      return { both, onlyA, onlyB };
    }),

  /**
   * "First time YOU heard this song live." User-scoped only per SI-17.
   * The global "tour debut you caught" rail was dropped from the plan
   * because it required honesty caveats about corpus completeness.
   */
  firstTimes: protectedProcedure
    .input(firstTimesInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const result = await ctx.db.execute<{
        song_id: string;
        performer_id: string;
        first_date: string;
        show_id: string;
        title: string;
        performer_name: string;
      }>(sql`
        SELECT
          first_appearances.song_id,
          first_appearances.performer_id,
          first_appearances.first_date,
          first_appearances.show_id,
          songs.title,
          performers.name AS performer_name
        FROM (
          SELECT DISTINCT ON (a.song_id)
            a.song_id,
            a.performer_id,
            a.performance_date AS first_date,
            a.show_id
          FROM setlist_song_appearances a
          JOIN shows s ON s.id = a.show_id
          WHERE s.user_id = ${userId}
          ORDER BY a.song_id, a.performance_date ASC
        ) first_appearances
        JOIN songs ON songs.id = first_appearances.song_id
        JOIN performers ON performers.id = first_appearances.performer_id
        ORDER BY first_appearances.first_date DESC
        LIMIT ${input.limit}
      `);

      const rows = Array.isArray(result) ? result : (result as { rows?: unknown }).rows;
      if (!Array.isArray(rows)) return [];
      return rows.map((r) => {
        const row = r as {
          song_id: string;
          performer_id: string;
          first_date: string;
          show_id: string;
          title: string;
          performer_name: string;
        };
        return {
          songId: row.song_id,
          performerId: row.performer_id,
          firstDate: row.first_date,
          showId: row.show_id,
          title: row.title,
          performerName: row.performer_name,
        };
      });
    }),

  /**
   * Phase 5 release-gate check. Reads the most-recent
   * `prediction_eval_runs` row (the cron's nightly back-test output)
   * and evaluates the three thresholds from the spec:
   *
   *   - stable-style mean Brier ≤ 0.15
   *   - rotating-style recall-at-15 ≥ 0.55
   *   - no calibration bin with |delta| > 0.20
   *
   * Public so the client can short-circuit the rotating-display FF
   * without needing admin access to the eval surface. Returns
   * `{ passes, reasons }` plus the latest run's id + ranAt for
   * audit traceability.
   *
   * Emits `setlist.release_gate.{passed,failed}` so Axiom keeps a
   * daily trail of the verdict.
   */
  releaseGate: publicProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        id: predictionEvalRuns.id,
        ranAt: predictionEvalRuns.ranAt,
        byStyle: predictionEvalRuns.byStyle,
        calibrationCurve: predictionEvalRuns.calibrationCurve,
      })
      .from(predictionEvalRuns)
      .orderBy(desc(predictionEvalRuns.ranAt))
      .limit(1);
    if (!row) {
      log.warn(
        { event: 'setlist.release_gate.failed', reason: 'no_runs' },
        'release-gate failed — no eval run on disk yet',
      );
      return {
        passes: false,
        reasons: [
          {
            metric: 'rotating_recall_top15' as const,
            value: 0,
            threshold: RELEASE_GATE_THRESHOLDS.rotatingRecallTop15Min,
            style: 'rotating' as const,
          },
        ] satisfies ReleaseGateBreach[],
        rotatingEvaluable: false,
        stableEvaluable: false,
        theatricalEvaluable: false,
        improvisedEvaluable: false,
        latestRunId: null,
        latestRunAt: null,
      };
    }
    const result = evaluateReleaseGate({
      byStyle: (row.byStyle as Array<{
        style: string;
        brier: number;
        recallTop15: number;
        predictions: number;
        showModeCalibrationDelta?: number | null;
      }>) ?? [],
      calibrationCurve: (row.calibrationCurve as Array<{
        lower: number;
        upper: number;
        predictions: number;
        meanProbability: number;
        empiricalRate: number;
        delta: number;
      }>) ?? [],
    });
    for (const breach of result.reasons) {
      log.warn(
        {
          event: 'setlist.release_gate.failed',
          metric: breach.metric,
          value: breach.value,
          threshold: breach.threshold,
          style: breach.style,
          binLower: breach.binLower,
          binUpper: breach.binUpper,
          runId: row.id,
        },
        'release-gate breach',
      );
    }
    if (result.passes) {
      log.info(
        { event: 'setlist.release_gate.passed', runId: row.id },
        'release-gate passed',
      );
    }
    return {
      ...result,
      latestRunId: row.id,
      latestRunAt: row.ranAt,
    };
  }),
});

export type SetlistIntelRouter = typeof setlistIntelRouter;
