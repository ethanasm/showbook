import { PgBoss, type StopOptions } from 'pg-boss';
import { child } from '@showbook/observability';

const log = child({ component: 'jobs.boss' });

// Back the pg-boss singleton + lifecycle flag with `globalThis` so every
// transpiled copy of this module shares one instance. `@showbook/jobs` is
// listed in the web app's `transpilePackages`, so Next bundles this file
// separately into the `instrumentation.ts` entry (which calls `startBoss()`
// and registers the crons) and into each route-handler entry (e.g.
// `/api/health/ready`, which calls `getBossState()`). Plain module-level
// `let`s give each bundle its own copy: instrumentation flips its `started`
// to true while the readiness route keeps reading `false` from its copy, so
// the probe returns 503 forever and the deploy health gate rolls back even
// though pg-boss is actually running. A `globalThis`-keyed holder collapses
// those copies onto one shared object in every environment (not just dev —
// the cross-bundle sharing is precisely what prod needs here).
const globalForBoss = globalThis as unknown as {
  __showbookBoss?: { boss: PgBoss | null; started: boolean };
};

const state = (globalForBoss.__showbookBoss ??= { boss: null, started: false });

export function getBoss(): PgBoss {
  if (!state.boss) {
    // pg-boss v12 removed the boss-level `archiveCompletedAfterSeconds`
    // / `deleteAfterDays` knobs along with the archive table itself;
    // retention is now per-queue via `deleteAfterSeconds` (default 7 d,
    // which matches what we used to set). Per-queue retry / expire
    // options live in `registry.ts` (`QUEUE_OPTIONS`) because
    // constructor-level values don't reach queues created via
    // `createQueue` (plans.js create_queue inserts the queue row from
    // the options arg).
    state.boss = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
    });
  }
  return state.boss;
}

export async function startBoss(): Promise<PgBoss> {
  const b = getBoss();
  await b.start();
  state.started = true;
  log.info({ event: 'pgboss.started' }, 'pg-boss started');
  return b;
}

export async function stopBoss(options?: StopOptions): Promise<void> {
  if (state.boss) {
    await state.boss.stop(options);
    state.boss = null;
    state.started = false;
    log.info({ event: 'pgboss.stopped' }, 'pg-boss stopped');
  }
}

/**
 * Lifecycle introspection for the readiness probe. Returns `started`
 * iff `startBoss()` has resolved and `stopBoss()` hasn't yet been
 * called. Crucially this does **not** force `getBoss()` to instantiate
 * a new PgBoss — the readiness endpoint should never trigger startup
 * as a side effect of probing.
 */
export function getBossState(): 'started' | 'stopped' {
  return state.started ? 'started' : 'stopped';
}
