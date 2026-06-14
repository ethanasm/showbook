import { PgBoss, type StopOptions } from 'pg-boss';
import { child } from '@showbook/observability';

const log = child({ component: 'jobs.boss' });

// Next.js compiles `instrumentation.ts` and the app/route-handler code as
// separate module graphs, and `@showbook/jobs` is `transpilePackages`'d
// (bundled per-consumer) rather than listed in `serverExternalPackages`.
// So *this module is duplicated*: the copy `startBoss()` runs in (the
// instrumentation graph, where boot happens) is NOT the copy
// `getBossState()` runs in (the route-handler graph, where the readiness
// probe lives). A plain module-level `let started` set during boot is
// therefore invisible to `/api/health/ready`, which read its own copy's
// perpetually-`false` flag and returned 503 forever — failing the
// post-deploy health gate on every deploy since it was introduced.
//
// `pg-boss` itself is externalized, so there's one PgBoss class in the
// process; only this wrapper's state was getting cloned. Anchor that
// state on `globalThis` (keyed by a process-wide registry symbol) so
// every duplicated copy of this module shares one boss instance + one
// `started` flag.
const STATE_KEY = Symbol.for('showbook.jobs.boss');

interface BossState {
  boss: PgBoss | null;
  started: boolean;
}

function bossState(): BossState {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: BossState };
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = { boss: null, started: false };
  }
  return g[STATE_KEY];
}

export function getBoss(): PgBoss {
  const state = bossState();
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
  bossState().started = true;
  log.info({ event: 'pgboss.started' }, 'pg-boss started');
  return b;
}

export async function stopBoss(options?: StopOptions): Promise<void> {
  const state = bossState();
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
 * as a side effect of probing. State is read from the `globalThis`
 * anchor so the route-handler module copy sees what the instrumentation
 * copy set at boot (see the module-graph note above).
 */
export function getBossState(): 'started' | 'stopped' {
  return bossState().started ? 'started' : 'stopped';
}
