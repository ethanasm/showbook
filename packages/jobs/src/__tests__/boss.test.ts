import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getBossState, stopBoss } from '../boss';

// boss.ts backs its singleton + lifecycle flag with a `globalThis`-keyed
// holder (`__showbookBossLifecycle`) so every transpiled copy of the module —
// the `instrumentation.ts` bundle that calls `startBoss()` and the
// route-handler bundle that calls `getBossState()` from /api/health/ready —
// shares one object. (The key is `__showbookBossLifecycle`, not `__showbookBoss`:
// the latter collided with the API's send-only enqueue client and was renamed
// in #611 — see the note in boss.ts.) These tests are the regression guard for
// that: they mutate the shared holder directly (standing in for the "other"
// bundle's copy writing to the same global) and assert `getBossState()` observes
// it. If the state ever regresses to a plain module-local `let`, mutating the
// holder would no longer move `getBossState()` and these fail.
function holder(): { boss: unknown; started: boolean } {
  const h = (globalThis as Record<string, unknown>).__showbookBossLifecycle as
    | { boss: unknown; started: boolean }
    | undefined;
  assert.ok(h, 'boss.ts should create the global holder on import');
  return h;
}

test('getBossState reflects the shared globalThis-anchored started flag', () => {
  const h = holder();
  h.started = false;
  assert.equal(getBossState(), 'stopped');
  h.started = true;
  assert.equal(getBossState(), 'started');
  h.started = false;
});

test('stopBoss is a no-op when nothing was started', async () => {
  const h = holder();
  h.boss = null;
  h.started = false;
  await assert.doesNotReject(stopBoss());
  assert.equal(getBossState(), 'stopped');
});
