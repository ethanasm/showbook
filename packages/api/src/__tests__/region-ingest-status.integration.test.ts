/**
 * Integration test for isRegionIngestPending against the live pgboss schema.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/region-ingest-status.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, sql } from '@showbook/db';
import { isRegionIngestPending, JOB_NAMES } from '../job-queue';

const REGION_ID = '00000000-0000-0000-0000-0000000000aa';

async function ensurePartitionExists() {
  // pg-boss partitions the job table by name. Create the partition for our
  // job name if it doesn't exist yet, so we can insert directly.
  // pg-boss creates these on first send; we mimic that here.
  await db.execute(
    sql`SELECT pgboss.create_queue(${JOB_NAMES.INGEST_REGION}, NULL)`,
  );
}

async function clearTestJobs() {
  await db.execute(
    sql`DELETE FROM pgboss.job
        WHERE name = ${JOB_NAMES.INGEST_REGION}
        AND data->>'regionId' = ${REGION_ID}`,
  );
}

// Skip when pgboss schema isn't installed on the target DB (eg. fresh
// showbook_e2e). The job-queue helper itself works without pgboss
// because it queries the table by name and short-circuits on errors.
let pgbossAvailable = false;

describe('isRegionIngestPending', () => {
  before(async () => {
    try {
      await db.execute(sql`SELECT 1 FROM pgboss.job LIMIT 1`);
      pgbossAvailable = true;
    } catch {
      pgbossAvailable = false;
      return;
    }
    try {
      await ensurePartitionExists();
    } catch (e) {
      void e;
    }
    await clearTestJobs();
  });

  after(async () => {
    if (!pgbossAvailable) return;
    await clearTestJobs();
  });

  it('returns false when no job exists for the region', async (t) => {
    if (!pgbossAvailable) return t.skip('pgboss schema not installed');
    const pending = await isRegionIngestPending(REGION_ID);
    assert.equal(pending, false);
  });

  it('returns true when a job is in created state', async (t) => {
    if (!pgbossAvailable) return t.skip('pgboss schema not installed');
    await db.execute(
      sql`INSERT INTO pgboss.job (name, data, state)
          VALUES (${JOB_NAMES.INGEST_REGION},
                  jsonb_build_object('regionId', ${REGION_ID}::text),
                  'created')`,
    );
    const pending = await isRegionIngestPending(REGION_ID);
    assert.equal(pending, true);
    await clearTestJobs();
  });

  it('returns true when a job is in active state', async (t) => {
    if (!pgbossAvailable) return t.skip('pgboss schema not installed');
    await db.execute(
      sql`INSERT INTO pgboss.job (name, data, state)
          VALUES (${JOB_NAMES.INGEST_REGION},
                  jsonb_build_object('regionId', ${REGION_ID}::text),
                  'active')`,
    );
    const pending = await isRegionIngestPending(REGION_ID);
    assert.equal(pending, true);
    await clearTestJobs();
  });

  it('returns false when only completed/failed jobs exist', async (t) => {
    if (!pgbossAvailable) return t.skip('pgboss schema not installed');
    await db.execute(
      sql`INSERT INTO pgboss.job (name, data, state)
          VALUES (${JOB_NAMES.INGEST_REGION},
                  jsonb_build_object('regionId', ${REGION_ID}::text),
                  'completed'),
                 (${JOB_NAMES.INGEST_REGION},
                  jsonb_build_object('regionId', ${REGION_ID}::text),
                  'failed')`,
    );
    const pending = await isRegionIngestPending(REGION_ID);
    assert.equal(pending, false);
    await clearTestJobs();
  });

  it('does not match jobs for different regionIds', async (t) => {
    if (!pgbossAvailable) return t.skip('pgboss schema not installed');
    await db.execute(
      sql`INSERT INTO pgboss.job (name, data, state)
          VALUES (${JOB_NAMES.INGEST_REGION},
                  jsonb_build_object('regionId', '11111111-1111-1111-1111-111111111111'::text),
                  'created')`,
    );
    const pending = await isRegionIngestPending(REGION_ID);
    assert.equal(pending, false);
    await db.execute(
      sql`DELETE FROM pgboss.job
          WHERE name = ${JOB_NAMES.INGEST_REGION}
          AND data->>'regionId' = '11111111-1111-1111-1111-111111111111'`,
    );
  });
});
