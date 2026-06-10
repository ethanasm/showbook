/**
 * Performer "upcoming shows" data shaping.
 *
 * The artist detail page mirrors the venue page's "Upcoming" rail. There are
 * two sources for the rows, unified into a single {@link PerformerUpcomingRow}
 * shape so the web + mobile clients render them identically:
 *
 *   1. **Stored discover data** — `announcements` rows we already ingested
 *      because the artist is followed (Phase 3), plays a followed venue
 *      (Phase 1), or falls inside an active region (Phase 2). These carry a
 *      real announcement id, so they can be watched / linked to a show.
 *
 *   2. **Live Ticketmaster lookup** — when there's no stored data for the
 *      performer, the router fetches their upcoming events from TM at page
 *      load and shapes them here *without persisting*. These are flagged
 *      `ephemeral: true` and use a synthetic `tm-<eventId>` id, so the UI can
 *      tell them apart (e.g. the watch action — which needs a persisted
 *      announcement — is gated on `ephemeral === false`).
 *
 * Everything in this module is pure (no DB, no network) so it can be unit
 * tested directly; the router owns the queries + the live TM fetch.
 */

import {
  inferKind,
  extractFestivalName,
  isPrimaryEventUrl,
  determineOnSaleStatus,
  parseOnSaleDate,
  type OnSaleStatus,
  type TMEvent,
} from './ticketmaster';
import {
  showMatchesAnnouncement,
  type ShowForDedup,
  type Kind,
} from '@showbook/shared';

export interface PerformerUpcomingRow {
  /** Announcement id for stored rows, or `tm-<eventId>` for live rows. */
  id: string;
  /** True when the row came from a live TM fetch and isn't persisted. */
  ephemeral: boolean;
  kind: Kind;
  headliner: string;
  /** Linked performer id when resolvable; null for ephemeral support slots. */
  headlinerPerformerId: string | null;
  support: string[] | null;
  productionName: string | null;
  showDate: string;
  onSaleStatus: OnSaleStatus;
  onSaleDate: Date | null;
  ticketUrl: string | null;
  venue: {
    id: string | null;
    name: string;
    city: string | null;
    stateRegion: string | null;
  };
}

export interface StoredAnnouncementForShaping {
  id: string;
  kind: Kind;
  headliner: string;
  headlinerPerformerId: string | null;
  support: string[] | null;
  productionName: string | null;
  showDate: string;
  onSaleStatus: OnSaleStatus;
  onSaleDate: Date | null;
  ticketUrl: string | null;
}

export interface VenueForShaping {
  id: string;
  name: string;
  city: string | null;
  stateRegion: string | null;
}

/**
 * Shape a stored (announcement ⨝ venue) row into the unified row type.
 */
export function shapeStoredUpcoming(
  announcement: StoredAnnouncementForShaping,
  venue: VenueForShaping,
): PerformerUpcomingRow {
  return {
    id: announcement.id,
    ephemeral: false,
    kind: announcement.kind,
    headliner: announcement.headliner,
    headlinerPerformerId: announcement.headlinerPerformerId,
    support: announcement.support,
    productionName: announcement.productionName,
    showDate: announcement.showDate,
    onSaleStatus: announcement.onSaleStatus,
    onSaleDate: announcement.onSaleDate,
    ticketUrl: announcement.ticketUrl,
    venue: {
      id: venue.id,
      name: venue.name,
      city: venue.city,
      stateRegion: venue.stateRegion,
    },
  };
}

/**
 * Convert a flat list of TM events (from a `searchEvents({ attractionId })`
 * call) into ephemeral upcoming rows. Mirrors the discover-ingest normalizer
 * but does no DB work: no venue/performer match-or-create, no writes.
 *
 *   - Events without a usable venue name, or dated before `today`, are
 *     dropped (we can't render a venue-less row and past events aren't
 *     "upcoming").
 *   - `kind === 'unknown'` is dropped, matching the ingest-side refusal to
 *     persist unclassifiable rows (parking passes, suite deposits, …).
 *   - Festivals use the stable festival name as the headliner/production and
 *     list every attraction as support (mirrors `normalizeTmEvent`).
 *   - The headliner is linked to `performerId` only when this performer is
 *     the top-billed attraction; otherwise the link is left null (we can't
 *     resolve other acts' performer ids without a DB hit).
 *   - De-duped by TM event id and sorted soonest-first.
 */
export function normalizeLiveAttractionEvents(
  events: readonly TMEvent[],
  opts: { performerId: string; tmAttractionId: string; today: string },
): PerformerUpcomingRow[] {
  const seen = new Set<string>();
  const rows: PerformerUpcomingRow[] = [];

  for (const event of events) {
    const tmVenue = event._embedded?.venues?.[0];
    if (!tmVenue?.name) continue;

    const date = event.dates?.start?.localDate;
    if (!date || date < opts.today) continue;

    const kind = inferKind(event.classifications, { eventName: event.name });
    if (kind === 'unknown') continue;

    if (seen.has(event.id)) continue;
    seen.add(event.id);

    const isFestival = kind === 'festival';
    const attractions = (event._embedded?.attractions ?? []).filter(
      (a): a is typeof a & { name: string } => Boolean(a?.name),
    );
    const headlinerAttraction = isFestival ? undefined : attractions[0];
    const headliner = isFestival
      ? extractFestivalName(event.name)
      : (headlinerAttraction?.name ?? event.name);

    const headlinerPerformerId =
      !isFestival && headlinerAttraction?.id === opts.tmAttractionId
        ? opts.performerId
        : null;

    const supportNames = (
      isFestival ? attractions : attractions.slice(1)
    ).map((a) => a.name);

    rows.push({
      id: `tm-${event.id}`,
      ephemeral: true,
      kind,
      headliner,
      headlinerPerformerId,
      support: supportNames.length > 0 ? supportNames : null,
      productionName: isFestival ? headliner : null,
      showDate: date,
      onSaleStatus: determineOnSaleStatus(event),
      onSaleDate: parseOnSaleDate(event),
      // Drop the resale-marketplace bare /event/<id> URL — it 404s in the
      // browser (same filter as the ingest path).
      ticketUrl: isPrimaryEventUrl(event.url) ? event.url : null,
      venue: {
        id: null,
        name: tmVenue.name,
        city: tmVenue.city?.name ?? null,
        stateRegion: tmVenue.state?.name ?? null,
      },
    });
  }

  rows.sort(
    (a, b) => a.showDate.localeCompare(b.showDate) || a.id.localeCompare(b.id),
  );
  return rows;
}

/**
 * Drop rows that map to a show the user already owns, so the same event
 * doesn't appear under both "Upcoming" and "Your shows". Two signals:
 *
 *   - `linkedAnnouncementIds` — announcements explicitly linked to one of the
 *     user's shows (watch / ticketed actions). Only applies to stored rows.
 *   - a fuzzy date+name match against the user's shows featuring this
 *     performer (covers manually-logged shows + poster-uploaded festivals).
 */
export function dedupeUpcomingAgainstUserShows(
  rows: readonly PerformerUpcomingRow[],
  userShows: readonly ShowForDedup[],
  linkedAnnouncementIds: ReadonlySet<string>,
): PerformerUpcomingRow[] {
  return rows.filter((row) => {
    if (!row.ephemeral && linkedAnnouncementIds.has(row.id)) return false;
    return !userShows.some((show) =>
      showMatchesAnnouncement(show, {
        showDate: row.showDate,
        productionName: row.productionName,
        headliner: row.headliner,
      }),
    );
  });
}
