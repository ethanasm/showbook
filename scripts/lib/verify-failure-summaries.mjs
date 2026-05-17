// Per-step failure extractors for `verify` / `verify:coverage`. Each
// summarizer takes a log file path (and, for coverage, a JSON path) and
// returns a normalized shape that the post-verify poster renders as a
// markdown <details> section:
//
//   {
//     stepName: 'Lint',
//     headline: '12 lint error(s) across 4 file(s)',
//     items: [{ title, location?, message }, ...],
//     rawTail: string,                 // last ~80 lines of the log, ANSI-stripped
//   }
//
// All summarizers fall back to `rawTail` when their pattern matcher
// finds nothing, so a freak failure mode still gets surfaced.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const MAX_ITEMS = 10;
const TAIL_LINES = 80;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s) {
  return s.replace(ANSI_RE, '');
}

function tailLines(text, n = TAIL_LINES) {
  const lines = stripAnsi(text).split(/\r?\n/);
  return lines.slice(-n).join('\n').trimEnd();
}

async function readLog(path) {
  if (!path || !existsSync(path)) return null;
  return stripAnsi(await readFile(path, 'utf8'));
}

function pluralize(n, singular, plural) {
  return n === 1 ? singular : (plural ?? `${singular}s`);
}

// ──────────────────────────────────────────────────────────────────────
// Build (Next.js / tsc-driven)
// ──────────────────────────────────────────────────────────────────────

