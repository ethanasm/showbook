/**
 * Setlist intelligence — read-only tRPC procedures for Phases 1 + 7.
 *
 * Phase 1:
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
 * Phase 7 (music layer v2):
 * - `fanLoyalty({ showId })` — donut ring source data (past shows).
 * - `discoveredLive({ showId })` — list-row rail data (past shows).
 * - `saveDiscoveredSong({ songId })` — PUT /me/tracks mutation.
 * - `primingStat({ showId })` — italic title-block line.
 *
 * Phase 9 additions:
 * - `spotifyFollowsDiff()` — Spotify-only artists for the Discover rail.
 * - `skipSpotifyArtist({ spotifyArtistId })` — × on a rail card.
 * - `trackPreviewsForShow({ showId })` — cached 30s preview URLs per
 *   row in the show's predicted/actual setlist.
 * - `resolveTrackPreview({ showId, title })` — lazy resolve a single
 *   row's preview/URI via Spotify search.
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
  userPerformerFollows,
  userSpotifySkippedArtists,
} from '@showbook/db';
import {
  getHeadlinerId,
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
import { enqueueSetlistCorpusFill } from '../job-queue';
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
import {
  lookupSpecialEventRule,
  type SpecialEventPrediction,
} from '../setlist-predict-special-event';
import {
  fanLoyaltyForShow,
  discoveredLiveForShow,
  saveDiscoveredSong,
  primingStatForShow,
} from '../spotify-music-layer';
import { ensureFreshUserToken } from '../spotify-tokens';
import {
  getFollowedArtists,
  searchTrack,
  SpotifyError,
  type SpotifyArtist,
} from '../spotify';
import { ITunesError, searchTrackPreview as searchITunesPreview } from '../itunes';
import { diffSpotifyFollows } from '../spotify-follows-diff';
import { enforceRateLimit, isRateLimited } from '../rate-limit';
import { resolvePersonalChips } from '../personal-chips';

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

const showIdOnly = z.object({ showId: z.string().uuid() });
const saveDiscoveredInput = z.object({ songId: z.string().uuid() });

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
      | SpecialEventPrediction
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

      const targetVenueName =
        (show as { venue?: { name?: string } | null }).venue?.name ?? null;

      // Phase 11 §15g — special-event short-circuit. When a rule
      // matches the (performer, date, venue) tuple, we never predict
      // and the UI renders a SpecialEventCard with the rule's copy +
      // prior matching events. The lookup is a single indexed query.
      try {
        const specialEvent = await lookupSpecialEventRule({
          performerId: headlinerId,
          targetDate: show.date,
          venueName: targetVenueName,
        });
        if (specialEvent) {
          return specialEvent;
        }
      } catch (err) {
        log.error(
          { event: 'setlist.special_event.lookup_failed', err, showId: input.showId },
          'special-event rule lookup failed; falling through',
        );
      }

      // Phase 5 — style classifier branch. When the performer is
      // rotating/theatrical/improvised-style, we run the matching
      // model instead of §4c stable.
      const effectiveStyle =
        perf.setlistStyleOverride ?? perf.setlistStyle ?? 'stable';

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
          // future work; v1 uses exact string match. `targetVenueName`
          // is the shared lookup computed once at the procedure top.
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
        // Phase 11 §15e — generalize multi-night anti-repeat to
        // stable-style residencies (Adele Caesars Palace, Bruno Mars
        // Sphere). When a venue match exists, run the detector against
        // a quick corpus load and feed the resulting runContext through
        // to the stable predictor so it can apply the 0.05 anti-repeat
        // penalty on already-played songs. Skips the extra corpus load
        // when there's no venue.
        let stableRunContext: NonNullable<
          Parameters<typeof predictedSetlistCached>[0]['runContext']
        > | null = null;
        if (targetVenueName) {
          try {
            const { setlists } = await loadCorpusForPrediction({
              performerId: headlinerId,
              targetDate: show.date,
            });
            const runContext = detectMultiNightRun({
              targetDate: show.date,
              targetVenue: targetVenueName,
              corpus: setlists,
            });
            if (runContext && runContext.priorNights >= 1) {
              stableRunContext = {
                venue: runContext.venue,
                priorNights: runContext.priorNights,
                songsAlreadyPlayed: runContext.songsAlreadyPlayed,
                runStartDate: runContext.runStartDate,
              };
              log.info(
                {
                  event: 'setlist.run_detection.matched',
                  performerId: headlinerId,
                  showId: input.showId,
                  venue: runContext.venue,
                  runIndex: runContext.runIndex,
                  priorNights: runContext.priorNights,
                  style: 'stable',
                },
                'multi-night run detected (stable)',
              );
            }
          } catch (err) {
            log.error(
              {
                event: 'setlist.run_detection.failed',
                err,
                showId: input.showId,
                style: 'stable',
              },
              'multi-night detection failed; falling through to stable predictor',
            );
          }
        }
        return await predictedSetlistCached({
          performerId: headlinerId,
          targetDate: show.date,
          snapshotContext: { userId, showId: input.showId },
          runContext: stableRunContext,
          // Phase 11 §15r — when the target show is a festival
          // appearance, prefer the artist's festival-corpus (shorter
          // sets) over their headline-corpus.
          prefer: show.kind === 'festival' ? 'festival' : undefined,
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
   * Per-artist predicted setlists for a festival lineup. Walks every
   * `showPerformer` (headliner + supports), runs the same Phase-5
   * style dispatch as the headliner-only `predictedSetlist`, and
   * returns one `AnyPrediction` per artist. Per-artist failures bubble
   * up as cold-state entries so one missing artist doesn't blank the
   * tab.
   *
   * The corpus loader always runs with `prefer: 'festival'` (≤16-song
   * filter, falls back to full corpus when fewer than 3 festival-shaped
   * rows exist) so each artist's prediction reflects their typical
   * festival set length rather than a headlining run.
   *
   * Special-event lookup and multi-night-run detection are skipped:
   * festival appearances are one-off slots, not residencies, and the
   * special-event rules table targets (performer, date, venue) tuples
   * that wouldn't apply to a festival circuit.
   */
  predictedFestivalSetlists: protectedProcedure
    .input(predictedSetlistInput)
    .query(async ({ ctx, input }): Promise<{
      entries: Array<{
        performerId: string;
        performerName: string;
        role: string;
        sortOrder: number;
        prediction:
          | HotPrediction
          | ColdPrediction
          | RotatingPrediction
          | TheatricalPrediction
          | ImprovisedPrediction;
      }>;
    }> => {
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
      if (show.kind !== 'festival') {
        // Caller mis-routing — non-festivals belong to predictedSetlist.
        return { entries: [] };
      }
      if (!show.date) {
        return { entries: [] };
      }

      const lineup = [...show.showPerformers]
        .filter((sp) => sp.role === 'headliner' || sp.role === 'support')
        .sort((a, b) => {
          // Headliner first (sortOrder 0), then supports by sortOrder.
          if (a.role !== b.role) {
            return a.role === 'headliner' ? -1 : 1;
          }
          return a.sortOrder - b.sortOrder;
        });
      if (lineup.length === 0) {
        return { entries: [] };
      }

      const targetDate = show.date;
      const showId = input.showId;

      const entries = await Promise.all(
        lineup.map(async (sp) => {
          const baseEntry = {
            performerId: sp.performer.id,
            performerName: sp.performer.name,
            role: sp.role,
            sortOrder: sp.sortOrder,
          };

          try {
            const [perf] = await ctx.db
              .select({
                id: performers.id,
                name: performers.name,
                musicbrainzId: performers.musicbrainzId,
                setlistStyle: performers.setlistStyle,
                setlistStyleOverride: performers.setlistStyleOverride,
              })
              .from(performers)
              .where(eq(performers.id, sp.performer.id))
              .limit(1);

            if (!perf) {
              return {
                ...baseEntry,
                prediction: coldPrediction('no_headliner'),
              };
            }
            if (!perf.musicbrainzId) {
              return {
                ...baseEntry,
                prediction: coldPrediction('no_mbid', perf.name),
              };
            }

            const effectiveStyle =
              perf.setlistStyleOverride ?? perf.setlistStyle ?? 'stable';

            if (effectiveStyle === 'rotating') {
              const { setlists } = await loadCorpusForPrediction({
                performerId: perf.id,
                targetDate,
                prefer: 'festival',
              });
              if (setlists.length === 0) {
                return {
                  ...baseEntry,
                  prediction: coldPrediction('no_corpus', perf.name),
                };
              }
              const prediction = predictRotating({
                performerId: perf.id,
                targetDate,
                corpus: setlists,
                multiNightRun: null,
              });
              return { ...baseEntry, prediction };
            }

            if (effectiveStyle === 'theatrical') {
              const { setlists } = await loadCorpusForPrediction({
                performerId: perf.id,
                targetDate,
                prefer: 'festival',
              });
              if (setlists.length === 0) {
                return {
                  ...baseEntry,
                  prediction: coldPrediction('no_corpus', perf.name),
                };
              }
              const prediction = predictTheatrical({
                performerId: perf.id,
                targetDate,
                corpus: setlists,
              });
              return { ...baseEntry, prediction };
            }

            if (effectiveStyle === 'improvised') {
              const { setlists } = await loadCorpusForPrediction({
                performerId: perf.id,
                targetDate,
                prefer: 'festival',
              });
              if (setlists.length === 0) {
                return {
                  ...baseEntry,
                  prediction: coldPrediction('no_corpus', perf.name),
                };
              }
              const prediction = predictImprovised({
                performerId: perf.id,
                targetDate,
                corpus: setlists,
              });
              return { ...baseEntry, prediction };
            }

            const prediction = await predictedSetlistCached({
              performerId: perf.id,
              targetDate,
              snapshotContext: { userId, showId },
              prefer: 'festival',
            });
            return { ...baseEntry, prediction };
          } catch (err) {
            log.error(
              {
                event: 'setlist.predict.failed',
                err,
                showId,
                performerId: sp.performer.id,
                style: 'festival',
              },
              'festival per-artist prediction failed',
            );
            return {
              ...baseEntry,
              prediction: coldPrediction('no_corpus', sp.performer.name),
            };
          }
        }),
      );

      // Festival-set predictions inherit confidence from the headline
      // corpus when the artist's festival-shaped corpus is < 3 rows
      // (`loadCorpusForPrediction` falls back to full corpus in that
      // case). The headline confidence overstates certainty for a
      // festival appearance: the artist plays a SUBSET of their tour
      // songs in a shorter slot, so even a 100% Jaccard tour leaves
      // real uncertainty about which subset shows up tonight. Cap each
      // hot prediction at 0.7 so the chip rail and the banner read as
      // "strong signal, not a sure thing" — matches what the user can
      // verify against the predicted song list below.
      const FESTIVAL_CONFIDENCE_CAP = 0.7;
      for (const entry of entries) {
        const p = entry.prediction as {
          style: string;
          confidence?: number;
          confidenceNote?: string | null;
        };
        if (p.style !== 'cold' && typeof p.confidence === 'number') {
          const before = p.confidence;
          p.confidence = Math.min(p.confidence, FESTIVAL_CONFIDENCE_CAP);
          // When the cap actually clipped the score, overwrite the
          // headliner-flavored confidenceNote with the festival-specific
          // reason so the banner doesn't say "active tour" while the
          // chip shows a depressed percentage.
          if (p.confidence < before) {
            p.confidenceNote =
              'Festival sets are usually shorter than tour shows — we know the songs, less so the exact subset they\'ll pick.';
          }
        }
      }

      // Lazy corpus-fill for any lineup artist who landed on `no_corpus`
      // cold-state. The daily refresh cron (`setlist-corpus-fill-refresh`)
      // only walks headliners with upcoming watching/ticketed shows + the
      // top followed performers, so festival supports stuck on
      // "We're pulling recent setlists" never had a corpus-fill trigger.
      // Enqueueing here means the next visit to the festival shows real
      // data. `runSetlistCorpusFill` is idempotent (ON CONFLICT upsert)
      // and short-circuits on `no_mbid`, so a duplicate enqueue is cheap.
      const noCorpusEntries = entries.filter(
        (e) =>
          e.prediction.style === 'cold' &&
          (e.prediction as ColdPrediction).reason === 'no_corpus',
      );
      if (noCorpusEntries.length > 0) {
        await Promise.all(
          noCorpusEntries.map(async (e) => {
            try {
              await enqueueSetlistCorpusFill(e.performerId, 'predict');
            } catch (err) {
              log.warn(
                {
                  event: 'setlist.predict_festival.corpus_fill_enqueue_failed',
                  err,
                  showId,
                  performerId: e.performerId,
                },
                'festival support corpus-fill enqueue failed (non-blocking)',
              );
            }
          }),
        );
      }

      log.info(
        {
          event: 'setlist.predict_festival.served',
          showId,
          lineupSize: lineup.length,
          coldCount: entries.filter((e) => e.prediction.style === 'cold').length,
          coldCorpusFillsEnqueued: noCorpusEntries.length,
        },
        'festival per-artist predictions served',
      );

      return { entries };
    }),

  /**
   * Phase 11 §15j — personal-weight chip data for a predicted setlist.
   * Returns three lower-cased title sets: songs the user has 💛 saved,
   * 🎯 never heard live before, and ⭐ in their Spotify top 50.
   *
   * Top-tracks data is NOT persisted to the DB — it's cached in-memory
   * server-side (24h TTL) and on the client via React Query. Saved
   * tracks use the existing Phase 7 `/me/tracks/contains` cache.
   *
   * Returns empty sets when the user hasn't connected Spotify (the
   * 🎯 first-time chip still flows because it's local-DB-only).
   */
  personalChips: protectedProcedure
    .input(
      z.object({
        showId: z.string().uuid(),
        titles: z.array(z.string().min(1).max(200)).max(120),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const show = await ctx.db.query.shows.findFirst({
        where: and(eq(shows.id, input.showId), eq(shows.userId, userId)),
        with: { showPerformers: { with: { performer: true } } },
      });
      if (!show) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }
      const headlinerId = getHeadlinerId(show as ShowLike);
      if (!headlinerId) {
        return { saved: [], firstTime: [], topTrack: [] };
      }
      const chips = await resolvePersonalChips({
        userId,
        performerId: headlinerId,
        predictedTitles: input.titles,
      });
      return {
        saved: Array.from(chips.saved),
        firstTime: Array.from(chips.firstTime),
        topTrack: Array.from(chips.topTrack),
      };
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

  // ─────────────────────────────────────────────────────────────────
  // Phase 9 — Spotify-follow rail (Discover)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Spotify artists the user follows on Spotify but NOT on Showbook,
   * minus any explicitly skipped via the rail's × button. Returns an
   * empty list (and `connected: false`) when the user hasn't
   * connected Spotify so the rail can hide itself without a separate
   * status hop.
   */
  spotifyFollowsDiff: protectedProcedure.query(
    async ({ ctx }): Promise<{
      connected: boolean;
      artists: SpotifyArtist[];
    }> => {
      const userId = ctx.session.user.id;
      const accessToken = await ensureFreshUserToken(userId);
      if (!accessToken) {
        return { connected: false, artists: [] };
      }
      enforceRateLimit(`setlist-intel.follow-diff:${userId}`, {
        max: 30,
        windowMs: 60_000,
      });

      let spotifyArtists: SpotifyArtist[];
      try {
        spotifyArtists = await getFollowedArtists(accessToken);
      } catch (err) {
        if (err instanceof SpotifyError && err.status === 401) {
          // ensureFreshUserToken handled the refresh; this hop was
          // still rejected. Surface as a disconnected state so the
          // rail collapses; the next page load picks up the connect
          // modal via the global hook.
          return { connected: false, artists: [] };
        }
        log.error(
          { err, event: 'spotify.follow_diff.failed', userId },
          'Spotify follow-diff failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'spotify_follow_diff_failed',
        });
      }

      // Showbook-followed performers (lowercase name match — see
      // diffSpotifyFollows for the trade-off note).
      const followedNames = await ctx.db
        .select({ name: performers.name })
        .from(userPerformerFollows)
        .innerJoin(
          performers,
          eq(performers.id, userPerformerFollows.performerId),
        )
        .where(eq(userPerformerFollows.userId, userId));
      const followedSet = new Set(
        followedNames.map((r) => r.name.toLowerCase()),
      );

      const skipped = await ctx.db
        .select({ id: userSpotifySkippedArtists.spotifyArtistId })
        .from(userSpotifySkippedArtists)
        .where(eq(userSpotifySkippedArtists.userId, userId));
      const skippedSet = new Set(skipped.map((r) => r.id));

      const artists = diffSpotifyFollows({
        spotifyArtists,
        showbookFollowedNames: followedSet,
        skippedSpotifyArtistIds: skippedSet,
      });

      if (artists.length === 0) {
        log.info(
          { event: 'spotify.follow_diff.empty', userId, total: spotifyArtists.length },
          'follow-diff empty',
        );
      } else {
        log.info(
          {
            event: 'spotify.follow_diff.served',
            userId,
            served: artists.length,
            spotifyTotal: spotifyArtists.length,
            followedTotal: followedSet.size,
            skippedTotal: skippedSet.size,
          },
          'follow-diff served',
        );
      }

      return { connected: true, artists };
    },
  ),

  /**
   * Dismiss a Spotify artist from the rail. Writes to
   * `user_spotify_skipped_artists` so the same card never re-surfaces.
   * Idempotent — duplicate (userId, spotifyArtistId) is a no-op via
   * the primary-key constraint.
   */
  skipSpotifyArtist: protectedProcedure
    .input(z.object({ spotifyArtistId: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db
        .insert(userSpotifySkippedArtists)
        .values({
          userId,
          spotifyArtistId: input.spotifyArtistId,
        })
        .onConflictDoNothing();
      return { ok: true as const };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Phase 9 — Track previews (30s clips + Spotify URIs)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Cached preview/URI map for every title in the show's predicted or
   * actual setlist. Used by the row-play button to flip directly into
   * "ready" without a Spotify hop on every render.
   *
   * Returns a record keyed by lower(title) so the client can resolve
   * a row in O(1). Values:
   *   - `previewUrl` — null if Spotify never had a preview (the row's
   *     play button stays disabled with a "no preview available"
   *     tooltip per the Phase-9 spec).
   *   - `spotifyTrackId` — null until the song-resolution path has
   *     cached one; Premium users use this to call Web Playback SDK.
   */
  trackPreviewsForShow: protectedProcedure
    .input(z.object({ showId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<{
      previews: Record<
        string,
        { previewUrl: string | null; spotifyTrackId: string | null }
      >;
    }> => {
      const userId = ctx.session.user.id;
      const show = await ctx.db.query.shows.findFirst({
        where: and(eq(shows.id, input.showId), eq(shows.userId, userId)),
        with: { showPerformers: { with: { performer: true } } },
      });
      if (!show) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }

      // Festivals expose per-artist setlists, so the row UI needs
      // preview data for every lineup artist's songs — not just the
      // headliner. For everything else, fall back to the headliner.
      const performerIds: string[] =
        show.kind === 'festival'
          ? show.showPerformers
              .filter(
                (sp) => sp.role === 'headliner' || sp.role === 'support',
              )
              .map((sp) => sp.performer.id)
          : (() => {
              const headlinerId = getHeadlinerId(show as ShowLike);
              return headlinerId ? [headlinerId] : [];
            })();
      if (performerIds.length === 0) return { previews: {} };

      const rows = await ctx.db
        .select({
          title: songs.title,
          previewUrl: songs.spotifyPreviewUrl,
          spotifyTrackId: songs.spotifyTrackId,
        })
        .from(songs)
        .where(inArray(songs.performerId, performerIds));

      const previews: Record<
        string,
        { previewUrl: string | null; spotifyTrackId: string | null }
      > = {};
      for (const row of rows) {
        const trackId =
          row.spotifyTrackId && row.spotifyTrackId !== '__none__'
            ? row.spotifyTrackId
            : null;
        previews[row.title.toLowerCase()] = {
          previewUrl: row.previewUrl ?? null,
          spotifyTrackId: trackId,
        };
      }
      return { previews };
    }),

  /**
   * Lazy-resolve a single setlist row's preview clip + Spotify URI on
   * tap. Tries Spotify Search first (so the Spotify track id is cached
   * for "Open in Spotify" / Web Playback SDK use), then falls back to
   * Apple's iTunes Search API when Spotify returns the track without a
   * `preview_url` — a near-universal outcome since Spotify's Nov 2024
   * deprecation of the field for new apps.
   *
   * Persists the final preview URL (Spotify-served OR iTunes-served)
   * in `songs.spotify_preview_url` plus a `preview_resolved_at`
   * timestamp so the cache check on the next tap can distinguish
   * "we tried both sources and got nothing" from "we never tried".
   *
   * Returns `{ previewUrl, spotifyTrackId }`. Either can be null:
   *   - `previewUrl: null` — both providers came up empty
   *   - `spotifyTrackId: null` — Spotify had no match (iTunes URL may
   *     still be present for inline playback)
   *
   * Rate-limit shape:
   *   - 60/min per user on the procedure (existing).
   *   - 20/min per user on the iTunes hop (mirrors Apple's IP limit).
   *     iTunes 403 or per-user rate-limit hit leaves the row's
   *     `preview_resolved_at` null so a subsequent tap can retry
   *     instead of caching the transient miss as permanent.
   */
  resolveTrackPreview: protectedProcedure
    .input(
      z.object({
        showId: z.string().uuid(),
        title: z.string().min(1).max(300),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{
      previewUrl: string | null;
      spotifyTrackId: string | null;
    }> => {
      const userId = ctx.session.user.id;
      enforceRateLimit(`setlist-intel.resolve-preview:${userId}`, {
        max: 60,
        windowMs: 60_000,
      });
      const accessToken = await ensureFreshUserToken(userId);
      if (!accessToken) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'spotify_not_connected',
        });
      }
      const show = await ctx.db.query.shows.findFirst({
        where: and(eq(shows.id, input.showId), eq(shows.userId, userId)),
        with: { showPerformers: { with: { performer: true } } },
      });
      if (!show) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }
      const headlinerId = getHeadlinerId(show as ShowLike);
      if (!headlinerId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'no_headliner',
        });
      }
      const headlinerName =
        show.showPerformers.find((sp) => sp.performer.id === headlinerId)
          ?.performer.name ?? '';

      const titleLower = input.title.toLowerCase();
      const [cached] = await ctx.db
        .select({
          id: songs.id,
          previewUrl: songs.spotifyPreviewUrl,
          spotifyTrackId: songs.spotifyTrackId,
          previewResolvedAt: songs.previewResolvedAt,
        })
        .from(songs)
        .where(
          and(
            eq(songs.performerId, headlinerId),
            sql`LOWER(${songs.title}) = ${titleLower}`,
          ),
        )
        .limit(1);

      // Cache hit: a previous run already settled this row. Either we
      // have a playable URL OR we've recorded that both providers came
      // up empty. `__none__` rows from before this change get a second
      // chance via iTunes — they fall through to the lookup below.
      if (cached?.previewUrl || cached?.previewResolvedAt) {
        return {
          previewUrl: cached.previewUrl ?? null,
          spotifyTrackId:
            cached.spotifyTrackId && cached.spotifyTrackId !== '__none__'
              ? cached.spotifyTrackId
              : null,
        };
      }

      // Step 1 — Spotify. Skip the network hop when we already cached
      // the track id from a previous tap (the existing-row fallback
      // path: Spotify ran before iTunes was wired in). The catalog-
      // pollution guard from the security PR (#192) applies to fresh
      // searches only — cached track ids were either vetted by the
      // guard the first time around, or pre-date it (rare; the guard
      // intentionally doesn't backfill).
      let spotifyTrackId: string | null = null;
      let spotifyPreviewUrl: string | null = null;
      let spotifyDurationMs: number | null = null;
      if (cached?.spotifyTrackId === '__none__') {
        spotifyTrackId = null; // Confirmed Spotify miss in a prior run.
      } else if (cached?.spotifyTrackId) {
        spotifyTrackId = cached.spotifyTrackId;
        spotifyPreviewUrl = cached.previewUrl ?? null;
      } else {
        let track;
        try {
          track = await searchTrack(accessToken, headlinerName, input.title);
        } catch (err) {
          log.warn(
            {
              err,
              event: 'spotify.preview.unavailable',
              userId,
              showId: input.showId,
              title: input.title,
              reason: 'spotify_search_error',
            },
            'Spotify search threw',
          );
          // Surface the failure rather than caching as resolved — the
          // next tap retries Spotify too.
          return { previewUrl: null, spotifyTrackId: null };
        }

        // Catalog-pollution guard: Spotify's track search is fuzzy, and
        // since `songs.spotify_track_id` is a global catalog column, a
        // mismatched resolution (e.g. a cover by a different artist that
        // happens to rank first) is visible to every Showbook user who
        // views this performer's setlist. Require the resolved track's
        // artist list to include the headliner before we persist anything
        // — when no artist matches, treat as a miss without poisoning the
        // catalog and without falling through to iTunes (the same title
        // ambiguity would pollute the preview URL just as readily).
        const headlinerLower = headlinerName.trim().toLowerCase();
        const trackArtistMatch =
          track !== null &&
          headlinerLower.length > 0 &&
          track.artists.some(
            (a) => a.trim().toLowerCase() === headlinerLower,
          );
        if (track !== null && !trackArtistMatch) {
          log.warn(
            {
              event: 'spotify.preview.artist_mismatch',
              userId,
              showId: input.showId,
              title: input.title,
              headlinerName,
              resolvedArtists: track.artists,
            },
            'Spotify search returned a track whose artist does not match the headliner; refusing to persist',
          );
          return { previewUrl: null, spotifyTrackId: null };
        }

        if (track) {
          spotifyTrackId = track.id;
          spotifyPreviewUrl = track.previewUrl;
          spotifyDurationMs = track.durationMs;
        }
      }

      // Step 2 — iTunes fallback whenever we don't already have a URL.
      let finalPreviewUrl: string | null = spotifyPreviewUrl;
      let previewSource: 'spotify' | 'itunes' | 'none' = finalPreviewUrl
        ? 'spotify'
        : 'none';
      let itunesDurationMs: number | null = null;
      let itunesRateLimited = false;
      if (!finalPreviewUrl) {
        if (
          isRateLimited(`itunes:${userId}`, { max: 20, windowMs: 60_000 })
        ) {
          itunesRateLimited = true;
          log.warn(
            {
              event: 'itunes.preview.user_rate_limited',
              userId,
              title: input.title,
            },
            'iTunes preview lookup skipped — per-user rate limit',
          );
        } else {
          try {
            const itunes = await searchITunesPreview(
              headlinerName,
              input.title,
            );
            if (itunes?.previewUrl) {
              finalPreviewUrl = itunes.previewUrl;
              previewSource = 'itunes';
              itunesDurationMs = itunes.durationMs;
            }
          } catch (err) {
            if (err instanceof ITunesError && err.status === 403) {
              itunesRateLimited = true;
            } else {
              log.warn(
                {
                  err,
                  event: 'itunes.preview.failed',
                  userId,
                  title: input.title,
                },
                'iTunes preview lookup threw',
              );
            }
          }
        }
      }

      // Step 3 — persist. `preview_resolved_at` stays null when iTunes
      // was rate-limited so the next tap retries instead of caching
      // the transient miss as permanent.
      const now = new Date();
      const resolvedAt = itunesRateLimited ? null : now;
      const trackIdToStore = spotifyTrackId ?? '__none__';
      const durationMsToStore = spotifyDurationMs ?? itunesDurationMs;

      if (cached) {
        await ctx.db
          .update(songs)
          .set({
            spotifyTrackId: trackIdToStore,
            spotifyPreviewUrl: finalPreviewUrl,
            ...(durationMsToStore != null && {
              durationMs: durationMsToStore,
            }),
            previewResolvedAt: resolvedAt,
          })
          .where(eq(songs.id, cached.id));
      } else {
        await ctx.db
          .insert(songs)
          .values({
            performerId: headlinerId,
            title: input.title,
            spotifyTrackId: trackIdToStore,
            spotifyPreviewUrl: finalPreviewUrl,
            durationMs: durationMsToStore,
            previewResolvedAt: resolvedAt,
          })
          .onConflictDoNothing();
      }

      log.info(
        {
          event: 'spotify.preview.resolved',
          userId,
          title: input.title,
          hasPreview: !!finalPreviewUrl,
          source: previewSource,
          itunesRateLimited,
        },
        'Track preview resolved',
      );

      return {
        previewUrl: finalPreviewUrl,
        spotifyTrackId,
      };
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

  // ───────────────────────────────────────────────────────────────────
  // Phase 7 — music layer v2
  // ───────────────────────────────────────────────────────────────────

  /**
   * Fan-loyalty ring source data — past shows only. Walks the actual
   * setlist, asks Spotify which of those tracks the user has saved,
   * and returns the rolled-up count/percentage. Computed on demand;
   * never persisted (SI-12).
   */
  fanLoyalty: protectedProcedure
    .input(showIdOnly)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        return await fanLoyaltyForShow({
          db: ctx.db,
          userId,
          showId: input.showId,
        });
      } catch (err) {
        log.error(
          {
            event: 'setlistIntel.fan_loyalty.failed',
            err,
            userId,
            showId: input.showId,
          },
          'Fan loyalty computation failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'fan_loyalty_failed',
        });
      }
    }),

  /**
   * Discovered-live rail — songs played at this show that the user
   * does NOT have saved on Spotify. List-row layout per the design
   * handoff. The companion `saveDiscoveredSong` mutation flips
   * individual rows.
   */
  discoveredLive: protectedProcedure
    .input(showIdOnly)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        return await discoveredLiveForShow({
          db: ctx.db,
          userId,
          showId: input.showId,
        });
      } catch (err) {
        log.error(
          {
            event: 'setlistIntel.discovered_live.failed',
            err,
            userId,
            showId: input.showId,
          },
          'Discovered-live computation failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'discovered_live_failed',
        });
      }
    }),

  /**
   * Save a single track to the user's Spotify library. The mutation
   * patches the in-process saved-cache so the next ring/rail render
   * reflects the new state without waiting for the 60s TTL.
   */
  saveDiscoveredSong: protectedProcedure
    .input(saveDiscoveredInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const result = await saveDiscoveredSong({
        db: ctx.db,
        userId,
        songId: input.songId,
      });
      if (!result.ok) {
        if (result.reason === 'not_connected') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'spotify_not_connected',
          });
        }
        if (result.reason === 'no_spotify_id') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'no_spotify_id',
          });
        }
        if (result.reason === 'not_in_user_history') {
          // The discovered-live rail only surfaces songs the caller has
          // heard live. A songId that doesn't appear in any of their
          // attended setlists isn't a configuration error — it's an
          // attempt to bypass the UI's authorization model. Respond
          // with NOT_FOUND so the client treats it like "rail item is
          // stale, refresh" rather than surfacing a connect prompt.
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'song_not_in_history',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'save_discovered_failed',
        });
      }
      return { ok: true as const };
    }),

  /**
   * Priming stat — italic line on the show title block. Reads the
   * pre/post counts populated by the nightly recently-played job.
   * Returns nulls when the job hasn't yet filled the show.
   */
  primingStat: protectedProcedure
    .input(showIdOnly)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return primingStatForShow({
        db: ctx.db,
        userId,
        showId: input.showId,
      });
    }),
});

export type SetlistIntelRouter = typeof setlistIntelRouter;
