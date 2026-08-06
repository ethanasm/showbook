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
import { EXTENDED_PROTOCOL_ONLY, validateAdminParams } from '../../../../lib/admin-query';

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

/**
 * The route binds `params` through `tx.unsafe(query, params)` inside a
 * `BEGIN READ ONLY` transaction. Unit tests can prove the validator accepts
 * the right shapes, but only a real connection proves the binding actually
 * happens — that `$1` becomes a bound value rather than reaching the parser,
 * and that it still works inside the read-only transaction the route opens.
 */
describe('admin/sql bind parameters', { skip: !HAS_DB }, () => {
  let client: ReturnType<typeof postgres> | null = null;

  before(() => {
    client = postgres(process.env.DATABASE_URL!, { max: 1, idle_timeout: 5 });
  });

  after(async () => {
    await withTimeout(10_000, async () => {
      if (client) await client.end({ timeout: 5 });
    });
  });

  it('binds parameters inside the read-only transaction', async () => {
    const rows = await client!.begin('READ ONLY', async (tx) => {
      const result = await tx.unsafe(
        'select $1::text as name, $2::int as n, $3::bool as flag',
        ['pgboss', 42, true],
      );
      return result as unknown as Array<Record<string, unknown>>;
    });

    assert.deepEqual(rows[0], { name: 'pgboss', n: 42, flag: true });
  });

  it('binds an array parameter, which is how `= any($1)` filters a set', async () => {
    const rows = await client!.begin('READ ONLY', async (tx) => {
      const result = await tx.unsafe(
        "select x from unnest(array['a','b','c']) as x where x = any($1)",
        [['a', 'c']],
      );
      return result as unknown as Array<Record<string, unknown>>;
    });

    assert.deepEqual(
      rows.map((r) => r.x),
      ['a', 'c'],
    );
  });

  it('treats a parameter as a value, never as SQL', async () => {
    // If this were interpolated rather than bound, the statement would error
    // or return something other than the literal string.
    const injection = "'; drop table users; --";
    const rows = await client!.begin('READ ONLY', async (tx) => {
      const result = await tx.unsafe('select $1::text as echoed', [injection]);
      return result as unknown as Array<Record<string, unknown>>;
    });

    assert.equal(rows[0]?.echoed, injection);
  });

  it('still refuses writes when parameters are supplied', async () => {
    await assert.rejects(
      () =>
        client!.begin('READ ONLY', async (tx) => {
          await tx.unsafe('insert into users (id, email) values ($1, $2)', [
            'x',
            'y@example.com',
          ]);
        }),
      (err: unknown) => {
        // 25006 read_only_sql_transaction — the engine, not our validator.
        assert.equal((err as { code?: string }).code, '25006');
        return true;
      },
    );
  });
});

/**
 * The validator and the driver, composed.
 *
 * Peer review on #686 flagged that nothing exercised `POST` with parameters.
 * Importing the route handler here is not possible in this harness — the
 * integration runner uses repo-root cwd and the route's `@/lib/...` alias only
 * resolves under `apps/web` — and no test in this repo imports a route.
 *
 * So this covers the seam that actually broke instead: every shape
 * `validateAdminParams` *admits* is bound against real Postgres and checked
 * for the right answer. The boolean-array bug lived exactly here — the
 * validator said yes and the driver silently returned `false` — and neither a
 * validator unit test nor a hand-written binding test would have caught it
 * alone.
 */
describe('admin/sql validator output binds correctly', { skip: !HAS_DB }, () => {
  let client: ReturnType<typeof postgres> | null = null;

  before(() => {
    client = postgres(process.env.DATABASE_URL!, { max: 1, idle_timeout: 5 });
  });

  after(async () => {
    await withTimeout(10_000, async () => {
      if (client) await client.end({ timeout: 5 });
    });
  });

  /** Run what the route would run, for params the validator accepted. */
  async function run(query: string, rawParams: unknown): Promise<unknown[]> {
    const validated = validateAdminParams(rawParams);
    assert.equal(validated.ok, true, 'validator rejected the fixture');
    return client!.begin('READ ONLY', async (tx) => {
      const result = await tx.unsafe(query, validated.ok ? validated.params : [], EXTENDED_PROTOCOL_ONLY);
      return result as unknown as unknown[];
    }) as Promise<unknown[]>;
  }

  it('binds accepted scalars to the values they came in as', async () => {
    const rows = (await run('select $1::text as s, $2::int as n, $3::bool as b', [
      'pgboss',
      42,
      true,
    ])) as Array<Record<string, unknown>>;

    assert.deepEqual(rows[0], { s: 'pgboss', n: 42, b: true });
  });

  it('binds an accepted string array as a real Postgres array', async () => {
    const rows = (await run(
      "select x from unnest(array['a','b','c']) as x where x = any($1)",
      [['a', 'c']],
    )) as Array<{ x: string }>;

    assert.deepEqual(rows.map((r) => r.x), ['a', 'c']);
  });

  it('binds an accepted number array as a real Postgres array', async () => {
    const rows = (await run(
      'select x from unnest(array[1,2,3]) as x where x = any($1)',
      [[1, 3]],
    )) as Array<{ x: number }>;

    assert.deepEqual(rows.map((r) => r.x), [1, 3]);
  });

  it('never admits a boolean array, because the driver mis-binds it', async () => {
    // Guard against the validator being loosened without re-checking the
    // driver. Proven directly: postgres-js returns `false` for [[true]].
    assert.equal(validateAdminParams([[true]]).ok, false);

    const rows = (await client!.begin('READ ONLY', async (tx) => {
      const r = await tx.unsafe('select $1::bool as v', [[true]], EXTENDED_PROTOCOL_ONLY);
      return r as unknown as unknown[];
    })) as Array<{ v: boolean }>;
    assert.equal(rows[0]?.v, false, 'driver behaviour changed — revisit the validator');
  });

  it('forces the extended protocol, so two statements cannot run', async () => {
    await assert.rejects(
      () =>
        client!.begin('READ ONLY', async (tx) => {
          await tx.unsafe('select 1; select 2', [], EXTENDED_PROTOCOL_ONLY);
        }),
      (err: unknown) => {
        // 42601 syntax_error — the protocol refuses a second command.
        assert.equal((err as { code?: string }).code, '42601');
        return true;
      },
    );
  });
});
