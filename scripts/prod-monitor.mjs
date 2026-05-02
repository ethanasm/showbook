#!/usr/bin/env node
// Queries Axiom for recent prod log levels and writes a markdown summary to
// stdout. When run from GitHub Actions, also writes the summary to
// $GITHUB_STEP_SUMMARY and exposes `error_count`, `warn_count`, and a
// multiline `body` via $GITHUB_OUTPUT for the surrounding workflow to
// decide whether to open an alert issue.
//
// Required env: AXIUM_QUERY_TOKEN (a user PAT or query-capable advanced
// token — the repo-side AXIOM_TOKEN is ingest-only and will not work).
// The "AXIUM" spelling matches the existing debugging-prod skill.
//
// Optional env:
//   AXIOM_ORG (default: showbook-egap)
//   AXIOM_DATASET (default: showbook-prod)
//   AXIOM_WINDOW (default: 1h) — APL ago() argument
//   ERROR_SAMPLE_LIMIT (default: 20)

import { appendFileSync } from 'node:fs';

const TOKEN = process.env.AXIUM_QUERY_TOKEN;
const ORG = process.env.AXIOM_ORG ?? 'showbook-egap';
const DATASET = process.env.AXIOM_DATASET ?? 'showbook-prod';
const WINDOW = process.env.AXIOM_WINDOW ?? '1h';
const SAMPLE_LIMIT = Number(process.env.ERROR_SAMPLE_LIMIT ?? 20);

if (!TOKEN) {
  console.error('[prod-monitor] AXIUM_QUERY_TOKEN is not set');
  process.exit(1);
}

async function apl(query) {
  const res = await fetch(
    'https://api.axiom.co/v1/datasets/_apl?format=tabular',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'X-AXIOM-ORG-ID': ORG,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apl: query }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Axiom ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

// Axiom tabular responses are column-oriented:
// { tables: [{ fields: [{name,type}], columns: [[...], [...]] }] }
function rowsFromTabular(json) {
  const table = json?.tables?.[0];
  if (!table) return [];
  const fields = (table.fields ?? []).map((f) => f.name);
  const columns = table.columns ?? [];
  const nRows = columns[0]?.length ?? 0;
  const rows = [];
  for (let i = 0; i < nRows; i++) {
    const row = {};
    for (let j = 0; j < fields.length; j++) {
      row[fields[j]] = columns[j]?.[i];
    }
    rows.push(row);
  }
  return rows;
}

const counts = rowsFromTabular(
  await apl(
    `["${DATASET}"] | where _time > ago(${WINDOW}) | summarize n=count() by level | order by n desc`,
  ),
);

const errorRows = rowsFromTabular(
  await apl(
    `["${DATASET}"] | where _time > ago(${WINDOW}) and level == "error" | project _time, event, component, msg | order by _time desc | limit ${SAMPLE_LIMIT}`,
  ),
);

const errorCount = Number(counts.find((r) => r.level === 'error')?.n ?? 0);
const warnCount = Number(counts.find((r) => r.level === 'warn')?.n ?? 0);

const escape = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

let md = `## Prod monitor — last ${WINDOW}\n\n`;
md += `- **errors:** ${errorCount}\n`;
md += `- **warnings:** ${warnCount}\n`;
md += `- dataset: \`${DATASET}\` · org: \`${ORG}\` · checked at: ${new Date().toISOString()}\n\n`;

if (errorRows.length > 0) {
  md += `### Recent errors (up to ${SAMPLE_LIMIT})\n\n`;
  md += `| time | event | component | msg |\n| --- | --- | --- | --- |\n`;
  for (const r of errorRows) {
    md += `| ${escape(r._time)} | ${escape(r.event)} | ${escape(r.component)} | ${escape(r.msg).slice(0, 200)} |\n`;
  }
  md += '\n';
}

if (counts.length > 0) {
  md += `### Volume by level\n\n`;
  md += `| level | count |\n| --- | --- |\n`;
  for (const r of counts) md += `| ${escape(r.level)} | ${escape(r.n)} |\n`;
}

process.stdout.write(md);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

if (process.env.GITHUB_OUTPUT) {
  const delim = `EOF_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `error_count=${errorCount}\n` +
      `warn_count=${warnCount}\n` +
      `body<<${delim}\n${md}\n${delim}\n`,
  );
}
