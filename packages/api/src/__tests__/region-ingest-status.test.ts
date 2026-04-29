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

describe('isRegionIngestPending', () => {
  before(async () => {
    try {
      await ensurePartitionExists();
    } catch (e) {
      // OK if the queue already exists.
      void e;
    }
    await clearTestJobs();
  });

  after(async () => {
    await clearTestJobs();
  });

  it('returns false when no job exists for the region', async () => {
    const pending = await isRegionIngestPending(REGION_ID);
    assert.equal(pending, false);
  });

  it('returns true when a job is in created state', async () => {
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

  it('returns true when a job is in active state', async () => {
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

  it('returns false when only completed/failed jobs exist', async () => {
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

  it('does not match jobs for different regionIds', async () => {
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
