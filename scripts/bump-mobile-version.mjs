#!/usr/bin/env node
// Bumps the mobile app version in apps/mobile/app.config.ts — the single
// source of truth for the user-facing version AND the expo-updates
// runtime (`runtimeVersion: { policy: 'appVersion' }`). See
// docs/specs/decisions.md D25 for the scheme this implements.
//
//   node scripts/bump-mobile-version.mjs --type patch|minor|major [--floor X.Y.Z]
//   node scripts/bump-mobile-version.mjs --print
//
// --type:  the bump to apply. While the major version is 0 (the beta
//          line), `major` is mapped to `minor` — SemVer reserves 0.x for
//          "anything may change", and the 1.0.0 jump is a deliberate
//          manual act, never an automated one.
// --floor: base the bump on max(file version, floor). The deploy
//          workflow passes the highest `mobile-v*` tag here so a queued
//          run whose checkout predates the previous run's bump commit
//          can't re-issue an already-used version.
// --print: print the current file version and exit without writing.
//
// Prints the resulting version to stdout (and nothing else), so callers
// can do NEW=$(node scripts/bump-mobile-version.mjs --type patch).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CONFIG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps/mobile/app.config.ts',
);

// Matches exactly the `version: '0.1.1',` line in the ExpoConfig literal.
const VERSION_RE = /(\n\s*version:\s*')(\d+\.\d+\.\d+)(',)/g;

function fail(msg) {
  console.error(`[bump-mobile-version] ${msg}`);
  process.exit(1);
}

function parseVersion(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (!m) fail(`not a MAJOR.MINOR.PATCH version: '${s}'`);
  return m.slice(1).map(Number);
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

const args = process.argv.slice(2);
function flagValue(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const source = readFileSync(CONFIG_PATH, 'utf8');
const matches = [...source.matchAll(VERSION_RE)];
if (matches.length !== 1) {
  fail(
    `expected exactly one version line in ${CONFIG_PATH}, found ${matches.length} — ` +
      `update VERSION_RE if the config format changed`,
  );
}
const current = parseVersion(matches[0][2]);

if (args.includes('--print')) {
  console.log(current.join('.'));
  process.exit(0);
}

const type = flagValue('--type');
if (!['patch', 'minor', 'major'].includes(type ?? '')) {
  fail(`--type must be patch, minor, or major (got '${type}')`);
}

const floorArg = flagValue('--floor');
let base = current;
if (floorArg) {
  const floor = parseVersion(floorArg);
  if (compareVersions(floor, base) > 0) base = floor;
}

// Pre-1.0 (beta line, D25): breaking changes bump minor, not major.
const effectiveType = type === 'major' && base[0] === 0 ? 'minor' : type;

const next =
  effectiveType === 'major'
    ? [base[0] + 1, 0, 0]
    : effectiveType === 'minor'
      ? [base[0], base[1] + 1, 0]
      : [base[0], base[1], base[2] + 1];

const nextStr = next.join('.');
writeFileSync(
  CONFIG_PATH,
  source.replace(VERSION_RE, `$1${nextStr}$3`),
  'utf8',
);
console.log(nextStr);
