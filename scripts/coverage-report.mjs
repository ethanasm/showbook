#!/usr/bin/env node
// Walks per-package `coverage/*.info` LCOV files written by Nx-cached
// `test:coverage` / `test:integration:coverage` targets, applies
// include/exclude filters, computes totals, and enforces thresholds.
//
// Usage:
//   node scripts/coverage-report.mjs [--threshold=N] [--write=path]
//
// Each package writes:
//   <projectRoot>/coverage/unit.info        (Node native LCOV reporter)
//   <projectRoot>/coverage/integration.info (run-integration.mjs)

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Coverage is computed per scope. Each scope has its own include patterns
// and its own threshold gate; the merged LCOV emitted at the end is the
// union of all scopes. Excludes are shared across scopes because the
// same junk (tests, barrels, generated code) is junk regardless.
//
// Per `showbook-specs/mobile-testing-strategy.md`, the mobile gate scopes
// to `apps/mobile/lib/**` only — no `app/`, no `components/`. Web's gate
// is unchanged.
const SCOPES = [
  {
    name: 'web',
    include: [
      /^packages\/api\/src\/.*\.ts$/,
      /^packages\/jobs\/src\/.*\.ts$/,
      /^packages\/shared\/src\/utils\/.*\.ts$/,
      /^packages\/shared\/src\/constants\/.*\.ts$/,
      /^packages\/emails\/src\/.*\.tsx?$/,
      /^packages\/observability\/src\/.*\.ts$/,
      /^packages\/scrapers\/src\/llm\.ts$/,
      /^apps\/web\/lib\/.*\.tsx?$/,
      /^apps\/web\/components\/.*\.tsx$/,
      /^apps\/web\/app\/.*\/route\.ts$/,
      /^apps\/web\/app\/discover\/region-helpers\.ts$/,
    ],
  },
  {
    name: 'mobile',
    include: [
      /^apps\/mobile\/lib\/.*\.tsx?$/,
    ],
  },
];

const EXCLUDE_PATTERNS = [
  /__tests__/,
  /\.test\.[jt]sx?$/,
  /_test-helpers\.ts$/,
  /_fake-db\.ts$/,
  /test-setup\.ts$/,
  /^packages\/db\//,
  /^packages\/api\/src\/index\.ts$/,
  /^packages\/api\/src\/root\.ts$/,
  /^packages\/jobs\/src\/(index|load-env-local|boss|registry)\.ts$/,
  /^packages\/shared\/src\/index\.ts$/,
  /^packages\/shared\/src\/utils\/index\.ts$/,
  /^packages\/shared\/src\/types\//,
  /^packages\/emails\/src\/index\.ts$/,
  /^packages\/emails\/src\/preview\//,
  /^packages\/observability\/src\/index\.ts$/,
  /^packages\/scrapers\/src\/(index|cli|run|runtime|extract)\.ts$/,
  /^apps\/web\/app\/.*\/(page|layout|loading)\.tsx$/,
  /^apps\/web\/app\/.*\.client\.tsx$/,
  /^apps\/web\/app\/api\/test\//,
  /^apps\/web\/app\/api\/auth\//,
  /^apps\/web\/app\/api\/trpc\//,
  /^apps\/mobile\/lib\/index\.ts$/,
  /^apps\/mobile\/lib\/cache\/index\.ts$/,
  /^apps\/mobile\/lib\/media\/index\.ts$/,
  /^apps\/mobile\/lib\/mutations\/index\.ts$/,
];

const args = process.argv.slice(2);
let threshold = 80;
let writePath = 'coverage/lcov.info';
for (const arg of args) {
  if (arg.startsWith('--threshold=')) threshold = Number(arg.slice('--threshold='.length));
  else if (arg.startsWith('--write=')) writePath = arg.slice('--write='.length);
}

const COVERAGE_DIRS = [
  'packages/api/coverage',
  'packages/jobs/coverage',
  'packages/shared/coverage',
  'packages/emails/coverage',
  'packages/observability/coverage',
  'packages/scrapers/coverage',
  'apps/web/coverage',
  'apps/mobile/coverage',
];

function scopeFor(file) {
  const p = file.split(sep).join('/');
  if (EXCLUDE_PATTERNS.some((re) => re.test(p))) return null;
  for (const scope of SCOPES) {
    if (scope.include.some((re) => re.test(p))) return scope.name;
  }
  return null;
}

function shouldInclude(file) {
  return scopeFor(file) !== null;
}

function normalizeRelPath(absPath, packageDir) {
  let abs = absPath;
  if (abs.startsWith('file://')) abs = fileURLToPath(abs);
  // Node native LCOV emits paths relative to cwd. Unit tests run from the
  // package dir (`src/utils/dates.ts`); integration tests run from the
  // repo root (`packages/api/src/...`). Resolve against the package dir
  // unless the path already names a workspace dir (packages/, apps/).
  if (!abs.startsWith('/')) {
    const isRepoRelative = /^(packages|apps)\//.test(abs);
    abs = resolve(isRepoRelative ? REPO_ROOT : packageDir, abs);
  }
  return relative(REPO_ROOT, abs).split(sep).join('/');
}

