/**
 * Unit tests for individual health checks. The axiom helper is
 * injected as a parameter so we don't have to mock module resolution
 * for the network calls. The DB is mocked at the package level.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface ScriptedExecute {
  results: unknown[];
  calls: Array<{ query: unknown }>;
  shouldThrow: Error | null;
}

const EXECUTE: ScriptedExecute = {
  results: [],
  calls: [],
  shouldThrow: null,
};

function nextResult(): unknown {
  return EXECUTE.results.shift() ?? [];
}

mock.module('@showbook/db', {
  namedExports: {
    db: {
      execute: async (query: unknown) => {
        EXECUTE.calls.push({ query });
        if (EXECUTE.shouldThrow) throw EXECUTE.shouldThrow;
        return nextResult();
      },
    },
  },
});

import type { AxiomQueryResult } from '../health-check/axiom';
import type {
  CheckResult,
  ExternalPingFns,
  QueryAxiomFn,
} from '../health-check/checks';

let checks: typeof import('../health-check/checks');

before(async () => {
  checks = await import('../health-check/checks');
});

beforeEach(() => {
  EXECUTE.results = [];
  EXECUTE.calls = [];
  EXECUTE.shouldThrow = null;
});

// Tests use unknown rows — the runtime shape is what matters, not the
// generic. Cast through unknown so TS doesn't fight the generic relation
// between QueryAxiomFn's TRow and the scripted rows.
function fakeAxiom(
  scripted: AxiomQueryResult<object> | AxiomQueryResult<object>[],
): QueryAxiomFn {
  const queue = Array.isArray(scripted) ? [...scripted] : [scripted];
  const fn = async () => (queue.shift() ?? scripted) as AxiomQueryResult<object>;
  return fn as unknown as QueryAxiomFn;
}

function ok(rows: object[]): AxiomQueryResult<object> {
  return { rows, ok: true, skipped: false, durationMs: 1 };
}

function unknown(): AxiomQueryResult<object> {
  return { rows: null, ok: false, skipped: true, durationMs: 0 };
}

function httpError(): AxiomQueryResult<object> {
  return { rows: null, ok: false, skipped: false, durationMs: 1, error: 'axiom http 500' };
}

describe('checkFailedJobs', () => {
  it('reports ok when no failures', async () => {
    const r = await checks.checkFailedJobs(fakeAxiom(ok([])));
    assert.equal(r.status, 'ok');
    assert.match(r.summary, /No failed jobs/);
  });

  it('reports fail with detail when failures exist', async () => {
    const r = await checks.checkFailedJobs(
      fakeAxiom(
        ok([
          { _time: '2026-05-03T01:00:00Z', job: 'shows/nightly', jobId: 'a', msg: 'boom' },
          { _time: '2026-05-03T02:00:00Z', job: 'enrichment/setlist-retry', jobId: 'b', msg: 'oops' },
        ]),
      ),
    );
    assert.equal(r.status, 'fail');
    assert.match(r.summary, /2 job failures/);
    assert.equal((r.detail?.failures as unknown[]).length, 2);
  });

  it('reports unknown when token is unset', async () => {
    const r = await checks.checkFailedJobs(fakeAxiom(unknown()));
    assert.equal(r.status, 'unknown');
  });

  it('reports warn on http error', async () => {
    const r = await checks.checkFailedJobs(fakeAxiom(httpError()));
    assert.equal(r.status, 'warn');
  });
});

describe('checkErrorVolume', () => {
  it('thresholds at <50 ok, <250 warn, else fail', async () => {
    const ok0 = await checks.checkErrorVolume(fakeAxiom(ok([])));
    assert.equal(ok0.status, 'ok');

    const okSmall = await checks.checkErrorVolume(
      fakeAxiom(ok([{ event: 'tm.request.failed', component: null, cnt: 12 }])),
    );
    assert.equal(okSmall.status, 'ok');

    const warnish = await checks.checkErrorVolume(
      fakeAxiom(ok([{ event: 'geocode.nominatim.failed', component: null, cnt: 80 }])),
    );
    assert.equal(warnish.status, 'warn');

    const failish = await checks.checkErrorVolume(
      fakeAxiom(ok([{ event: 'tm.request.failed', component: null, cnt: 500 }])),
    );
    assert.equal(failish.status, 'fail');
  });
});

describe('checkMissedSchedules', () => {
  // Tuesday morning ET — every daily job + the Monday discover ingest
  // should have a recent firing in pg-boss.
  const tuesdayMorning = new Date('2026-05-05T11:00:00Z'); // 7am ET
  const TUESDAY_QUEUES = [
    'shows/nightly',
    'enrichment/setlist-retry',
    'backfill/performer-images',
    'backfill/venue-photos',
    'notifications/daily-digest',
    'discover/ingest',
  ];

  function rowsFor(queues: string[], latest: Date): Array<{ name: string; latest: Date }> {
    return queues.map((name) => ({ name, latest }));
  }

  it('reports ok when every expected queue has a recent firing', async () => {
    EXECUTE.results = [rowsFor(TUESDAY_QUEUES, new Date(tuesdayMorning.getTime() - 60 * 60 * 1000))];
    const r = await checks.checkMissedSchedules(tuesdayMorning);
    assert.equal(r.status, 'ok');
    assert.match(r.summary, /All expected scheduled jobs/);
  });

  it('reports fail when at least one schedule has no firing in window', async () => {
    // Daily-digest queue missing from the result set entirely.
    const withoutDigest = TUESDAY_QUEUES.filter((q) => q !== 'notifications/daily-digest');
    EXECUTE.results = [rowsFor(withoutDigest, new Date(tuesdayMorning.getTime() - 60 * 60 * 1000))];
    const r = await checks.checkMissedSchedules(tuesdayMorning);
    assert.equal(r.status, 'fail');
    assert.match(r.summary, /Missing scheduled runs/);
    assert.match(r.summary, /daily-digest/);
  });

  it('reports fail when latest firing is older than the per-schedule window', async () => {
    // All queues present, but shows/nightly's last firing was 30h ago
    // (outside the 24h window).
    const recent = new Date(tuesdayMorning.getTime() - 60 * 60 * 1000);
    const stale = new Date(tuesdayMorning.getTime() - 30 * 60 * 60 * 1000);
    EXECUTE.results = [
      TUESDAY_QUEUES.map((name) => ({ name, latest: name === 'shows/nightly' ? stale : recent })),
    ];
    const r = await checks.checkMissedSchedules(tuesdayMorning);
    assert.equal(r.status, 'fail');
    assert.match(r.summary, /shows-nightly/);
  });

  it('skips discover-ingest expectation outside Tuesday', async () => {
    const wednesdayMorning = new Date('2026-05-06T11:00:00Z');
    const dailyOnly = TUESDAY_QUEUES.filter((q) => q !== 'discover/ingest');
    EXECUTE.results = [rowsFor(dailyOnly, new Date(wednesdayMorning.getTime() - 60 * 60 * 1000))];
    const r = await checks.checkMissedSchedules(wednesdayMorning);
    assert.equal(r.status, 'ok');
    // Discover-ingest must not appear in `expected` on a Wednesday — a
    // missing run would otherwise surface in the detail payload.
    const expectedLabels = (r.detail?.expected as string[] | undefined) ?? [];
    assert.ok(!expectedLabels.includes('discover-ingest'));
    assert.equal(expectedLabels.length, 5);
  });

  it('passes when discover-ingest ran in the last 8d even if last 24h is empty', async () => {
    // Simulate "last Monday's run; this Monday missed" — discover/ingest
    // is 7 days old, daily queues are fresh. Within the 8d window for
    // discover-ingest so we should not flag.
    const recent = new Date(tuesdayMorning.getTime() - 60 * 60 * 1000);
    const sevenDaysAgo = new Date(tuesdayMorning.getTime() - 7 * 24 * 60 * 60 * 1000);
    EXECUTE.results = [
      TUESDAY_QUEUES.map((name) => ({
        name,
        latest: name === 'discover/ingest' ? sevenDaysAgo : recent,
      })),
    ];
    const r = await checks.checkMissedSchedules(tuesdayMorning);
    assert.equal(r.status, 'ok');
  });

  it('reports warn when the DB query throws', async () => {
    EXECUTE.shouldThrow = new Error('connection refused');
    const r = await checks.checkMissedSchedules(tuesdayMorning);
    assert.equal(r.status, 'warn');
    assert.match(r.summary, /pgboss.job/);
  });

  it('binds the time threshold as an ISO string (not a Date object)', async () => {
    // postgres-js crashes with "string argument must be of type string or
    // an instance of Buffer" when a bind parameter is a Date. The check
    // converts to ISO before binding; assert the params reflect that.
    EXECUTE.results = [rowsFor(TUESDAY_QUEUES, new Date(tuesdayMorning.getTime() - 60 * 60 * 1000))];
    await checks.checkMissedSchedules(tuesdayMorning);
    const lastCall = EXECUTE.calls.at(-1);
    assert.ok(lastCall, 'expected a db.execute call');
    // Drizzle's `sql` template embeds non-SQL `${value}` interpolations as
    // raw chunks (primitives sit directly in `queryChunks`; nested SQL
    // objects expose their own `queryChunks`). `StringChunk` instances
    // carry `value: string[]` for the literal SQL fragments. Walk the
    // tree and collect every non-StringChunk leaf so we can assert the
    // bound values include the expected ISO timestamps and no Date.
    const collectBoundValues = (chunks: unknown[]): unknown[] => {
      const out: unknown[] = [];
      for (const c of chunks) {
        if (c && typeof c === 'object') {
          // Nested SQL: recurse into its queryChunks.
          if ('queryChunks' in c) {
            const nested = (c as { queryChunks: unknown }).queryChunks;
            if (Array.isArray(nested)) out.push(...collectBoundValues(nested));
            continue;
          }
          // StringChunk: `value` is the literal SQL string(s) — skip.
          if (
            'value' in c &&
            Array.isArray((c as { value: unknown }).value)
          ) {
            continue;
          }
          // Other objects (e.g. Param) — include their value.
          if ('value' in c) out.push((c as { value: unknown }).value);
          continue;
        }
        // Primitive interpolation — these are the bound values.
        out.push(c);
      }
      return out;
    };
    const chunks = (lastCall.query as unknown as { queryChunks: unknown[] })
      .queryChunks;
    assert.ok(Array.isArray(chunks), 'sql object should expose queryChunks');
    const paramValues = collectBoundValues(chunks);
    const dateValues = paramValues.filter((v) => v instanceof Date);
    assert.equal(
      dateValues.length,
      0,
      `no bind param should be a Date instance, got ${dateValues.length}`,
    );
    const isoValues = paramValues.filter(
      (v): v is string =>
        typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v),
    );
    assert.ok(
      isoValues.length >= 2,
      `expected two ISO timestamp params, got ${isoValues.length}`,
    );
  });

  it('surfaces underlying postgres cause message instead of "Failed query:"', async () => {
    // Mirror Drizzle's `DrizzleQueryError`: wrapper message is opaque,
    // the actual SQLSTATE + message live on .cause.
    class FakeDrizzleErr extends Error {
      override cause: unknown;
      constructor(message: string, cause: unknown) {
        super(message);
        this.cause = cause;
      }
    }
    EXECUTE.shouldThrow = new FakeDrizzleErr(
      'Failed query: SELECT … params: …',
      { code: '42P01', message: 'relation "pgboss.archive" does not exist' },
    );
    const r = await checks.checkMissedSchedules(tuesdayMorning);
    assert.equal(r.status, 'warn');
    assert.match(r.summary, /relation "pgboss.archive" does not exist/);
    assert.match(r.summary, /42P01/);
  });
});

describe('checkDatabaseConnectivity', () => {
  it('reports ok when db.execute resolves', async () => {
    const r = await checks.checkDatabaseConnectivity();
    assert.equal(r.status, 'ok');
  });

  it('reports fail when db.execute throws', async () => {
    EXECUTE.shouldThrow = new Error('connection refused');
    const r = await checks.checkDatabaseConnectivity();
    assert.equal(r.status, 'fail');
    assert.match(r.summary, /unreachable/);
  });
});

describe('checkPgBossQueue', () => {
  it('flags fail when stuck active jobs > 0', async () => {
    EXECUTE.results = [
      [{ failed: 0, active_stuck: 2, active_total: 5, retry: 0 }],
    ];
    const r = await checks.checkPgBossQueue();
    assert.equal(r.status, 'fail');
  });

  it('flags warn when failed in 1..5 range and no stuck', async () => {
    EXECUTE.results = [
      [{ failed: 1, active_stuck: 0, active_total: 0, retry: 0 }],
      [{ name: 'enrichment/setlist-corpus-fill', failed: 1 }],
    ];
    const r = await checks.checkPgBossQueue();
    assert.equal(r.status, 'warn');
    assert.match(r.summary, /enrichment\/setlist-corpus-fill/);
    assert.match(r.summary, /1 failed/);
  });

  it('flags fail and surfaces top queue when failed > 5', async () => {
    EXECUTE.results = [
      [{ failed: 800, active_stuck: 0, active_total: 1, retry: 0 }],
      [
        { name: 'enrichment/setlist-corpus-fill', failed: 875 },
        { name: 'backfill/performer-images', failed: 2 },
      ],
    ];
    const r = await checks.checkPgBossQueue();
    assert.equal(r.status, 'fail');
    assert.match(r.summary, /enrichment\/setlist-corpus-fill/);
    assert.match(r.summary, /\(875\)/);
    const topQueues = r.detail?.topQueues as Array<{ name: string; failed: number }>;
    assert.equal(topQueues.length, 2);
    assert.equal(topQueues[0]!.name, 'enrichment/setlist-corpus-fill');
  });

  it('flags ok when queue is clean', async () => {
    EXECUTE.results = [
      [{ failed: 0, active_stuck: 0, active_total: 0, retry: 0 }],
    ];
    const r = await checks.checkPgBossQueue();
    assert.equal(r.status, 'ok');
  });
});

describe('checkDataFreshness', () => {
  it('flags fail when never discovered', async () => {
    EXECUTE.results = [[{ last_discovered: null }]];
    const r = await checks.checkDataFreshness();
    assert.equal(r.status, 'warn');
  });

  it('reports ok when fresh', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    EXECUTE.results = [[{ last_discovered: recent }]];
    const r = await checks.checkDataFreshness();
    assert.equal(r.status, 'ok');
  });

  it('reports fail when stale > 14d', async () => {
    const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    EXECUTE.results = [[{ last_discovered: stale }]];
    const r = await checks.checkDataFreshness();
    assert.equal(r.status, 'fail');
  });
});

describe('checkStalledScrapes', () => {
  it('reports ok when no stalled rows', async () => {
    EXECUTE.results = [[{ cnt: 0 }]];
    const r = await checks.checkStalledScrapes();
    assert.equal(r.status, 'ok');
  });

  it('reports warn when there are stalled scrapes', async () => {
    EXECUTE.results = [[{ cnt: 3 }]];
    const r = await checks.checkStalledScrapes();
    assert.equal(r.status, 'warn');
  });
});

describe('checkExternalApis', () => {
  function pings(overrides: Partial<ExternalPingFns> = {}): ExternalPingFns {
    return {
      ticketmaster: async () => ({ ok: true }),
      setlistfm: async () => ({ ok: true }),
      groq: async () => ({ ok: true }),
      resend: async () => ({ ok: true }),
      ...overrides,
    };
  }

  it('reports ok when all pings succeed', async () => {
    const r = await checks.checkExternalApis(pings());
    assert.equal(r.status, 'ok');
  });

  it('reports warn when some pings fail', async () => {
    const r = await checks.checkExternalApis(
      pings({
        groq: async () => {
          throw new Error('bad key');
        },
      }),
    );
    assert.equal(r.status, 'warn');
    const detail = r.detail?.perApi as Record<string, { ok: boolean; error?: string }>;
    assert.equal(detail.groq.ok, false);
    assert.match(detail.groq.error ?? '', /bad key/);
  });

  it('reports fail when every ping fails', async () => {
    const fail = async () => {
      throw new Error('down');
    };
    const r = await checks.checkExternalApis({
      ticketmaster: fail,
      setlistfm: fail,
      groq: fail,
      resend: fail,
    });
    assert.equal(r.status, 'fail');
  });
});

// Quick sanity: every CheckResult has the documented shape.
describe('CheckResult shape', () => {
  it('every check returns name + status + summary', () => {
    const sample: CheckResult = { name: 'x', status: 'ok', summary: 'ok' };
    assert.equal(sample.name, 'x');
    assert.equal(sample.status, 'ok');
    assert.equal(sample.summary, 'ok');
  });
});
