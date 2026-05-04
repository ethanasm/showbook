#!/usr/bin/env node
/**
 * Local CLI for the read-only `/api/admin/sql` endpoint.
 *
 * Usage:
 *   ADMIN_QUERY_TOKEN=... ADMIN_QUERY_URL=https://prod.example pnpm prod:query "select count(*) from shows"
 *   echo "select count(*) from shows" | pnpm prod:query  # reads from stdin
 *   pnpm prod:query --file query.sql                     # reads from a file
 *
 * Env:
 *   ADMIN_QUERY_TOKEN   bearer token (matches `ADMIN_QUERY_TOKEN` in `.env.prod`)
 *   ADMIN_QUERY_URL     prod base URL, e.g. https://showbook.example.com
 *
 * Exits non-zero on HTTP error; prints rows as a tab-separated table on
 * success, plus a footer with rowCount + elapsedMs.
 */

import { readFileSync } from 'node:fs';

const token = process.env.ADMIN_QUERY_TOKEN;
const baseUrl = process.env.ADMIN_QUERY_URL;

function die(msg, code = 1) {
  process.stderr.write(`prod:query: ${msg}\n`);
  process.exit(code);
}

if (!token) die('ADMIN_QUERY_TOKEN is not set');
if (!baseUrl) die('ADMIN_QUERY_URL is not set (e.g. https://your-prod-host)');

// Pull query from --file <path>, the first positional arg, or stdin.
let query = '';
const args = process.argv.slice(2);
const fileFlag = args.indexOf('--file');
if (fileFlag !== -1 && args[fileFlag + 1]) {
  query = readFileSync(args[fileFlag + 1], 'utf8');
} else if (args[0] && !args[0].startsWith('-')) {
  query = args[0];
} else if (!process.stdin.isTTY) {
  query = await new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}
if (!query.trim()) {
  die('no query provided (pass as first arg, --file <path>, or via stdin)');
}

const url = new URL('/api/admin/sql', baseUrl).toString();
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query }),
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  die(`HTTP ${res.status}: non-JSON response: ${text.slice(0, 500)}`);
}

if (!res.ok) {
  die(`HTTP ${res.status}: ${JSON.stringify(body)}`);
}

const { rows, rowCount, truncated, elapsedMs } = body;

if (rowCount === 0) {
  process.stderr.write(`(0 rows, ${elapsedMs}ms)\n`);
  process.exit(0);
}

// Pretty-print as TSV with header. Postgres-js returns each row as an
// object keyed by column name; preserve insertion order.
const cols = Object.keys(rows[0]);
process.stdout.write(cols.join('\t') + '\n');
for (const row of rows) {
  const values = cols.map((c) => {
    const v = row[c];
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v).replace(/\t/g, '  ').replace(/\n/g, ' ');
  });
  process.stdout.write(values.join('\t') + '\n');
}

process.stderr.write(
  `(${rowCount}${truncated ? '+' : ''} rows, ${elapsedMs}ms)\n`,
);
