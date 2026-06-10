/**
 * Drives discover-ingest's consolidateGroupableSingles path: scattered
 * single-night announcement rows for the same (venue, headliner, kind) should
 * collapse into one canonical run row when shouldGroup is satisfied (e.g. a
 * comedian's 3+ night club stand), and stay put otherwise.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface Capture {
  selectResults: unknown[][];
  updatePayloads: Record<string, unknown>[];
  deleteCount: number;
}
const CAP: Capture = { selectResults: [], updatePayloads: [], deleteCount: 0 };
function reset(selectResults: unknown[][] = []) {
  CAP.selectResults = selectResults;
  CAP.updatePayloads = [];
  CAP.deleteCount = 0;
}

function selectChain() {
  const p: Record<string, unknown> = {};
  p.from = () => p;
  p.where = () => p;
  p.limit = () => p;
  p.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(CAP.selectResults.shift() ?? []).then(resolve, reject);
  return p;
}
function updateChain() {
  const state: { payload?: Record<string, unknown> } = {};
  const p: Record<string, unknown> = {};
  p.set = (payload: Record<string, unknown>) => {
    state.payload = payload;
    return p;
  };
  p.where = () => {
    if (state.payload) CAP.updatePayloads.push(state.payload);
    return p;
  };
  p.returning = () => p;
  p.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
  return p;
}
function deleteChain() {
  const p: Record<string, unknown> = {};
  p.where = () => {
    CAP.deleteCount += 1;
    return p;
  };
  p.returning = () => p;
  p.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
  return p;
}

const fakeDb = {
  select: () => selectChain(),
  selectDistinct: () => selectChain(),
  selectDistinctOn: () => selectChain(),
  update: () => updateChain(),
  delete: () => deleteChain(),
  insert: () => updateChain(),
  execute: async () => undefined,
};

mock.module('@showbook/db', {
  namedExports: {
    db: fakeDb,
    announcements: {},
    showAnnouncementLinks: {},
    userVenueFollows: {},
    userPerformerFollows: {},
    userRegions: {},
    venues: {},
    performers: {},
  },
});

mock.module('@showbook/api', {
  namedExports: {
    searchEvents: async () => ({ events: [], totalElements: 0, page: 0, size: 200 }),
    inferKind: () => 'comedy',
    selectBestImage: () => null,
    extractMusicbrainzId: () => null,
    extractFestivalName: (n: string) => n,
    determineOnSaleStatus: () => 'on_sale',
    parseOnSaleDate: () => null,
    isPrimaryEventUrl: () => true,
    matchOrCreateVenue: async () => ({ venue: { id: 'v1' }, created: false }),
    matchOrCreatePerformer: async (i: { name: string }) => ({
      performer: { id: `perf-${i.name}`, name: i.name },
      created: false,
    }),
  },
});

function single(id: string, date: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    venueId: 'v1',
    kind: 'comedy',
    headliner: 'Helen Hong',
    headlinerPerformerId: 'perf-helen',
    support: null,
    supportPerformerIds: null,
    productionName: null,
    showDate: date,
    runStartDate: date,
    runEndDate: date,
    performanceDates: [date],
    onSaleDate: null,
    onSaleStatus: 'on_sale',
    source: 'ticketmaster',
    sourceEventId: `src-${id}`,
    extraSourceEventIds: null,
    ticketUrl: null,
    discoveredAt: new Date('2026-02-01'),
    ...overrides,
  };
}

let mod: typeof import('../discover-ingest');

before(async () => {
  mod = await import('../discover-ingest');
});

beforeEach(() => reset());

describe('consolidateGroupableSingles', () => {
  it('collapses a 3-night comedy stand into one run and deletes the duplicates', async () => {
    reset([
      [
        single('a', '2026-06-10'),
        single('b', '2026-06-11'),
        single('c', '2026-06-12'),
      ],
      [], // no linked rows
    ]);

    const consolidated = await mod.consolidateGroupableSingles();
    assert.equal(consolidated, 1);
    assert.equal(CAP.updatePayloads.length, 1);

    const payload = CAP.updatePayloads[0]!;
    assert.equal(payload.runStartDate, '2026-06-10');
    assert.equal(payload.runEndDate, '2026-06-12');
    assert.deepEqual(payload.performanceDates, [
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
    ]);
    // productionName pinned to headliner so a later night extends this run.
    assert.equal(payload.productionName, 'Helen Hong');
    // The two non-canonical singles get deleted in one guarded statement.
    assert.equal(CAP.deleteCount, 1);
  });

  it('leaves a 2-night comedy pair untouched (under the 3-date floor)', async () => {
    reset([
      [single('a', '2026-06-10'), single('b', '2026-06-11')],
      [],
    ]);
    const consolidated = await mod.consolidateGroupableSingles();
    assert.equal(consolidated, 0);
    assert.equal(CAP.updatePayloads.length, 0);
    assert.equal(CAP.deleteCount, 0);
  });

  it('leaves a 3-date comedy tour spanning > 30 days untouched', async () => {
    reset([
      [
        single('a', '2026-06-10'),
        single('b', '2026-07-20'),
        single('c', '2026-08-30'),
      ],
      [],
    ]);
    const consolidated = await mod.consolidateGroupableSingles();
    assert.equal(consolidated, 0);
    assert.equal(CAP.updatePayloads.length, 0);
  });

  it('does not merge different headliners at the same venue', async () => {
    reset([
      [
        single('a', '2026-06-10', { headliner: 'Helen Hong', headlinerPerformerId: 'h' }),
        single('b', '2026-06-11', { headliner: 'John Mulaney', headlinerPerformerId: 'jm' }),
        single('c', '2026-06-12', { headliner: 'John Mulaney', headlinerPerformerId: 'jm' }),
      ],
      [],
    ]);
    const consolidated = await mod.consolidateGroupableSingles();
    // Helen: 1 row (no cluster). Mulaney: 2 rows (under floor). Neither groups.
    assert.equal(consolidated, 0);
  });

  it('prefers a linked row as the survivor and never deletes it', async () => {
    reset([
      [
        single('a', '2026-06-10'),
        single('b', '2026-06-11'),
        single('c', '2026-06-12', { discoveredAt: new Date('2026-01-01') }),
      ],
      [{ announcementId: 'a' }], // row "a" is linked to a watched show
    ]);
    const consolidated = await mod.consolidateGroupableSingles();
    assert.equal(consolidated, 1);
    // Even though "c" was discovered earliest, the linked row "a" survives,
    // so the run still spans the full range.
    const payload = CAP.updatePayloads[0]!;
    assert.equal(payload.runStartDate, '2026-06-10');
    assert.equal(payload.runEndDate, '2026-06-12');
    assert.deepEqual(payload.performanceDates, [
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
    ]);
  });
});
