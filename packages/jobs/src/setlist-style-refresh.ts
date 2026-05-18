/**
 * Nightly setlist-style-refresh cron. §15b / Phase 5.
 *
 * For every performer with at least one tour-setlist on disk, recompute
 * the auto-classified style from corpus signals and reconcile it with
 * the existing stored style + seed table via the three-runs-to-disagree
 * rule (`reconcileStyleTransition`). Writes `performers.setlist_style`
 * + `performers.computed_style` + `performers.style_disagreement_count`
 * when the verdict changes; pure no-op when it doesn't.
 *
 * Scheduling: 03:30 ET, between the eval back-test (03:00) and the
 * corpus-fill refresh (04:45) so the cron operates on the freshest
 * corpus the day produced.
 *
 * Spec: docs/specs/setlist-intelligence/phases/phase-05-style-classifier-rotating.md
 */

import { eq, sql, desc, and, gte } from 'drizzle-orm';
import { db, performers, tourSetlists } from '@showbook/db';
import { child } from '@showbook/observability';
import {
  inferSetlistStyle,
  lookupSeedStyle,
  reconcileStyleTransition,
  type SetlistStyle,
  type SetlistStyleOrUnknown,
} from '@showbook/api';
import type { CorpusRow } from '@showbook/api';
import type { PerformerSetlist } from '@showbook/shared';

const log = child({ component: 'jobs.setlist-style-refresh' });

const MIN_CORPUS_FOR_AUTO = 5;
const CORPUS_LOOKBACK_DAYS = 365;
const MS_PER_DAY = 86_400_000;

export interface SetlistStyleRefreshResult {
  performersConsidered: number;
  performersUpdated: number;
  performersFlipped: number;
  seedsApplied: number;
  unknownKept: number;
  failures: number;
}

export async function runSetlistStyleRefresh(): Promise<SetlistStyleRefreshResult> {
  const startedAt = Date.now();
  let performersConsidered = 0;
  let performersUpdated = 0;
  let performersFlipped = 0;
  let seedsApplied = 0;
  let unknownKept = 0;
  let failures = 0;

  // Pull every performer that has at least one corpus row. We do this in
  // a single query rather than scanning the full `performers` table to
  // keep the cron's footprint low — empty-corpus performers can't be
  // auto-classified.
  const performerRows = await db
    .select({
      id: performers.id,
      name: performers.name,
      musicbrainzId: performers.musicbrainzId,
      setlistStyle: performers.setlistStyle,
      setlistStyleOverride: performers.setlistStyleOverride,
      computedStyle: performers.computedStyle,
      styleDisagreementCount: performers.styleDisagreementCount,
    })
    .from(performers)
    .where(
      sql`EXISTS (
        SELECT 1 FROM ${tourSetlists} ts
        WHERE ts.performer_id = ${performers.id}
      )`,
    );

  performersConsidered = performerRows.length;
  log.info(
    {
      event: 'setlist.style.refresh.started',
      performersConsidered,
    },
    'setlist-style-refresh cron started',
  );

  const earliest = new Date(Date.now() - CORPUS_LOOKBACK_DAYS * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

  for (const perf of performerRows) {
    try {
      const corpus = await loadCorpusForPerformer(perf.id, earliest);
      const seed = lookupSeedStyle(perf.musicbrainzId);
      const override = (perf.setlistStyleOverride ?? null) as SetlistStyle | null;
      const auto = inferSetlistStyle(corpus, { seed }).style;

      const stored = (perf.setlistStyle ?? null) as SetlistStyleOrUnknown | null;
      const verdict = reconcileStyleTransition({
        stored,
        disagreementCount: perf.styleDisagreementCount ?? 0,
        auto,
        seed,
        override,
      });

      // Update path — write only when something changed to keep churn
      // low. We always refresh `computed_style` so the audit trail of
      // "what the classifier wanted" stays current even when we
      // haven't flipped yet.
      const needsWrite =
        verdict.flipped ||
        verdict.nextDisagreementCount !== (perf.styleDisagreementCount ?? 0) ||
        perf.computedStyle !== auto;

      if (needsWrite) {
        const updateValues: {
          setlistStyle?: string | null;
          setlistStyleInferredAt?: Date;
          computedStyle?: string | null;
          styleDisagreementCount?: number;
        } = {
          computedStyle: auto,
          styleDisagreementCount: verdict.nextDisagreementCount,
        };
        if (verdict.flipped) {
          updateValues.setlistStyle = verdict.nextStored;
          updateValues.setlistStyleInferredAt = new Date();
        }
        await db
          .update(performers)
          .set(updateValues)
          .where(eq(performers.id, perf.id));
        performersUpdated += 1;
        if (verdict.flipped) performersFlipped += 1;
      }

      if (verdict.reason === 'seed_initial') seedsApplied += 1;
      if (verdict.reason === 'unknown_keep') unknownKept += 1;

      // Emit per-performer events only when the verdict actually
      // changed something — every-night noise would drown the
      // signal otherwise. seed_applied / seed_overridden / classified
      // each fire on their respective transitions.
      if (verdict.flipped && verdict.reason === 'seed_initial') {
        log.info(
          {
            event: 'setlist.style.seed_applied',
            performerId: perf.id,
            performerName: perf.name,
            mbid: perf.musicbrainzId,
            style: verdict.nextStored,
            seed,
          },
          'seed style applied for fresh performer',
        );
      } else if (verdict.flipped && verdict.reason === 'auto_flip') {
        log.info(
          {
            event: 'setlist.style.seed_overridden',
            performerId: perf.id,
            performerName: perf.name,
            mbid: perf.musicbrainzId,
            oldStyle: stored,
            newStyle: verdict.nextStored,
            seed,
            jaccard: undefined as number | undefined, // see classified below
          },
          'auto-classifier overrode seed after three disagreements',
        );
      }
      if (verdict.flipped || verdict.reason === 'auto_apply') {
        const signals = inferSetlistStyle(corpus).signals;
        log.info(
          {
            event: 'setlist.style.classified',
            performerId: perf.id,
            performerName: perf.name,
            oldStyle: stored,
            newStyle: verdict.nextStored,
            reason: verdict.reason,
            jaccard: Number(signals.jaccard.toFixed(3)),
            uniqueRatio: Number(signals.uniqueRatio.toFixed(3)),
            meanLength: Number(signals.meanLength.toFixed(2)),
            corpusSize: signals.corpusSize,
          },
          'classified style change',
        );
      }
    } catch (err) {
      failures += 1;
      log.error(
        {
          event: 'setlist.style.refresh.entry_failed',
          err,
          performerId: perf.id,
        },
        'per-performer style refresh failed',
      );
    }
  }

  const result: SetlistStyleRefreshResult = {
    performersConsidered,
    performersUpdated,
    performersFlipped,
    seedsApplied,
    unknownKept,
    failures,
  };
  log.info(
    {
      event: 'setlist.style.refresh.summary',
      ...result,
      durationMs: Date.now() - startedAt,
    },
    'setlist-style-refresh cron complete',
  );
  return result;
}

async function loadCorpusForPerformer(
  performerId: string,
  earliest: string,
): Promise<CorpusRow[]> {
  const rows = await db
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
        eq(tourSetlists.performerId, performerId),
        gte(tourSetlists.performanceDate, earliest),
      ),
    )
    .orderBy(desc(tourSetlists.performanceDate));
  return rows.map((r) => ({
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
}

export { MIN_CORPUS_FOR_AUTO };
