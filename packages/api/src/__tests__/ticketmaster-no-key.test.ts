/**
 * Verifies that ticketmaster.ts short-circuits to empty results when
 * TICKETMASTER_API_KEY is unset, without making a network call. This
 * makes integration tests hermetic in CI (where the secret isn't
 * provided) and lets self-hosters run without a TM account.
 *
 * Note: ticketmaster.ts captures the env var into a module-scope const
 * at import time, so this file MUST delete the env var before any
 * dynamic import of the module.
 */

delete process.env.TICKETMASTER_API_KEY;

import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type {
  searchEvents as SearchEventsFn,
  searchVenues as SearchVenuesFn,
  searchAttractions as SearchAttractionsFn,
  getVenue as GetVenueFn,
  getEvent as GetEventFn,
  getAttraction as GetAttractionFn,
} from '../ticketmaster';

let searchEvents: typeof SearchEventsFn;
let searchVenues: typeof SearchVenuesFn;
let searchAttractions: typeof SearchAttractionsFn;
let getVenue: typeof GetVenueFn;
let getEvent: typeof GetEventFn;
let getAttraction: typeof GetAttractionFn;

before(async () => {
  delete process.env.TICKETMASTER_API_KEY;
  const spec = '../ticketmaster?bust=no-key' as string;
  const mod = (await import(spec)) as typeof import('../ticketmaster');
  searchEvents = mod.searchEvents;
  searchVenues = mod.searchVenues;
  searchAttractions = mod.searchAttractions;
  getVenue = mod.getVenue;
  getEvent = mod.getEvent;
  getAttraction = mod.getAttraction;
});

const ORIGINAL_FETCH = globalThis.fetch;
let fetchCalls = 0;

beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be called when TICKETMASTER_API_KEY is unset');
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('searchVenues: returns [] without calling fetch when API key is unset', async () => {
  const result = await searchVenues({ keyword: 'fillmore' });
  assert.deepEqual(result, []);
  assert.equal(fetchCalls, 0);
});

test('searchEvents: returns empty page without calling fetch when API key is unset', async () => {
  const result = await searchEvents({ keyword: 'radiohead' });
  assert.deepEqual(result, { events: [], totalElements: 0, totalPages: 0 });
  assert.equal(fetchCalls, 0);
});

test('searchAttractions: returns [] without calling fetch when API key is unset', async () => {
  const result = await searchAttractions('radiohead');
  assert.deepEqual(result, []);
  assert.equal(fetchCalls, 0);
});

test('getVenue: returns null without calling fetch when API key is unset', async () => {
  const result = await getVenue('K8vZ');
  assert.equal(result, null);
  assert.equal(fetchCalls, 0);
});

test('getEvent: returns null without calling fetch when API key is unset', async () => {
  const result = await getEvent('G5d');
  assert.equal(result, null);
  assert.equal(fetchCalls, 0);
});

test('getAttraction: returns null without calling fetch when API key is unset', async () => {
  const result = await getAttraction('K8v');
  assert.equal(result, null);
  assert.equal(fetchCalls, 0);
});
