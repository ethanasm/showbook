/**
 * Unit tests for the pkpass parser.
 *
 * The parser accepts raw zip bytes, so fixtures are built in-memory
 * by zipping a synthesized `pass.json` per issuer. Anonymized,
 * version-controlled as data — no binary blobs in the repo.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';

import { parsePkpassBytes } from '../wallet/parse-pkpass';

function buildPkpass(passJson: object, extra: Record<string, string> = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    'pass.json': strToU8(JSON.stringify(passJson)),
    // Apple-required noise files don't need to exist for our parser
    // (we filter on `pass.json`), but we add a couple of stubs to
    // confirm the filter actually narrows the unzip work and the
    // parser doesn't trip on irrelevant entries.
    'icon.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    'manifest.json': strToU8('{}'),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
  };
  return zipSync(entries);
}

describe('parsePkpassBytes', () => {
  test('Ticketmaster concert — happy path', () => {
    const bytes = buildPkpass({
      serialNumber: 'tm-1234-5678',
      passTypeIdentifier: 'pass.com.ticketmaster.tickets',
      relevantDate: '2026-10-28T20:00:00-07:00',
      eventTicket: {
        primaryFields: [{ key: 'event', value: 'Fred Armisen' }],
        secondaryFields: [{ key: 'venue', value: 'The Castro Theatre' }],
        auxiliaryFields: [
          { key: 'section', value: '108' },
          { key: 'row', value: 'R' },
          { key: 'seat', value: '5' },
        ],
      },
    });
    const parsed = parsePkpassBytes(bytes);
    assert.ok(parsed, 'expected parsed pass');
    assert.equal(parsed.headliner, 'Fred Armisen');
    assert.equal(parsed.venueName, 'The Castro Theatre');
    assert.equal(parsed.showDate, '2026-10-28');
    assert.equal(parsed.seat, 'SEC 108 · ROW R · SEAT 5');
    assert.equal(parsed.kindHint, 'concert');
    assert.equal(parsed.serialNumber, 'tm-1234-5678');
    assert.equal(parsed.passTypeIdentifier, 'pass.com.ticketmaster.tickets');
  });

  test('AXS concert — venue in primary not secondary', () => {
    const bytes = buildPkpass({
      serialNumber: 'axs-9999',
      passTypeIdentifier: 'pass.com.axs.events',
      relevantDate: '2026-09-12T19:30:00-04:00',
      eventTicket: {
        primaryFields: [
          { key: 'event', value: 'Massive Attack' },
          { key: 'venue', value: 'Brooklyn Steel' },
        ],
        secondaryFields: [{ key: 'admission', value: 'General Admission' }],
      },
    });
    const parsed = parsePkpassBytes(bytes);
    assert.ok(parsed);
    assert.equal(parsed.headliner, 'Massive Attack');
    assert.equal(parsed.venueName, 'Brooklyn Steel');
    assert.equal(parsed.showDate, '2026-09-12');
    assert.equal(parsed.seat, 'GA');
    assert.equal(parsed.kindHint, 'concert');
  });

  test('Dice — venue missing from primary, falls back to secondary', () => {
    const bytes = buildPkpass({
      serialNumber: 'dice-abcdef',
      passTypeIdentifier: 'pass.com.dice.dice',
      relevantDate: '2026-11-03T20:00:00-05:00',
      eventTicket: {
        primaryFields: [{ key: 'event', value: 'Japanese Breakfast' }],
        secondaryFields: [{ key: 'venue', value: 'Irving Plaza' }],
        auxiliaryFields: [],
      },
    });
    const parsed = parsePkpassBytes(bytes);
    assert.ok(parsed);
    assert.equal(parsed.venueName, 'Irving Plaza');
    assert.equal(parsed.seat, null);
    assert.equal(parsed.kindHint, 'concert');
  });

  test('Theatre issuer — kind hint maps to theatre', () => {
    const bytes = buildPkpass({
      serialNumber: 'tt-555',
      passTypeIdentifier: 'pass.com.telecharge.telecharge',
      relevantDate: '2026-05-10T19:00:00-04:00',
      eventTicket: {
        primaryFields: [{ key: 'event', value: 'Wicked' }],
        secondaryFields: [{ key: 'venue', value: 'Gershwin Theatre' }],
        auxiliaryFields: [
          { key: 'section', value: 'FRONT MEZZ' },
          { key: 'row', value: 'B' },
          { key: 'seat', value: '12' },
        ],
      },
    });
    const parsed = parsePkpassBytes(bytes);
    assert.ok(parsed);
    assert.equal(parsed.kindHint, 'theatre');
    assert.equal(parsed.seat, 'SEC FRONT MEZZ · ROW B · SEAT 12');
  });

  test('Unknown issuer — kind hint is null but other fields parse', () => {
    const bytes = buildPkpass({
      serialNumber: 'mlb-0001',
      passTypeIdentifier: 'pass.com.mlb.mlb',
      relevantDate: '2026-07-04T13:05:00-04:00',
      eventTicket: {
        primaryFields: [{ key: 'event', value: 'Yankees vs Red Sox' }],
        secondaryFields: [{ key: 'venue', value: 'Yankee Stadium' }],
      },
    });
    const parsed = parsePkpassBytes(bytes);
    assert.ok(parsed);
    assert.equal(parsed.kindHint, null);
    assert.equal(parsed.headliner, 'Yankees vs Red Sox');
    assert.equal(parsed.venueName, 'Yankee Stadium');
  });

  test('returns null when serialNumber is missing', () => {
    const bytes = buildPkpass({
      passTypeIdentifier: 'pass.com.ticketmaster.tickets',
      eventTicket: { primaryFields: [{ key: 'event', value: 'X' }] },
    });
    assert.equal(parsePkpassBytes(bytes), null);
  });

  test('returns null when passTypeIdentifier is missing', () => {
    const bytes = buildPkpass({
      serialNumber: 'no-type',
      eventTicket: { primaryFields: [{ key: 'event', value: 'X' }] },
    });
    assert.equal(parsePkpassBytes(bytes), null);
  });

  test('returns null when pass.json is missing from the zip', () => {
    const bytes = zipSync({ 'icon.png': new Uint8Array([1, 2, 3]) });
    assert.equal(parsePkpassBytes(bytes), null);
  });

  test('returns null when pass.json is malformed', () => {
    const bytes = zipSync({ 'pass.json': strToU8('{not json') });
    assert.equal(parsePkpassBytes(bytes), null);
  });

  test('returns null when input is not a zip', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4]);
    assert.equal(parsePkpassBytes(bytes), null);
  });

  test('handles missing eventTicket entirely (defensive)', () => {
    const bytes = buildPkpass({
      serialNumber: 'minimal',
      passTypeIdentifier: 'pass.com.unknown',
      relevantDate: '2026-12-25T20:00:00Z',
    });
    const parsed = parsePkpassBytes(bytes);
    assert.ok(parsed);
    assert.equal(parsed.headliner, null);
    assert.equal(parsed.venueName, null);
    assert.equal(parsed.seat, null);
    assert.equal(parsed.showDate, '2026-12-25');
  });

  test('relevantDate calendar date follows the pass TZ, not the device TZ', () => {
    // A 2026-10-28 20:00 -07:00 pass is 2026-10-29 03:00 UTC. We
    // must report the *pass*'s local date (the show is on the 28th
    // in San Francisco), not what the device would compute after
    // converting to UTC.
    const bytes = buildPkpass({
      serialNumber: 'tz-check',
      passTypeIdentifier: 'pass.com.ticketmaster.tickets',
      relevantDate: '2026-10-28T20:00:00-07:00',
      eventTicket: { primaryFields: [{ key: 'event', value: 'X' }] },
    });
    const parsed = parsePkpassBytes(bytes);
    assert.ok(parsed);
    assert.equal(parsed.showDate, '2026-10-28');
  });
});
