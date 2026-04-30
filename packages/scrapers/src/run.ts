import { db } from '@showbook/db';
import {
  announcements,
  performers,
  shows,
  venues,
  venueScrapeRuns,
} from '@showbook/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { matchOrCreatePerformer, parseScrapeConfig } from '@showbook/api';
import { loadAndExtract } from './extract';
import { extractEventsFromPage, type ExtractedEvent } from './llm';
import { isAllowedByRobots } from './runtime';
import { child } from '@showbook/observability';

const log = child({ component: 'scrapers.run' });

/**
 * Run scrapers for every venue with `scrapeConfig.type === 'llm'`.
 * Returns aggregate counts; per-venue results live in `venue_scrape_runs`.
 */
export async function runScrapers(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  eventsCreated: number;
}> {
  const today = new Date().toISOString().slice(0, 10);

  // We can't filter by JSON shape in the WHERE here cleanly, so just pull
  // all venues with a non-null scrapeConfig and dispatch by parsed type.
  const candidateVenues = await db
    .select()
    .from(venues)
    .where(isNotNull(venues.scrapeConfig));

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let eventsCreated = 0;

  for (const venue of candidateVenues) {
    const cfg = parseScrapeConfig(venue.scrapeConfig);
    if (!cfg || cfg.type !== 'llm') continue;
    attempted++;

    const [run] = await db
      .insert(venueScrapeRuns)
      .values({ venueId: venue.id, status: 'running' })
      .returning();

    const venueLog = log.child({ venueId: venue.id, venueName: venue.name, url: cfg.url });
    const startedAt = Date.now();
    venueLog.info({ event: 'scrape.venue.start' }, 'Scrape started');

    try {
      if (!(await isAllowedByRobots(cfg.url))) {
        venueLog.warn({ event: 'scrape.venue.robots_disallowed' }, 'Disallowed by robots.txt');
        await db
          .update(venueScrapeRuns)
          .set({
            status: 'error',
            completedAt: new Date(),
            errorMessage: 'Disallowed by robots.txt',
          })
          .where(eq(venueScrapeRuns.id, run!.id));
        failed++;
        continue;
      }

      const page = await loadAndExtract(cfg.url);
      const venueDescriptor = await deriveVenueDescriptor(venue.id);
      const llm = await extractEventsFromPage({
        pageText: page.text,
        pageTitle: page.title,
        pageUrl: page.url,
        venueName: venue.name,
        venueCity: venue.city,
        venueRegion: venue.stateRegion ?? venue.country,
        venueDescriptor,
        todayISO: today,
      });

      const created = await persistScrapedEvents(venue.id, llm.events);

      await db
        .update(venueScrapeRuns)
        .set({
          status: 'success',
          completedAt: new Date(),
          eventsFound: llm.events.length + llm.rejected.length,
          eventsCreated: created,
          groqTokensUsed: llm.tokensUsed,
          pageHtmlExcerpt: page.text.slice(0, 2000),
        })
        .where(eq(venueScrapeRuns.id, run!.id));

      succeeded++;
      eventsCreated += created;
      venueLog.info(
        {
          event: 'scrape.venue.complete',
          eventsFound: llm.events.length,
          eventsRejected: llm.rejected.length,
          eventsCreated: created,
          tokensUsed: llm.tokensUsed,
          durationMs: Date.now() - startedAt,
        },
        'Scrape complete',
      );
      if (llm.rejected.length > 0) {
        venueLog.warn(
          { event: 'scrape.venue.quotes_rejected', rejected: llm.rejected.length },
          'Some events rejected by sourceQuote check',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(venueScrapeRuns)
        .set({
          status: 'error',
          completedAt: new Date(),
          errorMessage: msg.slice(0, 1000),
        })
        .where(eq(venueScrapeRuns.id, run!.id));
      failed++;
      venueLog.error({ err, event: 'scrape.venue.failed', durationMs: Date.now() - startedAt }, 'Scrape failed');
    }
  }

  return { attempted, succeeded, failed, eventsCreated };
}

/**
 * Derive a short noun-phrase describing what kind of events the venue
 * usually hosts, used inside the LLM system prompt. Falls back to a
 * generic phrase when the venue has no past shows.
 */
async function deriveVenueDescriptor(venueId: string): Promise<string> {
  const rows = await db
    .select({ kind: shows.kind, count: sql<number>`count(*)::int` })
    .from(shows)
    .where(eq(shows.venueId, venueId))
    .groupBy(shows.kind)
    .orderBy(sql`count(*) desc`);

  const top = rows[0]?.kind;
  switch (top) {
    case 'concert':
      return 'concerts';
    case 'theatre':
      return 'theatre productions';
    case 'comedy':
      return 'comedy shows';
    case 'festival':
      return 'festivals';
    default:
      return 'live events';
  }
}

/**
 * Convert a list of extracted events into announcements. Dedup by stable
 * sourceEventId built from (venueId, title, startDate). Mirror the run
 * fields from the LLM output (single date when no endDate; date range
 * when both dates supplied).
 */
async function persistScrapedEvents(
  venueId: string,
  events: ExtractedEvent[],
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);

  // Try to infer kind from venue history once; same heuristic as the
  // descriptor above.
  const [topKindRow] = await db
    .select({ kind: shows.kind })
    .from(shows)
    .where(eq(shows.venueId, venueId))
    .groupBy(shows.kind)
    .orderBy(sql`count(*) desc`)
    .limit(1);
  const inferredKind = topKindRow?.kind ?? 'theatre';

  let created = 0;
  for (const event of events) {
    if (event.startDate < today) continue;

    const sourceEventId = await stableId(venueId, event.title, event.startDate);

    // Check existing dedup.
    const [existing] = await db
      .select({ id: announcements.id })
      .from(announcements)
      .where(
        and(
          eq(announcements.source, 'scraped'),
          eq(announcements.sourceEventId, sourceEventId),
        ),
      )
      .limit(1);
    if (existing) continue;

    const { performer } = await matchOrCreatePerformer({ name: event.title });

    const isRun = !!event.endDate && event.endDate > event.startDate;
    const performanceDates = isRun
      ? expandDateRange(event.startDate, event.endDate!)
      : [event.startDate];

    await db.insert(announcements).values({
      venueId,
      kind: inferredKind,
      headliner: event.title,
      headlinerPerformerId: performer.id,
      support: event.supportActs ?? null,
      productionName: isRun ? event.title : null,
      showDate: event.startDate,
      runStartDate: event.startDate,
      runEndDate: event.endDate ?? event.startDate,
      performanceDates,
      onSaleDate: null,
      onSaleStatus: 'announced',
      source: 'scraped',
      sourceEventId,
    });
    created++;
  }
  return created;
}

function expandDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + 'T00:00:00Z');
  const stop = new Date(end + 'T00:00:00Z');
  while (cur <= stop) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

async function stableId(
  venueId: string,
  title: string,
  date: string,
): Promise<string> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  const data = new TextEncoder().encode(`${venueId}::${title}::${date}`);
  if (subtle) {
    const hash = await subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback for older Node runtimes; require it lazily to avoid bundler errors.
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(data).digest('hex');
}
