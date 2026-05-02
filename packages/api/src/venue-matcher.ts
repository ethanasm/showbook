import { db } from '@showbook/db';
import { venues } from '@showbook/db';
import { eq, and, sql } from 'drizzle-orm';
import { geocodeVenue } from './geocode';
import { searchVenues } from './ticketmaster';
import { child } from '@showbook/observability';

const log = child({ component: 'api.venue-matcher' });

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
  photoUrl?: string;
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
  // Validate at the boundary so empty/whitespace-only inputs from upstream
  // (e.g. TM events with a missing venue name like the Düsseldorf 2026-04-30
  // discover-ingest crash) fail with a clear typed error instead of being
  // interpolated into `lower(${input.name})` and producing the cryptic
  // Postgres `function lower() does not exist`. Callers that may produce
  // empty values (discover-ingest in particular) must skip + log first.
  if (!input.name || input.name.trim().length === 0) {
    throw new Error('matchOrCreateVenue: input.name is required (got empty/blank string)');
  }
  if (!input.city || input.city.trim().length === 0) {
    throw new Error('matchOrCreateVenue: input.city is required (got empty/blank string)');
  }

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

  // 4. Create new venue — resolve external metadata BEFORE the transaction
  // so we don't hold the advisory lock while waiting on Google/TM.
  let lat = input.lat ?? null;
  let lng = input.lng ?? null;
  let stateRegion = input.stateRegion ?? null;
  let country = input.country ?? 'US';
  let tmVenueId = input.tmVenueId ?? null;
  let googlePlaceId = input.googlePlaceId ?? null;
  let photoUrl = input.photoUrl ?? null;

  if (lat == null && input.name && input.city) {
    try {
      const geo = await geocodeVenue(input.name, input.city, stateRegion);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        if (!stateRegion && geo.stateRegion) stateRegion = geo.stateRegion;
        if (geo.country) country = geo.country;
        if (!googlePlaceId && geo.googlePlaceId) googlePlaceId = geo.googlePlaceId;
        if (!photoUrl && geo.photoUrl) photoUrl = geo.photoUrl;
      }
    } catch (err) {
      log.warn(
        {
          err,
          event: 'venue_matcher.geocode.failed',
          name: input.name,
          city: input.city,
          stateRegion: stateRegion ?? null,
        },
        'geocodeVenue threw; saving venue without coordinates/Place ID',
      );
    }
  }

  if (!tmVenueId && input.name && input.city) {
    const found = await findTmVenueId(input.name, input.city, stateRegion);
    if (found) tmVenueId = found;
  }

  // Re-check + insert under an advisory lock keyed on lower(name)+lower(city)
  // so two concurrent requests for the same venue serialize. Without the
  // lock both would miss the SELECT above and both would INSERT, creating a
  // duplicate global row.
  return await db.transaction(async (tx) => {
    const lockKey = `${input.name.trim().toLowerCase()}|${input.city.trim().toLowerCase()}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const [recheck] = await tx
      .select()
      .from(venues)
      .where(
        and(
          sql`lower(${venues.name}) = lower(${input.name})`,
          sql`lower(${venues.city}) = lower(${input.city})`,
        ),
      )
      .limit(1);
    if (recheck) {
      return { venue: recheck, created: false };
    }

    try {
      // Wrap the INSERT in a savepoint (nested tx) so a unique-violation
      // doesn't poison the outer transaction. Without this, the SELECT in
      // the catch block would fail with 25P02 ("current transaction is
      // aborted") and we couldn't recover.
      const [created] = await tx.transaction(async (sp) =>
        sp
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
            photoUrl,
          })
          .returning(),
      );
      return { venue: created, created: true };
    } catch (err) {
      // External-ID unique-violation. Fires when two concurrent calls have
      // different name+city (so they hold different advisory locks and
      // both pass the recheck) but resolve to the same TM/Google id —
      // the partial UNIQUE index on those columns rejects the second
      // INSERT with 23505. Fall back to the existing row.
      if (isUniqueViolation(err)) {
        if (tmVenueId) {
          const [existing] = await tx
            .select()
            .from(venues)
            .where(eq(venues.ticketmasterVenueId, tmVenueId))
            .limit(1);
          if (existing) return { venue: existing, created: false };
        }
        if (googlePlaceId) {
          const [existing] = await tx
            .select()
            .from(venues)
            .where(eq(venues.googlePlaceId, googlePlaceId))
            .limit(1);
          if (existing) return { venue: existing, created: false };
        }
      }
      throw err;
    }
  });
}

export function isUniqueViolation(err: unknown): boolean {
  // drizzle-orm wraps the underlying postgres error in DrizzleQueryError,
  // moving the SQLSTATE off `err.code` and onto `err.cause.code`. Walk the
  // cause chain so callers don't have to care which layer threw.
  let cur = err;
  while (cur != null && typeof cur === 'object') {
    if ((cur as { code?: string }).code === '23505') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const US_STATE_CODES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
  ontario: 'ON', quebec: 'QC', 'british columbia': 'BC', alberta: 'AB',
  manitoba: 'MB', saskatchewan: 'SK', 'nova scotia': 'NS', 'new brunswick': 'NB',
  'prince edward island': 'PE', 'newfoundland and labrador': 'NL',
};

export function toStateCode(stateRegion: string | undefined | null): string | undefined {
  if (!stateRegion) return undefined;
  if (stateRegion.length === 2) return stateRegion.toUpperCase();
  return US_STATE_CODES[stateRegion.toLowerCase()];
}

export function venueNameVariants(name: string): string[] {
  const variants: string[] = [name];
  // Google Places often appends " at <parent>" or " - <org>". Use single-
  // whitespace matchers (no `\s+` quantifier) to avoid polynomial backtracking
  // on adversarial inputs.
  const stripped = name
    .replace(/\sat\s.+$/i, '')
    .replace(/\s-\s.+$/, '');
  if (stripped !== name && stripped.length >= 3) variants.push(stripped);
  return variants;
}

export async function findTmVenueId(
  name: string,
  city: string,
  stateRegion?: string | null,
): Promise<string | null> {
  const cityLower = city.toLowerCase().split(',')[0].trim();
  const stateCode = toStateCode(stateRegion);

  for (const variant of venueNameVariants(name)) {
    try {
      const tmResults = await searchVenues({
        keyword: variant,
        stateCode,
        size: 10,
      });
      const match = tmResults.find((v) => {
        const tmCity = v.city?.name?.toLowerCase() ?? '';
        return tmCity.includes(cityLower) || cityLower.includes(tmCity);
      });
      if (match) return match.id;
    } catch (err) {
      log.warn({ err, event: 'venue_matcher.tm_lookup.failed' }, 'TM venue lookup failed');
      return null;
    }
  }
  return null;
}

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
      const geo = await geocodeVenue(
        existing.name,
        existing.city,
        existing.stateRegion ?? input.stateRegion ?? null,
      );
      if (geo) {
        updates.latitude = geo.lat;
        updates.longitude = geo.lng;
        if (!existing.stateRegion && geo.stateRegion) updates.stateRegion = geo.stateRegion;
        if (!existing.country && geo.country) updates.country = geo.country;
        if (!existing.googlePlaceId && geo.googlePlaceId) updates.googlePlaceId = geo.googlePlaceId;
        if (!existing.photoUrl && geo.photoUrl) updates.photoUrl = geo.photoUrl;
      }
    } catch (err) {
      log.warn(
        {
          err,
          event: 'venue_matcher.geocode_update.failed',
          name: existing.name,
          city: existing.city,
        },
        'geocodeVenue threw during maybeUpdate; leaving fields unchanged',
      );
    }
  }
  if (input.googlePlaceId && !existing.googlePlaceId) {
    updates.googlePlaceId = input.googlePlaceId;
  }
  if (input.photoUrl && !existing.photoUrl) {
    updates.photoUrl = input.photoUrl;
  }
  if (input.stateRegion && !existing.stateRegion) {
    updates.stateRegion = input.stateRegion;
  }

  if (!existing.ticketmasterVenueId && !input.tmVenueId) {
    const stateForTm = (updates.stateRegion as string | undefined) ?? input.stateRegion ?? existing.stateRegion;
    const tmId = await findTmVenueId(existing.name, existing.city, stateForTm);
    if (tmId) updates.ticketmasterVenueId = tmId;
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
