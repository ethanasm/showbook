#!/usr/bin/env node
/**
 * Nightly Postgres dump for the prod Showbook database.
 *
 * Operator cron, not pg-boss — see `docs/specs/operations/backups.md` for
 * why. Exit codes:
 *   0 — dump landed, prune succeeded (rclone optional)
 *   1 — pg_dump failed (no dump written)
 *   2 — pg_dump ok, rclone copy failed (local dump retained)
 *   3 — pg_dump ok, prune failed (manual cleanup needed)
 *
 * Environment:
 *   DATABASE_URL          — required; source of truth for what to dump
 *   BACKUP_DIR            — default /var/backups/showbook
 *   BACKUP_RETENTION_DAYS — default 30
 *   RCLONE_REMOTE         — optional rclone target (e.g. r2:showbook-backups)
 *
 * Run from the repo root:
 *   node scripts/backup-postgres.mjs
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, stat, unlink, rename } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

const exec = promisify(execFile);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const BACKUP_DIR = process.env.BACKUP_DIR ?? '/var/backups/showbook';
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? '30');
const RCLONE_REMOTE = process.env.RCLONE_REMOTE ?? null;

const stamp = new Date().toISOString().slice(0, 10);
const dumpName = `showbook-prod-${stamp}.dump`;
const dumpPath = join(BACKUP_DIR, dumpName);
const gzPath = `${dumpPath}.gz`;

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

async function pgDump() {
  // --format=custom is already compressed (zlib) and supports parallel
  // restore. We still gzip the file because rclone's wire-cost is lower
  // and the on-disk format gains another ~10–30 %.
  const args = ['--format=custom', '--no-owner', '--no-acl', '--file', dumpPath, DATABASE_URL];
  await exec('pg_dump', args, { maxBuffer: 1024 * 1024 * 64 });
}

async function gzipDump() {
  const tmp = `${gzPath}.partial`;
  await pipeline(createReadStream(dumpPath), createGzip({ level: 6 }), createWriteStream(tmp));
  await rename(tmp, gzPath);
  await unlink(dumpPath);
}

async function rcloneUpload() {
  if (!RCLONE_REMOTE) return;
  const dest = `${RCLONE_REMOTE}/${dumpName}.gz`;
  await exec('rclone', ['copyto', gzPath, dest], { maxBuffer: 1024 * 1024 * 16 });
}

async function prune() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = await readdir(BACKUP_DIR);
  for (const name of entries) {
    if (!name.startsWith('showbook-prod-') || !name.endsWith('.dump.gz')) continue;
    const full = join(BACKUP_DIR, name);
    const st = await stat(full);
    if (st.mtimeMs < cutoff) {
      await unlink(full);
      console.log(`pruned ${name}`);
    }
  }
  if (RCLONE_REMOTE) {
    // `rclone delete --min-age` only deletes; we don't need a listing.
    await exec(
      'rclone',
      ['delete', '--min-age', `${RETENTION_DAYS}d`, RCLONE_REMOTE],
      { maxBuffer: 1024 * 1024 * 8 },
    );
  }
}

async function main() {
  await ensureDir(BACKUP_DIR);

  try {
    await pgDump();
    await gzipDump();
    console.log(`dump complete: ${gzPath}`);
  } catch (err) {
    console.error(`pg_dump failed: ${err.message}`);
    process.exit(1);
  }

  try {
    await rcloneUpload();
    if (RCLONE_REMOTE) console.log(`uploaded to ${RCLONE_REMOTE}/${dumpName}.gz`);
  } catch (err) {
    console.error(`rclone upload failed: ${err.message}`);
    process.exit(2);
  }

  try {
    await prune();
  } catch (err) {
    console.error(`prune failed: ${err.message}`);
    process.exit(3);
  }
}

main();
