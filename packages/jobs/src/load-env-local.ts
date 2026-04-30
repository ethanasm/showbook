// Side-effect module: walks up from CWD looking for the first `.env.local`
// and merges any keys not already present in process.env. Import this BEFORE
// any module that reads env at module init time (DB client, API key consumers
// etc.) — `import './load-env-local';` as the first line of the entrypoint.
//
// Used by stand-alone scripts (backfills, ad-hoc jobs) that don't run inside
// the Next.js process. Inside Next.js the framework already loads .env.local
// for you; do NOT import this from app or API code.

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

let dir = process.cwd();
for (let i = 0; i < 6; i++) {
  const candidate = resolve(dir, '.env.local');
  if (existsSync(candidate)) {
    const text = readFileSync(candidate, 'utf-8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
    break;
  }
  const parent = resolve(dir, '..');
  if (parent === dir) break;
  dir = parent;
}
