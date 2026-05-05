/**
 * Integration test for the `showbook_query` Postgres role created by migration
 * 0027. This is the security boundary that protects `/api/admin/sql` from
 * exfiltrating OAuth refresh tokens / session material if `ADMIN_QUERY_TOKEN`
 * leaks: the engine itself refuses SELECT on the auth tables for this role,
 * regardless of what query the bearer-token holder sends.
 *
 * Strategy: connect as the role with a temporarily-set password, then assert
 * SELECTs against `accounts` / `sessions` / `verification_tokens` raise
 * SQLSTATE 42501 (`insufficient_privilege`), while a SELECT against `users`
 * succeeds.
 *
 * Skipped gracefully when `DATABASE_URL` isn't set (e.g. unit-test runs).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { db } from '@showbook/db';
import { sql } from 'drizzle-orm';

const HAS_DB = Boolean(process.env.DATABASE_URL);

const ROLE = 'showbook_query';
// Random per-run password so leftover state from a prior crashed run can't be
// reused. The password is reset at teardown.
const ROLE_PASSWORD = `testpw-${Math.random().toString(36).slice(2)}`;

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

function buildRoleUrl(): string {
  // Replace the userinfo segment of DATABASE_URL with showbook_query:<pw>.
  const original = new URL(process.env.DATABASE_URL!);
  original.username = ROLE;
  original.password = ROLE_PASSWORD;
  return original.toString();
}

describe('admin/sql showbook_query role', { skip: !HAS_DB }, () => {
  let roleClient: ReturnType<typeof postgres> | null = null;

  before(async () => {
    await withTimeout(15_000, async () => {
      // Verify migration 0027 ran — the role should exist.
      const exists = await db.execute(
        sql`SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}`,
      );
      assert.ok(
        exists.length > 0,
        `${ROLE} role missing — did migration 0027 run?`,
      );

      // Give the role LOGIN + a known password so the test can connect.
      await db.execute(
        sql.raw(
          `ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${ROLE_PASSWORD}'`,
        ),
      );
    });

    roleClient = postgres(buildRoleUrl(), { max: 1, idle_timeout: 5 });
  });

  after(async () => {
    await withTimeout(10_000, async () => {
      if (roleClient) await roleClient.end({ timeout: 5 });
      // Restore NOLOGIN so the role is inert outside this test, matching the
      // post-migration default.
      await db.execute(sql.raw(`ALTER ROLE ${ROLE} WITH NOLOGIN PASSWORD NULL`));
    });
  });

  it('can SELECT from non-sensitive tables (users)', async () => {
    // Just need it to not error. The row count is irrelevant; on a fresh test
    // DB it's likely zero.
    const rows = await roleClient!`SELECT id FROM users LIMIT 1`;
    assert.ok(Array.isArray(rows));
  });

  it('cannot SELECT from accounts (refresh tokens)', async () => {
    await assert.rejects(
      () => roleClient!`SELECT 1 FROM accounts LIMIT 1`,
      (err: unknown) => {
        const code = (err as { code?: string }).code;
        assert.equal(
          code,
          '42501',
          `expected 42501 (insufficient_privilege), got ${code}`,
        );
        return true;
      },
    );
  });

  it('cannot SELECT from sessions (live session tokens)', async () => {
    await assert.rejects(
      () => roleClient!`SELECT 1 FROM sessions LIMIT 1`,
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, '42501');
        return true;
      },
    );
  });

  it('cannot SELECT from verification_tokens', async () => {
    await assert.rejects(
      () => roleClient!`SELECT 1 FROM verification_tokens LIMIT 1`,
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, '42501');
        return true;
      },
    );
  });

  it('cannot INSERT/UPDATE/DELETE on any table', async () => {
    await assert.rejects(
      () => roleClient!`INSERT INTO users (id, email) VALUES ('x', 'y')`,
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, '42501');
        return true;
      },
    );
  });
});
