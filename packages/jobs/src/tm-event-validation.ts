import type { TMAttraction, TMEvent } from '@showbook/api';

/**
 * Discriminated result returned by every skip predicate. When `skip` is
 * true the caller emits `tm.normalize.skipped` with the carried
 * `reason` field — the reason strings here MUST stay 1:1 with the
 * production Axiom dashboards that filter on them. `msg` keeps the
 * original "Skipping TM event with no venue name" style log message so
 * the pino message-string column doesn't change either.
 */
export type SkipResult =
  | {
      skip: true;
      reason: 'missing_venue_name' | 'missing_venue_city' | 'unknown_kind';
      msg: string;
      fields: Record<string, unknown>;
    }
  | { skip: false };

/**
 * TM occasionally returns events with a venue object that has no `name`
 * (observed for European venues where the city is the only text field —
 * Düsseldorf, 2026-04-30). matchOrCreateVenue rejects empty names, so
 * skip+log here rather than emitting a `tm.normalize.failed` error per
 * event. Without a venue name there's no usable show row to create.
 */
export function hasValidVenueName(event: TMEvent): SkipResult {
  const tmVenue = event._embedded?.venues?.[0];
  if (!tmVenue) {
    return {
      skip: true,
      reason: 'missing_venue_name',
      msg: 'Skipping TM event with no venue name',
      fields: { tmEventId: event.id, name: event.name, city: undefined },
    };
  }
  if (!tmVenue.name || tmVenue.name.trim().length === 0) {
    return {
      skip: true,
      reason: 'missing_venue_name',
      msg: 'Skipping TM event with no venue name',
      fields: {
        tmEventId: event.id,
        name: event.name,
        city: tmVenue.city?.name,
      },
    };
  }
  return { skip: false };
}

/**
 * TM also returns events with a venue name but no city — these are
 * overwhelmingly Ticketmaster Resale Marketplace listings (event ids like
 * `ZkDnngzZDdAjbJpUFAGnI9l-Lv9oEss`, 2026-05-17) where the "venue" is the
 * reseller's business address (a notary, a UPS Store, …) rather than the
 * actual concert venue. They also tend to ship malformed `_embedded.attractions`
 * (missing `name` on the support attraction), which then leaks through to
 * Discover as "+ undefined". Skip rather than create a venue with city
 * "Unknown" that the UI surfaces verbatim.
 */
export function hasValidVenueCity(event: TMEvent): SkipResult {
  const tmVenue = event._embedded?.venues?.[0];
  if (!tmVenue?.city?.name || tmVenue.city.name.trim().length === 0) {
    return {
      skip: true,
      reason: 'missing_venue_city',
      msg: 'Skipping TM event with no venue city',
      fields: {
        tmEventId: event.id,
        name: event.name,
        venueName: tmVenue?.name,
      },
    };
  }
  return { skip: false };
}

/**
 * Drop events that classify as "unknown" — TM didn't tell us what they are,
 * and they pile up on Discover as noise (the High Roller Wheel at the LINQ
 * and similar attractions that ship without a usable segment id). The
 * refresh path in discover-ingest mirrors this by deleting any existing row
 * that would re-classify back into 'unknown'.
 */
export function hasValidKind(kind: string, event: TMEvent): SkipResult {
  if (kind === 'unknown') {
    return {
      skip: true,
      reason: 'unknown_kind',
      msg: 'Skipping TM event with unknown kind',
      fields: { tmEventId: event.id, name: event.name },
    };
  }
  return { skip: false };
}

/**
 * Defensively drop attractions with a missing/blank `name`. TM occasionally
 * returns attraction objects with only an `id`, which used to leak through
 * as the literal string "undefined" in `announcement.support` (postgres-js
 * stringifies JS undefined when serializing a text[]) and crash
 * matchOrCreatePerformer in `name.trim().toLowerCase()`. See the Lizzo
 * resale-marketplace event ZkDnngzZDdAjbJpUFAGnI9l-Lv9oEss, 2026-05-17.
 *
 * `dropped` is the number of attractions that were filtered out — the
 * caller emits `tm.normalize.attraction_dropped` (reason `missing_name`)
 * when it is non-zero.
 */
export function filterValidAttractions(event: TMEvent): {
  attractions: TMAttraction[];
  dropped: number;
} {
  const raw = event._embedded?.attractions ?? [];
  const attractions = raw.filter(
    (a) => typeof a.name === 'string' && a.name.trim().length > 0,
  );
  return { attractions, dropped: raw.length - attractions.length };
}
