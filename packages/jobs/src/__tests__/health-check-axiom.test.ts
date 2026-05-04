/**
 * Unit tests for the Axiom APL helper. We mock `fetch` so the test
 * runs offline and doesn't need a real query token.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { queryAxiom, _testing } from '../health-check/axiom';

interface FakeRow extends Record<string, unknown> {
  cnt: number;
  event: string;
}

const ORIGINAL_FETCH = globalThis.fetch;

function installFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = mock.fn(async (url: string | URL, init?: RequestInit) => {
    return handler(typeof url === 'string' ? url : url.toString(), init ?? {});
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  delete process.env.AXIOM_QUERY_TOKEN;
  delete process.env.AXIOM_ORG_ID;
  delete process.env.AXIOM_QUERY_DATASET;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('queryAxiom', () => {
  it('skips when AXIOM_QUERY_TOKEN is unset', async () => {
    let called = false;
    installFetch(() => {
      called = true;
      return new Response('{}', { status: 200 });
    });

    const result = await queryAxiom<FakeRow>('["x"] | summarize cnt = count()');
    assert.equal(result.skipped, true);
    assert.equal(result.ok, false);
    assert.equal(result.rows, null);
    assert.equal(called, false);
  });

  it('returns parsed rows on a successful tabular response', async () => {
    process.env.AXIOM_QUERY_TOKEN = 'tok-abc';
    let captured: { url: string; init: RequestInit } | null = null;
    installFetch((url, init) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          format: 'tabular',
          tables: [
            {
              fields: [
                { name: 'event', type: 'string' },
                { name: 'cnt', type: 'long' },
              ],
              columns: [
                ['job.failed', 'tm.request.failed'],
                [3, 1],
              ],
            },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await queryAxiom<FakeRow>(
      '["showbook-prod"] | where event in ("job.failed","tm.request.failed") | summarize cnt = count() by event',
    );

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.deepEqual(result.rows, [
      { event: 'job.failed', cnt: 3 },
      { event: 'tm.request.failed', cnt: 1 },
    ]);

    const captured2 = captured as unknown as { url: string; init: RequestInit };
    assert.ok(captured2, 'fetch must be called');
    assert.equal(captured2.init.method, 'POST');
    const headers = captured2.init.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer tok-abc');
    assert.equal(headers['X-AXIOM-ORG-ID'], 'showbook-egap');
    assert.match(captured2.url, /api\.axiom\.co\/v1\/datasets\/_apl/);
    const body = JSON.parse(captured2.init.body as string);
    assert.equal(typeof body.apl, 'string');
  });

  it('reports an http error without throwing', async () => {
    process.env.AXIOM_QUERY_TOKEN = 'tok-abc';
    installFetch(
      () => new Response('forbidden', { status: 403 }),
    );

    const result = await queryAxiom<FakeRow>('["x"]');
    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    assert.equal(result.rows, null);
    assert.match(result.error ?? '', /403/);
  });

  it('reports a network error without throwing', async () => {
    process.env.AXIOM_QUERY_TOKEN = 'tok-abc';
    installFetch(() => {
      throw new Error('connect ECONNREFUSED');
    });

    const result = await queryAxiom<FakeRow>('["x"]');
    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    assert.equal(result.rows, null);
    assert.match(result.error ?? '', /ECONNREFUSED/);
  });

  it('respects org id and dataset env overrides', async () => {
    process.env.AXIOM_QUERY_TOKEN = 'tok-abc';
    process.env.AXIOM_ORG_ID = 'custom-org';
    let captured: { url: string; init: RequestInit } | null = null;
    installFetch((url, init) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({ tables: [{ fields: [], columns: [] }] }),
        { status: 200 },
      );
    });

    await queryAxiom<FakeRow>('["x"]');
    const captured2 = captured as unknown as { url: string; init: RequestInit };
    assert.ok(captured2);
    const headers = captured2.init.headers as Record<string, string>;
    assert.equal(headers['X-AXIOM-ORG-ID'], 'custom-org');
  });

  it('handles tabular responses with no tables gracefully', () => {
    const rows = _testing.tabularToRows<FakeRow>({});
    assert.deepEqual(rows, []);
  });
});
