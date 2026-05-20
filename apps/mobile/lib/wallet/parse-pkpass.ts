/**
 * pkpass parser — extracts the four user-facing fields plus a dedup
 * key from an Apple Wallet pass.
 *
 * A `.pkpass` is a zip whose `pass.json` carries strongly-typed
 * fields. The parser accepts the raw bytes (Uint8Array) so it can be
 * unit-tested without mocking iOS file APIs — callers are responsible
 * for reading the file URI handed over by the share-sheet intent.
 *
 * Returns `null` on any failure (bad zip, missing pass.json, malformed
 * JSON). The caller shows a toast.
 */

import { unzipSync, strFromU8 } from 'fflate';

export type PassKind = 'concert' | 'theatre' | 'comedy' | 'festival';

export interface ParsedPass {
  /** Headliner / event name. Maps to ShowFormValues.title. */
  headliner: string | null;
  /** Venue name (free text — server-side matchOrCreateVenue resolves it). */
  venueName: string | null;
  /** ISO `YYYY-MM-DD` date in the venue's local TZ when available. */
  showDate: string | null;
  /** Composed seat string ("SEC X · ROW Y · SEAT Z") or whatever the issuer provided. */
  seat: string | null;
  /** Kind hint from the pass's bundle identifier; `null` if unrecognised. */
  kindHint: PassKind | null;
  /** Dedup key — opaque per-issuer serial number. */
  serialNumber: string;
  /** e.g. `pass.com.ticketmaster.tickets`. Stored on shows.source_refs. */
  passTypeIdentifier: string;
}

interface PassField {
  key?: string;
  label?: string;
  value?: unknown;
}

interface PassJsonShape {
  serialNumber?: unknown;
  passTypeIdentifier?: unknown;
  relevantDate?: unknown;
  eventTicket?: {
    primaryFields?: PassField[];
    secondaryFields?: PassField[];
    auxiliaryFields?: PassField[];
    backFields?: PassField[];
  };
}

// Lookup of well-known Wallet issuers → Showbook kind. Conservative — we
// only map identifiers we've actually seen ship pkpass files. Anything
// else falls through to `null` and the form defaults to 'concert' (the
// most common case), letting the user re-pick via the kind segmented
// control if needed.
const KIND_BY_PASS_TYPE: ReadonlyMap<string, PassKind> = new Map([
  ['pass.com.ticketmaster.tickets', 'concert'],
  ['pass.com.ticketmaster.universe', 'concert'],
  ['pass.com.axs.events', 'concert'],
  ['pass.com.dice.dice', 'concert'],
  ['pass.com.eventbrite.eventbrite', 'concert'],
  ['pass.com.seatgeek.seatgeek', 'concert'],
  ['pass.com.todaytix.todaytix', 'theatre'],
  ['pass.com.telecharge.telecharge', 'theatre'],
  ['pass.com.shubert.telecharge', 'theatre'],
]);

const VENUE_KEYS = new Set(['venue', 'venueName', 'location', 'where']);
const EVENT_KEYS = new Set(['event', 'eventName', 'headliner', 'show', 'name']);
const SEAT_KEYS = new Set(['seat', 'seats', 'seatNumber']);
const ROW_KEYS = new Set(['row', 'rowNumber']);
const SECTION_KEYS = new Set(['section', 'sectionNumber', 'sect']);
const GA_KEYS = new Set(['admission', 'admissionType', 'ga']);

function findField(fields: PassField[] | undefined, keys: Set<string>): string | null {
  if (!fields) return null;
  for (const f of fields) {
    if (!f || typeof f.key !== 'string') continue;
    if (keys.has(f.key)) {
      const value = typeof f.value === 'string' ? f.value : f.value == null ? '' : String(f.value);
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

function findFirstNonEmpty(
  fields: PassField[] | undefined,
  keys: Set<string>,
): string | null {
  return findField(fields, keys);
}

function readPassJson(zipBytes: Uint8Array): PassJsonShape | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes, {
      filter: (file) => file.name === 'pass.json',
    });
  } catch {
    return null;
  }
  const raw = entries['pass.json'];
  if (!raw) return null;
  try {
    return JSON.parse(strFromU8(raw)) as PassJsonShape;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isoDateInTimeZone(iso: string): string | null {
  // `relevantDate` is ISO 8601 with a timezone offset, e.g.
  // `2026-10-28T20:00:00-07:00`. We want the calendar date in the
  // venue's local TZ — which is the offset embedded in the string
  // itself, not the device's TZ. The fastest way to read the
  // calendar date in the original TZ is to compute the local-clock
  // time before normalising to UTC, which is just the leading
  // `YYYY-MM-DD` of the string.
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function composeSeat(ticket: NonNullable<PassJsonShape['eventTicket']>): string | null {
  const fields = [
    ...(ticket.primaryFields ?? []),
    ...(ticket.secondaryFields ?? []),
    ...(ticket.auxiliaryFields ?? []),
  ];
  // GA passes don't have row/seat — surface the admission type instead.
  for (const f of fields) {
    if (!f || typeof f.key !== 'string') continue;
    if (GA_KEYS.has(f.key)) {
      const value = asString(f.value);
      if (value && /general/i.test(value)) return 'GA';
    }
  }
  const section = findFirstNonEmpty(fields, SECTION_KEYS);
  const row = findFirstNonEmpty(fields, ROW_KEYS);
  const seat = findFirstNonEmpty(fields, SEAT_KEYS);
  const parts: string[] = [];
  if (section) parts.push(`SEC ${section}`);
  if (row) parts.push(`ROW ${row}`);
  if (seat) parts.push(`SEAT ${seat}`);
  if (parts.length > 0) return parts.join(' · ');
  return null;
}

function findVenue(ticket: NonNullable<PassJsonShape['eventTicket']>): string | null {
  return (
    findFirstNonEmpty(ticket.primaryFields, VENUE_KEYS) ||
    findFirstNonEmpty(ticket.secondaryFields, VENUE_KEYS) ||
    findFirstNonEmpty(ticket.auxiliaryFields, VENUE_KEYS) ||
    findFirstNonEmpty(ticket.backFields, VENUE_KEYS)
  );
}

function findEvent(ticket: NonNullable<PassJsonShape['eventTicket']>): string | null {
  return (
    findFirstNonEmpty(ticket.primaryFields, EVENT_KEYS) ||
    findFirstNonEmpty(ticket.secondaryFields, EVENT_KEYS) ||
    findFirstNonEmpty(ticket.auxiliaryFields, EVENT_KEYS)
  );
}

export function parsePkpassBytes(zipBytes: Uint8Array): ParsedPass | null {
  const pass = readPassJson(zipBytes);
  if (!pass) return null;

  const serialNumber = asString(pass.serialNumber);
  const passTypeIdentifier = asString(pass.passTypeIdentifier);
  if (!serialNumber || !passTypeIdentifier) {
    // A pkpass without these isn't a real pass (Apple requires both at
    // the format level) and we can't dedup without serial.
    return null;
  }

  const ticket = pass.eventTicket ?? {};
  const relevantDate = asString(pass.relevantDate);

  return {
    headliner: findEvent(ticket),
    venueName: findVenue(ticket),
    showDate: relevantDate ? isoDateInTimeZone(relevantDate) : null,
    seat: composeSeat(ticket),
    kindHint: KIND_BY_PASS_TYPE.get(passTypeIdentifier) ?? null,
    serialNumber,
    passTypeIdentifier,
  };
}