function parseLcov(text, packageDir) {
  const records = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('SF:')) {
      const rel = normalizeRelPath(line.slice(3), packageDir);
      current = records.get(rel);
      if (!current) {
        current = {
          path: rel,
          lines: new Map(),
          branches: new Map(),
          functions: new Map(),
        };
        records.set(rel, current);
      }
      continue;
    }
    if (!current) continue;
    if (line === 'end_of_record') {
      current = null;
      continue;
    }
    if (line.startsWith('DA:')) {
      const [lineNum, hits] = line.slice(3).split(',').map(Number);
      const prev = current.lines.get(lineNum) ?? 0;
      current.lines.set(lineNum, prev + (hits || 0));
    } else if (line.startsWith('BRDA:')) {
      const [lineNum, block, branch, hitsStr] = line.slice(5).split(',');
      const key = `${lineNum}.${block}.${branch}`;
      const hits = hitsStr === '-' ? 0 : Number(hitsStr);
      const prev = current.branches.get(key) ?? 0;
      current.branches.set(key, prev + hits);
    } else if (line.startsWith('FN:')) {
      const idx = line.indexOf(',');
      const lineNum = Number(line.slice(3, idx));
      const name = line.slice(idx + 1);
      const key = `${lineNum}|${name}`;
      if (!current.functions.has(key)) {
        current.functions.set(key, { line: lineNum, name, hits: 0 });
      }
    } else if (line.startsWith('FNDA:')) {
      const idx = line.indexOf(',');
      const hits = Number(line.slice(5, idx));
      const name = line.slice(idx + 1);
      for (const [key, fn] of current.functions) {
        if (key.endsWith(`|${name}`)) fn.hits += hits;
      }
    }
  }
  return records;
}

function emptyTotals() {
  return {
    lines: 0, linesHit: 0,
    branches: 0, branchesHit: 0,
    functions: 0, functionsHit: 0,
  };
}

function summarize(records) {
  const byScope = new Map();
  for (const scope of SCOPES) {
    byScope.set(scope.name, { perFile: [], totals: emptyTotals() });
  }
  for (const rec of records.values()) {
    const scopeName = scopeFor(rec.path);
    if (!scopeName) continue;
    const lines = rec.lines.size;
    const linesHit = [...rec.lines.values()].filter((h) => h > 0).length;
    const branches = rec.branches.size;
    const branchesHit = [...rec.branches.values()].filter((h) => h > 0).length;
    const fns = rec.functions.size;
    const fnsHit = [...rec.functions.values()].filter((f) => f.hits > 0).length;
    const bucket = byScope.get(scopeName);
    bucket.totals.lines += lines;
    bucket.totals.linesHit += linesHit;
    bucket.totals.branches += branches;
    bucket.totals.branchesHit += branchesHit;
    bucket.totals.functions += fns;
    bucket.totals.functionsHit += fnsHit;
    bucket.perFile.push({
      path: rec.path,
      lines, linesHit,
      branches, branchesHit,
      functions: fns, functionsHit: fnsHit,
    });
  }
  for (const bucket of byScope.values()) {
    bucket.perFile.sort((a, b) => a.path.localeCompare(b.path));
  }
  return byScope;
}

function pct(hit, total) {
  if (total === 0) return 100;
  return (hit / total) * 100;
}

function fmtPct(p) {
  return `${p.toFixed(2).padStart(6, ' ')}%`;
}

function colorPct(p) {
  if (p >= threshold) return `\x1b[32m${fmtPct(p)}\x1b[0m`;
  if (p >= threshold - 10) return `\x1b[33m${fmtPct(p)}\x1b[0m`;
  return `\x1b[31m${fmtPct(p)}\x1b[0m`;
}

async function writeMergedLcov(records, path) {
  const dir = resolve(REPO_ROOT, path, '..');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const out = [];
  for (const rec of records.values()) {
    if (!shouldInclude(rec.path)) continue;
    out.push(`SF:${join(REPO_ROOT, rec.path)}`);
    for (const [line, hits] of [...rec.lines.entries()].sort((a, b) => a[0] - b[0])) {
      out.push(`DA:${line},${hits}`);
    }
    for (const [key, hits] of rec.branches) {
      const [line, block, branch] = key.split('.');
      out.push(`BRDA:${line},${block},${branch},${hits}`);
    }
    out.push(`BRF:${rec.branches.size}`);
    out.push(`BRH:${[...rec.branches.values()].filter((h) => h > 0).length}`);
    for (const fn of rec.functions.values()) {
      out.push(`FN:${fn.line},${fn.name}`);
      out.push(`FNDA:${fn.hits},${fn.name}`);
    }
    out.push(`FNF:${rec.functions.size}`);
    out.push(`FNH:${[...rec.functions.values()].filter((f) => f.hits > 0).length}`);
    out.push(`LF:${rec.lines.size}`);
    out.push(`LH:${[...rec.lines.values()].filter((h) => h > 0).length}`);
    out.push('end_of_record');
  }
  await writeFile(resolve(REPO_ROOT, path), out.join('\n') + '\n');
}

