#!/usr/bin/env node
// Post (or update) a sticky PR comment with the verify / verify:coverage
// failure summary. Mirrors the pattern used by post-e2e-failure-comment.mjs
// so failure detail reaches PR-watching sessions over the comment webhook
// (rather than requiring CI-log fetches).
//
// Reads `.verify-logs/<step>.log` (written by scripts/verify.sh and
// scripts/verify-coverage.sh) plus `.verify-logs/coverage.json` (written
// by scripts/coverage-report.mjs --json-out).
//
// Env (CI):
//   GH_TOKEN, PR_NUMBER, GITHUB_REPOSITORY, JOB_URL
//
// CLI flags:
//   --dry-run   print body to stdout instead of POSTing
//   --log-dir=  override .verify-logs location

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { upsertStickyComment } from './lib/sticky-pr-comment.mjs';
import {
  summarizeBuild,
  summarizeLint,
  summarizeNodeTest,
  summarizeCoverage,
} from './lib/verify-failure-summaries.mjs';

const MARKER = '<!-- verify-failures -->';
const TRUNCATE_LIMIT = 30_000;
const RAW_TAIL_MAX_CHARS = 4_000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
let logDir = '.verify-logs';
for (const arg of args) {
  if (arg.startsWith('--log-dir=')) logDir = arg.slice('--log-dir='.length);
}
logDir = path.resolve(logDir);

const repo = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const token = process.env.GH_TOKEN;
const jobUrl = process.env.JOB_URL ?? '';

function statusPath(slug) {
  return path.join(logDir, `${slug}.status`);
}

function readStatus(slug) {
  const p = statusPath(slug);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').trim();
}

function logPath(slug) {
  return path.join(logDir, `${slug}.log`);
}

async function collectSections() {
  // Discover which steps ran from the .status sidecar files that
  // verify.sh / verify-coverage.sh drop next to each .log.
  const statuses = {};
  if (existsSync(logDir)) {
    for (const entry of readdirSync(logDir)) {
      if (!entry.endsWith('.status')) continue;
      const slug = entry.slice(0, -'.status'.length);
      statuses[slug] = readFileSync(path.join(logDir, entry), 'utf8').trim();
    }
  }

  const sections = [];

  const seen = new Set();
  async function addIfFailed(slug, runner) {
    if (seen.has(slug)) return;
    seen.add(slug);
    if (readStatus(slug) !== 'fail') return;
    const result = await runner(logPath(slug));
    if (result) sections.push(result);
  }

  await addIfFailed('build', (p) => summarizeBuild(p));
  await addIfFailed('lint', (p) => summarizeLint(p));
  await addIfFailed('unit-tests', (p) => summarizeNodeTest(p, 'unit'));
  await addIfFailed('integration-tests', (p) => summarizeNodeTest(p, 'integration'));
  await addIfFailed('coverage-threshold', () =>
    summarizeCoverage(path.join(logDir, 'coverage.json'), logPath('coverage-threshold')),
  );

  // Surface any other failed steps (e.g. DB prepare) as plain rawTail
  // sections so nothing slips through.
  for (const [slug, status] of Object.entries(statuses)) {
    if (status !== 'fail') continue;
    if (seen.has(slug)) continue;
    const lp = logPath(slug);
    if (!existsSync(lp)) continue;
    const raw = readFileSync(lp, 'utf8');
    sections.push({
      stepName: prettifySlug(slug),
      headline: `${prettifySlug(slug)} failed (no structured summary)`,
      items: [],
      rawTail: tail(raw),
    });
  }

  return sections;
}

function prettifySlug(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function tail(text, max = 80) {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .slice(-max)
    .join('\n')
    .trimEnd();
}

function renderSection(section) {
  const lines = [];
  lines.push(`### ✗ ${section.stepName} — ${section.headline}`);
  lines.push('');
  if (section.items.length > 0) {
    lines.push(`<details open><summary>${section.items.length} item(s)</summary>`);
    lines.push('');
    for (const item of section.items) {
      lines.push(`- **${item.title}**`);
      if (item.location) lines.push(`  - at \`${item.location}\``);
      if (item.message) {
        lines.push('  ```');
        for (const ln of item.message.split('\n')) lines.push(`  ${ln}`);
        lines.push('  ```');
      }
    }
    lines.push('</details>');
    lines.push('');
  }
  if (section.rawTail) {
    let tailBlock = section.rawTail;
    if (tailBlock.length > RAW_TAIL_MAX_CHARS) {
      tailBlock = '…\n' + tailBlock.slice(-RAW_TAIL_MAX_CHARS);
    }
    lines.push('<details><summary>raw log tail</summary>');
    lines.push('');
    lines.push('```');
    lines.push(tailBlock);
    lines.push('```');
    lines.push('</details>');
  }
  return lines.join('\n');
}

function renderBody(sections) {
  const lines = [MARKER];
  lines.push(`## ❌ \`verify:coverage\` failed`);
  lines.push('');
  if (jobUrl) lines.push(`[Job logs](${jobUrl})`);
  lines.push('');
  if (sections.length === 0) {
    lines.push(
      '_No per-step failure logs were captured (the run likely exited before any step finished — see the job logs)._',
    );
  } else {
    for (const section of sections) {
      lines.push(renderSection(section));
      lines.push('');
    }
  }
  let body = lines.join('\n');
  if (body.length > TRUNCATE_LIMIT) {
    body = body.slice(0, TRUNCATE_LIMIT) + '\n\n_…truncated…_';
  }
  return body;
}

async function main() {
  const sections = await collectSections();
  const body = renderBody(sections);

  if (dryRun) {
    process.stdout.write(body + '\n');
    return;
  }
  if (!repo || !prNumber || !token) {
    console.error(
      'post-verify-failure-comment: missing GITHUB_REPOSITORY / PR_NUMBER / GH_TOKEN — skipping comment.',
    );
    return;
  }
  const result = await upsertStickyComment({
    repo,
    prNumber,
    token,
    marker: MARKER,
    body,
  });
  console.log(
    result.action === 'updated'
      ? `Updated sticky verify-failure comment ${result.id}.`
      : `Posted sticky verify-failure comment ${result.id}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
