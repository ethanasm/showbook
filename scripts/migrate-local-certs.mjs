#!/usr/bin/env node
// One-shot relocation for local mkcert TLS certs after the
// `certs/` → `infra/certs/` move. Runs from pnpm dev:up so the
// operator never sees a "where did my cert go" failure on first
// `pnpm dev:up` after pulling the move. Idempotent — no-op once
// the old path is empty.

import { existsSync, readdirSync, renameSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';

const OLD = 'certs';
const NEW = 'infra/certs';

if (!existsSync(OLD)) process.exit(0);

const oldEntries = readdirSync(OLD).filter((f) => !f.startsWith('.'));
if (oldEntries.length === 0) {
  // Empty leftover directory from a previous run — clean it up.
  try { rmdirSync(OLD); } catch {}
  process.exit(0);
}

mkdirSync(NEW, { recursive: true });

let moved = 0;
for (const f of oldEntries) {
  const from = join(OLD, f);
  const to = join(NEW, f);
  if (existsSync(to)) continue;
  renameSync(from, to);
  moved += 1;
}

if (moved > 0) {
  console.log(`[migrate-local-certs] moved ${moved} file(s) ${OLD}/ → ${NEW}/`);
}

// Best-effort cleanup of the now-empty old directory.
try {
  if (readdirSync(OLD).length === 0) rmdirSync(OLD);
} catch {}
