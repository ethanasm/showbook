/**
 * Unit tests for the conversation-memory buffer used by the chat-mode
 * Add screen. Pure-function tests — no React, no tRPC.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRecent,
  isConversationKind,
  MAX_SESSION_RECENT,
  type SessionRecentShow,
} from '../conversationMemory';

describe('appendRecent', () => {
  it('prepends a new entry to an empty buffer', () => {
    const out = appendRecent([], { headliner: 'Bon Iver' });
    assert.deepEqual(out, [{ headliner: 'Bon Iver' }]);
  });

  it('places the newest entry at the front (LRU on a small list)', () => {
    const buf: SessionRecentShow[] = [
      { headliner: 'Phoebe Bridgers' },
      { headliner: 'Big Thief' },
    ];
    const out = appendRecent(buf, { headliner: 'Bon Iver' });
    assert.deepEqual(
      out.map((s) => s.headliner),
      ['Bon Iver', 'Phoebe Bridgers', 'Big Thief'],
    );
  });

  it('caps the buffer at MAX_SESSION_RECENT entries', () => {
    let buf: SessionRecentShow[] = [];
    for (let i = 0; i < 12; i++) {
      buf = appendRecent(buf, { headliner: `Artist ${i}` });
    }
    assert.equal(buf.length, MAX_SESSION_RECENT);
    // The 5 most-recent should be in there, with the very latest at front
    assert.equal(buf[0].headliner, 'Artist 11');
    assert.equal(buf[4].headliner, 'Artist 7');
  });

  it('floats a re-mentioned headliner to the front (case-insensitive)', () => {
    // Regression for the bug case: user adds Bon Iver, says "I saw him
    // again in 2016". The parseChat result re-mentions Bon Iver — that
    // should not double the entry, it should refresh its position.
    const buf: SessionRecentShow[] = [
      { headliner: 'Phoebe Bridgers' },
      { headliner: 'Bon Iver', date: '2018-08-05' },
    ];
    const out = appendRecent(buf, { headliner: 'BON IVER', date: '2016-10-23' });
    assert.equal(out.length, 2);
    assert.equal(out[0].headliner, 'BON IVER');
    assert.equal(out[0].date, '2016-10-23');
    assert.equal(out[1].headliner, 'Phoebe Bridgers');
  });

  it('drops empty / whitespace-only headliners without mutating', () => {
    const buf: SessionRecentShow[] = [{ headliner: 'Bon Iver' }];
    assert.deepEqual(appendRecent(buf, { headliner: '' }), buf);
    assert.deepEqual(appendRecent(buf, { headliner: '   ' }), buf);
    // Must return a new array even on the no-op so callers using it as
    // a useState setter don't accidentally retain reference equality.
    assert.notStrictEqual(appendRecent(buf, { headliner: '' }), buf);
  });
});

describe('isConversationKind', () => {
  it('accepts each of the four watchable kinds', () => {
    for (const k of ['concert', 'theatre', 'comedy', 'festival'] as const) {
      assert.equal(isConversationKind(k), true);
    }
  });

  it('rejects everything else', () => {
    for (const v of [
      null,
      undefined,
      '',
      'film',
      'unknown',
      42,
      {},
      ['concert'],
    ]) {
      assert.equal(isConversationKind(v), false);
    }
  });
});
