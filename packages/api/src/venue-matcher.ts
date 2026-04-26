import { db } from '@showbook/db';
import { venues } from '@showbook/db';
import { eq, and, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VenueInput {
  name: string;
  city: string;
  stateRegion?: string;
  country?: string;
  neighborhood?: string;
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

  // 3. Create new venue
  const [created] = await db
    .insert(venues)
    .values({
      name: input.name,
      city: input.city,
      stateRegion: input.stateRegion ?? null,
      country: input.country ?? 'US',
      neighborhood: input.neighborhood ?? null,
      ticketmasterVenueId: input.tmVenueId ?? null,
      latitude: input.lat ?? null,
      longitude: input.lng ?? null,
      googlePlaceId: input.googlePlaceId ?? null,
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
  if (input.googlePlaceId && !existing.googlePlaceId) {
    updates.googlePlaceId = input.googlePlaceId;
  }
  if (input.stateRegion && !existing.stateRegion) {
    updates.stateRegion = input.stateRegion;
  }
  if (input.neighborhood && !existing.neighborhood) {
    updates.neighborhood = input.neighborhood;
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
