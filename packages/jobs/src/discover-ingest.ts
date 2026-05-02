import { db } from '@showbook/db';
import {
  announcements,
  userVenueFollows,
  userPerformerFollows,
  userRegions,
  venues,
  performers,
} from '@showbook/db';
import { eq, lt, isNotNull, and, inArray, sql } from 'drizzle-orm';
import {
  searchEvents,
  inferKind,
  selectBestImage,
  extractMusicbrainzId,
  matchOrCreateVenue,
  matchOrCreatePerformer,
  type TMEvent,
} from '@showbook/api';
import {
  groupEventsIntoRuns,
  type EventRun,
  type NormalizedEvent,
} from './run-grouping';
import { child } from '@showbook/observability';

const log = child({ component: 'discover-ingest' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function futureISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function determineOnSaleStatus(
  event: TMEvent,
): 'announced' | 'on_sale' | 'sold_out' {
  const now = new Date();
  if (event.dates?.status?.code === 'offsale') return 'sold_out';
  if (event.dates?.status?.code === 'cancelled') return 'sold_out';

  const publicSale = event.sales?.public;
  if (publicSale?.startDateTime) {
    const saleStart = new Date(publicSale.startDateTime);
    if (saleStart > now) return 'announced';
  }
  if (publicSale?.endDateTime) {
    const saleEnd = new Date(publicSale.endDateTime);
    if (saleEnd < now) return 'sold_out';
  }
  return 'on_sale';
}

export function parseOnSaleDate(event: TMEvent): Date | null {
  const startDateTime = event.sales?.public?.startDateTime;
  if (!startDateTime) return null;

  const date = new Date(startDateTime);
  if (Number.isNaN(date.getTime())) return null;

  // Ticketmaster sometimes uses 1900-01-01 as a placeholder. Treat it as
  // missing so the UI does not show a bogus on-sale date.
  if (date.getUTCFullYear() < 2000) return null;

  return date;
}

/**
 * Dedup strategy: TM sourceEventId dedup uses `existingSourceIds` (a Set of
 * already-ingested TM event IDs loaded from the announcements table before
 * each ingest run). This is the primary key for single-night events and for
 * the nights that make up a run. Google Place ID dedup is handled in
 * venue-matcher.ts when a googlePlaceId is available; TM events don't supply
 * one, so TM venue ID (tmVenueId) is the effective dedup key for venues.
 * Between the two layers, re-running ingest is safe and idempotent.
 */
export async function fetchAllEvents(
  params: Parameters<typeof searchEvents>[0],
  maxEvents = 1000,
  searchFn: typeof searchEvents = searchEvents,
): Promise<TMEvent[]> {
  // TM caps page*size at 1000; use 200 per page for 5 pages max.
  const PAGE_SIZE = 200;
  const first = await searchFn({ ...params, size: PAGE_SIZE, page: 0 });
  const all = [...first.events];

  let page = 1;
  while (all.length < maxEvents && all.length < first.totalElements) {
    // TM hard cap: page * size must be <= 1000 (5 pages of 200).
    if (page * PAGE_SIZE > 1000) break;
    const next = await searchFn({ ...params, size: PAGE_SIZE, page });
    if (next.events.length === 0) break;
    all.push(...next.events);
    page++;
  }

  return all.slice(0, maxEvents);
}

/**
 * Convert a TM event into our normalized shape. Resolves the venue and
 * headliner performer along the way (creating new rows as needed).
 * Returns null when the event is unusable (no venue).
 */
async function normalizeTmEvent(event: TMEvent): Promise<NormalizedEvent | null> {
  const tmVenue = event._embedded?.venues?.[0];
  if (!tmVenue) return null;

  // TM occasionally returns events with a venue object that has no `name`
  // (observed for European venues where the city is the only text field —
  // Düsseldorf, 2026-04-30). matchOrCreateVenue rejects empty names, so
  // skip+log here rather than emitting a `tm.normalize.failed` error per
  // event. Without a venue name there's no usable show row to create.
  if (!tmVenue.name || tmVenue.name.trim().length === 0) {
    log.warn(
      {
        event: 'tm.normalize.skipped',
        reason: 'missing_venue_name',
        tmEventId: event.id,
        name: event.name,
        city: tmVenue.city?.name,
      },
      'Skipping TM event with no venue name',
    );
    return null;
  }

  const { venue } = await matchOrCreateVenue({
    name: tmVenue.name,
    city: tmVenue.city?.name ?? 'Unknown',
    stateRegion: tmVenue.state?.name,
    country: tmVenue.country?.countryCode,
    tmVenueId: tmVenue.id,
    lat: tmVenue.location?.latitude
      ? parseFloat(tmVenue.location.latitude)
      : undefined,
    lng: tmVenue.location?.longitude
      ? parseFloat(tmVenue.location.longitude)
      : undefined,
  });

  const attractions = event._embedded?.attractions ?? [];
  const headlinerAttraction = attractions[0];
  const headlinerName = headlinerAttraction?.name ?? event.name;

  let headlinerPerformerId: string | null = null;
  if (headlinerAttraction) {
    const imageUrl = selectBestImage(headlinerAttraction.images);
    const { performer } = await matchOrCreatePerformer({
      name: headlinerAttraction.name,
      tmAttractionId: headlinerAttraction.id,
      imageUrl: imageUrl ?? undefined,
      musicbrainzId: extractMusicbrainzId(headlinerAttraction),
    });
    headlinerPerformerId = performer.id;
  }

  const supportAttractions = attractions.length > 1 ? attractions.slice(1) : [];
  const support = supportAttractions.length > 0
    ? supportAttractions.map((a) => a.name)
    : null;

  // Resolve every support act through matchOrCreatePerformer too, so
  // followed-artist feeds can match on support_performer_ids and the
  // performer's photo/MBID get backfilled from TM the same way the
  // headliner's do. Failures are logged but don't abort the event —
  // we'd rather have an announcement with one missing support id than
  // no announcement at all.
  const supportPerformerIds: string[] = [];
  for (const attr of supportAttractions) {
    try {
      const img = selectBestImage(attr.images);
      const { performer } = await matchOrCreatePerformer({
        name: attr.name,
        tmAttractionId: attr.id,
        imageUrl: img ?? undefined,
        musicbrainzId: extractMusicbrainzId(attr),
      });
      supportPerformerIds.push(performer.id);
    } catch (err) {
      log.warn(
        {
          err,
          event: 'tm.normalize.support_performer_failed',
          name: attr.name,
          tmEventId: event.id,
        },
        'Failed to resolve support performer',
      );
    }
  }

  return {
    sourceEventId: event.id,
    date: event.dates.start.localDate,
    kind: inferKind(event.classifications, { eventName: event.name }),
    headliner: headlinerName,
    headlinerPerformerId,
    venueId: venue.id,
    support,
    supportPerformerIds: supportPerformerIds.length > 0 ? supportPerformerIds : null,
    onSaleDate: parseOnSaleDate(event),
    onSaleStatus: determineOnSaleStatus(event),
    source: 'ticketmaster',
    ticketUrl: event.url ?? null,
  };
}

/**
 * Insert a single normalized event as an announcement. Used for events that
 * shouldn't be grouped into a run (single-night, comedy, festival, isolated
 * concerts).
 */
async function insertSingleEvent(
  event: NormalizedEvent,
  existingSourceIds: Set<string>,
): Promise<boolean> {
  if (existingSourceIds.has(event.sourceEventId)) return false;
  await db.insert(announcements).values({
    venueId: event.venueId,
    kind: event.kind,
    headliner: event.headliner,
    headlinerPerformerId: event.headlinerPerformerId,
    support: event.support,
    supportPerformerIds: event.supportPerformerIds,
    showDate: event.date,
    runStartDate: event.date,
    runEndDate: event.date,
    performanceDates: [event.date],
    onSaleDate: event.onSaleDate,
    onSaleStatus: event.onSaleStatus,
    source: event.source,
    sourceEventId: event.sourceEventId,
    ticketUrl: event.ticketUrl,
  });
  existingSourceIds.add(event.sourceEventId);
  return true;
}

/**
 * Insert a grouped run, OR extend an existing run row if one with the same
 * (productionName, venueId, kind) already exists. Festival runs may also
 * upgrade an existing concert run for the same production/venue that was
 * created before festival inference was strong enough. Extending merges the
 * new dates into the existing performanceDates and updates run start/end.
 *
 * Returns 1 if a row was inserted or extended (i.e., new dates appeared),
 * 0 if nothing changed.
 */
async function upsertRun(
  run: EventRun,
  existingSourceIds: Set<string>,
): Promise<number> {
  // Skip dates that were already ingested as singles (rare, but possible
  // across schema upgrades).
  const newSourceIds = run.sourceEventIds.filter(
    (id) => !existingSourceIds.has(id),
  );
  if (newSourceIds.length === 0) return 0;

  // Look for an existing run row at the same (productionName, venueId, kind).
  const [existing] = await db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.venueId, run.venueId),
        run.kind === 'festival'
          ? sql`${announcements.kind} in ('festival', 'concert')`
          : eq(announcements.kind, run.kind),
        eq(announcements.productionName, run.productionName),
      ),
    )
    .limit(1);

  if (existing) {
    // Merge dates into the existing run.
    const existingDates = new Set(existing.performanceDates ?? []);
    let extended = false;
    for (const d of run.performanceDates) {
      if (!existingDates.has(d)) {
        existingDates.add(d);
        extended = true;
      }
    }
    const merged = Array.from(existingDates).sort();
    await db
      .update(announcements)
      .set({
        kind: run.kind,
        runStartDate: merged[0]!,
        runEndDate: merged[merged.length - 1]!,
        performanceDates: merged,
        showDate: merged[0]!,
        support: run.support ?? existing.support,
        supportPerformerIds:
          run.supportPerformerIds ?? existing.supportPerformerIds,
        onSaleDate:
          run.kind === 'festival'
            ? run.onSaleDate
            : run.onSaleDate ?? existing.onSaleDate,
        onSaleStatus: run.onSaleStatus,
        ticketUrl: run.ticketUrl ?? existing.ticketUrl,
      })
      .where(eq(announcements.id, existing.id));
    for (const id of newSourceIds) existingSourceIds.add(id);
    return extended ? 1 : 0;
  }

  // Fresh run row.
  await db.insert(announcements).values({
    venueId: run.venueId,
    kind: run.kind,
    headliner: run.headliner,
    headlinerPerformerId: run.headlinerPerformerId,
    support: run.support,
    supportPerformerIds: run.supportPerformerIds,
    productionName: run.productionName,
    showDate: run.runStartDate,
    runStartDate: run.runStartDate,
    runEndDate: run.runEndDate,
    performanceDates: run.performanceDates,
    onSaleDate: run.onSaleDate,
    onSaleStatus: run.onSaleStatus,
    source: run.source,
    // sourceEventId is per-night, not per-run; leave null on a run row and
    // let the per-night IDs live in performanceDates' association via
    // existingSourceIds dedup.
    sourceEventId: null,
    ticketUrl: run.ticketUrl,
  });
  for (const id of newSourceIds) existingSourceIds.add(id);
  return 1;
}

