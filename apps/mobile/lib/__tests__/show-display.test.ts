/**
 * Tests for `headlinerDisplayName`.
 *
 * The regression: festival shows that carry both a headliner performer
 * (e.g. "The Rapture") and a `productionName` (e.g. "Portola Music
 * Festival") were rendering the headliner in the mobile timeline /
 * artist screens, while the web app correctly preferred the festival
 * name via `@showbook/shared.getHeadliner`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { headlinerDisplayName } from '../show-display.js';

describe('headlinerDisplayName', () => {
  it('returns the productionName for a festival that also has a headliner', () => {
    const label = headlinerDisplayName({
      kind: 'festival',
      productionName: 'Portola Music Festival',
      performers: [
        { name: 'The Rapture', role: 'headliner', sortOrder: 0 },
        { name: 'Moby', role: 'support', sortOrder: 1 },
      ],
    });
    assert.equal(label, 'Portola Music Festival');
  });

  it('returns the productionName for a theatre production with a cast', () => {
    const label = headlinerDisplayName({
      kind: 'theatre',
      productionName: 'Hadestown',
      performers: [
        { name: 'Lead Actor', role: 'headliner', sortOrder: 0 },
      ],
    });
    assert.equal(label, 'Hadestown');
  });

  it('returns the headliner for a concert (ignores productionName)', () => {
    const label = headlinerDisplayName({
      kind: 'concert',
      productionName: 'Should Be Ignored',
      performers: [
        { name: 'Phoebe Bridgers', role: 'headliner', sortOrder: 0 },
      ],
    });
    assert.equal(label, 'Phoebe Bridgers');
  });

  it('prefers headliner with sortOrder=0 over later headliners', () => {
    const label = headlinerDisplayName({
      kind: 'concert',
      productionName: null,
      performers: [
        { name: 'Second', role: 'headliner', sortOrder: 1 },
        { name: 'First', role: 'headliner', sortOrder: 0 },
      ],
    });
    assert.equal(label, 'First');
  });

  it('falls back to productionName when a festival has no headliner', () => {
    const label = headlinerDisplayName({
      kind: 'festival',
      productionName: 'Some Festival',
      performers: [],
    });
    assert.equal(label, 'Some Festival');
  });

  it('returns the configured fallback when nothing identifies the show', () => {
    const label = headlinerDisplayName({
      kind: 'concert',
      productionName: null,
      performers: [],
      fallback: 'Untitled show',
    });
    assert.equal(label, 'Untitled show');
  });
});
