import { db } from '@showbook/db';
import {
  announcements,
  userVenueFollows,
  userPerformerFollows,
  userRegions,
  venues,
  performers,
} from '@showbook/db';
import { eq, lt, isNotNull, and, inArray } from 'drizzle-orm';
import {
  searchEvents,
  inferKind,
  selectBestImage,
  matchOrCreateVenue,
  matchOrCreatePerformer,
  type TMEvent,
} from '@showbook/api';
import {
  groupEventsIntoRuns,
  type EventRun,
  type NormalizedEvent,
} from './run-grouping';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function futureISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function determineOnSaleStatus(
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
    });
    headlinerPerformerId = performer.id;
  }

  const support =
    attractions.length > 1 ? attractions.slice(1).map((a) => a.name) : null;

  return {
    sourceEventId: event.id,
    date: event.dates.start.localDate,
    kind: inferKind(event.classifications),
    headliner: headlinerName,
    headlinerPerformerId,
    venueId: venue.id,
    support,
    onSaleDate: event.sales?.public?.startDateTime
      ? new Date(event.sales.public.startDateTime)
      : null,
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
 * (productionName, venueId, kind) already exists. Extending merges the new
 * dates into the existing performanceDates and updates run start/end.
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
        eq(announcements.kind, run.kind),
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
    if (!extended) {
      // Track all source IDs so subsequent calls dedup correctly.
      for (const id of newSourceIds) existingSourceIds.add(id);
      return 0;
    }
    const merged = Array.from(existingDates).sort();
    await db
      .update(announcements)
      .set({
        runStartDate: merged[0]!,
        runEndDate: merged[merged.length - 1]!,
        performanceDates: merged,
        showDate: merged[0]!,
      })
      .where(eq(announcements.id, existing.id));
    for (const id of newSourceIds) existingSourceIds.add(id);
    return 1;
  }

  // Fresh run row.
  await db.insert(announcements).values({
    venueId: run.venueId,
    kind: run.kind,
    headliner: run.headliner,
    headlinerPerformerId: run.headlinerPerformerId,
    support: run.support,
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
      console.error(
        `[discover/ingest] Failed to normalize TM event ${event.id} (${event.name}):`,
        err,
      );
    }
  }

  const { runs, singles } = groupEventsIntoRuns(normalized);

  let count = 0;
  for (const run of runs) {
    try {
      count += await upsertRun(run, existingSourceIds);
    } catch (err) {
      console.error(
        `[discover/ingest] Failed to upsert run "${run.productionName}" at venue ${run.venueId}:`,
        err,
      );
    }
  }
  for (const event of singles) {
    try {
      const created = await insertSingleEvent(event, existingSourceIds);
      if (created) count++;
    } catch (err) {
      console.error(
        `[discover/ingest] Failed to insert event ${event.sourceEventId}:`,
        err,
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
  console.log(JSON.stringify({
    msg: '[discover/ingest-targeted]',
    target: 'venue',
    venueId,
    fetched: events.length,
    inserted: created,
    skipped: events.length - created,
  }));
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
  console.log(JSON.stringify({
    msg: '[discover/ingest-targeted]',
    target: 'region',
    regionId,
    fetched: events.length,
    filtered: filtered.length,
    inserted: created,
    skipped: filtered.length - created,
  }));
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
  console.log(JSON.stringify({
    msg: '[discover/ingest-targeted]',
    target: 'performer',
    performerId,
    fetched: events.length,
    inserted: created,
    skipped: events.length - created,
  }));
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

  console.log(JSON.stringify({
    msg: '[discover/ingest]',
    phase: 0,
    venues: followedVenues.length,
    regions: regionRows.length,
    performers: followedPerformers.length,
  }));

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
      console.error(
        `[discover/ingest] Phase 1 error for venue ${tmVenueId}:`,
        err,
      );
    }
  }
  console.log(JSON.stringify({ msg: '[discover/ingest]', phase: 1, inserted: phase1Events }));

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
      console.error(
        `[discover/ingest] Phase 2 error for region (${region.latitude},${region.longitude}):`,
        err,
      );
    }
  }
  console.log(JSON.stringify({ msg: '[discover/ingest]', phase: 2, inserted: phase2Events }));

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
      console.error(
        `[discover/ingest] Phase 3 error for attraction ${tmAttractionId}:`,
        err,
      );
    }
  }
  console.log(JSON.stringify({ msg: '[discover/ingest]', phase: 3, inserted: phase3Events }));

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
  console.log(JSON.stringify({ msg: '[discover/ingest]', phase: 4, pruned }));

  return {
    phase1Events,
    phase2Events,
    phase3Events,
    pruned,
    ingestionRunStart,
  };
}
