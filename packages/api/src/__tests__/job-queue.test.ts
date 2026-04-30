/**
 * Unit tests for job-queue.ts. Covers the success and failure branches of
 * each enqueue helper plus isRegionIngestPending without touching pg-boss
 * or Postgres. The pg-boss singleton is pre-populated on globalThis so
 * getSender() returns a fake; the db.execute used by isRegionIngestPending
 * is monkey-patched per test.
 *
 * Run with:
 *   pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/job-queue.test.ts
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Provide a DATABASE_URL so the @showbook/db client can be imported without
// blowing up. We never make real queries — db.execute is patched per test.
process.env.DATABASE_URL ??= 'postgresql://x:x@127.0.0.1:1/x';

type FakeBoss = {
  send: (queue: string, payload: unknown) => Promise<string | null>;
  start: () => Promise<void>;
};

type Globals = {
  __showbookBoss?: FakeBoss;
  __showbookBossStarting?: Promise<FakeBoss>;
};

const globals = globalThis as unknown as Globals;

// Capture sends so we can assert on them.
let lastSent: { queue: string; payload: unknown } | null = null;
let nextSendResult: string | null = 'job-id-1';
let shouldThrow: Error | null = null;

function installFakeBoss() {
  lastSent = null;
  nextSendResult = 'job-id-1';
  shouldThrow = null;
  globals.__showbookBoss = {
    async send(queue: string, payload: unknown) {
      if (shouldThrow) throw shouldThrow;
      lastSent = { queue, payload };
      return nextSendResult;
    },
    async start() {},
  };
  delete globals.__showbookBossStarting;
}

function clearFakeBoss() {
  delete globals.__showbookBoss;
  delete globals.__showbookBossStarting;
}

// Import after the fake is installable. We import dynamically inside the
// tests so the module picks up our pre-populated globalThis.__showbookBoss.
// (Static imports here would also work because getSender is called per
// invocation and reads globalThis at that point, but doing it in the test
// keeps the dependency on the module ordering explicit.)
let mod: typeof import('../job-queue');
let db: typeof import('@showbook/db').db;
beforeEach(async () => {
  installFakeBoss();
  if (!mod) mod = await import('../job-queue');
  if (!db) ({ db } = await import('@showbook/db'));
});

afterEach(() => {
  clearFakeBoss();
});

// ── enqueueIngestVenue ────────────────────────────────────────────────

test('enqueueIngestVenue: sends job with venueId payload', async () => {
  await mod.enqueueIngestVenue('venue-42');
  assert.equal(lastSent?.queue, mod.JOB_NAMES.INGEST_VENUE);
  assert.deepEqual(lastSent?.payload, { venueId: 'venue-42' });
});

test('enqueueIngestVenue: swallows errors and resolves', async () => {
  shouldThrow = new Error('queue down');
  // Should not reject — the helper logs and returns void.
  await mod.enqueueIngestVenue('venue-err');
  assert.equal(lastSent, null);
});

// ── enqueueIngestPerformer ────────────────────────────────────────────

test('enqueueIngestPerformer: sends job with performerId payload', async () => {
  await mod.enqueueIngestPerformer('perf-7');
  assert.equal(lastSent?.queue, mod.JOB_NAMES.INGEST_PERFORMER);
  assert.deepEqual(lastSent?.payload, { performerId: 'perf-7' });
});

test('enqueueIngestPerformer: swallows errors and resolves', async () => {
  shouldThrow = new Error('boss broken');
  await mod.enqueueIngestPerformer('perf-x');
  assert.equal(lastSent, null);
});

// ── enqueueIngestRegion ───────────────────────────────────────────────

test('enqueueIngestRegion: returns job id from boss.send on success', async () => {
  nextSendResult = 'abc-123';
  const id = await mod.enqueueIngestRegion('region-1');
  assert.equal(id, 'abc-123');
  assert.equal(lastSent?.queue, mod.JOB_NAMES.INGEST_REGION);
  assert.deepEqual(lastSent?.payload, { regionId: 'region-1' });
});

test('enqueueIngestRegion: passes through null result', async () => {
  nextSendResult = null;
  const id = await mod.enqueueIngestRegion('region-2');
  assert.equal(id, null);
});

test('enqueueIngestRegion: returns null on send failure', async () => {
  shouldThrow = new Error('nope');
  const id = await mod.enqueueIngestRegion('region-3');
  assert.equal(id, null);
});

// ── isRegionIngestPending ─────────────────────────────────────────────

test('isRegionIngestPending: true when execute returns rows', async () => {
  const original = db.execute;
  (db as unknown as { execute: unknown }).execute = async () =>
    [{ '?column?': 1 }] as unknown as ReturnType<typeof db.execute>;
  try {
    const pending = await mod.isRegionIngestPending('region-a');
    assert.equal(pending, true);
  } finally {
    (db as unknown as { execute: unknown }).execute = original;
  }
});

test('isRegionIngestPending: false when execute returns no rows', async () => {
  const original = db.execute;
  (db as unknown as { execute: unknown }).execute = async () =>
    [] as unknown as ReturnType<typeof db.execute>;
  try {
    const pending = await mod.isRegionIngestPending('region-b');
    assert.equal(pending, false);
  } finally {
    (db as unknown as { execute: unknown }).execute = original;
  }
});

test('isRegionIngestPending: false on db error (logs and short-circuits)', async () => {
  const original = db.execute;
  (db as unknown as { execute: unknown }).execute = async () => {
    throw new Error('pgboss schema missing');
  };
  try {
    const pending = await mod.isRegionIngestPending('region-c');
    assert.equal(pending, false);
  } finally {
    (db as unknown as { execute: unknown }).execute = original;
  }
});

// ── getSender caching path (covers the IIFE's "starting" branch) ──────

test('getSender: reuses the in-flight starting promise when called twice', async () => {
  // Force the starting branch by clearing both the cached instance and any
  // prior starting promise, then setting a starting promise that resolves
  // to a fake. Both enqueue calls should resolve through the same promise.
  delete globals.__showbookBoss;
  let resolveStart: (b: FakeBoss) => void = () => {};
  const started = new Promise<FakeBoss>((res) => {
    resolveStart = res;
  });
  globals.__showbookBossStarting = started;

  const calls: Array<{ queue: string; payload: unknown }> = [];
  const fake: FakeBoss = {
    async send(queue, payload) {
      calls.push({ queue, payload });
      return 'ok';
    },
    async start() {},
  };

  // Kick off two enqueues that will await the starting promise.
  const p1 = mod.enqueueIngestVenue('v-1');
  const p2 = mod.enqueueIngestPerformer('p-1');
  // Resolve the starting promise after both calls are awaiting.
  resolveStart(fake);
  await Promise.all([p1, p2]);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { queue: mod.JOB_NAMES.INGEST_VENUE, payload: { venueId: 'v-1' } });
  assert.deepEqual(calls[1], { queue: mod.JOB_NAMES.INGEST_PERFORMER, payload: { performerId: 'p-1' } });
});
