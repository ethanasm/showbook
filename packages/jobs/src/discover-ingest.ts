import { db } from '@showbook/db';
import {
  announcements,
  userVenueFollows,
  userRegions,
  venues,
} from '@showbook/db';
import { eq, lt, isNotNull, and } from 'drizzle-orm';
import {
  searchEvents,
  inferKind,
  selectBestImage,
  matchOrCreateVenue,
  matchOrCreatePerformer,
  type TMEvent,
} from '@showbook/api';

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

  // Check dates.status.code first
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
 * Fetch all events for a TM query, paginating up to maxEvents.
 */
async function fetchAllEvents(
  params: Parameters<typeof searchEvents>[0],
  maxEvents = 200,
): Promise<TMEvent[]> {
  const first = await searchEvents({ ...params, size: 100, page: 0 });
  const all = [...first.events];

  if (first.totalElements > 100 && all.length < maxEvents) {
    const page2 = await searchEvents({ ...params, size: 100, page: 1 });
    all.push(...page2.events);
  }

  return all.slice(0, maxEvents);
}

/**
 * Process a single TM event: dedup, match venue & performer, insert announcement.
 * Returns true if a new announcement was created.
 */
async function processEvent(
  event: TMEvent,
  existingSourceIds: Set<string>,
): Promise<boolean> {
  // Skip if already ingested
  if (existingSourceIds.has(event.id)) return false;

  const tmVenue = event._embedded?.venues?.[0];
  if (!tmVenue) return false; // Can't create announcement without a venue

  try {
    // Match or create venue
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

    // Match or create headliner performer
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

    // Extract support acts from remaining attractions
    const support =
      attractions.length > 1
        ? attractions.slice(1).map((a) => a.name)
        : null;

    // Determine kind from classifications
    const kind = inferKind(event.classifications);

    // Determine on-sale status
    const onSaleStatus = determineOnSaleStatus(event);

    // Parse on-sale date
    const onSaleDate = event.sales?.public?.startDateTime
      ? new Date(event.sales.public.startDateTime)
      : null;

    // Insert announcement
    await db.insert(announcements).values({
      venueId: venue.id,
      kind,
      headliner: headlinerName,
      headlinerPerformerId,
      support,
      showDate: event.dates.start.localDate,
      onSaleDate,
      onSaleStatus,
      source: 'ticketmaster',
      sourceEventId: event.id,
    });

    // Track so we don't process again in phase 2
    existingSourceIds.add(event.id);
    return true;
  } catch (err) {
    console.error(
      `[discover/ingest] Error processing event ${event.id} (${event.name}):`,
      err,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main ingestion pipeline
// ---------------------------------------------------------------------------

export async function runDiscoverIngest(): Promise<{
  phase1Events: number;
  phase2Events: number;
  pruned: number;
}> {
  const start = nowISO();
  const end = futureISO(12);

  // Build set of existing source event IDs for dedup
  const existingAnnouncements = await db
    .select({ sourceEventId: announcements.sourceEventId })
    .from(announcements)
    .where(
      and(
        eq(announcements.source, 'ticketmaster'),
        isNotNull(announcements.sourceEventId),
      ),
    );

  const existingSourceIds = new Set(
    existingAnnouncements
      .map((a) => a.sourceEventId)
      .filter((id): id is string => id !== null),
  );

  // ==========================================================================
  // Phase 0: Collect unique targets
  // ==========================================================================

  // Distinct followed venue IDs with TM venue IDs
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

  // Distinct active regions
  const regionRows = await db
    .selectDistinct({
      latitude: userRegions.latitude,
      longitude: userRegions.longitude,
      radiusMiles: userRegions.radiusMiles,
    })
    .from(userRegions)
    .where(eq(userRegions.active, true));

  console.log(
    `[discover/ingest] Phase 0: ${followedVenues.length} venues, ${regionRows.length} regions`,
  );

  // ==========================================================================
  // Phase 1: Followed venue events
  // ==========================================================================

  let phase1Events = 0;

  for (const { tmVenueId } of followedVenues) {
    try {
      const events = await fetchAllEvents({
        venueId: tmVenueId,
        startDateTime: start,
        endDateTime: end,
      });

      for (const event of events) {
        const created = await processEvent(event, existingSourceIds);
        if (created) phase1Events++;
      }
    } catch (err) {
      console.error(
        `[discover/ingest] Phase 1 error for venue ${tmVenueId}:`,
        err,
      );
    }
  }

  console.log(`[discover/ingest] Phase 1 done: ${phase1Events} new events`);

  // ==========================================================================
  // Phase 2: Near-you events
  // ==========================================================================

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

      for (const event of events) {
        // Filter out events at already-followed venues (covered in Phase 1)
        const tmVenue = event._embedded?.venues?.[0];
        if (tmVenue?.id) {
          const isFollowedTmVenue = followedVenues.some(
            (fv) => fv.tmVenueId === tmVenue.id,
          );
          if (isFollowedTmVenue) continue;
        }

        const created = await processEvent(event, existingSourceIds);
        if (created) phase2Events++;
      }
    } catch (err) {
      console.error(
        `[discover/ingest] Phase 2 error for region (${region.latitude},${region.longitude}):`,
        err,
      );
    }
  }

  console.log(`[discover/ingest] Phase 2 done: ${phase2Events} new events`);

  // ==========================================================================
  // Phase 3: Cleanup — delete old announcements
  // ==========================================================================

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoffDate = sevenDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD

  const deleted = await db
    .delete(announcements)
    .where(lt(announcements.showDate, cutoffDate))
    .returning({ id: announcements.id });

  const pruned = deleted.length;
  console.log(`[discover/ingest] Phase 3 done: ${pruned} old announcements pruned`);

  return { phase1Events, phase2Events, pruned };
}
