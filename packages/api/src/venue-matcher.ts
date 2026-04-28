import { db } from '@showbook/db';
import { venues } from '@showbook/db';
import { eq, and, sql } from 'drizzle-orm';
import { geocodeVenue } from './geocode';
import { searchVenues } from './ticketmaster';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VenueInput {
  name: string;
  city: string;
  stateRegion?: string;
  country?: string;
  tmVenueId?: string;
  lat?: number;
  lng?: number;
  googlePlaceId?: string;
}

export interface VenueMatchResult {
  venue: typeof venues.$inferSelect;
  candidates?: (typeof venues.$inferSelect)[];
  created: boolean;
}

// ---------------------------------------------------------------------------
// matchOrCreateVenue
// ---------------------------------------------------------------------------

export async function matchOrCreateVenue(
  input: VenueInput,
): Promise<VenueMatchResult> {
  // 1. TM venue ID match
  if (input.tmVenueId) {
    const [existing] = await db
      .select()
      .from(venues)
      .where(eq(venues.ticketmasterVenueId, input.tmVenueId))
      .limit(1);

    if (existing) {
      const updated = await maybeUpdate(existing, input);
      return { venue: updated, created: false };
    }
  }

  // 2. Google Place ID match
  if (input.googlePlaceId) {
    const [existing] = await db
      .select()
      .from(venues)
      .where(eq(venues.googlePlaceId, input.googlePlaceId))
      .limit(1);

    if (existing) {
      const updated = await maybeUpdate(existing, input);
      return { venue: updated, created: false };
    }
  }

  // 3. Exact name+city match (case-insensitive)
  const nameCityMatches = await db
    .select()
    .from(venues)
    .where(
      and(
        sql`lower(${venues.name}) = lower(${input.name})`,
        sql`lower(${venues.city}) = lower(${input.city})`,
      ),
    );

  if (nameCityMatches.length === 1) {
    const updated = await maybeUpdate(nameCityMatches[0], input);
    return { venue: updated, created: false };
  }

  if (nameCityMatches.length > 1) {
    return {
      venue: nameCityMatches[0],
      candidates: nameCityMatches,
      created: false,
    };
  }

  // 4. Create new venue — geocode if no coordinates provided
  let lat = input.lat ?? null;
  let lng = input.lng ?? null;
  let stateRegion = input.stateRegion ?? null;
  let country = input.country ?? 'US';
  let tmVenueId = input.tmVenueId ?? null;
  let googlePlaceId = input.googlePlaceId ?? null;

  if (lat == null && input.name && input.city) {
    try {
      const geo = await geocodeVenue(input.name, input.city);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        if (!stateRegion && geo.stateRegion) stateRegion = geo.stateRegion;
        if (geo.country) country = geo.country;
        if (!googlePlaceId && geo.googlePlaceId) googlePlaceId = geo.googlePlaceId;
      }
    } catch { /* geocoding failed; save without coordinates */ }
  }

  if (!tmVenueId && input.name && input.city) {
    try {
      const tmResults = await searchVenues({ keyword: `${input.name}`, size: 3 });
      const cityLower = input.city.toLowerCase().split(',')[0].trim();
      const match = tmResults.find(
        (v) => v.city?.name?.toLowerCase() === cityLower,
      );
      if (match) tmVenueId = match.id;
    } catch { /* TM lookup failed; continue without */ }
  }

  const [created] = await db
    .insert(venues)
    .values({
      name: input.name,
      city: input.city,
      stateRegion,
      country,
      ticketmasterVenueId: tmVenueId,
      latitude: lat,
      longitude: lng,
      googlePlaceId,
    })
    .returning();

  return { venue: created, created: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * If the incoming input has fields that the existing venue row is missing,
 * update the row and return the refreshed version. Otherwise return as-is.
 */
async function maybeUpdate(
  existing: typeof venues.$inferSelect,
  input: VenueInput,
): Promise<typeof venues.$inferSelect> {
  const updates: Partial<Record<string, unknown>> = {};

  if (input.tmVenueId && !existing.ticketmasterVenueId) {
    updates.ticketmasterVenueId = input.tmVenueId;
  }
  if (input.lat != null && existing.latitude == null) {
    updates.latitude = input.lat;
  }
  if (input.lng != null && existing.longitude == null) {
    updates.longitude = input.lng;
  }
  if (existing.latitude == null && input.lat == null) {
    try {
      const geo = await geocodeVenue(existing.name, existing.city);
      if (geo) {
        updates.latitude = geo.lat;
        updates.longitude = geo.lng;
        if (!existing.stateRegion && geo.stateRegion) updates.stateRegion = geo.stateRegion;
        if (!existing.country && geo.country) updates.country = geo.country;
        if (!existing.googlePlaceId && geo.googlePlaceId) updates.googlePlaceId = geo.googlePlaceId;
      }
    } catch { /* geocoding failed */ }
  }
  if (input.googlePlaceId && !existing.googlePlaceId) {
    updates.googlePlaceId = input.googlePlaceId;
  }
  if (input.stateRegion && !existing.stateRegion) {
    updates.stateRegion = input.stateRegion;
  }

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  const [updated] = await db
    .update(venues)
    .set(updates)
    .where(eq(venues.id, existing.id))
    .returning();

  return updated;
}
