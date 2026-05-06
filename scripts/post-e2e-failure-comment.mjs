#!/usr/bin/env node
// Post (or update) a sticky PR comment with the Playwright failure list for
// this shard. Sticky-per-shard so re-runs replace cleanly. Runs from CI on
// pull_request events when the `Run Playwright E2E` step failed.
//
// Reads apps/web/test-results/failures.json (written by the progress
// reporter — see apps/web/tests/reporters/progress-reporter.ts).
//
// Required env: GH_TOKEN, PR_NUMBER, SHARD, JOB_URL, GITHUB_REPOSITORY.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const shard = process.env.SHARD ?? '?';
const jobUrl = process.env.JOB_URL ?? '';
const token = process.env.GH_TOKEN;

if (!repo || !prNumber || !token) {
  console.error('Missing GITHUB_REPOSITORY / PR_NUMBER / GH_TOKEN');
  process.exit(0);
}

const marker = `<!-- e2e-failures:shard-${shard} -->`;

const failuresPath = path.resolve('apps/web/test-results/failures.json');
let failures = [];
try {
  const raw = JSON.parse(readFileSync(failuresPath, 'utf8'));
  failures = Array.isArray(raw.failures) ? raw.failures : [];
} catch {
  // No JSON dump (e.g. server-startup failure). Fall back to a generic note.
}

const TRUNCATE_LIMIT = 30_000; // GH issue-comment max is 65,536; stay well under.

function renderBody() {
  const lines = [
    marker,
    `## ❌ Playwright E2E shard ${shard}/4 failed`,
    '',
    `[Job logs](${jobUrl})`,
    '',
  ];
  if (failures.length === 0) {
    lines.push(
      '_No structured failure list was produced (the run likely failed before any test ended — check the job logs)._',
    );
  } else {
    lines.push(`<details open><summary>${failures.length} failure(s)</summary>`);
    lines.push('');
    for (const f of failures) {
      lines.push(`- **${f.title}**`);
      if (f.location) lines.push(`  - at \`${f.location}\``);
      const message = (f.message ?? '').trim();
      if (message) {
        lines.push('  ```');
        for (const ln of message.split('\n')) lines.push(`  ${ln}`);
        lines.push('  ```');
      }
    }
    lines.push('</details>');
  }
  let body = lines.join('\n');
  if (body.length > TRUNCATE_LIMIT) {
    body = body.slice(0, TRUNCATE_LIMIT) + '\n\n_…truncated…_';
  }
  return body;
}

async function gh(method, urlPath, body) {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'showbook-ci',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${urlPath} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function findStickyComment() {
  let page = 1;
  while (page < 10) {
    const comments = await gh(
      'GET',
      `/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
    );
    if (!Array.isArray(comments) || comments.length === 0) return null;
    const hit = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker));
    if (hit) return hit;
    if (comments.length < 100) return null;
    page += 1;
  }
  return null;
}

const body = renderBody();
const existing = await findStickyComment();
if (existing) {
  await gh('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
  console.log(`Updated sticky comment ${existing.id} for shard ${shard}.`);
} else {
  await gh('POST', `/repos/${repo}/issues/${prNumber}/comments`, { body });
  console.log(`Posted sticky comment for shard ${shard}.`);
}
