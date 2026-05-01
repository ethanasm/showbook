/**
 * Integration tests for upsertUserFromGoogle in apps/web/lib/mobile-token.ts.
 *
 * These tests require a real Postgres database (the showbook_e2e database).
 * They are excluded from the unit-test glob and run via:
 *   pnpm test:integration
 * which sets DATABASE_URL to the e2e database.
 *
 * Skip gracefully when DATABASE_URL is not set so local development without
 * a running database doesn't break.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, accounts, users, eq, and } from '@showbook/db';
import { sql } from 'drizzle-orm';
import { upsertUserFromGoogle } from '../../lib/mobile-token';

const HAS_DB = Boolean(process.env.DATABASE_URL);

/**
 * Wrap a hook in a wall-clock timeout. Node's --test-timeout only applies to
 * `it()` callbacks; DB-touching `before`/`after` hooks can hang otherwise.
 */
async function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Hook exceeded ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Test prefix for deterministic cleanup
// ---------------------------------------------------------------------------
const PREFIX = 'mtit-'; // mobile-token integration test

async function cleanupTestRows() {
  const p = `${PREFIX}%`;
  // accounts reference users via FK (ON DELETE CASCADE), but we delete
  // accounts first via the providerAccountId prefix to be explicit.
  await db.execute(
    sql`DELETE FROM accounts WHERE provider_account_id LIKE ${p}`,
  );
  // Delete any remaining users whose email matches our test prefix.
  // Some may be "loser" users from concurrent tests (no accounts row).
  await db.execute(
    sql`DELETE FROM users WHERE email LIKE ${p}`,
  );
}

function makeGoogleSub(suffix: string) {
  return `${PREFIX}${suffix}`;
}

function makeEmail(suffix: string) {
  return `${PREFIX}${suffix}@test.local`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('upsertUserFromGoogle — integration', { skip: !HAS_DB }, () => {
  before(async () => {
    await withTimeout(10_000, cleanupTestRows);
  });

  after(async () => {
    await withTimeout(10_000, cleanupTestRows);
  });

  it('sequential first-login then second-login returns the same userId, no duplicate rows', async () => {
    const googleSub = makeGoogleSub('seq-001');
    const email = makeEmail('seq-001');

    const result1 = await upsertUserFromGoogle({
      googleSub,
      email,
      name: 'Seq User',
      image: null,
      emailVerified: true,
    });

    const result2 = await upsertUserFromGoogle({
      googleSub,
      email,
      name: 'Seq User',
      image: null,
      emailVerified: true,
    });

    assert.equal(result1.id, result2.id, 'both calls should return the same userId');

    // Verify exactly one users row and one accounts row
    const userRows = await db.select().from(users).where(eq(users.id, result1.id));
    assert.equal(userRows.length, 1, 'exactly one users row');

    const accountRows = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.provider, 'google'),
          eq(accounts.providerAccountId, googleSub),
        ),
      );
    assert.equal(accountRows.length, 1, 'exactly one accounts row');
    assert.equal(accountRows[0]!.userId, result1.id, 'accounts row points at correct user');
  });

  it('concurrent first-logins for the same googleSub result in exactly one accounts row', async () => {
    const googleSub = makeGoogleSub('conc-001');
    const email = makeEmail('conc-001');

    // Fire two upsertUserFromGoogle calls concurrently without awaiting between
    const [result1, result2] = await Promise.all([
      upsertUserFromGoogle({
        googleSub,
        email,
        name: 'Conc User',
        image: null,
        emailVerified: true,
      }),
      upsertUserFromGoogle({
        googleSub,
        email,
        name: 'Conc User',
        image: null,
        emailVerified: true,
      }),
    ]);

    // Both calls must have resolved to the same userId (whichever transaction won)
    assert.equal(result1.id, result2.id, 'concurrent calls must return the same userId');

    // Exactly one accounts row must exist for this google sub
    const accountRows = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.provider, 'google'),
          eq(accounts.providerAccountId, googleSub),
        ),
      );
    assert.equal(accountRows.length, 1, 'exactly one accounts row even under concurrency');

    // The winning accounts row must point at the winning user
    const winningUserId = accountRows[0]!.userId;
    assert.equal(result1.id, winningUserId, 'returned userId matches the accounts row userId');

    // NOTE: In the concurrent case, a "loser" users row may exist (no accounts
    // row pointing at it). That is expected and documented in the upsert
    // comment. We only assert there's no SECOND accounts row.
  });
});
