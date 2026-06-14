import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getBossState, stopBoss } from '../boss';

const STATE_KEY = Symbol.for('showbook.jobs.boss');

type BossState = { boss: unknown; started: boolean };

function globalState(): BossState | undefined {
  return (globalThis as Record<symbol, BossState | undefined>)[STATE_KEY];
}

test('getBossState reports stopped before any start', () => {
  // Ensure a clean global anchor for this assertion.
  delete (globalThis as Record<symbol, unknown>)[STATE_KEY];
  assert.equal(getBossState(), 'stopped');
});

test('getBossState reflects the globalThis-anchored started flag', () => {
  // Simulate the instrumentation module copy flipping `started` on the
  // shared global anchor; the route-handler copy (this import) must
  // observe it. This is the regression guard for the deploy health gate:
  // before the global anchor, a duplicated module copy kept its own
  // perpetually-false `started` and `/api/health/ready` 503'd forever.
  delete (globalThis as Record<symbol, unknown>)[STATE_KEY];
  // First read lazily creates the anchor.
  assert.equal(getBossState(), 'stopped');
  const state = globalState();
  assert.ok(state, 'global anchor should exist after first read');
  state.started = true;
  assert.equal(getBossState(), 'started');
});

test('stopBoss is a no-op when nothing was started', async () => {
  delete (globalThis as Record<symbol, unknown>)[STATE_KEY];
  await assert.doesNotReject(stopBoss());
  assert.equal(getBossState(), 'stopped');
});
