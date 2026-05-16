#!/usr/bin/env node
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function mkcertRootCandidate() {
  const result = spawnSync('mkcert', ['-CAROOT'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const caroot = result.stdout.trim();
  return caroot ? path.join(caroot, 'rootCA.pem') : null;
}

function runSimctl(args) {
  return spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });
}

function hasBootedSimulator() {
  const result = runSimctl(['list', 'devices', 'booted', '--json']);
  if (result.status !== 0) return false;
  try {
    const parsed = JSON.parse(result.stdout);
    return Object.values(parsed.devices ?? {})
      .flat()
      .some((device) => device?.state === 'Booted');
  } catch {
    return false;
  }
}

function pickAvailableIphone() {
  if (process.env.IOS_SIMULATOR_UDID) return process.env.IOS_SIMULATOR_UDID;

  const result = runSimctl(['list', 'devices', 'available', '--json']);
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    const devices = Object.values(parsed.devices ?? {})
      .flat()
      .filter(
        (device) =>
          device?.udid &&
          device?.name?.startsWith('iPhone') &&
          device?.isAvailable !== false,
      );
    return devices[0]?.udid ?? null;
  } catch {
    return null;
  }
}

function ensureBootedSimulator() {
  if (hasBootedSimulator()) return true;

  const udid = pickAvailableIphone();
  if (!udid) {
    console.warn('[mobile] No available iPhone simulator found for trusting the local cert.');
    return false;
  }

  const boot = runSimctl(['boot', udid]);
  if (
    boot.status !== 0 &&
    !/current state: Booted|already booted/i.test(`${boot.stderr}\n${boot.stdout}`)
  ) {
    console.warn(`[mobile] Could not boot iOS simulator ${udid}: ${boot.stderr.trim()}`);
    return false;
  }

  const bootstatus = runSimctl(['bootstatus', udid, '-b']);
  if (bootstatus.status !== 0) {
    console.warn(`[mobile] Simulator ${udid} did not finish booting: ${bootstatus.stderr.trim()}`);
    return false;
  }
  return true;
}

const explicit = process.env.LOCALHOST_CERT_PATH;
const candidates = [
  explicit,
  process.env.MKCERT_ROOT_CA,
  mkcertRootCandidate(),
  path.join(os.homedir(), 'Library/Application Support/mkcert/rootCA.pem'),
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
    '[mobile] No local HTTPS root cert found to trust in the iOS simulator. ' +
      'Set MKCERT_ROOT_CA=/absolute/path/to/rootCA.pem or LOCALHOST_CERT_PATH=/absolute/path/to/rootCA.pem if native fetch fails for https://localhost:3001.',
  );
  process.exit(0);
}

if (!ensureBootedSimulator()) {
  process.exit(0);
}

const result = runSimctl(['keychain', 'booted', 'add-root-cert', certPath]);

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
