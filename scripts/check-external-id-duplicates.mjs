#!/usr/bin/env node
/**
 * Read-only audit for the partial-unique constraints added in
 * migration 0019_unique_external_ids.sql. If any of the four
 * external-ID columns has more than one row pointing at the same
 * id, the constraint failed to build (or the rows landed before
 * the migration), the matcher's race-recovery is silently masking
 * the breach, and follow-up dedupes will keep recurring until
 * `scripts/dedupe-external-ids.sql` is re-run.
 *
 * Run periodically (operator dashboard, CI cron) against prod via
 * the read-only `/api/admin/sql` endpoint. Exits 0 when clean,
 * exits 2 when duplicates are present (so cron/monitoring can
 * detect it), and exits 1 on transport errors.
 *
 * Usage:
 *   ADMIN_QUERY_TOKEN=... ADMIN_QUERY_URL=https://your-prod \
 *     pnpm db:check-duplicates
 */

const token = process.env.ADMIN_QUERY_TOKEN;
const baseUrl = process.env.ADMIN_QUERY_URL;

function die(msg, code = 1) {
  process.stderr.write(`db:check-duplicates: ${msg}\n`);
  process.exit(code);
}

if (!token) die('ADMIN_QUERY_TOKEN is not set');
if (!baseUrl) die('ADMIN_QUERY_URL is not set (e.g. https://your-prod-host)');

// One UNION ALL so the admin endpoint's single-statement guard is happy
// and the dashboard captures all four columns in a single row set.
const query = `
SELECT 'venues.tm_venue_id' AS col, COUNT(*)::int AS dup_groups
FROM (SELECT 1 FROM venues
       WHERE ticketmaster_venue_id IS NOT NULL
       GROUP BY ticketmaster_venue_id HAVING COUNT(*) > 1) s
UNION ALL
SELECT 'venues.google_place_id', COUNT(*)::int
FROM (SELECT 1 FROM venues
       WHERE google_place_id IS NOT NULL
       GROUP BY google_place_id HAVING COUNT(*) > 1) s
UNION ALL
SELECT 'performers.tm_attraction_id', COUNT(*)::int
FROM (SELECT 1 FROM performers
       WHERE ticketmaster_attraction_id IS NOT NULL
       GROUP BY ticketmaster_attraction_id HAVING COUNT(*) > 1) s
UNION ALL
SELECT 'performers.musicbrainz_id', COUNT(*)::int
FROM (SELECT 1 FROM performers
       WHERE musicbrainz_id IS NOT NULL
       GROUP BY musicbrainz_id HAVING COUNT(*) > 1) s
`.trim();

const url = new URL('/api/admin/sql', baseUrl).toString();
let res;
try {
  res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
} catch (err) {
  die(`network error: ${err.message ?? err}`);
}

if (!res.ok) {
  const text = await res.text().catch(() => '');
  die(`HTTP ${res.status}: ${text}`);
}

let body;
try {
  body = await res.json();
} catch (err) {
  die(`invalid JSON response: ${err.message ?? err}`);
}

const rows = body?.rows ?? body?.data ?? [];
if (!Array.isArray(rows) || rows.length === 0) {
  die(`empty response: ${JSON.stringify(body).slice(0, 200)}`);
}

let dirty = false;
const lines = [];
for (const r of rows) {
  const col = r.col ?? r[0] ?? '?';
  const dupGroups = Number(r.dup_groups ?? r[1] ?? 0);
  const status = dupGroups > 0 ? 'FAIL' : 'ok';
  lines.push(`  ${status.padEnd(4)}  ${col.padEnd(32)}  ${dupGroups} duplicate groups`);
  if (dupGroups > 0) dirty = true;
}

process.stdout.write(`External-ID duplicate audit (${baseUrl}):\n${lines.join('\n')}\n`);

if (dirty) {
  process.stdout.write(
    '\nDuplicates detected. Run scripts/dedupe-external-ids.sql against prod, ' +
      'then re-run this audit.\n',
  );
  process.exit(2);
}
process.exit(0);
