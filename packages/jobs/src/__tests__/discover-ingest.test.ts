/**
 * Unit tests for fetchAllEvents pagination logic.
 *
 * Run with:
 *   GROQ_API_KEY=test pnpm --filter @showbook/jobs exec node --import tsx --test src/__tests__/discover-ingest.test.ts
 *
 * GROQ_API_KEY=test is required because @showbook/api initialises the Groq
 * client at import time (throws if the env var is absent). No actual Groq or
 * DB calls are made — fetchAllEvents is exercised via its injected `searchFn`
 * parameter so the tests stay in-process and fast.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchAllEvents,
  determineOnSaleStatus,
  parseOnSaleDate,
  nowISO,
  futureISO,
} from '../discover-ingest';
import type { TMEvent } from '@showbook/api';

function makeEvent(id: string): TMEvent {
  return {
    id,
    name: `Event ${id}`,
    url: null,
    dates: {
      start: { localDate: '2026-08-01', localTime: '20:00:00', dateTime: '2026-08-01T20:00:00Z' },
      status: { code: 'onsale' },
    },
    classifications: [],
    sales: null,
    images: [],
    _embedded: { venues: [], attractions: [] },
  } as unknown as TMEvent;
}

function makeSearchFn(
  totalElements: number,
  pageSize = 200,
): { fn: typeof import('@showbook/api').searchEvents; calls: number[] } {
  const calls: number[] = [];
  const fn = async (params: { page?: number; size?: number }) => {
    const page = params.page ?? 0;
    const size = params.size ?? 200;
    calls.push(page);
    const offset = page * size;
    const count = Math.min(size, Math.max(0, totalElements - offset));
    const events = Array.from({ length: count }, (_, i) =>
      makeEvent(`e-${page}-${i}`),
    );
    return { events, totalElements, page, size };
  };
  return { fn: fn as unknown as typeof import('@showbook/api').searchEvents, calls };
}

test('fetchAllEvents: single page when totalElements <= 200', async () => {
  const { fn, calls } = makeSearchFn(150);
  const result = await fetchAllEvents({}, 1000, fn);
  assert.equal(calls.length, 1, 'only one page fetched');
  assert.equal(calls[0], 0, 'fetched page 0');
  assert.equal(result.length, 150);
});

test('fetchAllEvents: fetches multiple pages up to totalElements', async () => {
  const { fn, calls } = makeSearchFn(450);
  const result = await fetchAllEvents({}, 1000, fn);
  assert.equal(calls.length, 3, 'three pages fetched (200+200+50)');
  assert.deepEqual(calls, [0, 1, 2]);
  assert.equal(result.length, 450);
});

test('fetchAllEvents: stops at 5 pages (TM cap page*size<=1000)', async () => {
  // 1100 events available but TM only allows 5 pages of 200
  const { fn, calls } = makeSearchFn(1100);
  const result = await fetchAllEvents({}, 1000, fn);
  assert.equal(calls.length, 5, 'exactly 5 pages fetched');
  assert.deepEqual(calls, [0, 1, 2, 3, 4]);
  assert.equal(result.length, 1000, 'capped at maxEvents=1000');
});

test('fetchAllEvents: stops when totalElements exhausted before 5 pages', async () => {
  // 350 events: 2 full pages + 1 partial
  const { fn, calls } = makeSearchFn(350);
  const result = await fetchAllEvents({}, 1000, fn);
  assert.equal(calls.length, 2, 'only 2 pages needed');
  assert.equal(result.length, 350);
});

test('fetchAllEvents: respects maxEvents cap smaller than totalElements', async () => {
  const { fn, calls } = makeSearchFn(800);
  const result = await fetchAllEvents({}, 400, fn);
  assert.equal(result.length, 400, 'capped at maxEvents=400');
  // Should stop after 2 pages (400 events)
  assert.ok(calls.length <= 2, `expected ≤2 pages, got ${calls.length}`);
});

// ---------------------------------------------------------------------------
// determineOnSaleStatus
// ---------------------------------------------------------------------------

function eventWithSales(opts: {
  statusCode?: string;
  saleStart?: string | null;
  saleEnd?: string | null;
}): TMEvent {
  return {
    id: 'x',
    name: 'x',
    url: null,
    dates: { start: { localDate: '2026-08-01' }, status: opts.statusCode ? { code: opts.statusCode } : undefined },
    classifications: [],
    sales: opts.saleStart || opts.saleEnd
      ? {
          public: {
            startDateTime: opts.saleStart ?? undefined,
            endDateTime: opts.saleEnd ?? undefined,
          },
        }
      : null,
    images: [],
    _embedded: { venues: [], attractions: [] },
  } as unknown as TMEvent;
}

test('determineOnSaleStatus: offsale status → sold_out', () => {
  assert.equal(
    determineOnSaleStatus(eventWithSales({ statusCode: 'offsale' })),
    'sold_out',
  );
});

test('determineOnSaleStatus: cancelled status → sold_out', () => {
  assert.equal(
    determineOnSaleStatus(eventWithSales({ statusCode: 'cancelled' })),
    'sold_out',
  );
});

test('determineOnSaleStatus: future saleStart → announced', () => {
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  assert.equal(
    determineOnSaleStatus(eventWithSales({ saleStart: future })),
    'announced',
  );
});

test('determineOnSaleStatus: past saleEnd → sold_out', () => {
  const past = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
  assert.equal(
    determineOnSaleStatus(
      eventWithSales({ saleStart: '2020-01-01T00:00:00Z', saleEnd: past }),
    ),
    'sold_out',
  );
});

test('determineOnSaleStatus: ongoing window → on_sale', () => {
  const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  assert.equal(
    determineOnSaleStatus(eventWithSales({ saleStart: past, saleEnd: future })),
    'on_sale',
  );
});

test('determineOnSaleStatus: no sales info defaults to on_sale', () => {
  assert.equal(determineOnSaleStatus(eventWithSales({})), 'on_sale');
});

// ---------------------------------------------------------------------------
// parseOnSaleDate
// ---------------------------------------------------------------------------

test('parseOnSaleDate: returns null when missing', () => {
  assert.equal(parseOnSaleDate(eventWithSales({})), null);
});

test('parseOnSaleDate: returns null for unparseable date', () => {
  assert.equal(
    parseOnSaleDate(eventWithSales({ saleStart: 'not-a-date' })),
    null,
  );
});

test('parseOnSaleDate: filters TM 1900 placeholder', () => {
  assert.equal(
    parseOnSaleDate(eventWithSales({ saleStart: '1900-01-01T00:00:00Z' })),
    null,
  );
});

test('parseOnSaleDate: returns parsed Date for real date', () => {
  const d = parseOnSaleDate(eventWithSales({ saleStart: '2026-08-15T10:00:00Z' }));
  assert.ok(d instanceof Date);
  assert.equal(d?.getUTCFullYear(), 2026);
  assert.equal(d?.getUTCMonth(), 7); // August
});

// ---------------------------------------------------------------------------
// nowISO / futureISO
// ---------------------------------------------------------------------------

test('nowISO: returns ISO string without milliseconds', () => {
  const s = nowISO();
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('futureISO: returns a date `months` in the future', () => {
  const now = new Date();
  const future = new Date(futureISO(6));
  // 6 months ahead, allow ±1 day for time-of-call drift.
  const diffMs = future.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  assert.ok(diffDays > 170 && diffDays < 200, `expected ~180 days, got ${diffDays}`);
});

test('futureISO: format matches nowISO', () => {
  assert.match(futureISO(1), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('fetchAllEvents: stops early when a page returns 0 events', async () => {
  let callCount = 0;
  const fn = async (params: { page?: number }) => {
    callCount++;
    const page = params.page ?? 0;
    // Return events only on page 0; empty on subsequent pages
    const events = page === 0 ? Array.from({ length: 200 }, (_, i) => makeEvent(`e${i}`)) : [];
    return { events, totalElements: 1000, page, size: 200 };
  };
  const result = await fetchAllEvents(
    {},
    1000,
    fn as unknown as typeof import('@showbook/api').searchEvents,
  );
  assert.equal(callCount, 2, 'stops after the empty page');
  assert.equal(result.length, 200);
});
