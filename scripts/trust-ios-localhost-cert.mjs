#!/usr/bin/env node
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const explicit = process.env.LOCALHOST_CERT_PATH;
const candidates = [
  explicit,
  'certs/localhost-cert.pem',
  'certs/localhost.pem',
  'certs/localhost.crt',
  'certificates/localhost.pem',
  'certificates/localhost-cert.pem',
  '.cert/localhost.pem',
  '.cert/localhost-cert.pem',
  path.join(os.homedir(), '.localhost-ssl/localhost.pem'),
].filter(Boolean);

const certPath = candidates
  .map((candidate) =>
    path.isAbsolute(candidate) ? candidate : path.join(root, candidate),
  )
  .find((candidate) => existsSync(candidate));

if (!certPath) {
  console.warn(
    '[mobile] No localhost cert found to trust in the iOS simulator. ' +
      'Set LOCALHOST_CERT_PATH=/absolute/path/to/localhost-cert.pem if native fetch fails for https://localhost:3001.',
  );
  process.exit(0);
}

const result = spawnSync(
  'xcrun',
  ['simctl', 'keychain', 'booted', 'add-root-cert', certPath],
  { encoding: 'utf8' },
);

if (result.error) {
  console.warn(`[mobile] Could not run xcrun to trust localhost cert: ${result.error.message}`);
  process.exit(0);
}

if (result.status !== 0) {
  const stderr = result.stderr.trim();
  console.warn(
    `[mobile] Could not trust localhost cert in the booted simulator. ${stderr || 'Is a simulator booted?'}`,
  );
  process.exit(0);
}

console.log(`[mobile] Trusted localhost cert in booted iOS simulator: ${certPath}`);
