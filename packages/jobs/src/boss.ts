import PgBoss from 'pg-boss';
import { child } from '@showbook/observability';

const log = child({ component: 'jobs.boss' });

let boss: PgBoss | null = null;
let started = false;

export function getBoss(): PgBoss {
  if (!boss) {
    // pg-boss v12 removed the boss-level `archiveCompletedAfterSeconds`
    // / `deleteAfterDays` knobs along with the archive table itself;
    // retention is now per-queue via `deleteAfterSeconds` (default 7 d,
    // which matches what we used to set). Per-queue retry / expire
    // options live in `registry.ts` (`QUEUE_OPTIONS`) because
    // constructor-level values don't reach queues created via
    // `createQueue` (plans.js create_queue inserts the queue row from
    // the options arg).
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
    });
  }
  return boss;
}

export async function startBoss(): Promise<PgBoss> {
  const b = getBoss();
  await b.start();
  started = true;
  log.info({ event: 'pgboss.started' }, 'pg-boss started');
  return b;
}

export async function stopBoss(options?: PgBoss.StopOptions): Promise<void> {
  if (boss) {
    await boss.stop(options);
    boss = null;
    started = false;
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
  return started ? 'started' : 'stopped';
}
