#!/usr/bin/env node
// Refuses to proceed if DATABASE_URL points at the prod database.
// Wired into the dev/e2e workspace scripts (db:migrate, db:studio,
// db:prepare:e2e, test:integration, ...) so a misconfigured env can't
// accidentally run a destructive dev command against prod data.
//
// Mirrors the runtime guard in apps/web/app/api/test/_guard.ts: prod
// is identified by database name (`showbook_prod`), since the compose
// builds DATABASE_URL with that name and role.

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[db-guard] DATABASE_URL is not set');
  process.exit(1);
}

let dbName;
try {
  dbName = new URL(url).pathname.replace(/^\//, '').split('?')[0];
} catch (err) {
  console.error(`[db-guard] invalid DATABASE_URL: ${err.message}`);
  process.exit(1);
}

if (dbName === 'showbook_prod' || dbName.startsWith('showbook_prod_')) {
  console.error(
    `[db-guard] refusing to run a dev/test command against prod database '${dbName}'.\n` +
      `           To migrate prod, run: pnpm prod:migrate`,
  );
  process.exit(1);
}
