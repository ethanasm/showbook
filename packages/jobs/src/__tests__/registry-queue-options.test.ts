/**
 * Unit tests for queue-option registration.
 *
 * pg-boss v10 sets `expire_seconds`, `retry_limit`, `retry_delay` and
 * `retry_backoff` on the `pgboss.queue` row at INSERT time inside the
 * `create_queue` SQL function (see node_modules/pg-boss/src/plans.js).
 * Constructor-level options are not propagated, and `create_queue`
 * uses `ON CONFLICT DO NOTHING`, so an existing queue keeps whatever
 * options it was first created with. registerAllJobs has to call BOTH
 * `createQueue` (to seed new envs) and `updateQueue` (to fix already-
 * provisioned prod queues) for every queue, with the right options.
 *
 * If this test ever drops to default `expireInSeconds`, the bug from
 * the Tuesday-night Spotify import (15 min stuck "still importing"
 * bullets) is back.
 *
 * Run with:
 *   GROQ_API_KEY=test pnpm --filter @showbook/jobs exec node \
 *     --import tsx --test src/__tests__/registry-queue-options.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerAllJobs, JOBS } from '../registry';

type Call = { name: string; opts: unknown };

function makeFakeBoss() {
  const created: Call[] = [];
  const updated: Call[] = [];
  const workCalls: Array<{ name: string }> = [];
  const fakeBoss = {
    unschedule: async () => {},
    createQueue: async (name: string, opts: unknown) => {
      created.push({ name, opts });
    },
    updateQueue: async (name: string, opts: unknown) => {
      updated.push({ name, opts });
    },
    work: async (name: string) => {
      workCalls.push({ name });
      return 'worker-id';
    },
    schedule: async () => {},
  };
  return { fakeBoss, created, updated, workCalls };
}

describe('registerAllJobs queue options', () => {
  it('creates AND updates every queue with explicit retry + expire options', async () => {
    const { fakeBoss, created, updated } = makeFakeBoss();

    await registerAllJobs(fakeBoss as never);

    const expectedNames = Object.values(JOBS).sort();
    assert.deepEqual(
      created.map((c) => c.name).sort(),
      expectedNames,
      'createQueue called for every JOBS entry',
    );
    assert.deepEqual(
      updated.map((c) => c.name).sort(),
      expectedNames,
      'updateQueue called for every JOBS entry — required because create_queue is ON CONFLICT DO NOTHING',
    );
  });

  it('sets fast-ingest options on user-triggered ingest queues', async () => {
    const { fakeBoss, created, updated } = makeFakeBoss();
    await registerAllJobs(fakeBoss as never);

    const fastQueues = [
      JOBS.DISCOVER_INGEST_VENUE,
      JOBS.DISCOVER_INGEST_PERFORMER,
      JOBS.DISCOVER_INGEST_REGION,
    ];

    for (const name of fastQueues) {
      const c = created.find((x) => x.name === name);
      const u = updated.find((x) => x.name === name);
      assert.ok(c, `createQueue called for ${name}`);
      assert.ok(u, `updateQueue called for ${name}`);
      const opts = c!.opts as Record<string, unknown>;
      assert.equal(opts.expireInSeconds, 300, `${name}: expireInSeconds = 300 (5 min)`);
      assert.equal(opts.retryLimit, 3, `${name}: retryLimit = 3`);
      assert.equal(opts.retryDelay, 60, `${name}: retryDelay = 60`);
      assert.equal(opts.retryBackoff, true, `${name}: retryBackoff = true`);
      const uOpts = u!.opts as Record<string, unknown>;
      assert.equal(uOpts.expireInSeconds, opts.expireInSeconds);
      assert.equal(uOpts.retryLimit, opts.retryLimit);
      assert.equal(uOpts.retryDelay, opts.retryDelay);
      assert.equal(uOpts.retryBackoff, opts.retryBackoff);
    }
  });

  it('sets long-batch options on scheduled / batch queues', async () => {
    const { fakeBoss, created } = makeFakeBoss();
    await registerAllJobs(fakeBoss as never);

    const longQueues = [
      JOBS.SHOWS_NIGHTLY,
      JOBS.SETLIST_RETRY,
      JOBS.DISCOVER_INGEST,
      JOBS.NOTIFICATIONS_DAILY_DIGEST,
      JOBS.BACKFILL_PERFORMER_IMAGES,
      JOBS.BACKFILL_PERFORMER_MBIDS,
      JOBS.BACKFILL_PERFORMER_SPOTIFY_IDS,
      JOBS.BACKFILL_VENUE_PHOTOS,
      JOBS.PRUNE_ORPHAN_CATALOG,
      JOBS.PRUNE_NIGHTLY,
      JOBS.BACKFILL_PERFORMER_IDS,
      JOBS.HEALTH_CHECK,
    ];

    for (const name of longQueues) {
      const c = created.find((x) => x.name === name);
      assert.ok(c, `createQueue called for ${name}`);
      const opts = c!.opts as Record<string, unknown>;
      assert.equal(opts.expireInSeconds, 1800, `${name}: expireInSeconds = 1800 (30 min)`);
      assert.equal(opts.retryLimit, 2, `${name}: retryLimit = 2`);
      assert.equal(opts.retryDelay, 300, `${name}: retryDelay = 300`);
      assert.equal(opts.retryBackoff, true, `${name}: retryBackoff = true`);
    }
  });

  it('applies singleton policy to every cron-driven queue', async () => {
    // Belt-and-suspenders against duplicate cron firings. If `boss.schedule`
    // ever runs from more than one process (HMR re-register, future
    // multi-replica) the singleton queue policy rejects the second
    // `boss.send` at INSERT time. Also prevents a slow cron (e.g. a
    // 75-min digest) from piling up tomorrow's run behind itself.
    const { fakeBoss, created, updated } = makeFakeBoss();
    await registerAllJobs(fakeBoss as never);

    const cronQueues = [
      JOBS.SHOWS_NIGHTLY,
      JOBS.SETLIST_RETRY,
      JOBS.DISCOVER_INGEST,
      JOBS.NOTIFICATIONS_DAILY_DIGEST,
      JOBS.BACKFILL_PERFORMER_IMAGES,
      JOBS.BACKFILL_PERFORMER_MBIDS,
      JOBS.BACKFILL_PERFORMER_SPOTIFY_IDS,
      JOBS.BACKFILL_VENUE_PHOTOS,
      JOBS.BACKFILL_SHOW_COVER_IMAGES,
      JOBS.PRUNE_ORPHAN_CATALOG,
      JOBS.PRUNE_NIGHTLY,
      JOBS.BACKFILL_PERFORMER_IDS,
      JOBS.HEALTH_CHECK,
      JOBS.SETLIST_CORPUS_FILL_REFRESH,
      JOBS.EVAL_RUN_DAILY_BACKTEST,
      JOBS.SETLIST_STYLE_REFRESH,
      JOBS.SPOTIFY_RECENTLY_PLAYED,
      JOBS.YEAR_END_SOUNDTRACK,
    ];

    for (const name of cronQueues) {
      const c = created.find((x) => x.name === name);
      const u = updated.find((x) => x.name === name);
      assert.ok(c, `createQueue called for ${name}`);
      assert.ok(u, `updateQueue called for ${name}`);
      const opts = c!.opts as Record<string, unknown>;
      assert.equal(opts.policy, 'singleton', `${name}: policy = 'singleton'`);
      // policy is intentionally stripped from the update payload — see
      // the "strips policy + name from the updateQueue payload" test
      // below for why.
    }
  });

  it('strips policy + name from the updateQueue payload (pg-boss v12 compat)', async () => {
    // pg-boss v12 codifies the immutable-on-update fields at the type
    // level (`UpdateQueueOptions = Omit<Queue, 'name' | 'partition' |
    // 'policy'>`) and `Manager.updateQueue` throws "queue policy
    // cannot be changed after creation" at runtime if `policy` slips
    // through. Stripping both lets the rest of the updatable options
    // (retryLimit / retryDelay / retryBackoff / expireInSeconds)
    // still get re-applied on every boot.
    const { fakeBoss, updated } = makeFakeBoss();
    await registerAllJobs(fakeBoss as never);

    for (const u of updated) {
      const opts = u.opts as Record<string, unknown>;
      assert.equal(
        opts.policy,
        undefined,
        `${u.name}: policy must NOT appear on updateQueue (pg-boss v12 rejects it)`,
      );
      assert.equal(
        opts.name,
        undefined,
        `${u.name}: name must NOT appear on updateQueue payload (v12 UpdateQueueOptions omits it)`,
      );
    }
  });

  it('leaves user-triggered queues on the default policy', async () => {
    // The user-triggered queues (follow → ingest, refresh-now, per-
    // performer corpus fill) must allow parallel jobs for different
    // IDs. Singleton would serialize every Spotify import to one
    // performer at a time.
    const { fakeBoss, created } = makeFakeBoss();
    await registerAllJobs(fakeBoss as never);

    const parallelQueues = [
      JOBS.DISCOVER_INGEST_VENUE,
      JOBS.DISCOVER_INGEST_PERFORMER,
      JOBS.DISCOVER_INGEST_REGION,
      JOBS.SETLIST_CORPUS_FILL,
      JOBS.SONG_INDEX_REBUILD,
    ];

    for (const name of parallelQueues) {
      const c = created.find((x) => x.name === name);
      assert.ok(c, `createQueue called for ${name}`);
      const opts = c!.opts as Record<string, unknown>;
      assert.notEqual(
        opts.policy,
        'singleton',
        `${name}: must allow parallel jobs across different IDs`,
      );
    }
  });

  it('never falls back to pg-boss defaults (expireInSeconds undefined would mean 15 min)', async () => {
    const { fakeBoss, created, updated } = makeFakeBoss();
    await registerAllJobs(fakeBoss as never);

    for (const c of [...created, ...updated]) {
      const opts = c.opts as Record<string, unknown> | undefined;
      assert.ok(opts, `${c.name}: opts must be defined (omitting them re-introduces the 15-min default)`);
      assert.equal(typeof opts.expireInSeconds, 'number', `${c.name}: expireInSeconds is set explicitly`);
    }
  });

  it('is idempotent against the same boss instance — second call adds zero workers', async () => {
    // Regression for the prod symptom: every scheduled cron firing
    // produces two `job.start` events with two distinct jobIds, only
    // one DB row per firing, "missing" jobIds absent from
    // `pgboss.archive`. Shape matches a doubled `boss.work` worker
    // pool. Whatever invokes `register()` twice in prod, the guard
    // keeps the second call from doubling the worker count.
    const { fakeBoss, workCalls, created, updated } = makeFakeBoss();
    await registerAllJobs(fakeBoss as never);
    const workCallsAfterFirst = workCalls.length;
    const createdAfterFirst = created.length;
    const updatedAfterFirst = updated.length;

    await registerAllJobs(fakeBoss as never);

    assert.equal(
      workCalls.length,
      workCallsAfterFirst,
      'second registerAllJobs must not call boss.work again',
    );
    assert.equal(
      created.length,
      createdAfterFirst,
      'second registerAllJobs must not re-create queues',
    );
    assert.equal(
      updated.length,
      updatedAfterFirst,
      'second registerAllJobs must not re-update queues',
    );
  });
});
