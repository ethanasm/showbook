#!/usr/bin/env node
// Publishes PR screenshot PNGs to an orphan `pr-screenshots` branch in
// this repo, so the pr-screenshots skill can embed them in PR bodies as
// raw.githubusercontent.com URLs without bloating `main`.
//
// Usage:
//   node scripts/upload-pr-screenshots.mjs \
//     --branch <pr-source-branch> \
//     --pr <pr-number> \
//     [--dir apps/web/test-results/screenshots] \
//     [--remote origin] \
//     [--target-branch pr-screenshots] \
//     [--dry-run]
//
// Emits a JSON array on stdout:
//   [{ "name": "pr-desktop-home", "url": "https://github.com/.../home.png" }, ...]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = parseArgs(process.argv.slice(2));
const branch = required(args, 'branch');
const pr = required(args, 'pr');
const screenshotDir = resolve(args.dir ?? 'apps/web/test-results/screenshots');
const remote = args.remote ?? 'origin';
const targetBranch = args['target-branch'] ?? 'pr-screenshots';
const dryRun = Boolean(args['dry-run']);

if (!existsSync(screenshotDir)) {
  process.stderr.write(`upload-pr-screenshots: no screenshot dir at ${screenshotDir}\n`);
  process.stdout.write('[]\n');
  process.exit(0);
}

const pngs = readdirSync(screenshotDir)
  .filter((f) => f.endsWith('.png'))
  .sort();

if (pngs.length === 0) {
  process.stderr.write(`upload-pr-screenshots: no PNGs in ${screenshotDir}\n`);
  process.stdout.write('[]\n');
  process.exit(0);
}

const { owner, repo } = parseRemote(remote);
const wtDir = join(tmpdir(), `pr-screenshots-wt-${process.pid}`);

try {
  prepareWorktree(wtDir, remote, targetBranch);
  const branchDir = join(wtDir, branch);
  if (existsSync(branchDir)) rmSync(branchDir, { recursive: true, force: true });
  mkdirSync(branchDir, { recursive: true });
  for (const name of pngs) copyFileSync(join(screenshotDir, name), join(branchDir, name));

  if (dryRun) {
    process.stderr.write(`upload-pr-screenshots: dry-run, skipping commit + push\n`);
  } else {
    git(['add', '.'], { cwd: wtDir });
    const status = git(['status', '--porcelain'], { cwd: wtDir, capture: true });
    if (!status.trim()) {
      process.stderr.write(`upload-pr-screenshots: no changes to commit\n`);
    } else {
      // The orphan branch stores only binary asset PNGs — no source code,
      // no audit value to signing — and the Claude Code on the web
      // sandbox's SSH signer rejects commits made inside a fresh
      // `git worktree add --orphan` directory with "missing source".
      // Skip signing for this one commit only; the feature branch
      // commits still go through the regular signed path.
      git(['commit', '--no-gpg-sign', '-m', `screenshots: ${branch} (PR #${pr})`], { cwd: wtDir });
      git(['push', remote, `HEAD:${targetBranch}`], { cwd: wtDir });
    }
  }

  const urls = pngs.map((name) => ({
    name: name.replace(/\.png$/, ''),
    url: `https://github.com/${owner}/${repo}/raw/${targetBranch}/${encodeURIComponent(branch)}/${encodeURIComponent(name)}`,
  }));
  process.stdout.write(JSON.stringify(urls, null, 2) + '\n');
} finally {
  try {
    git(['worktree', 'remove', '--force', wtDir], { allowFail: true });
  } catch {
    // best effort
  }
  if (existsSync(wtDir)) rmSync(wtDir, { recursive: true, force: true });
}

function prepareWorktree(dir, remoteName, targetRef) {
  // Fetch the orphan branch if it exists; ignore failure (first run).
  git(['fetch', remoteName, targetRef], { allowFail: true });
  const remoteRef = `refs/remotes/${remoteName}/${targetRef}`;
  const hasRemote = git(['rev-parse', '--verify', remoteRef], {
    capture: true,
    allowFail: true,
  }).trim();
  if (hasRemote) {
    git(['worktree', 'add', '-B', targetRef, dir, remoteRef]);
    return;
  }
  // First run: create the orphan worktree, then wipe any inherited tracked files.
  git(['worktree', 'add', '--orphan', '-b', targetRef, dir]);
  git(['rm', '-rf', '.'], { cwd: dir, allowFail: true });
}

function git(argv, { cwd, capture, allowFail } = {}) {
  const res = spawnSync('git', argv, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (res.status !== 0 && !allowFail) {
    const err = capture ? `${res.stdout ?? ''}${res.stderr ?? ''}` : '';
    throw new Error(`git ${argv.join(' ')} failed (${res.status})${err ? `: ${err}` : ''}`);
  }
  return res.stdout ?? '';
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function required(args, key) {
  const v = args[key];
  if (v === undefined || v === true) {
    process.stderr.write(`upload-pr-screenshots: missing required --${key}\n`);
    process.exit(2);
  }
  return String(v);
}

function parseRemote(remoteName) {
  const url = git(['remote', 'get-url', remoteName], { capture: true }).trim();
  // Match git@github.com:owner/repo.git OR https://github.com/owner/repo(.git)?
  const ssh = url.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (https) return { owner: https[1], repo: https[2] };
  // Sandbox / proxy routes the same repo through a non-github host like
  // http://local_proxy@127.0.0.1:PORT/git/owner/repo. Fall back to the
  // last two path segments.
  try {
    const u = new URL(url);
    const segs = u.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
    if (segs.length >= 2) {
      return { owner: segs[segs.length - 2], repo: segs[segs.length - 1] };
    }
  } catch {
    // not a parseable URL — fall through to throw below
  }
  throw new Error(`upload-pr-screenshots: cannot parse remote URL ${url}`);
}
