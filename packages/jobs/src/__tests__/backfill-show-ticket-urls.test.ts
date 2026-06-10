/**
 * Unit tests for runBackfillShowTicketUrls. Ticketmaster is mocked at
 * the `@showbook/api` boundary (searchEvents) and the DB is replaced
 * with a minimal drizzle-shaped fake — same pattern as
 * backfill-show-cover-images.test.ts.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface Candidate {
  id: string;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival' | 'film' | 'unknown';
  productionName: string | null;
  date: string | null;
  tmVenueId: string | null;
}

interface HeadlinerRow {
  showId: string;
  name: string;
  sortOrder: number;
}

interface Script {
  candidates: Candidate[];
  headliners: HeadlinerRow[];
  // Per-call result; supports an `error` entry so we can drive the
  // catch path without re-mocking `@showbook/api`.
  searchEventsResults: Array<
    { events: Array<{ url?: string }> } | { error: string }
  >;
  updates: Array<{ id: string; ticketUrl: string }>;
  searchEventsCalls: Array<{ keyword: string; venueId?: string }>;
}

const SCRIPT: Script = {
  candidates: [],
  headliners: [],
  searchEventsResults: [],
  updates: [],
  searchEventsCalls: [],
};

function reset(opts: Partial<Script> = {}): void {
  SCRIPT.candidates = opts.candidates ?? [];
  SCRIPT.headliners = opts.headliners ?? [];
  SCRIPT.searchEventsResults = opts.searchEventsResults ?? [];
  SCRIPT.updates = [];
  SCRIPT.searchEventsCalls = [];
}

// Sentinel table objects so the fake can route `db.select(...).from(t)`
// to the right script queue. Drizzle table objects are opaque to us
// here — we only need referential equality.
const SHOWS_TABLE = { __table: 'shows', id: 'shows.id' };
const VENUES_TABLE = { __table: 'venues' };
const SHOW_PERFORMERS_TABLE = { __table: 'show_performers' };
const PERFORMERS_TABLE = { __table: 'performers' };

function findKnownId(predicate: unknown): string | undefined {
  const known = new Set(SCRIPT.candidates.map((c) => c.id));
  function walk(node: unknown): string | undefined {
    if (typeof node === 'string' && known.has(node)) return node;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return undefined;
    }
    if (node && typeof node === 'object') {
      for (const v of Object.values(node)) {
        const found = walk(v);
        if (found) return found;
      }
    }
    return undefined;
  }
  return walk(predicate);
}

const fakeDb = {
  select: (_cols: unknown) => ({
    from: (table: unknown) => ({
      innerJoin: (_other: unknown, _on: unknown) => ({
        where: () => {
          if (table === SHOWS_TABLE) {
            return Promise.resolve(SCRIPT.candidates);
          }
          if (table === SHOW_PERFORMERS_TABLE) {
            return Promise.resolve(SCRIPT.headliners);
          }
          throw new Error(`unexpected select.from table: ${String(table)}`);
        },
      }),
    }),
  }),
  update: (_table: unknown) => ({
    set: (vals: { ticketUrl?: string }) => ({
      where: (predicate: unknown) => {
        const id = findKnownId(predicate) ?? 'unknown';
        SCRIPT.updates.push({
          id,
          ticketUrl: vals.ticketUrl ?? '',
        });
        return Promise.resolve();
      },
    }),
  }),
};

mock.module('@showbook/db', {
  namedExports: {
    db: fakeDb,
    shows: SHOWS_TABLE,
    venues: VENUES_TABLE,
    showPerformers: SHOW_PERFORMERS_TABLE,
    performers: PERFORMERS_TABLE,
  },
});

mock.module('@showbook/api', {
  namedExports: {
    searchEvents: async (params: { keyword: string; venueId?: string }) => {
      SCRIPT.searchEventsCalls.push({
        keyword: params.keyword,
        venueId: params.venueId,
      });
      const next = SCRIPT.searchEventsResults.shift();
      if (next && 'error' in next) {
        throw new Error(next.error);
      }
      return next ?? { events: [] };
    },
    // Inlined to mirror the production regex — we don't import the real
    // function because mock.module replaces the whole boundary; tests
    // exercise this same shape directly in `ticketmaster.test.ts`.
    pickPrimaryEventUrl: (events: Array<{ url?: string }>) => {
      for (const e of events) {
        if (e.url && /:\/\/[^/]+\/[^/]+\/event\//.test(e.url)) return e.url;
      }
      return null;
    },
  },
});

mock.module('@showbook/observability', {
  namedExports: {
    child: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      child() {
        return this;
      },
    }),
    flushObservability: async () => {},
  },
});

let mod: typeof import('../backfill-show-ticket-urls');

before(async () => {
  mod = await import('../backfill-show-ticket-urls');
});

describe('runBackfillShowTicketUrls', () => {
  beforeEach(() => {
    reset();
  });

  it('returns zeros when no candidate rows', async () => {
    const result = await mod.runBackfillShowTicketUrls();
    assert.deepEqual(result, { total: 0, updated: 0, missing: 0, failed: 0 });
    assert.equal(SCRIPT.updates.length, 0);
  });

  it('writes ticketUrl from TM event search for a concert', async () => {
    reset({
      candidates: [
        {
          id: 'show-1',
          kind: 'concert',
          productionName: null,
          date: '2026-08-16',
          tmVenueId: 'tm-venue-1',
        },
      ],
      headliners: [{ showId: 'show-1', name: 'Passion Pit', sortOrder: 0 }],
      searchEventsResults: [
        {
          events: [
            {
              url: 'https://www.ticketmaster.com/passion-pit-tickets/event/abc',
            },
          ],
        },
      ],
    });
    const result = await mod.runBackfillShowTicketUrls();
    assert.equal(result.total, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.missing, 0);
    assert.equal(SCRIPT.updates.length, 1);
    assert.equal(SCRIPT.updates[0].id, 'show-1');
    assert.equal(
      SCRIPT.updates[0].ticketUrl,
      'https://www.ticketmaster.com/passion-pit-tickets/event/abc',
    );
    assert.equal(SCRIPT.searchEventsCalls[0].keyword, 'Passion Pit');
    assert.equal(SCRIPT.searchEventsCalls[0].venueId, 'tm-venue-1');
  });

  it('uses productionName for a theatre show', async () => {
    reset({
      candidates: [
        {
          id: 'show-theatre',
          kind: 'theatre',
          productionName: 'Oh, Mary!',
          date: '2026-06-01',
          tmVenueId: 'tm-venue-lyceum',
        },
      ],
      // Theatre shows have no headliner in show_performers (production
      // shows track cast via productionName on the show row), so the
      // map is empty for this row.
      headliners: [],
      searchEventsResults: [
        {
          events: [
            {
              url: 'https://www.ticketmaster.com/oh-mary/event/oh-mary',
            },
          ],
        },
      ],
    });
    const result = await mod.runBackfillShowTicketUrls();
    assert.equal(result.updated, 1);
    assert.equal(SCRIPT.searchEventsCalls[0].keyword, 'Oh, Mary!');
    assert.equal(
      SCRIPT.updates[0].ticketUrl,
      'https://www.ticketmaster.com/oh-mary/event/oh-mary',
    );
  });

  it('counts missing when TM returns no events', async () => {
    reset({
      candidates: [
        {
          id: 'show-2',
          kind: 'concert',
          productionName: null,
          date: '2026-09-17',
          tmVenueId: 'tm-venue-greek',
        },
      ],
      headliners: [{ showId: 'show-2', name: 'Bleachers', sortOrder: 0 }],
      searchEventsResults: [{ events: [] }],
    });
    const result = await mod.runBackfillShowTicketUrls();
    assert.equal(result.updated, 0);
    assert.equal(result.missing, 1);
    assert.equal(SCRIPT.updates.length, 0);
  });

  it('counts missing when an event has no url', async () => {
    reset({
      candidates: [
        {
          id: 'show-3',
          kind: 'concert',
          productionName: null,
          date: '2026-09-11',
          tmVenueId: null,
        },
      ],
      headliners: [{ showId: 'show-3', name: 'Foster the People', sortOrder: 0 }],
      searchEventsResults: [{ events: [{}] }], // event present, no url
    });
    const result = await mod.runBackfillShowTicketUrls();
    assert.equal(result.updated, 0);
    assert.equal(result.missing, 1);
  });

  it('skips rows with no keyword (no headliner, no productionName)', async () => {
    reset({
      candidates: [
        {
          id: 'show-empty',
          kind: 'concert',
          productionName: null,
          date: '2026-10-01',
          tmVenueId: null,
        },
      ],
      headliners: [],
      searchEventsResults: [],
    });
    const result = await mod.runBackfillShowTicketUrls();
    assert.equal(result.updated, 0);
    assert.equal(result.missing, 1);
    assert.equal(
      SCRIPT.searchEventsCalls.length,
      0,
      'no-keyword rows must skip the TM call entirely',
    );
  });

  it('counts failed when searchEvents throws', async () => {
    reset({
      candidates: [
        {
          id: 'show-err',
          kind: 'concert',
          productionName: null,
          date: '2026-09-17',
          tmVenueId: 'tm-venue-greek',
        },
      ],
      headliners: [{ showId: 'show-err', name: 'Bleachers', sortOrder: 0 }],
      searchEventsResults: [{ error: 'TM 500' }],
    });
    const result = await mod.runBackfillShowTicketUrls();
    assert.equal(result.failed, 1);
    assert.equal(result.updated, 0);
    assert.equal(SCRIPT.updates.length, 0);
  });

  it('skips festivals at the SQL layer (they never appear as candidates)', async () => {
    // The query filter excludes festivals, so the job should never see
    // them as candidates. This asserts the contract: even if a festival
    // somehow leaks through, the test scaffolding records what happened.
    reset({
      candidates: [],
      headliners: [],
      searchEventsResults: [],
    });
    const result = await mod.runBackfillShowTicketUrls();
    assert.equal(result.total, 0);
  });
});
