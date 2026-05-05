#!/usr/bin/env node
// Validates Maestro flow YAML without launching a device.
// Maestro itself has no --dry-run flag, so we parse each file as
// a two-document YAML (config + commands) and sanity-check the shape.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseAllDocuments } from 'yaml';

const root = resolve(process.argv[2] ?? 'e2e/flows');

function collectFlowFiles(target) {
  const stat = statSync(target);
  if (stat.isFile()) return target.endsWith('.yaml') || target.endsWith('.yml') ? [target] : [];
  return readdirSync(target)
    .flatMap((name) => collectFlowFiles(join(target, name)));
}

const files = collectFlowFiles(root);
if (files.length === 0) {
  console.error(`No flow files found under ${root}`);
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const docs = parseAllDocuments(source, { prettyErrors: true });

  const errors = docs.flatMap((d) => d.errors);
  if (errors.length > 0) {
    console.error(`✗ ${file}`);
    for (const err of errors) console.error(`  ${err.message}`);
    failed++;
    continue;
  }

  if (docs.length !== 2) {
    console.error(`✗ ${file}: expected 2 YAML documents (config + commands), got ${docs.length}`);
    failed++;
    continue;
  }

  const config = docs[0].toJS();
  const commands = docs[1].toJS();

  if (!config || typeof config.appId !== 'string' || config.appId.length === 0) {
    console.error(`✗ ${file}: missing or invalid appId in config document`);
    failed++;
    continue;
  }

  if (!Array.isArray(commands) || commands.length === 0) {
    console.error(`✗ ${file}: commands document must be a non-empty list`);
    failed++;
    continue;
  }

  console.log(`✓ ${file} (${commands.length} steps, appId=${config.appId})`);
}

if (failed > 0) {
  console.error(`\n${failed} flow file(s) failed validation`);
  process.exit(1);
}
console.log(`\n${files.length} flow file(s) OK`);
