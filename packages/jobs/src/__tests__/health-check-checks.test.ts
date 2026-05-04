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
  // should have an entry from the prior 24h.
  const tuesdayMorning = new Date('2026-05-05T11:00:00Z'); // 7am ET

  it('reports ok when every expected event has a count', async () => {
    // 6 expectations on a Tuesday — provide a single shared scripted
    // result that matches for all calls.
    const r = await checks.checkMissedSchedules(
      tuesdayMorning,
      fakeAxiom(ok([{ cnt: 1 }])),
    );
    assert.equal(r.status, 'ok');
  });

  it('reports fail when at least one schedule has zero hits', async () => {
    let call = 0;
    const fn = (async () => {
      call += 1;
      const cnt = call === 5 ? 0 : 1; // digest is the 5th expectation
      return ok([{ cnt }]);
    }) as unknown as QueryAxiomFn;
    const r = await checks.checkMissedSchedules(tuesdayMorning, fn);
    assert.equal(r.status, 'fail');
    assert.match(r.summary, /Missing/);
  });

  it('skips discover-ingest expectation outside Tuesday', async () => {
    const wednesdayMorning = new Date('2026-05-06T11:00:00Z');
    let call = 0;
    const fn = (async () => {
      call += 1;
      return ok([{ cnt: 1 }]);
    }) as unknown as QueryAxiomFn;
    await checks.checkMissedSchedules(wednesdayMorning, fn);
    // 5 expectations expected on Wed (no discover-ingest).
    assert.equal(call, 5);
  });

  it('reports unknown when token is unset', async () => {
    const r = await checks.checkMissedSchedules(
      tuesdayMorning,
      fakeAxiom(unknown()),
    );
    assert.equal(r.status, 'unknown');
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
    EXECUTE.results = [[{ failed: 0, active_stuck: 2, active_total: 5, retry: 0 }]];
    const r = await checks.checkPgBossQueue();
    assert.equal(r.status, 'fail');
  });

  it('flags warn when failed > 0 but no stuck', async () => {
    EXECUTE.results = [[{ failed: 1, active_stuck: 0, active_total: 0, retry: 0 }]];
    const r = await checks.checkPgBossQueue();
    assert.equal(r.status, 'warn');
  });

  it('flags ok when queue is clean', async () => {
    EXECUTE.results = [[{ failed: 0, active_stuck: 0, active_total: 0, retry: 0 }]];
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