async function collectLcovFiles() {
  const out = [];
  for (const dir of COVERAGE_DIRS) {
    const abs = resolve(REPO_ROOT, dir);
    if (!existsSync(abs)) continue;
    const packageDir = resolve(abs, '..');
    let entries;
    try {
      entries = await readdir(abs);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith('.info')) continue;
      const file = join(abs, f);
      const s = await stat(file);
      if (!s.isFile()) continue;
      out.push({ file, packageDir });
    }
  }
  return out;
}

async function main() {
  const lcovFiles = await collectLcovFiles();
  if (lcovFiles.length === 0) {
    console.error('[coverage-report] No LCOV files found in any package coverage/ directory.');
    console.error('  Run `pnpm test:coverage` (and `pnpm test:integration:coverage`) first.');
    process.exit(2);
  }
  const merged = new Map();
  for (const { file, packageDir } of lcovFiles) {
    const text = await readFile(file, 'utf8');
    const recs = parseLcov(text, packageDir);
    for (const [path, rec] of recs) {
      if (!merged.has(path)) {
        merged.set(path, rec);
      } else {
        const existing = merged.get(path);
        for (const [ln, hits] of rec.lines) {
          existing.lines.set(ln, (existing.lines.get(ln) ?? 0) + hits);
        }
        for (const [k, hits] of rec.branches) {
          existing.branches.set(k, (existing.branches.get(k) ?? 0) + hits);
        }
        for (const [k, fn] of rec.functions) {
          if (existing.functions.has(k)) {
            existing.functions.get(k).hits += fn.hits;
          } else {
            existing.functions.set(k, { ...fn });
          }
        }
      }
    }
  }
  const byScope = summarize(merged);
  await writeMergedLcov(merged, writePath);

  const W = 60;
  let totalIncluded = 0;
  const breaches = [];

  for (const scope of SCOPES) {
    const { perFile, totals } = byScope.get(scope.name);
    totalIncluded += perFile.length;

    console.log(`\n${'═'.repeat(W + 30)}`);
    console.log(`SCOPE: ${scope.name}`);
    console.log('─'.repeat(W + 30));
    console.log(
      'File'.padEnd(W) +
        ' | ' + 'Lines'.padStart(8) +
        ' | ' + 'Branches'.padStart(9) +
        ' | ' + 'Funcs'.padStart(7),
    );
    console.log('─'.repeat(W + 30));
    if (perFile.length === 0) {
      console.log('(no files matched this scope)');
    }
    for (const f of perFile) {
      const name = f.path.length > W ? '…' + f.path.slice(-(W - 1)) : f.path.padEnd(W);
      console.log(
        name +
          ' | ' + colorPct(pct(f.linesHit, f.lines)) +
          ' | ' + colorPct(pct(f.branchesHit, f.branches)) +
          ' | ' + colorPct(pct(f.functionsHit, f.functions)),
      );
    }
    const linesPct = pct(totals.linesHit, totals.lines);
    const branchesPct = pct(totals.branchesHit, totals.branches);
    const fnsPct = pct(totals.functionsHit, totals.functions);
    console.log('─'.repeat(W + 30));
    console.log(
      `TOTAL (${scope.name})`.padEnd(W) +
        ' | ' + colorPct(linesPct) +
        ' | ' + colorPct(branchesPct) +
        ' | ' + colorPct(fnsPct),
    );

    if (perFile.length === 0) continue;
    if (linesPct < threshold) {
      breaches.push(`[${scope.name}] lines ${linesPct.toFixed(2)}% < ${threshold}%`);
    }
    if (branchesPct < threshold) {
      breaches.push(`[${scope.name}] branches ${branchesPct.toFixed(2)}% < ${threshold}%`);
    }
    if (fnsPct < threshold) {
      breaches.push(`[${scope.name}] functions ${fnsPct.toFixed(2)}% < ${threshold}%`);
    }
  }

  console.log(`\nIncluded files: ${totalIncluded}`);
  console.log(`LCOV inputs:    ${lcovFiles.length}`);
  console.log(`Threshold:      ${threshold}% on lines, branches, functions (per scope)`);
  console.log(`Merged LCOV:    ${writePath}`);

  if (breaches.length > 0) {
    console.error('\n\x1b[31m✗ Coverage below threshold:\x1b[0m');
    for (const b of breaches) console.error(`  - ${b}`);
    process.exit(1);
  }
  console.log('\n\x1b[32m✓ Coverage threshold met for all scopes.\x1b[0m');
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
