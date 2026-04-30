#!/usr/bin/env node
// Runs `*.integration.test.ts` files under `node --test` with:
//   - per-test 45 s timeout (--test-timeout=45000)
//   - batch wall-clock kill at BATCH_TIMEOUT_MS (default 5 min)
//   - optional coverage via NODE_V8_COVERAGE / --experimental-test-coverage
//
// Usage: node scripts/run-integration.mjs <package-dir> [--coverage]
//   <package-dir> e.g. packages/api or packages/jobs
//   --coverage    enables Node native coverage; LCOV path resolved from
//                 LCOV_OUT env var (set by the wrapper script)

import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const packageDir = args[0];
const enableCoverage = args.includes('--coverage');
if (!packageDir) {
  console.error('Usage: run-integration.mjs <package-dir> [--coverage]');
  process.exit(2);
}

const PER_TEST_TIMEOUT_MS = 45_000;
const BATCH_TIMEOUT_MS = Number(process.env.INTEGRATION_BATCH_TIMEOUT_MS ?? 300_000);

const testsDir = join(REPO_ROOT, packageDir, 'src/__tests__');
if (!existsSync(testsDir)) {
  console.error(`No __tests__ dir at ${testsDir}`);
  process.exit(2);
}
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.integration.test.ts'))
  .map((f) => join(testsDir, f))
  .sort();

if (files.length === 0) {
  console.log(`[run-integration] no integration tests in ${packageDir}`);
  process.exit(0);
}

console.log(
  `[run-integration] ${packageDir}: ${files.length} file(s), ` +
    `per-test ${PER_TEST_TIMEOUT_MS / 1000}s, batch ${BATCH_TIMEOUT_MS / 1000}s` +
    (enableCoverage ? ', coverage on' : ''),
);

const lcovOut = process.env.LCOV_OUT;
const nodeArgs = [
  '--import',
  'tsx',
  '--test',
  `--test-timeout=${PER_TEST_TIMEOUT_MS}`,
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
];
if (enableCoverage) {
  nodeArgs.push('--experimental-test-coverage');
  if (lcovOut) {
    nodeArgs.push('--test-reporter=lcov');
    nodeArgs.push(`--test-reporter-destination=${lcovOut}`);
  }
}
nodeArgs.push(...files);

const child = spawn(process.execPath, nodeArgs, {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: process.env,
});

const killTimer = setTimeout(() => {
  console.error(
    `\n[run-integration] BATCH TIMEOUT after ${BATCH_TIMEOUT_MS / 1000}s — killing test process`,
  );
  child.kill('SIGKILL');
}, BATCH_TIMEOUT_MS);

child.on('exit', (code, signal) => {
  clearTimeout(killTimer);
  if (signal) {
    console.error(`[run-integration] killed by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
