import PgBoss from 'pg-boss';

let boss: PgBoss | null = null;

export function getBoss(): PgBoss {
  if (!boss) {
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInHours: 24,
      archiveCompletedAfterSeconds: 86400,
      deleteAfterDays: 7,
    });
  }
  return boss;
}

export async function startBoss(): Promise<PgBoss> {
  const b = getBoss();
  await b.start();
  console.log('pg-boss started');
  return b;
}

export async function stopBoss(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
    console.log('pg-boss stopped');
  }
}
