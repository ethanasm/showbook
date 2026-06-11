#!/usr/bin/env node
// Mint a fresh MAESTRO_E2E_TOKEN (+ the matching MAESTRO_E2E_USER_JSON) for
// the Maestro Android e2e suite (.github/workflows/mobile-e2e.yml).
//
// Why this exists: the token baked into the e2e APK is a NextAuth Bearer JWT
// for the test user, signed exactly the way apps/web/lib/mobile-token.ts
// (encodeMobileToken) signs real mobile tokens — secret = AUTH_SECRET, salt =
// 'authjs.session-token'. The tRPC bearer path (decodeMobileToken) verifies it
// with the same secret + salt and rejects an expired / wrong-secret token with
// UNAUTHORIZED. When the baked-in token silently aged past its lifetime, every
// flow that loads data broke — the Shows list rendered "Couldn't load shows —
// UNAUTHORIZED" and `show-card-row-0` was never found. Re-minting and updating
// the repo secret is the fix.
//
// Default lifetime is 365 days (vs the 30-day mobile default) so this CI-only
// credential doesn't expire mid-PR-lifecycle again.
//
// Usage (run on a host with the e2e DATABASE_URL + AUTH_SECRET available):
//
//   AUTH_SECRET=... \
//   DATABASE_URL=postgresql://showbook:...@localhost:5433/showbook_e2e \
//   node scripts/mint-e2e-token.mjs --email maestro-e2e@showbook.test
//
// Then copy the two printed lines into the GitHub repo secrets
// (Settings -> Secrets and variables -> Actions):
//
//   MAESTRO_E2E_TOKEN      = <token>
//   MAESTRO_E2E_USER_JSON  = <userJson>
//
// Flags:
//   --email <addr>   test user email (default maestro-e2e@showbook.test)
//   --name  <name>   display name    (default "Maestro E2E")
//   --days  <n>      token lifetime in days (default 365)

import postgres from 'postgres';
import { encode } from 'next-auth/jwt';
import { randomUUID } from 'node:crypto';

// Must stay in sync with MOBILE_JWT_SALT in apps/web/lib/mobile-token.ts.
const MOBILE_JWT_SALT = 'authjs.session-token';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const email = arg('--email', 'maestro-e2e@showbook.test');
const name = arg('--name', 'Maestro E2E');
const days = Number(arg('--days', '365'));

const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
if (!secret) {
  console.error(
    '[mint-e2e-token] AUTH_SECRET (or NEXTAUTH_SECRET) must be set — it signs the token.',
  );
  process.exit(2);
}

const url = process.env.DATABASE_URL ?? process.env.E2E_DATABASE_URL;
if (!url) {
  console.error(
    '[mint-e2e-token] DATABASE_URL (the e2e database) is required to resolve the test user id.',
  );
  process.exit(2);
}

if (!Number.isFinite(days) || days <= 0) {
  console.error(`[mint-e2e-token] --days must be a positive number, got '${days}'.`);
  process.exit(2);
}

// Guard: never mint against prod (mirrors scripts/guard-not-prod-db.mjs —
// prod is identified by database name).
let dbName;
try {
  dbName = new URL(url).pathname.replace(/^\//, '').split('?')[0];
} catch (err) {
  console.error(`[mint-e2e-token] invalid DATABASE_URL: ${err.message}`);
  process.exit(1);
}
if (dbName === 'showbook_prod' || dbName.startsWith('showbook_prod_')) {
  console.error(`[mint-e2e-token] refusing to mint against prod database '${dbName}'.`);
  process.exit(1);
}

const sql = postgres(url, { max: 2 });

async function main() {
  // Resolve (or create) the test user row, mirroring /api/test/login so the
  // token's `id` claim points at a real users row the tRPC context can load.
  let user = (
    await sql`SELECT id, email, name, image FROM users WHERE email = ${email} LIMIT 1`
  )[0];
  if (!user) {
    // users.id has no DB-level default — the Drizzle schema fills it at the
    // app layer — so a raw INSERT must supply one itself.
    user = (
      await sql`INSERT INTO users (id, email, name) VALUES (${randomUUID()}, ${email}, ${name}) RETURNING id, email, name, image`
    )[0];
  }

  const maxAgeSeconds = Math.round(days * 24 * 60 * 60);
  const token = await encode({
    token: {
      sub: user.id,
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.image ?? null,
    },
    secret,
    salt: MOBILE_JWT_SALT,
    maxAge: maxAgeSeconds,
  });

  // SessionUser shape (apps/mobile/lib/auth-helpers.ts): { id, email, name, image }.
  const userJson = JSON.stringify({
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    image: user.image ?? null,
  });

  process.stderr.write(
    `[mint-e2e-token] minted for ${user.email} (id=${user.id}), valid ${days} days, db='${dbName}'.\n` +
      '[mint-e2e-token] set these two GitHub repo secrets:\n\n',
  );
  console.log(`MAESTRO_E2E_TOKEN=${token}`);
  console.log(`MAESTRO_E2E_USER_JSON=${userJson}`);
}

main()
  .catch((err) => {
    console.error('[mint-e2e-token] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 5 }));