async function pruneDuplicateFestivalSinglesForRun(run: EventRun): Promise<void> {
  if (run.kind !== 'festival') return;

  await db.execute(
    sql`DELETE FROM announcements a
        WHERE a.source = 'ticketmaster'
          AND a.kind = 'festival'
          AND a.source_event_id IS NOT NULL
          AND a.venue_id = ${run.venueId}
          AND lower(a.headliner) = lower(${run.headliner})
          AND a.show_date >= ${run.runStartDate}
          AND a.show_date <= ${run.runEndDate}
          AND NOT EXISTS (
            SELECT 1
            FROM show_announcement_links sal
            WHERE sal.announcement_id = a.id
          )`,
  );
}

/**
 * Take a flat list of TM events for a single (target, query), normalize and
 * group them, then write the announcements. Returns the number of new
 * announcement rows produced (insert + extend).
 */
async function ingestTmEvents(
  events: TMEvent[],
  existingSourceIds: Set<string>,
): Promise<number> {
  const normalized: NormalizedEvent[] = [];
  for (const event of events) {
    if (existingSourceIds.has(event.id)) continue;
    try {
      const ne = await normalizeTmEvent(event);
      if (ne) normalized.push(ne);
    } catch (err) {
      log.error(
        { err, event: 'tm.normalize.failed', tmEventId: event.id, name: event.name },
        'Failed to normalize TM event',
      );
    }
  }

  const { runs, singles } = groupEventsIntoRuns(normalized);

  let count = 0;
  for (const run of runs) {
    try {
      count += await upsertRun(run, existingSourceIds);
      await pruneDuplicateFestivalSinglesForRun(run);
    } catch (err) {
      log.error(
        { err, event: 'run.upsert.failed', productionName: run.productionName, venueId: run.venueId },
        'Failed to upsert run',
      );
    }
  }
  for (const event of singles) {
    try {
      const created = await insertSingleEvent(event, existingSourceIds);
      if (created) count++;
    } catch (err) {
      log.error(
        { err, event: 'event.insert.failed', sourceEventId: event.sourceEventId },
        'Failed to insert event',
      );
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Existing-source-id loader (shared dedup state)
// ---------------------------------------------------------------------------

async function loadExistingSourceIds(): Promise<Set<string>> {
  const rows = await db
    .select({ sourceEventId: announcements.sourceEventId })
    .from(announcements)
    .where(
      and(
        eq(announcements.source, 'ticketmaster'),
        isNotNull(announcements.sourceEventId),
      ),
    );
  return new Set(rows.map((r) => r.sourceEventId).filter((id): id is string => !!id));
}

// ---------------------------------------------------------------------------
// Targeted ingestion (used by on-follow trigger and refreshNow)
// ---------------------------------------------------------------------------

const INGEST_HORIZON_MONTHS = 12;

/**
 * Run Phase 1 for a single venue (when a user follows a venue). The TM
 * venue id is required — venues without one yield no announcements.
 */
export async function ingestVenue(venueId: string): Promise<{ events: number }> {
  const [venue] = await db
    .select({ id: venues.id, tmVenueId: venues.ticketmasterVenueId })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);

  if (!venue || !venue.tmVenueId) return { events: 0 };

  const existingSourceIds = await loadExistingSourceIds();
  const events = await fetchAllEvents({
    venueId: venue.tmVenueId,
    startDateTime: nowISO(),
    endDateTime: futureISO(INGEST_HORIZON_MONTHS),
  });
  const created = await ingestTmEvents(events, existingSourceIds);
  log.info(
    {
      event: 'discover.ingest.targeted.venue',
      venueId,
      fetched: events.length,
      inserted: created,
      skipped: events.length - created,
    },
    'Targeted venue ingest complete',
  );
  return { events: created };
}

/**
 * Run Phase 2 for a single region (when a user adds or re-activates one).
 * Uses TM's native latlong+radius query and skips events at venues the user
 * already follows so Phase 1 stays the source of truth for those.
 */
export async function ingestRegion(regionId: string): Promise<{ events: number }> {
  const [region] = await db
    .select({
      id: userRegions.id,
      latitude: userRegions.latitude,
      longitude: userRegions.longitude,
      radiusMiles: userRegions.radiusMiles,
      active: userRegions.active,
    })
    .from(userRegions)
    .where(eq(userRegions.id, regionId))
    .limit(1);

  if (!region || !region.active) return { events: 0 };

  const followedVenueRows = await db
    .selectDistinctOn([userVenueFollows.venueId], {
      tmVenueId: venues.ticketmasterVenueId,
    })
    .from(userVenueFollows)
    .innerJoin(venues, eq(userVenueFollows.venueId, venues.id))
    .where(isNotNull(venues.ticketmasterVenueId));
  const followedTmVenueIds = new Set(
    followedVenueRows
      .map((v) => v.tmVenueId)
      .filter((id): id is string => !!id),
  );

  const existingSourceIds = await loadExistingSourceIds();
  const events = await fetchAllEvents({
    latlong: `${region.latitude},${region.longitude}`,
    radius: region.radiusMiles,
    unit: 'miles',
    startDateTime: nowISO(),
    endDateTime: futureISO(INGEST_HORIZON_MONTHS),
  });
  const filtered = events.filter((e) => {
    const tmVenue = e._embedded?.venues?.[0];
    return !(tmVenue?.id && followedTmVenueIds.has(tmVenue.id));
  });
  const created = await ingestTmEvents(filtered, existingSourceIds);
  log.info(
    {
      event: 'discover.ingest.targeted.region',
      regionId,
      fetched: events.length,
      filtered: filtered.length,
      inserted: created,
      skipped: filtered.length - created,
    },
    'Targeted region ingest complete',
  );
  return { events: created };
}

/**
 * Run Phase 3 for a single performer (when a user follows an artist). The TM
 * attraction id is required.
 */
export async function ingestPerformer(
  performerId: string,
): Promise<{ events: number }> {
  const [performer] = await db
    .select({ id: performers.id, tmAttractionId: performers.ticketmasterAttractionId })
    .from(performers)
    .where(eq(performers.id, performerId))
    .limit(1);

  if (!performer || !performer.tmAttractionId) return { events: 0 };

  const existingSourceIds = await loadExistingSourceIds();
  const events = await fetchAllEvents({
    attractionId: performer.tmAttractionId,
    startDateTime: nowISO(),
    endDateTime: futureISO(INGEST_HORIZON_MONTHS),
  });
  const created = await ingestTmEvents(events, existingSourceIds);
  log.info(
    {
      event: 'discover.ingest.targeted.performer',
      performerId,
      fetched: events.length,
      inserted: created,
      skipped: events.length - created,
    },
    'Targeted performer ingest complete',
  );
  return { events: created };
}

// ---------------------------------------------------------------------------
// Main weekly ingestion pipeline (Phases 0–4)
// ---------------------------------------------------------------------------

export async function runDiscoverIngest(): Promise<{
  phase1Events: number;
  phase2Events: number;
  phase3Events: number;
  pruned: number;
  ingestionRunStart: Date;
}> {
  const ingestionRunStart = new Date();
  const start = nowISO();
  const end = futureISO(INGEST_HORIZON_MONTHS);

  const existingSourceIds = await loadExistingSourceIds();

  // ==========================================================================
  // Phase 0: Collect unique targets
  // ==========================================================================

  const followedVenueRows = await db
    .selectDistinctOn([userVenueFollows.venueId], {
      venueId: userVenueFollows.venueId,
      tmVenueId: venues.ticketmasterVenueId,
    })
    .from(userVenueFollows)
    .innerJoin(venues, eq(userVenueFollows.venueId, venues.id))
    .where(isNotNull(venues.ticketmasterVenueId));

  const followedVenues = followedVenueRows.filter(
    (v): v is typeof v & { tmVenueId: string } => v.tmVenueId !== null,
  );

  const regionRows = await db
    .selectDistinct({
      latitude: userRegions.latitude,
      longitude: userRegions.longitude,
      radiusMiles: userRegions.radiusMiles,
    })
    .from(userRegions)
    .where(eq(userRegions.active, true));

  const followedPerformerRows = await db
    .selectDistinctOn([userPerformerFollows.performerId], {
      performerId: userPerformerFollows.performerId,
      tmAttractionId: performers.ticketmasterAttractionId,
    })
    .from(userPerformerFollows)
    .innerJoin(performers, eq(userPerformerFollows.performerId, performers.id))
    .where(isNotNull(performers.ticketmasterAttractionId));

  const followedPerformers = followedPerformerRows.filter(
    (p): p is typeof p & { tmAttractionId: string } => p.tmAttractionId !== null,
  );

  log.info(
    {
      event: 'discover.ingest.phase0',
      venues: followedVenues.length,
      regions: regionRows.length,
      performers: followedPerformers.length,
    },
    'Phase 0: collected targets',
  );

  // ==========================================================================
  // Phase 1: Followed venue events (per-venue, grouped to runs as needed)
  // ==========================================================================

  let phase1Events = 0;
  for (const { tmVenueId } of followedVenues) {
    try {
      const events = await fetchAllEvents({
        venueId: tmVenueId,
        startDateTime: start,
        endDateTime: end,
      });
      phase1Events += await ingestTmEvents(events, existingSourceIds);
    } catch (err) {
      log.error(
        { err, event: 'discover.ingest.phase1.venue_failed', tmVenueId },
        'Phase 1 venue error',
      );
    }
  }
  log.info(
    { event: 'discover.ingest.phase1', inserted: phase1Events },
    'Phase 1 complete',
  );

  // ==========================================================================
  // Phase 2: Near-you events (per-region, excluding followed venues)
  // ==========================================================================

  const followedTmVenueIds = new Set(followedVenues.map((v) => v.tmVenueId));
  let phase2Events = 0;
  for (const region of regionRows) {
    try {
      const events = await fetchAllEvents({
        latlong: `${region.latitude},${region.longitude}`,
        radius: region.radiusMiles,
        unit: 'miles',
        startDateTime: start,
        endDateTime: end,
      });
      const filtered = events.filter((e) => {
        const tmVenue = e._embedded?.venues?.[0];
        return !(tmVenue?.id && followedTmVenueIds.has(tmVenue.id));
      });
      phase2Events += await ingestTmEvents(filtered, existingSourceIds);
    } catch (err) {
      log.error(
        {
          err,
          event: 'discover.ingest.phase2.region_failed',
          latitude: region.latitude,
          longitude: region.longitude,
        },
        'Phase 2 region error',
      );
    }
  }
  log.info(
    { event: 'discover.ingest.phase2', inserted: phase2Events },
    'Phase 2 complete',
  );

  // ==========================================================================
  // Phase 3: Tracked-performer events (per-attraction, filtered to user
  // regions or followed venues so we don't pull the entire global tour).
  // ==========================================================================

  // Collect user-relevant venue IDs (followed) and bounding boxes (regions)
  // once for filtering all performer events.
  const followedVenueIdSet = new Set(followedVenues.map((v) => v.venueId));
  const regionBoxes = regionRows.map((r) => {
    const latDelta = r.radiusMiles / 69.0;
    const lngDelta =
      r.radiusMiles / (69.0 * Math.cos((r.latitude * Math.PI) / 180));
    return {
      minLat: r.latitude - latDelta,
      maxLat: r.latitude + latDelta,
      minLng: r.longitude - lngDelta,
      maxLng: r.longitude + lngDelta,
    };
  });

  let phase3Events = 0;
  for (const { tmAttractionId } of followedPerformers) {
    try {
      const events = await fetchAllEvents({
        attractionId: tmAttractionId,
        startDateTime: start,
        endDateTime: end,
      });
      const relevant = events.filter((e) => {
        const tmVenue = e._embedded?.venues?.[0];
        if (!tmVenue) return false;
        // Always keep if at a venue someone follows.
        if (tmVenue.id && followedTmVenueIds.has(tmVenue.id)) return true;
        // Else require the venue to fall in some user's region bounding box.
        const latStr = tmVenue.location?.latitude;
        const lngStr = tmVenue.location?.longitude;
        if (!latStr || !lngStr) return false;
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        return regionBoxes.some(
          (b) =>
            lat >= b.minLat &&
            lat <= b.maxLat &&
            lng >= b.minLng &&
            lng <= b.maxLng,
        );
      });
      phase3Events += await ingestTmEvents(relevant, existingSourceIds);
    } catch (err) {
      log.error(
        { err, event: 'discover.ingest.phase3.performer_failed', tmAttractionId },
        'Phase 3 performer error',
      );
    }
  }
  log.info(
    { event: 'discover.ingest.phase3', inserted: phase3Events },
    'Phase 3 complete',
  );

  // Quiet "unused import" — followedVenueIdSet is referenced for clarity.
  void followedVenueIdSet;
  void inArray;

  // ==========================================================================
  // Phase 4: Cleanup — delete old announcements
  // ==========================================================================

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoffDate = sevenDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD

  const deleted = await db
    .delete(announcements)
    .where(lt(announcements.showDate, cutoffDate))
    .returning({ id: announcements.id });
  const pruned = deleted.length;
  log.info(
    { event: 'discover.ingest.phase4', pruned },
    'Phase 4 (cleanup) complete',
  );

  return {
    phase1Events,
    phase2Events,
    phase3Events,
    pruned,
    ingestionRunStart,
  };
}