export async function summarizeBuild(logPath) {
  const text = await readLog(logPath);
  if (text === null) return null;
  const items = [];

  // Next.js prints "Failed to compile." then per-file blocks:
  //   ./apps/web/lib/foo.ts:42:5
  //   Type error: ...
  //
  //   40 |   ...
  // The (file:line:col, message) pair is what we want.
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && items.length < MAX_ITEMS; i += 1) {
    const m = lines[i].match(/^(\.\/[^\s:]+):(\d+):(\d+)$/);
    if (!m) continue;
    const location = `${m[1].replace(/^\.\//, '')}:${m[2]}:${m[3]}`;
    // Next.js follows the location with the error sentence on the next
    // non-empty line.
    let msg = '';
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
      const trimmed = lines[j].trim();
      if (!trimmed) continue;
      msg = trimmed;
      break;
    }
    items.push({ title: msg || 'Build error', location, message: '' });
  }

  // Fallback: plain `tsc --noEmit` style errors that aren't wrapped in
  // Next.js's "./" prefix: `path/to/file.ts(42,5): error TS2345: ...`
  if (items.length === 0) {
    const tscRe = /^([\w./@-]+\.tsx?)\((\d+),(\d+)\): (error TS\d+: .+)$/;
    for (const line of lines) {
      const m = line.match(tscRe);
      if (!m) continue;
      items.push({
        title: m[4],
        location: `${m[1]}:${m[2]}:${m[3]}`,
        message: '',
      });
      if (items.length >= MAX_ITEMS) break;
    }
  }

  const headline =
    items.length === 0
      ? 'Build failed (no structured errors parsed — see raw log)'
      : `${items.length}${items.length >= MAX_ITEMS ? '+' : ''} build ${pluralize(items.length, 'error')}`;

  return {
    stepName: 'Build',
    headline,
    items,
    rawTail: tailLines(text),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Lint (ESLint stylish formatter)
// ──────────────────────────────────────────────────────────────────────
//
// Stylish output is grouped by file:
//
//   /abs/path/to/file.ts
//     12:5   error    Some message  rule/name
//     14:1   warning  Other thing   other-rule
//
//   ✖ 2 problems (2 errors, 0 warnings)

export async function summarizeLint(logPath) {
  const text = await readLog(logPath);
  if (text === null) return null;
  const items = [];

  const lines = text.split(/\r?\n/);
  let currentFile = null;
  const fileHeaderRe = /^(\/[^:]+|\.\.?\/[^:]+|[A-Za-z]:[\\/][^:]+|[\w./@-]+\.\w+)$/;
  const violationRe = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+([\w@/-]+)\s*$/;

  for (const raw of lines) {
    if (items.length >= MAX_ITEMS) break;
    const line = raw.trimEnd();
    if (!line) continue;
    const v = line.match(violationRe);
    if (v) {
      if (v[3] !== 'error') continue;
      const file = currentFile ? prettyPath(currentFile) : '(unknown)';
      items.push({
        title: `${v[4]} (${v[5]})`,
        location: `${file}:${v[1]}:${v[2]}`,
        message: '',
      });
      continue;
    }
    const f = line.match(fileHeaderRe);
    if (f && !line.startsWith(' ')) {
      currentFile = line;
    }
  }

  // Try to lift the official count line so the headline is accurate even
  // when items got capped.
  const countMatch = text.match(/✖\s+(\d+)\s+problems?\s+\((\d+)\s+errors?,\s+(\d+)\s+warnings?\)/);
  let headline;
  if (countMatch) {
    headline = `${countMatch[2]} lint ${pluralize(Number(countMatch[2]), 'error')}, ${countMatch[3]} ${pluralize(Number(countMatch[3]), 'warning')}`;
  } else if (items.length > 0) {
    headline = `${items.length}${items.length >= MAX_ITEMS ? '+' : ''} lint ${pluralize(items.length, 'error')}`;
  } else {
    headline = 'Lint failed (no structured errors parsed — see raw log)';
  }

  return {
    stepName: 'Lint',
    headline,
    items,
    rawTail: tailLines(text),
  };
}

function prettyPath(absOrRel) {
  const repoRoot = process.cwd();
  if (absOrRel.startsWith(repoRoot + '/')) return absOrRel.slice(repoRoot.length + 1);
  return absOrRel;
}

// Strip absolute prefixes that don't match cwd (e.g. GitHub Actions
// runner path "/home/runner/work/showbook/showbook/...") by anchoring
// on the first repo-recognizable path segment.
function stripToRepoRelative(file, repoRoot) {
  if (file.startsWith(repoRoot + '/')) return file.slice(repoRoot.length + 1);
  const m = file.match(/\/((?:apps|packages|scripts|specs)\/.+)$/);
  if (m) return m[1];
  return file.replace(/^(\.\.\/)+/, '');
}

// ──────────────────────────────────────────────────────────────────────
// node:test (spec reporter)
// ──────────────────────────────────────────────────────────────────────
//
// node:test spec output ends with a "✖ failing tests:" section that
// lists each failure in a clean, parseable form:
//
//   ✖ failing tests:
//
//   test at /abs/path/file.test.ts:42:5
//   ✖ test name (5.123ms)
//     AssertionError [ERR_ASSERTION]: expected x to equal y
//         at TestContext.<anonymous> (/abs/path/file.test.ts:42:5)
//         ...
//
// We parse only that section so we don't mistake the inline-progress
// `✖` lines (e.g. `✖ outer suite (Xms)`, `✖ /path/to/file.test.ts`)
// for individual failures.

export async function summarizeNodeTest(logPath, kind) {
  const text = await readLog(logPath);
  if (text === null) return null;
  const lines = text.split(/\r?\n/);
  const repoRoot = process.cwd();
  const items = [];

  const sectionStart = lines.findIndex((l) => /^✖\s+failing tests:/.test(l));
  if (sectionStart !== -1) {
    let pendingLocation = null;
    for (let i = sectionStart + 1; i < lines.length && items.length < MAX_ITEMS; i += 1) {
      const line = lines[i];

      const loc = line.match(/^test at\s+(.+?\.tsx?):(\d+):(\d+)\s*$/);
      if (loc) {
        pendingLocation = `${stripToRepoRelative(loc[1], repoRoot)}:${loc[2]}:${loc[3]}`;
        continue;
      }

      const header = line.match(/^✖\s+(.+?)(?:\s+\(\d+(?:\.\d+)?ms\))?\s*$/);
      if (!header || !pendingLocation) continue;
      const title = header[1].trim();
      // Skip the section's own banner if we somehow looped back to it.
      if (/^failing tests:?$/i.test(title)) continue;

      let message = '';
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j += 1) {
        const sub = lines[j];
        if (!sub.trim()) continue;
        if (/^test at\s+/.test(sub)) break;
        if (/^✖\s+/.test(sub)) break;
        // The first non-stack-frame indented line is the assertion message.
        if (/^\s+\S/.test(sub) && !/^\s+at\s/.test(sub) && !/^\s+(code|generatedMessage|actual|expected|operator|diff):/.test(sub)) {
          message = sub.trim();
          break;
        }
      }
      items.push({ title, location: pendingLocation, message });
      pendingLocation = null;
    }
  }

  // Fallback: scan for inline `✖` lines paired with stack frames (used
  // when the run was killed before the "failing tests:" footer was
  // emitted, e.g. a batch-timeout SIGKILL).
  if (items.length === 0) {
    for (let i = 0; i < lines.length && items.length < MAX_ITEMS; i += 1) {
      const line = lines[i];
      const fail = line.match(/^\s+✖\s+(.+?)(?:\s+\(\d+(?:\.\d+)?ms\))?\s*$/);
      if (!fail) continue;
      const title = fail[1].trim();
      let message = '';
      let location;
      for (let j = i + 1; j < Math.min(i + 30, lines.length); j += 1) {
        const sub = lines[j];
        if (!sub.trim()) continue;
        if (/^\s+(?:✖|✔)\s+/.test(sub)) break;
        if (!message && /^\s+\S/.test(sub) && !/^\s+at\s/.test(sub)) {
          message = sub.trim();
        }
        if (!location) {
          const at = sub.match(/at\s+(?:[^(]+\()?([^)\s]+\.tsx?):(\d+):(\d+)/);
          if (at && !at[1].includes('node_modules')) {
            location = `${stripToRepoRelative(at[1], repoRoot)}:${at[2]}:${at[3]}`;
          }
        }
        if (message && location) break;
      }
      items.push({ title, location, message });
    }
  }

  const label = kind === 'integration' ? 'integration' : 'unit';
  const headline =
    items.length === 0
      ? `${label} tests failed (no structured failures parsed — see raw log)`
      : `${items.length}${items.length >= MAX_ITEMS ? '+' : ''} failing ${label} ${pluralize(items.length, 'test')}`;

  // Prefer the "failing tests:" section as the rawTail — it's the part
  // a triager actually needs, and it survives the coverage report that
  // otherwise pushes everything useful out of the last 80 lines.
  let rawTail;
  if (sectionStart !== -1) {
    rawTail = lines.slice(sectionStart).join('\n').trimEnd();
    if (rawTail.split('\n').length > TAIL_LINES * 2) {
      rawTail = lines.slice(sectionStart, sectionStart + TAIL_LINES * 2).join('\n').trimEnd();
    }
  } else {
    rawTail = tailLines(text);
  }

  return {
    stepName: kind === 'integration' ? 'Integration tests' : 'Unit tests',
    headline,
    items,
    rawTail,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Coverage threshold gate
// ──────────────────────────────────────────────────────────────────────
//
// Reads the JSON written by coverage-report.mjs --json-out=...
//   {
//     thresholdPct: 80,
//     scopes: [{ scope, lines, branches, functions }, ...],
//     breaches: [{ scope, metric, value }, ...]
//   }

export async function summarizeCoverage(jsonPath, logPath) {
  let parsed = null;
  if (jsonPath && existsSync(jsonPath)) {
    try {
      parsed = JSON.parse(await readFile(jsonPath, 'utf8'));
    } catch {
      parsed = null;
    }
  }
  const text = (await readLog(logPath)) ?? '';

  const items = [];
  if (parsed?.breaches?.length) {
    for (const b of parsed.breaches.slice(0, MAX_ITEMS)) {
      items.push({
        title: `[${b.scope}] ${b.metric} ${Number(b.value).toFixed(2)}% < ${parsed.thresholdPct}%`,
        message: '',
      });
    }
  }

  let headline;
  if (parsed?.breaches?.length) {
    headline = `${parsed.breaches.length} coverage ${pluralize(parsed.breaches.length, 'breach', 'breaches')} below ${parsed.thresholdPct}%`;
  } else if (text) {
    headline = 'Coverage step failed (no structured breach data — see raw log)';
  } else {
    return null;
  }

  return {
    stepName: 'Coverage threshold',
    headline,
    items,
    rawTail: text ? tailLines(text) : '',
  };
}
