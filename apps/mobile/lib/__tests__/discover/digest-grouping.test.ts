/**
 * Pure-helper tests for the Discover "New for you" (digest) tab grouping.
 * The screen wiring is exercised by the Playwright web bundle + Maestro
 * flows; the branchy bucketing logic lives here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DIGEST_REASON_HEADERS,
  DIGEST_REASON_ORDER,
  groupDigestByReason,
} from '../../discover/digest-grouping';

type Row = { id: string; reason?: string };

describe('groupDigestByReason', () => {
  it('returns [] for an empty input', () => {
    assert.deepEqual(groupDigestByReason([]), []);
  });

  it('orders sections venue → artist → region and omits empty ones', () => {
    const items: Row[] = [
      { id: 'r1', reason: 'region' },
      { id: 'v1', reason: 'venue' },
      { id: 'a1', reason: 'artist' },
    ];
    const sections = groupDigestByReason(items);
    assert.deepEqual(
      sections.map((s) => s.reason),
      ['venue', 'artist', 'region'],
    );
  });

  it('preserves input (position) order within a section', () => {
    const items: Row[] = [
      { id: 'v1', reason: 'venue' },
      { id: 'v2', reason: 'venue' },
      { id: 'v3', reason: 'venue' },
    ];
    const [venue] = groupDigestByReason(items);
    assert.deepEqual(
      venue!.items.map((i) => i.id),
      ['v1', 'v2', 'v3'],
    );
  });

  it('drops rows with a missing or unrecognized reason', () => {
    const items: Row[] = [
      { id: 'ok', reason: 'venue' },
      { id: 'none' },
      { id: 'weird', reason: 'mystery' },
    ];
    const sections = groupDigestByReason(items);
    assert.equal(sections.length, 1);
    assert.deepEqual(
      sections[0]!.items.map((i) => i.id),
      ['ok'],
    );
  });

  it('exposes a header for every reason in the order list', () => {
    for (const reason of DIGEST_REASON_ORDER) {
      assert.ok(DIGEST_REASON_HEADERS[reason]);
    }
  });
});
