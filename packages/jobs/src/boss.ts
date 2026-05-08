import PgBoss from 'pg-boss';
import { child } from '@showbook/observability';

const log = child({ component: 'jobs.boss' });

let boss: PgBoss | null = null;

export function getBoss(): PgBoss {
  if (!boss) {
    // pg-boss v10 ignores constructor-level retry / expiration options
    // when queues are created via `createQueue` — those land on the
    // queue row at INSERT time and the constructor values never reach
    // them (plans.js, create_queue function). Per-queue retry/expire
    // options live in `registry.ts` (`QUEUE_OPTIONS`); only options
    // that genuinely apply at the boss level belong here.
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      archiveCompletedAfterSeconds: 86400,
      deleteAfterDays: 7,
    });
  }
  return boss;
}

export async function startBoss(): Promise<PgBoss> {
  const b = getBoss();
  await b.start();
  log.info({ event: 'pgboss.started' }, 'pg-boss started');
  return b;
}

export async function stopBoss(options?: PgBoss.StopOptions): Promise<void> {
  if (boss) {
    await boss.stop(options);
    boss = null;
    log.info({ event: 'pgboss.stopped' }, 'pg-boss stopped');
  }
}
