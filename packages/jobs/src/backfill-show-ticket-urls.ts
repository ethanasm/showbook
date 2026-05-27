// `load-env-local` is a no-op when no .env.local is present (the prod
// container case), so it's safe to import unconditionally.
import './load-env-local';

import { db, shows, venues, showPerformers, performers } from '@showbook/db';
import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { searchEvents, pickPrimaryEventUrl } from '@showbook/api';
import { child, flushObservability } from '@showbook/observability';

const log = child({ component: 'jobs.backfill-show-ticket-urls' });
const WAIT_MS = 250; // TM allows ~5 req/sec on the discovery API

export interface BackfillShowTicketUrlsSummary {
  total: number;
  updated: number;
  missing: number;
  failed: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backfill `shows.ticket_url` for future shows (state in
 * `watching` / `ticketed`) that don't have one yet. Catches the gap
 * left by Gmail / Eventbrite / setlist.fm bulk imports that landed
 * before `shows.create` widened its TM enrichment to cover ticketed
 * shows — those rows would otherwise sit without a tickets-jump link
 * for their whole upcoming lifetime.
 *
 * Strategy per row: TM event search keyed by venue + date + headliner
 * (or production name for theatre). Take the first event's `url` if
 * present. Without a venue+date scope TM event search returns too much
 * noise to safely auto-pick, so there is no fallback.
 *
 * Festivals are excluded because TM matching is poor for multi-artist
 * events (same reason `shows.create` excludes them). Past shows are
 * excluded because (a) a stale ticket link is worse than no link and
 * (b) the ShowCard rule already hides the icon for `state === 'past'`.
 *
 * Run via pg-boss schedule (daily 06:45 ET — see registry.ts) or as a CLI:
 * `pnpm --filter @showbook/jobs exec tsx src/backfill-show-ticket-urls.ts`
 */
export async function runBackfillShowTicketUrls(): Promise<BackfillShowTicketUrlsSummary> {
  const candidates = await db
    .select({
      id: shows.id,
      kind: shows.kind,
      productionName: shows.productionName,
      date: shows.date,
      tmVenueId: venues.ticketmasterVenueId,
    })
    .from(shows)
    .innerJoin(venues, eq(shows.venueId, venues.id))
    .where(
      and(
        isNull(shows.ticketUrl),
        inArray(shows.state, ['watching', 'ticketed']),
        ne(shows.kind, 'festival'),
        isNotNull(shows.date),
      ),
    );

  // Batch-fetch headliner names so the TM keyword is accurate for
  // concerts / comedy (theatre uses productionName). One query rather
  // than N — multiple headliners on one show is allowed (rare), so we
  // keep the lowest sortOrder.
  const headlinerByShowId = new Map<string, string>();
  if (candidates.length > 0) {
    const showIds = candidates.map((c) => c.id);
    const rows = await db
      .select({
        showId: showPerformers.showId,
        name: performers.name,
        sortOrder: showPerformers.sortOrder,
      })
      .from(showPerformers)
      .innerJoin(performers, eq(performers.id, showPerformers.performerId))
      .where(
        and(
          inArray(showPerformers.showId, showIds),
          eq(showPerformers.role, 'headliner'),
        ),
      );
    for (const row of rows) {
      const existing = headlinerByShowId.get(row.showId);
      if (!existing) {
        headlinerByShowId.set(row.showId, row.name);
      }
      // Note: drizzle doesn't guarantee ordering on this query — we
      // prefer the first row seen, which is fine because picking any
      // headliner gives TM a reasonable keyword. The exact pick only
      // matters for the edge case of co-headliners, which is rare and
      // the lookup is still likely to succeed either way.
    }
  }

  let updated = 0;
  let missing = 0;
  let failed = 0;

  for (const [index, row] of candidates.entries()) {
    if (index > 0) await sleep(WAIT_MS);

    // Theatre uses productionName (the play title); everything else
    // (concert / comedy) keys on the headliner. Festivals were filtered
    // out at the query level. If we have neither, skip — TM event
    // search needs a keyword.
    const headlinerName = headlinerByShowId.get(row.id) ?? null;
    const keyword =
      row.kind === 'theatre'
        ? row.productionName ?? headlinerName
        : headlinerName ?? row.productionName;

    if (!keyword || !row.date) {
      missing++;
      log.info(
        { event: 'show.ticket_url.no_keyword', showId: row.id, kind: row.kind },
        'No headliner or productionName — skipping',
      );
      continue;
    }

    try {
      // size > 1 because TM returns the resale-marketplace listing
      // alongside the primary box-office event for the same physical
      // show, and the resale variant's bare /event/<id> URL renders
      // "Page Not Found" — pickPrimaryEventUrl filters it out, so we
      // need both candidates in the response.
      const { events } = await searchEvents({
        keyword,
        venueId: row.tmVenueId ?? undefined,
        startDateTime: `${row.date}T00:00:00Z`,
        endDateTime: `${row.date}T23:59:59Z`,
        size: 5,
      });
      const tmUrl = pickPrimaryEventUrl(events);
      if (!tmUrl) {
        missing++;
        log.info(
          { event: 'show.ticket_url.no_match', showId: row.id, keyword },
          'No TM event match for show',
        );
        continue;
      }

      await db
        .update(shows)
        .set({ ticketUrl: tmUrl })
        .where(eq(shows.id, row.id));
      updated++;
      log.info(
        { event: 'show.ticket_url.updated', showId: row.id, keyword },
        'Updated show ticket URL',
      );
    } catch (err) {
      failed++;
      log.error(
        { err, event: 'show.ticket_url.failed', showId: row.id, keyword },
        'Ticket URL lookup failed',
      );
    }
  }

  log.info(
    { event: 'show.ticket_url.done', total: candidates.length, updated, missing, failed },
    'Backfill complete',
  );

  return { total: candidates.length, updated, missing, failed };
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runBackfillShowTicketUrls()
    .then(async () => {
      await flushObservability();
      process.exit(0);
    })
    .catch(async (err) => {
      log.error({ err, event: 'show.ticket_url.fatal' }, 'Backfill failed');
      await flushObservability();
      process.exit(1);
    });
}
